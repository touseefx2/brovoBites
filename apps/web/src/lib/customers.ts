import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { CUSTOMER_NOTE_MAX, phoneKey, type AppUser, type Customer, type Order } from "@bravobites/domain";
import { getClientAuth, getClientDb } from "@/lib/firebase/client";
import { asOrder } from "@/lib/firestore-parse";
import { trackInventoryWrite } from "@/lib/firestore";
import { apiFetch } from "@/lib/http";

/**
 * Customers in the app: the list (live, and from this browser's cache when
 * offline), the counter note, a customer's orders, and the owner's changes
 * (sent to the server, which rebuilds the numbers from the orders).
 */

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max).map((x) => x.slice(0, 300));

/** Firestore doc → Customer (every field coerced; missing numbers = 0). */
export function asCustomer(id: string, d: DocumentData): Customer {
  const c: Customer = {
    id,
    phone: str(d.phone, 20) || id,
    name: str(d.name, 80),
    otherNames: strList(d.otherNames, 10),
    addresses: strList(d.addresses, 10),
    note: str(d.note, CUSTOMER_NOTE_MAX),
    orderCount: Math.max(0, Math.floor(Number(d.orderCount) || 0)),
    totalSpent: Math.max(0, Number(d.totalSpent) || 0),
    firstOrderAt: str(d.firstOrderAt, 40),
    lastOrderAt: str(d.lastOrderAt, 40),
  };
  if (d.lastOrderId) c.lastOrderId = str(d.lastOrderId, 64);
  if (d.lastBranchId) c.lastBranchId = str(d.lastBranchId, 64);
  if (d.noteUpdatedByName) c.noteUpdatedByName = str(d.noteUpdatedByName, 120);
  if (d.nameLocked === true) c.nameLocked = true;
  const alt = strList(d.altPhones, 30);
  if (alt.length) c.altPhones = alt;
  if (d.mergedInto) c.mergedInto = str(d.mergedInto, 20);
  return c;
}

/**
 * Every customer, live. Works offline from this browser's copy (the POS
 * search never waits for the network). Merged-away numbers are left out.
 */
export function onCustomersSnapshot(
  callback: (customers: Customer[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getClientDb(), "customers"),
    (snap) => {
      callback(
        snap.docs
          .map((d) => asCustomer(d.id, d.data()))
          .filter((c) => !c.mergedInto)
          .sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt) || a.name.localeCompare(b.name)),
      );
    },
    (err) => onError?.(err),
  );
}

/**
 * Save the counter note for a phone number. Not awaited by checkout: offline
 * it waits in Firestore's own queue and goes up with the net.
 */
export function saveCustomerNote(rawPhone: string, note: string, user: AppUser): Promise<void> {
  const key = phoneKey(rawPhone);
  if (!key) return Promise.resolve();
  const write = setDoc(
    doc(getClientDb(), "customers", key),
    {
      phone: key,
      note: note.replace(/\s+/g, " ").trim().slice(0, CUSTOMER_NOTE_MAX),
      noteUpdatedBy: user.uid,
      // Must equal the profile's name or email exactly (rules); a name over 120 letters → the email.
      noteUpdatedByName: user.displayName && user.displayName.length <= 120 ? user.displayName : user.email || "",
      noteUpdatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  // Logout waits for it: on a shared PC it must not go up under the next person's login.
  trackInventoryWrite(write);
  return write;
}

/**
 * A customer's orders (all their numbers), newest first. Staff ask per branch
 * they work at (the rules only let them read their branches' orders).
 */
export async function fetchCustomerOrders(
  phoneKeys: readonly string[],
  user: Pick<AppUser, "role" | "branchIds">,
): Promise<Order[]> {
  const keys = phoneKeys.slice(0, 30);
  if (keys.length === 0) return [];
  const col = collection(getClientDb(), "orders");
  const queries =
    user.role === "owner"
      ? [query(col, where("customerKey", "in", keys))]
      : user.branchIds.map((b) => query(col, where("branchId", "==", b), where("customerKey", "in", keys)));
  const snaps = await Promise.all(queries.map((q) => getDocs(q)));
  const byId = new Map<string, Order>();
  for (const s of snaps) for (const d of s.docs) byId.set(d.id, asOrder(d.id, d.data()));
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type CustomerManageAction =
  | { action: "rename"; key: string; name: string | null }
  | { action: "merge"; from: string; into: string }
  | { action: "rebuild" };

/** Owner changes, done by the server (it rebuilds the numbers). Throws with the server's message. */
export async function manageCustomer(body: CustomerManageAction): Promise<unknown> {
  const token = await getClientAuth().currentUser?.getIdToken();
  const res = await apiFetch(
    "/api/customers/manage",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    },
    { timeoutMs: 120_000 },
  );
  const data = (await res.json().catch(() => null)) as { error?: string; result?: unknown } | null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data?.result;
}
