import { FieldValue, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import {
  CUSTOMER_MAX_OTHER_NAMES,
  phoneKey,
  statsFromOrders,
  type CustomerOrderLike,
  type CustomerStats,
} from "@bravobites/domain";

/**
 * Customers on the server (admin SDK). A customer's numbers are always
 * rebuilt from their orders (statsFromOrders) — never "+1 per sale" — so a
 * sale uploaded twice, a cancel, refund, edit or a phone changed later can't
 * leave them wrong, and running it again changes nothing.
 *
 * What only people write stays as it is: the note, a name the owner set by
 * hand, merged numbers.
 */

export const CUSTOMERS = "customers";
/** Firestore `in` takes at most 30 values. */
const IN_MAX = 30;
/** Where the hourly safety net remembers how far it got (server-only; rules deny clients). */
const CRON_STATE = { collection: "serverState", doc: "customersCron" } as const;
/** How many merge stubs to follow at most (a merge keeps it to one). */
const MAX_HOPS = 10;

const str = (v: unknown) => (typeof v === "string" ? v : "");

function asOrderLike(id: string, d: DocumentData): CustomerOrderLike {
  return {
    id,
    createdAt: str(d.createdAt),
    status: str(d.status),
    total: Number(d.total) || 0,
    refundAmount: Number(d.refundAmount) || 0,
    customerName: str(d.customerName),
    deliveryAddress: str(d.deliveryAddress),
    branchId: str(d.branchId),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The stats fields a customer doc gets from their orders (a hand-set name kept). */
function statsDoc(key: string, data: DocumentData | undefined, stats: CustomerStats) {
  const locked = Boolean(data?.nameLocked) && str(data?.name);
  const name = locked ? str(data!.name) : stats.name;
  const otherNames = locked
    ? [stats.name, ...stats.otherNames]
        .filter((n) => n && n.toLowerCase() !== name.toLowerCase())
        .slice(0, CUSTOMER_MAX_OTHER_NAMES)
    : stats.otherNames;
  return {
    phone: key,
    name,
    otherNames,
    addresses: stats.addresses,
    orderCount: stats.orderCount,
    totalSpent: stats.totalSpent,
    firstOrderAt: stats.firstOrderAt,
    lastOrderAt: stats.lastOrderAt,
    lastOrderId: stats.lastOrderId,
    lastBranchId: stats.lastBranchId,
  };
}

/** What to do with a customer doc given their orders' stats: write these fields, delete, or nothing. */
function plan(key: string, data: DocumentData | undefined, stats: CustomerStats | null):
  | { op: "set"; fields: Record<string, unknown> }
  | { op: "delete" }
  | { op: "none" } {
  // A merged number's stub only points to its customer: never counted, never removed.
  if (str(data?.mergedInto)) return { op: "none" };
  if (!stats) {
    if (!data) return { op: "none" };
    // No order counts any more: keep a customer someone wrote a note for, named, or merged
    // numbers into (their stubs point here); drop the rest.
    if (str(data.note) || data.nameLocked || ((data.altPhones as unknown[] | undefined)?.length ?? 0) > 0) {
      return data.orderCount === 0 && data.totalSpent === 0
        ? { op: "none" }
        : { op: "set", fields: { orderCount: 0, totalSpent: 0 } };
    }
    return { op: "delete" };
  }
  const next = statsDoc(key, data, stats);
  const unchanged = data && (Object.keys(next) as (keyof typeof next)[]).every((k) => same(data[k], next[k]));
  return unchanged ? { op: "none" } : { op: "set", fields: next };
}

export type ReconcileResult = { key: string; status: "updated" | "unchanged" | "removed" | "none"; into?: string };

/**
 * Rebuild one customer from their orders, in a transaction: two runs at once
 * (two PCs, the cron) can't write older numbers over newer ones.
 */
export async function reconcileCustomer(db: Firestore, rawKey: string): Promise<ReconcileResult> {
  const asked = phoneKey(rawKey);
  if (!asked) return { key: rawKey, status: "none" };
  return db.runTransaction(async (tx) => {
    // The customer this number belongs to now (follows owner merges; a merge points every
    // stub straight at the kept customer, so this is one hop — more only for old data).
    let key = asked;
    let snap = await tx.get(db.collection(CUSTOMERS).doc(key));
    const seen = new Set([key]);
    while (str(snap.data()?.mergedInto) && !seen.has(str(snap.data()?.mergedInto)) && seen.size <= MAX_HOPS) {
      key = str(snap.data()!.mergedInto);
      seen.add(key);
      snap = await tx.get(db.collection(CUSTOMERS).doc(key));
    }
    const data = snap.data();
    // Still on a stub (a loop or a very long chain): write nothing rather than onto the stub.
    if (str(data?.mergedInto)) return { key: asked, status: "none" as const };
    const phones = [key, ...((data?.altPhones as unknown[]) ?? []).map(str).filter(Boolean)].slice(0, IN_MAX);
    const orders = await tx.get(db.collection("orders").where("customerKey", "in", phones));
    const p = plan(key, data, statsFromOrders(orders.docs.map((d) => asOrderLike(d.id, d.data()))));
    const ref = db.collection(CUSTOMERS).doc(key);
    const into = key !== asked ? { into: key } : {};
    if (p.op === "none") return { key: asked, status: data ? "unchanged" : "none", ...into };
    if (p.op === "delete") {
      tx.delete(ref);
      return { key: asked, status: "removed", ...into };
    }
    tx.set(ref, { ...p.fields, statsUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { key: asked, status: "updated", ...into };
  });
}

/** Rebuild several customers (each once). */
export async function reconcileCustomers(db: Firestore, keys: readonly string[]): Promise<ReconcileResult[]> {
  const unique = [...new Set(keys.map(phoneKey).filter(Boolean))];
  const out: ReconcileResult[] = [];
  // A few at a time: quick for a PC's handful, gentle on the database for many.
  for (let i = 0; i < unique.length; i += 8) {
    out.push(...(await Promise.all(unique.slice(i, i + 8).map((k) => reconcileCustomer(db, k)))));
  }
  return out;
}

/**
 * Hourly safety net: customers of orders that reached the cloud or were
 * changed since the last run (a watermark, so each order is looked at about
 * once — not re-read every hour). Catches an update a PC couldn't send.
 *
 * Edits, cancels, refunds and deletes made offline carry the time they were
 * made, not when they reached the cloud — their activity log rows carry the
 * cloud time (syncedAtServer / createdAtServer) and the bill before / after,
 * so the old number of a phone change and a deleted order's customer are
 * found too.
 */
export async function reconcileChangedCustomers(db: Firestore, now = new Date()): Promise<{ keys: number; changed: number }> {
  const stateRef = db.collection(CRON_STATE.collection).doc(CRON_STATE.doc);
  const last = (await stateRef.get()).data()?.lastRunAt;
  const sinceMs = last instanceof Timestamp ? last.toMillis() - 10 * 60_000 : now.getTime() - 48 * 3600_000;
  const since = Timestamp.fromMillis(sinceMs);
  const [synced, created, edited, logSynced, logCreated] = await Promise.all([
    db.collection("orders").where("syncedAtServer", ">=", since).get(),
    db.collection("orders").where("createdAtServer", ">=", since).get(),
    db.collection("orders").where("updatedAt", ">=", new Date(sinceMs).toISOString()).get(),
    db.collection("activityLogs").where("syncedAtServer", ">=", since).get(),
    db.collection("activityLogs").where("createdAtServer", ">=", since).get(),
  ]);
  const keys = new Set<string>();
  const add = (phone: unknown) => {
    const k = phoneKey(str(phone));
    if (k) keys.add(k);
  };
  // An order written by an older app (still cached on a counter PC) may have no customerKey,
  // or an old one after a phone edit: put the right one on it first, so the rebuild counts it.
  const fixes = new Map<string, { ref: FirebaseFirestore.DocumentReference; key: string }>();
  for (const d of [...synced.docs, ...created.docs, ...edited.docs]) {
    const key = phoneKey(str(d.data().customerPhone));
    const had = str(d.data().customerKey);
    if (key) keys.add(key);
    if (had) keys.add(had);
    if (had !== key) fixes.set(d.id, { ref: d.ref, key });
  }
  const fixList = [...fixes.values()];
  for (let i = 0; i < fixList.length; i += 400) {
    const batch = db.batch();
    for (const { ref, key } of fixList.slice(i, i + 400)) batch.update(ref, { customerKey: key || FieldValue.delete() });
    await batch.commit().catch((e) => console.warn("[customers] order keys not fixed", e));
  }
  for (const d of [...logSynced.docs, ...logCreated.docs]) {
    const log = d.data();
    if (log.entityType !== "order") continue;
    add(log.change?.before?.customerPhone);
    add(log.change?.after?.customerPhone);
  }
  const res = await reconcileCustomers(db, [...keys]);
  await stateRef.set({ lastRunAt: Timestamp.fromDate(now) }, { merge: true });
  return { keys: keys.size, changed: res.filter((r) => r.status === "updated" || r.status === "removed").length };
}

/**
 * Every customer from every order, in one pass (owner "Recount", first setup):
 * orders read once, grouped in memory, only changed customers written.
 * Orders with a phone but no customerKey (made before keys existed) get it.
 * `dryRun`: count only, write nothing.
 */
export async function rebuildAllCustomers(
  db: Firestore,
  opts: { dryRun?: boolean } = {},
): Promise<{ orders: number; keyed: number; customers: number; updated: number; removed: number }> {
  const [orders, existing] = await Promise.all([db.collection("orders").get(), db.collection(CUSTOMERS).get()]);
  const docs = new Map(existing.docs.map((d) => [d.id, d.data()]));
  const readAt = new Map(existing.docs.map((d) => [d.id, d.updateTime]));
  // A number's customer now: merged stubs and other numbers point to the one kept.
  const altOwner = new Map<string, string>();
  for (const [id, d] of docs) for (const alt of (d.altPhones as unknown[]) ?? []) if (str(alt)) altOwner.set(str(alt), id);
  const target = (key: string): string => {
    let k = altOwner.get(key) ?? key;
    for (let i = 0; i < MAX_HOPS && str(docs.get(k)?.mergedInto); i++) k = str(docs.get(k)!.mergedInto);
    return k;
  };

  const writes: {
    kind: "create" | "update" | "delete";
    ref: FirebaseFirestore.DocumentReference;
    data?: Record<string, unknown>;
    /** A customer doc as it was read: the write applies only if nobody changed it since. */
    readAt?: Timestamp;
    customer?: string;
  }[] = [];
  const groups = new Map<string, CustomerOrderLike[]>();
  let keyed = 0;
  for (const d of orders.docs) {
    const data = d.data();
    const key = phoneKey(str(data.customerPhone));
    if (!key) continue;
    if (data.customerKey !== key) {
      keyed++;
      writes.push({ kind: "update", ref: d.ref, data: { customerKey: key } });
    }
    const t = target(key);
    const list = groups.get(t) ?? [];
    list.push(asOrderLike(d.id, data));
    groups.set(t, list);
  }

  let updated = 0;
  let removed = 0;
  const keys = new Set<string>([...groups.keys(), ...[...docs.keys()].filter((k) => !str(docs.get(k)?.mergedInto))]);
  for (const key of keys) {
    const p = plan(key, docs.get(key), statsFromOrders(groups.get(key) ?? []));
    const ref = db.collection(CUSTOMERS).doc(key);
    const at = readAt.get(key);
    if (p.op === "set") {
      updated++;
      const data = { ...p.fields, statsUpdatedAt: FieldValue.serverTimestamp() };
      writes.push(at ? { kind: "update", ref, data, readAt: at, customer: key } : { kind: "create", ref, data, customer: key });
    } else if (p.op === "delete") {
      removed++;
      writes.push({ kind: "delete", ref, readAt: at, customer: key });
    }
  }

  if (!opts.dryRun) {
    // Each write on its own, guarded by the time its customer was read: a note saved, a
    // merge or a sale counted while this ran makes that write fail instead of undoing it —
    // that customer is then rebuilt on its own (in a transaction) from the fresh doc.
    const stale = new Set<string>();
    const bw = db.bulkWriter();
    bw.onWriteError((e) => {
      const failed = writes.find((w) => w.ref.path === e.documentRef.path && w.customer);
      if (failed?.customer && (e.code === 9 || e.code === 6 || e.code === 5)) {
        stale.add(failed.customer); // FAILED_PRECONDITION / ALREADY_EXISTS / NOT_FOUND
        return false;
      }
      return e.failedAttempts < 3;
    });
    const errors: unknown[] = [];
    for (const w of writes) {
      const pre = w.readAt ? { lastUpdateTime: w.readAt } : undefined;
      const done =
        w.kind === "create"
          ? bw.create(w.ref, w.data!)
          : w.kind === "update"
            ? pre
              ? bw.update(w.ref, w.data!, pre)
              : bw.update(w.ref, w.data!)
            : pre
              ? bw.delete(w.ref, pre)
              : bw.delete(w.ref);
      done.catch((e) => {
        if (!w.customer || !stale.has(w.customer)) errors.push(e);
      });
    }
    await bw.close();
    if (stale.size > 0) await reconcileCustomers(db, [...stale]);
    if (errors.length > 0) throw errors[0];
  }
  return { orders: orders.size, keyed, customers: groups.size, updated, removed };
}

/** Owner: merge customer `from` into `into` (two numbers, one person). */
export async function mergeCustomers(db: Firestore, fromRaw: string, intoRaw: string): Promise<ReconcileResult> {
  const from = phoneKey(fromRaw);
  const into = phoneKey(intoRaw);
  if (!from || !into || from === into) throw new Error("Pick two different customers");
  const fromRef = db.collection(CUSTOMERS).doc(from);
  const intoRef = db.collection(CUSTOMERS).doc(into);
  await db.runTransaction(async (tx) => {
    const [f, t] = await Promise.all([tx.get(fromRef), tx.get(intoRef)]);
    const fd = f.data() ?? {};
    const td = t.data() ?? {};
    // Merging a number twice (or into a merged one) would count its orders twice.
    if (str(fd.mergedInto)) throw new Error("This number was already merged into another customer");
    if (str(td.mergedInto)) throw new Error("That customer was merged into another one");
    if (((td.altPhones as unknown[]) ?? []).map(str).includes(from)) throw new Error("Already merged");
    const alt = [...new Set([...((td.altPhones as unknown[]) ?? []).map(str), from, ...((fd.altPhones as unknown[]) ?? []).map(str)])]
      .filter((p) => p && p !== into);
    // One customer's numbers are read in one query (Firestore `in`: 30 values).
    if (alt.length > IN_MAX - 1) throw new Error(`A customer can have at most ${IN_MAX} numbers`);
    const notes = [str(td.note), str(fd.note)].filter(Boolean);
    tx.set(
      intoRef,
      { phone: into, altPhones: alt, ...(notes.length > 1 ? { note: notes.join(" · ").slice(0, 300) } : notes[0] ? { note: notes[0] } : {}) },
      { merge: true },
    );
    // A stub that points to the kept customer: later sales on this number count there
    // (replaces the whole doc — its numbers and note moved to `into` above).
    tx.set(fromRef, { phone: from, mergedInto: into, mergedAt: FieldValue.serverTimestamp() });
    // Numbers merged into `from` earlier now point straight here too (one hop, never a chain).
    for (const old of ((fd.altPhones as unknown[]) ?? []).map(str)) {
      if (old && old !== into && old !== from) {
        tx.set(db.collection(CUSTOMERS).doc(old), { phone: old, mergedInto: into }, { merge: true });
      }
    }
  });
  return reconcileCustomer(db, into);
}

/** Owner: set a customer's name by hand (null: go back to the name on their newest order). */
export async function renameCustomer(db: Firestore, rawKey: string, name: string | null): Promise<ReconcileResult> {
  const key = phoneKey(rawKey);
  if (!key) throw new Error("Not a phone number");
  const clean = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  await db
    .collection(CUSTOMERS)
    .doc(key)
    .set(clean ? { phone: key, name: clean, nameLocked: true } : { phone: key, nameLocked: FieldValue.delete() }, { merge: true });
  return reconcileCustomer(db, key);
}
