import { phoneKey } from "@bravobites/domain";
import { getClientAuth } from "@/lib/firebase/client";
import { apiFetch } from "@/lib/http";

/**
 * Customers to bring up to date: after a sale or an order change reaches the
 * cloud, its phone number(s) wait here (this browser's storage, so a reload
 * keeps them) until the server rebuilds those customers from their orders.
 * Best effort and never in the way of a sale: anything missed is caught by
 * the hourly server run. Asking twice is harmless.
 */

const STORE = "bb:customerOutbox";
const BATCH = 25;
/** After a failed send, wait before the next try. */
const RETRY_MS = 2 * 60_000;

let failedAt = 0;
/** One send at a time (several sync passes / tabs may ask). */
let inFlight = false;

/** A queued number and when it was (last) queued. */
type Entry = { k: string; t: number };

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list.flatMap((x): Entry[] => {
      if (typeof x === "string") return [{ k: x, t: 0 }]; // older format: plain keys
      if (x && typeof x === "object" && typeof (x as Entry).k === "string") {
        return [{ k: (x as Entry).k, t: Number((x as Entry).t) || 0 }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

/** Fired on window when the queue changes (the POS list re-reads which sales still wait). */
export const CUSTOMER_OUTBOX_EVENT = "bb:customer-outbox";

function write(entries: Entry[]) {
  try {
    if (entries.length === 0) localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, JSON.stringify(entries.slice(-500)));
  } catch {
    // storage blocked / full: the hourly server run still catches up
  }
  try {
    window.dispatchEvent(new Event(CUSTOMER_OUTBOX_EVENT));
  } catch {
    // no window (server render)
  }
}

/**
 * Queue the customers behind these phone numbers (any shape; blanks ignored).
 * Works offline too — the numbers wait here for the next send.
 */
export function queueCustomerUpdate(...phones: (string | null | undefined)[]): void {
  const keys = [...new Set(phones.map((p) => phoneKey(p)).filter(Boolean))];
  if (keys.length === 0) return;
  const now = Date.now();
  // Queued again: the newer time, so a send already under way doesn't clear it.
  write([...read().filter((e) => !keys.includes(e.k)), ...keys.map((k) => ({ k, t: now }))]);
}

/** Numbers still waiting (tests / diagnostics). */
export function queuedCustomerKeys(): string[] {
  return read().map((e) => e.k);
}

/**
 * Send what is queued (online, signed in). Never throws. A number leaves the
 * queue only after the server answered OK — a reload, app update or closed
 * tab mid-send keeps it for the next try (sending twice is harmless).
 */
export async function flushCustomerUpdates(): Promise<void> {
  // A flag set and cleared in the same call: a run that finishes without
  // waiting (nothing queued) must not leave it set for good.
  if (inFlight) return;
  inFlight = true;
  let release: (() => void) | null = null;
  try {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (Date.now() - failedAt < RETRY_MS) return;
    const user = getClientAuth().currentUser;
    if (!user) return;
    let entries = read();
    if (entries.length === 0) return;
    // An app update waits for this send (it would reload the page mid-request).
    release = (await import("@/lib/app-update")).holdAppUpdate();
    const tried = new Set<string>();
    while (entries.length > 0) {
      const batch = entries.filter((e) => !tried.has(e.k)).slice(0, BATCH);
      if (batch.length === 0) break;
      const sentAt = Date.now();
      const token = await user.getIdToken();
      const res = await apiFetch(
        "/api/customers/reconcile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ keys: batch.map((e) => e.k) }),
        },
        { timeoutMs: 45_000 },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Done: remove them — unless queued again while this was sending.
      const sent = new Set(batch.map((e) => e.k));
      batch.forEach((e) => tried.add(e.k));
      write(read().filter((e) => !(sent.has(e.k) && e.t <= sentAt)));
      entries = read();
    }
  } catch (err) {
    failedAt = Date.now();
    console.warn("[customers] update not sent yet", err);
  } finally {
    release?.();
    inFlight = false;
  }
}
