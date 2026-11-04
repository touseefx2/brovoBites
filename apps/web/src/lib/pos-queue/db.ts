import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  QueueMeta,
  QueuedExpense,
  QueuedMutation,
  QueuedOrder,
} from "./types";
import { expenseOpTarget, isExpenseActive, isMutationActive, isQueueActive } from "./types";

const DB_NAME = "bravobites-pos-queue";
const DB_VERSION = 4;

interface PosQueueDb extends DBSchema {
  meta: {
    key: string;
    value: QueueMeta;
  };
  orders: {
    key: string;
    value: QueuedOrder;
    /** by-stock: stockStatus — "synced" only once the sale is fully on the cloud. */
    indexes: { "by-enqueued": number; "by-stock": string };
  };
  mutations: {
    key: string;
    value: QueuedMutation;
    indexes: { "by-enqueued": number; "by-status": string };
  };
  expenses: {
    key: string;
    value: QueuedExpense;
    indexes: { "by-enqueued": number; "by-status": string };
  };
}

let dbPromise: Promise<IDBPDatabase<PosQueueDb>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<PosQueueDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, upgradeTx) {
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("orders")) {
          const store = db.createObjectStore("orders", { keyPath: "clientId" });
          store.createIndex("by-enqueued", "enqueuedAt");
        }
        if (oldVersion < 2 && !db.objectStoreNames.contains("mutations")) {
          const m = db.createObjectStore("mutations", { keyPath: "mutationId" });
          m.createIndex("by-enqueued", "enqueuedAt");
        }
        if (oldVersion < 3 && !db.objectStoreNames.contains("expenses")) {
          const e = db.createObjectStore("expenses", { keyPath: "clientId" });
          e.createIndex("by-enqueued", "enqueuedAt");
        }
        // v4: status indexes — synced rows are kept as the local copy, so
        // "what still needs the cloud" must not scan every kept row.
        const orders = upgradeTx.objectStore("orders");
        if (!orders.indexNames.contains("by-stock")) orders.createIndex("by-stock", "stockStatus");
        const muts = upgradeTx.objectStore("mutations");
        if (!muts.indexNames.contains("by-status")) muts.createIndex("by-status", "status");
        const exps = upgradeTx.objectStore("expenses");
        if (!exps.indexNames.contains("by-status")) exps.createIndex("by-status", "status");
      },
      // A newer app version (e.g. a freshly deployed tab) needs to upgrade this
      // DB. An old tab holding the connection would leave that tab stuck on
      // "Loading…", so close ours and reload into the new version. Every sale is
      // already committed to IndexedDB — only an unsaved cart is lost.
      blocking() {
        const pending = dbPromise;
        dbPromise = null;
        void pending?.then((db) => db.close());
        if (typeof window !== "undefined") window.location.reload();
      },
      // Browser dropped the connection (storage pressure, etc.) — reopen next call.
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function getQueueMeta(): Promise<QueueMeta> {
  const db = await getDb();
  const existing = await db.get("meta", "meta");
  if (existing) return existing;
  const fresh: QueueMeta = { id: "meta", lastOrderNumber: 0 };
  await db.put("meta", fresh);
  return fresh;
}

/** An order reached the cloud: counter ≥ its number, and bump syncSeq. */
export async function markOrderSynced(orderNumber: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("meta", "readwrite");
  const store = tx.objectStore("meta");
  let meta = await store.get("meta");
  if (!meta) meta = { id: "meta", lastOrderNumber: 0 };
  await store.put({
    ...meta,
    lastOrderNumber: Math.max(meta.lastOrderNumber, orderNumber),
    syncSeq: (meta.syncSeq ?? 0) + 1,
  });
  await tx.done;
}

/** Force lastOrderNumber to at least `n` (cloud reconcile). Atomic single tx. */
export async function reconcileLastOrderNumber(
  cloudLast: number,
): Promise<number> {
  const db = await getDb();
  const cloud = Number.isFinite(cloudLast) ? Math.max(0, Math.floor(cloudLast)) : 0;
  const tx = db.transaction("meta", "readwrite");
  const store = tx.objectStore("meta");
  let meta = await store.get("meta");
  if (!meta) meta = { id: "meta", lastOrderNumber: 0 };
  const last = Math.max(meta.lastOrderNumber, cloud);
  await store.put({ ...meta, lastOrderNumber: last, lastCloudSyncAt: new Date().toISOString() });
  await tx.done;
  return last;
}

/**
 * Adopt the server counter as the local one.
 *
 * - Queue has unsynced orders → max(local, cloud): offline numbers must never be reused.
 * - Queue fully synced → local = cloud, so a cloud counter reset reaches this PC too.
 *
 * `fetchServerLast` must read from the server (never the offline cache). The local
 * counter is snapshotted before the fetch and only lowered if no order was numbered
 * while the request was in flight (compare-and-set), so a slow response can't rewind it.
 */
export async function reconcileFromServer(
  fetchServerLast: () => Promise<number>,
): Promise<number> {
  const beforeMeta = await getQueueMeta();
  const before = beforeMeta.lastOrderNumber;
  const beforeSeq = beforeMeta.syncSeq ?? 0;
  const raw = await fetchServerLast();
  const cloud = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;

  const db = await getDb();
  const tx = db.transaction(["meta", "orders"], "readwrite");
  const metaStore = tx.objectStore("meta");
  let meta = await metaStore.get("meta");
  if (!meta) meta = { id: "meta", lastOrderNumber: 0 };
  const byStock = tx.objectStore("orders").index("by-stock");
  const [activeBefore, activeAfter] = await Promise.all([
    byStock.count(beforeSynced()),
    byStock.count(afterSynced()),
  ]);
  const queueEmpty = activeBefore + activeAfter === 0;
  // Untouched = no order numbered AND none synced while the read was in flight.
  const untouched =
    meta.lastOrderNumber === before && (meta.syncSeq ?? 0) === beforeSeq;
  const last =
    queueEmpty && untouched ? cloud : Math.max(meta.lastOrderNumber, cloud);
  await metaStore.put({ ...meta, lastOrderNumber: last, lastCloudSyncAt: new Date().toISOString() });
  await tx.done;
  return last;
}

/**
 * Allocate the next order number atomically in IndexedDB.
 * Uses Web Locks API for cross-tab safety when available.
 */
export async function allocateOrderNumber(): Promise<number> {
  const hasLocks = typeof navigator !== "undefined" && "locks" in navigator;
  if (hasLocks) {
    return navigator.locks.request("pos-order-number", async () => doAllocate());
  }
  return doAllocate();
}

/**
 * Allocate the next number and enqueue the order in ONE IndexedDB transaction,
 * so `reconcileFromServer` can never see the number taken but the queue empty.
 * `build` must be synchronous (no awaits inside an IDB transaction).
 */
export async function allocateAndEnqueueOrder(
  build: (orderNumber: number) => QueuedOrder,
): Promise<QueuedOrder> {
  const work = async () => {
    const db = await getDb();
    const tx = db.transaction(["meta", "orders"], "readwrite");
    const metaStore = tx.objectStore("meta");
    let meta = await metaStore.get("meta");
    if (!meta) meta = { id: "meta", lastOrderNumber: 0 };
    const next = meta.lastOrderNumber + 1;
    const order = build(next);
    await metaStore.put({ ...meta, lastOrderNumber: next });
    await tx.objectStore("orders").put(order);
    await tx.done;
    return order;
  };
  const hasLocks = typeof navigator !== "undefined" && "locks" in navigator;
  if (hasLocks) {
    return navigator.locks.request("pos-order-number", work);
  }
  return work();
}

async function doAllocate(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction("meta", "readwrite");
  const store = tx.objectStore("meta");
  let meta = await store.get("meta");
  if (!meta) {
    meta = { id: "meta", lastOrderNumber: 0 };
  }
  const next = meta.lastOrderNumber + 1;
  await store.put({ ...meta, lastOrderNumber: next });
  await tx.done;
  return next;
}

/** Reconcile cloud counter and allocate next number in one atomic step (collision recovery). */
export async function reconcileAndAllocate(cloudLast: number): Promise<number> {
  const cloud = Number.isFinite(cloudLast) ? Math.max(0, Math.floor(cloudLast)) : 0;
  const hasLocks = typeof navigator !== "undefined" && "locks" in navigator;
  const work = async () => {
    const db = await getDb();
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");
    let meta = await store.get("meta");
    if (!meta) meta = { id: "meta", lastOrderNumber: 0 };
    const reconciled = Math.max(meta.lastOrderNumber, cloud);
    const next = reconciled + 1;
    await store.put({ ...meta, lastOrderNumber: next, lastCloudSyncAt: new Date().toISOString() });
    await tx.done;
    return next;
  };
  if (hasLocks) {
    return navigator.locks.request("pos-order-number", work);
  }
  return work();
}

export async function putQueuedOrder(order: QueuedOrder): Promise<void> {
  const db = await getDb();
  await db.put("orders", order);
}

export async function getQueuedOrder(
  clientId: string,
): Promise<QueuedOrder | undefined> {
  const db = await getDb();
  return db.get("orders", clientId);
}

export async function deleteQueuedOrder(clientId: string): Promise<void> {
  const db = await getDb();
  await db.delete("orders", clientId);
}

/**
 * Every index value except "synced" = two key ranges around it. Built lazily:
 * IDBKeyRange only exists in the browser (this module is also loaded during SSR).
 */
const beforeSynced = () => IDBKeyRange.upperBound("synced", true);
const afterSynced = () => IDBKeyRange.lowerBound("synced", true);

/** Oldest-first active (not fully synced) orders — index lookup, not a full scan. */
export async function listActiveQueuedOrders(): Promise<QueuedOrder[]> {
  const db = await getDb();
  const [a, b] = await Promise.all([
    db.getAllFromIndex("orders", "by-stock", beforeSynced()),
    db.getAllFromIndex("orders", "by-stock", afterSynced()),
  ]);
  return [...a, ...b].filter(isQueueActive).sort((x, y) => x.enqueuedAt - y.enqueuedAt);
}

export async function listAllQueuedOrders(): Promise<QueuedOrder[]> {
  const db = await getDb();
  return db.getAllFromIndex("orders", "by-enqueued");
}

export async function countActiveQueued(): Promise<number> {
  const list = await listActiveQueuedOrders();
  return list.length;
}

export async function countFailedQueued(): Promise<number> {
  const list = await listActiveQueuedOrders();
  return list.filter(
    (q) => q.status === "failed" || q.stockStatus === "failed",
  ).length;
}

/** Peek next number without allocating (preview). */
export async function peekLocalNextOrderNumber(): Promise<number> {
  const meta = await getQueueMeta();
  return meta.lastOrderNumber + 1;
}

/* ── Mutations (edit / cancel / refund / delete) ── */

export async function putQueuedMutation(m: QueuedMutation): Promise<void> {
  const db = await getDb();
  await db.put("mutations", m);
}

export async function getQueuedMutation(
  mutationId: string,
): Promise<QueuedMutation | undefined> {
  const db = await getDb();
  return db.get("mutations", mutationId);
}

export async function deleteQueuedMutation(mutationId: string): Promise<void> {
  const db = await getDb();
  await db.delete("mutations", mutationId);
}

export async function listActiveQueuedMutations(): Promise<QueuedMutation[]> {
  const db = await getDb();
  const [a, b] = await Promise.all([
    db.getAllFromIndex("mutations", "by-status", beforeSynced()),
    db.getAllFromIndex("mutations", "by-status", afterSynced()),
  ]);
  return [...a, ...b].filter(isMutationActive).sort((x, y) => x.enqueuedAt - y.enqueuedAt);
}

export async function countActiveMutations(): Promise<number> {
  return (await listActiveQueuedMutations()).length;
}

export async function countFailedMutations(): Promise<number> {
  return (await listActiveQueuedMutations()).filter((m) => m.status === "failed")
    .length;
}

/* ── Expenses (POS offline) ── */

export async function putQueuedExpense(e: QueuedExpense): Promise<void> {
  const db = await getDb();
  await db.put("expenses", e);
}

export async function deleteQueuedExpense(clientId: string): Promise<void> {
  const db = await getDb();
  await db.delete("expenses", clientId);
}

/** Oldest-first expenses not yet on Firestore. */
export async function listActiveQueuedExpenses(): Promise<QueuedExpense[]> {
  const db = await getDb();
  const [a, b] = await Promise.all([
    db.getAllFromIndex("expenses", "by-status", beforeSynced()),
    db.getAllFromIndex("expenses", "by-status", afterSynced()),
  ]);
  return [...a, ...b].filter(isExpenseActive).sort((x, y) => x.enqueuedAt - y.enqueuedAt);
}

export async function countActiveExpenses(): Promise<number> {
  return (await listActiveQueuedExpenses()).length;
}

export async function countFailedExpenses(): Promise<number> {
  return (await listActiveQueuedExpenses()).filter((e) => e.status === "failed")
    .length;
}

/* ── Local copy: rows stay after sync (status "synced") until pruned or cleared ── */

export async function listAllQueuedMutations(): Promise<QueuedMutation[]> {
  const db = await getDb();
  return db.getAllFromIndex("mutations", "by-enqueued");
}

export async function listAllQueuedExpenses(): Promise<QueuedExpense[]> {
  const db = await getDb();
  return db.getAllFromIndex("expenses", "by-enqueued");
}

type StatusCount = { total: number; pending: number; failed: number };

export type LocalDataStats = {
  sales: StatusCount;
  changes: StatusCount;
  expenses: StatusCount;
  /** Earliest row still kept on this PC (ms). */
  oldestAt: number | null;
  /** Latest time anything reached the cloud (ms). */
  lastSyncedAt: number | null;
};

function countBy<T>(
  rows: T[],
  isActive: (r: T) => boolean,
  isFailed: (r: T) => boolean,
): StatusCount {
  let pending = 0;
  let failed = 0;
  for (const r of rows) {
    if (!isActive(r)) continue;
    if (isFailed(r)) failed++;
    else pending++;
  }
  return { total: rows.length, pending, failed };
}

export async function getLocalDataStats(): Promise<LocalDataStats> {
  const [orders, muts, exps] = await Promise.all([
    listAllQueuedOrders(),
    listAllQueuedMutations(),
    listAllQueuedExpenses(),
  ]);
  const all = [...orders, ...muts, ...exps];
  const synced = all
    .map((r) => r.syncedAt)
    .filter((t): t is number => typeof t === "number");
  return {
    sales: countBy(orders, isQueueActive, (q) => q.status === "failed" || q.stockStatus === "failed"),
    changes: countBy(muts, isMutationActive, (m) => m.status === "failed"),
    expenses: countBy(exps, isExpenseActive, (e) => e.status === "failed"),
    // reduce, not Math.min(...rows): spreading many rows overflows the call stack.
    oldestAt: all.length ? all.reduce((min, r) => Math.min(min, r.enqueuedAt), Infinity) : null,
    lastSyncedAt: synced.length ? synced.reduce((a, b) => Math.max(a, b)) : null,
  };
}

/** Thrown when a clear is attempted while something is still unsynced. */
export class UnsyncedLocalDataError extends Error {
  constructor() {
    super("Some local data is not synced yet");
    this.name = "UnsyncedLocalDataError";
  }
}

/**
 * Delete this PC's local copy of sales, order changes and expenses — only if
 * every row is synced, checked inside the same transaction (a sale made a
 * moment ago can never be wiped). Keeps the order counter (meta), menu cache
 * and login. Returns how many rows were removed.
 */
export async function clearSyncedLocalData(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(["orders", "mutations", "expenses"], "readwrite");
  const [orders, muts, exps] = await Promise.all([
    tx.objectStore("orders").getAll(),
    tx.objectStore("mutations").getAll(),
    tx.objectStore("expenses").getAll(),
  ]);
  if (
    orders.some(isQueueActive) ||
    muts.some(isMutationActive) ||
    exps.some(isExpenseActive)
  ) {
    tx.done.catch(() => {});
    tx.abort();
    throw new UnsyncedLocalDataError();
  }
  await Promise.all([
    tx.objectStore("orders").clear(),
    tx.objectStore("mutations").clear(),
    tx.objectStore("expenses").clear(),
  ]);
  await tx.done;
  return orders.length + muts.length + exps.length;
}

/** Synced rows are kept as the local copy this long (after their sync), then pruned. */
const SYNCED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Drop synced rows older than SYNCED_KEEP_MS from this PC's local copy, so it
 * doesn't grow forever. Never a row that still needs the cloud, nor any row of
 * an order / expense that such a row is about — decided inside the delete
 * transaction, so a sale or change queued meanwhile is always seen. The order
 * counter (meta) is not touched. Returns how many rows were removed.
 */
export async function pruneOldSyncedLocalData(): Promise<number> {
  const cutoff = Date.now() - SYNCED_KEEP_MS;
  const db = await getDb();
  const tx = db.transaction(["orders", "mutations", "expenses"], "readwrite");
  const orders = tx.objectStore("orders");
  const muts = tx.objectStore("mutations");
  const exps = tx.objectStore("expenses");
  // Synced long ago ⇒ enqueued long ago: only old rows are read.
  const old = IDBKeyRange.upperBound(cutoff);
  const [o1, o2, m1, m2, e1, e2, oldOrders, oldMuts, oldExps] = await Promise.all([
    orders.index("by-stock").getAll(beforeSynced()),
    orders.index("by-stock").getAll(afterSynced()),
    muts.index("by-status").getAll(beforeSynced()),
    muts.index("by-status").getAll(afterSynced()),
    exps.index("by-status").getAll(beforeSynced()),
    exps.index("by-status").getAll(afterSynced()),
    orders.index("by-enqueued").getAll(old),
    muts.index("by-enqueued").getAll(old),
    exps.index("by-enqueued").getAll(old),
  ]);
  const busy = new Set<string>([
    ...[...o1, ...o2].filter(isQueueActive).map((q) => q.clientId),
    ...[...m1, ...m2].filter(isMutationActive).map((m) => m.orderId),
    ...[...e1, ...e2].filter(isExpenseActive).map(expenseOpTarget),
  ]);
  const expired = (r: { syncedAt?: number; updatedAt: number }) =>
    (r.syncedAt ?? r.updatedAt) < cutoff;
  const removals = [
    ...oldOrders
      .filter((q) => !isQueueActive(q) && expired(q) && !busy.has(q.clientId))
      .map((q) => orders.delete(q.clientId)),
    ...oldMuts
      .filter((m) => !isMutationActive(m) && expired(m) && !busy.has(m.orderId))
      .map((m) => muts.delete(m.mutationId)),
    ...oldExps
      .filter((e) => !isExpenseActive(e) && expired(e) && !busy.has(expenseOpTarget(e)))
      .map((e) => exps.delete(e.clientId)),
  ];
  await Promise.all(removals);
  await tx.done;
  return removals.length;
}

/** Rows kept on this PC (any status) — cheap counts, no row reads. */
export async function countLocalRows(): Promise<number> {
  const db = await getDb();
  const [o, m, e] = await Promise.all([db.count("orders"), db.count("mutations"), db.count("expenses")]);
  return o + m + e;
}
