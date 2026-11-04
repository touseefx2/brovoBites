import type { AppUser } from "@bravobites/domain";
import { mapFirebaseError } from "@/lib/errors";
import { RequestTimeoutError, withTimeout } from "@/lib/http";
import { ensureShopClock, isShopClockMeasured, resolveSaleTime } from "@/lib/shop-clock";

/** Firestore / app error code kept with a failed row (for the sync-status popup). */
function errorCode(err: unknown): string {
  return typeof err === "object" && err && "code" in err
    ? String((err as { code: unknown }).code)
    : "";
}
import {
  OrderConflictError,
  OrderNumberCollisionError,
  cancelOrder,
  deductStockForOrder,
  redoWaitingStockChanges,
  deleteOrder,
  getCloudLastOrderNumber,
  refundOrder,
  deleteExpense,
  syncQueuedExpenseToFirestore,
  syncQueuedOrderToFirestore,
  isOrderNumberTaken,
  updateExpense,
  updateOrderItems,
} from "@/lib/firestore";
import {
  clearSyncedLocalData,
  getQueueMeta,
  listActiveQueuedExpenses,
  listActiveQueuedMutations,
  listActiveQueuedOrders,
  markOrderSynced,
  pruneOldSyncedLocalData,
  putQueuedExpense,
  putQueuedMutation,
  putQueuedOrder,
  reconcileAndAllocate,
  reconcileFromServer,
} from "./db";
import type { QueuedExpense, QueuedMutation, QueuedOrder } from "./types";
import { expenseOpKind, expenseOpTarget } from "./types";

/** Rows per queue per sync pass (a long offline day can easily exceed 50). */
const MAX_PER_PASS = 300;
/** How often a sync pass also prunes the old synced local copy. */
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
/**
 * Longest wait for one cloud step (a sale, its stock, a change, an expense).
 * The PC can say "online" while the line is dead, and Firestore then simply
 * never answers — without a limit one such step froze the queue until reload.
 */
const CLOUD_STEP_TIMEOUT_MS = 45_000;
/** Counter / order-number reads — quick lookups. */
const QUICK_READ_TIMEOUT_MS = 15_000;
/**
 * Safety net under those limits: a pass with no progress for this long (some
 * other await never settled) is abandoned and the sync lock freed, so the
 * next minute's pass runs. Longer than any single step's limit.
 */
const STALL_MS = 2 * 60 * 1000;

export type QueueSnapshot = {
  pendingCount: number;
  failedCount: number;
  /** Subset of pendingCount — POS expenses not yet on Firestore. */
  expensePendingCount: number;
  syncing: boolean;
  lastError: string | null;
  /**
   * False until cloud counter is loaded at least once on this PC
   * (or this session when online). Checkout blocked while false.
   */
  counterReady: boolean;
  /** Why POS is not ready (for banner). */
  notReadyReason: "loading" | "need_net_once" | null;
};

type Listener = (snap: QueueSnapshot) => void;

const listeners = new Set<Listener>();
let syncing = false;
let lastError: string | null = null;
let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
let profileRef: AppUser | null = null;
let counterReady = false;
let notReadyReason: QueueSnapshot["notReadyReason"] = "loading";
let lastPruneAt = 0;
/** The running pass's id — bumped when a pass ends, so a stalled one that wakes up later knows it is stale. */
let passEpoch = 0;
/** Last time the running pass got anywhere (watchdog input). */
let lastProgressAt = 0;

/** Thrown inside a pass that was abandoned: it stops without touching any row. */
class PassAbandonedError extends Error {
  constructor() {
    super("Sync pass abandoned");
    this.name = "PassAbandonedError";
  }
}

/** Still the running pass? Throws if not; otherwise counts as progress. */
function live(epoch: number): void {
  if (epoch !== passEpoch) throw new PassAbandonedError();
  lastProgressAt = Date.now();
}

/**
 * One cloud step, bounded by `ms`. On timeout the step's signal is aborted
 * (queued edits stop before their next write) and RequestTimeoutError ends
 * the pass. Nothing is re-sent here — the next minute's pass retries, and
 * every upload is idempotent (fixed ids), so a late landing is never doubled.
 */
async function cloudStep<T>(
  epoch: number,
  run: (signal: AbortSignal) => Promise<T>,
  ms = CLOUD_STEP_TIMEOUT_MS,
): Promise<T> {
  live(epoch);
  const ctrl = new AbortController();
  try {
    return await withTimeout(run(ctrl.signal), ms, ctrl);
  } finally {
    live(epoch);
  }
}

/** A timeout (line not answering) or an abandoned pass: stop this pass. */
const endsPass = (err: unknown) =>
  err instanceof RequestTimeoutError || err instanceof PassAbandonedError;

const isPermissionDenied = (code?: string) =>
  code === "permission-denied" || code === "firestore/permission-denied";
/** A row the rules refused is tried again this rarely by the timer (cheap, and it heals after a rules change). */
const REFUSED_RETRY_MS = 30 * 60 * 1000;

async function queueCounts(): Promise<
  Pick<QueueSnapshot, "pendingCount" | "failedCount" | "expensePendingCount">
> {
  // One read per store — synced rows stay as the local copy until cleared, so
  // these stores grow; never scan them more than needed.
  const [orders, muts, exps] = await Promise.all([
    listActiveQueuedOrders(),
    listActiveQueuedMutations(),
    listActiveQueuedExpenses(),
  ]);
  const failed =
    orders.filter((q) => q.status === "failed" || q.stockStatus === "failed").length +
    muts.filter((m) => m.status === "failed").length +
    exps.filter((e) => e.status === "failed").length;
  return {
    pendingCount: orders.length + muts.length + exps.length,
    failedCount: failed,
    expensePendingCount: exps.length,
  };
}

let emitTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Notify listeners with fresh counts. Bursts (a sync pass emits for every row)
 * are coalesced into one read + notify every 50ms.
 */
function emit() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    void (async () => {
      try {
        const snap: QueueSnapshot = {
          ...(await queueCounts()),
          syncing,
          lastError,
          counterReady,
          notReadyReason,
        };
        for (const l of listeners) {
          try { l(snap); } catch { /* listener error */ }
        }
      } catch (err) {
        console.error("[pos-queue] emit failed", err);
      }
    })();
  }, 50);
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  emit();
  return () => {
    listeners.delete(listener);
  };
}

/** True while this tab is uploading queued sales / edits / expenses. */
export function isQueueSyncing(): boolean {
  return syncing;
}

export async function refreshQueueSnapshot(): Promise<QueueSnapshot> {
  return {
    ...(await queueCounts()),
    syncing,
    lastError,
    counterReady,
    notReadyReason,
  };
}

/** Cloud counter, server only — a dead line fails it instead of leaving it pending. */
const serverLastBounded = () =>
  withTimeout(getCloudLastOrderNumber({ fromServer: true }), QUICK_READ_TIMEOUT_MS);

/**
 * Counter gate:
 * - Agar is PC pe pehle cloud seed ho chuka (`lastCloudSyncAt`) → turant ready (local #).
 * - Online hone pe cloud se background refresh → max(local, cloud).
 * - Pehli dafa / Clear Data: online zaroori — jab tak cloud na aaye block.
 */
export async function ensureCounterReady(): Promise<boolean> {
  const online =
    typeof navigator === "undefined" ? true : navigator.onLine;
  const meta = await getQueueMeta();
  const hasLocalSeed = Boolean(meta.lastCloudSyncAt);

  // Returning PC: local last counter enough to unblock ASAP.
  if (hasLocalSeed) {
    counterReady = true;
    notReadyReason = null;
    emit();

    if (online) {
      // Refresh cloud in background — do not block checkout.
      void (async () => {
        try {
          await reconcileFromServer(serverLastBounded);
          emit();
        } catch {
          // keep local seed
        }
      })();
    }
    return true;
  }

  // First time on this browser profile — must get cloud once.
  if (!online) {
    counterReady = false;
    notReadyReason = "need_net_once";
    emit();
    return false;
  }

  notReadyReason = "loading";
  emit();
  try {
    await reconcileFromServer(serverLastBounded);
    counterReady = true;
    notReadyReason = null;
    emit();
    return true;
  } catch {
    counterReady = false;
    notReadyReason = "need_net_once";
    emit();
    return false;
  }
}

/** Call once from POS with the signed-in user; safe to call again on profile change. */
export function startPosQueueSync(user: AppUser): () => void {
  // A different login may be allowed what the last one was refused (e.g. an
  // owner, or the person who made it) — retry those rows once.
  const userChanged = profileRef?.uid !== user.uid;
  profileRef = user;
  if (typeof window === "undefined") return () => {};

  if (!started) {
    started = true;
    const onOnline = () => {
      void (async () => {
        await ensureCounterReady();
        await kickSync({ retryFailed: true });
      })();
    };
    window.addEventListener("online", onOnline);
    // Retry pending/failed every 1 minute until fully synced.
    intervalId = setInterval(() => {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        // First counter read gave up (no answer): ask again, or checkout stays blocked.
        if (!counterReady) void ensureCounterReady();
        void kickSync({ retryFailed: true });
      }
    }, 60_000);

    // Stash cleanup on the function for stopPosQueueSync
    (startPosQueueSync as { _cleanup?: () => void })._cleanup = () => {
      window.removeEventListener("online", onOnline);
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      started = false;
      counterReady = false;
      notReadyReason = "loading";
    };
  }

  void (async () => {
    await ensureCounterReady();
    emit();
    void kickSync(userChanged ? { retryFailed: true, retryRefused: true } : undefined);
  })();

  return () => {
    // Keep worker running for the POS session; profile updates just refresh ref.
    profileRef = user;
  };
}

export function stopPosQueueSync(): void {
  const cleanup = (startPosQueueSync as { _cleanup?: () => void })._cleanup;
  cleanup?.();
  profileRef = null;
}

/** Clear failed flag and retry (FIFO still applies). */
export async function retryFailedQueued(): Promise<void> {
  await requeueFailedOrders(true);
  lastError = null;
  emit();
  await kickSync();
}

/**
 * Failed rows back to pending. One the rules refused (permission-denied) would
 * mostly be refused again, costing reads each time — the timer retries it only
 * every REFUSED_RETRY_MS; a manual Retry or another login (`refused`) retries
 * it at once.
 */
async function requeueFailedOrders(refused: boolean): Promise<void> {
  const now = Date.now();
  const waitForRetry = (row: { lastErrorCode?: string; updatedAt: number }) =>
    !refused && isPermissionDenied(row.lastErrorCode) && now - row.updatedAt < REFUSED_RETRY_MS;
  const list = await listActiveQueuedOrders();
  for (const q of list) {
    if (q.status !== "failed" && q.stockStatus !== "failed") continue;
    if (waitForRetry(q)) continue;
    await putQueuedOrder({
      ...q,
      status: q.status === "failed" ? "pending" : q.status,
      stockStatus: q.stockStatus === "failed" ? "pending" : q.stockStatus,
      lastError: undefined,
      lastErrorCode: undefined,
      updatedAt: now,
    });
  }
  const muts = await listActiveQueuedMutations();
  for (const m of muts) {
    if (m.status !== "failed") continue;
    if (waitForRetry(m)) continue;
    await putQueuedMutation({
      ...m,
      status: "pending",
      lastError: undefined,
      lastErrorCode: undefined,
      updatedAt: now,
    });
  }
  const expenses = await listActiveQueuedExpenses();
  for (const e of expenses) {
    if (e.status !== "failed") continue;
    if (waitForRetry(e)) continue;
    await putQueuedExpense({
      ...e,
      status: "pending",
      lastError: undefined,
      lastErrorCode: undefined,
      updatedAt: now,
    });
  }
}

export async function kickSync(opts?: {
  /** Re-attempt previously failed queue rows (online + 1‑min timer). */
  retryFailed?: boolean;
  /** …including rows the rules refused (another login, manual retry). */
  retryRefused?: boolean;
}): Promise<void> {
  if (syncing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    emit();
    return;
  }
  const user = profileRef;
  if (!user) return;

  // Cross-tab lock: only one tab syncs at a time.
  const hasLocks = typeof navigator !== "undefined" && "locks" in navigator;
  if (hasLocks) {
    await navigator.locks.request(
      "pos-queue-sync",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return; // another tab is syncing
        await runPass(user, opts);
      },
    );
  } else {
    await runPass(user, opts);
  }
}

/**
 * One sync pass that always ends: each cloud step has its own time limit, and
 * a pass with no progress for STALL_MS (something else never settled) is
 * abandoned. Returning frees the cross-tab lock and the `syncing` flag — before,
 * one such await kept both forever and every later pass silently did nothing
 * until the page was reloaded. The abandoned pass's epoch is retired, so if it
 * ever wakes up it stops at its next step without touching any row.
 */
async function runPass(
  user: AppUser,
  opts?: { retryFailed?: boolean; retryRefused?: boolean },
): Promise<void> {
  const epoch = ++passEpoch;
  syncing = true;
  lastProgressAt = Date.now();
  emit();

  let watchdog: ReturnType<typeof setInterval> | undefined;
  const stalled = new Promise<void>((resolve) => {
    watchdog = setInterval(() => {
      if (Date.now() - lastProgressAt < STALL_MS) return;
      console.warn("[pos-queue] sync pass stalled — abandoned; the next pass retries");
      resolve();
    }, 10_000);
  });

  try {
    await Promise.race([doSync(user, epoch, opts), stalled]);
  } catch (err) {
    // A step the server never answered ends the pass (its row is already
    // marked); the 1-minute timer tries again. Anything else is a real bug.
    if (!endsPass(err)) throw err;
    if (err instanceof RequestTimeoutError) lastError = mapFirebaseError(err);
  } finally {
    clearInterval(watchdog);
    passEpoch++;
    syncing = false;
    emit();
  }
}

async function doSync(
  user: AppUser,
  epoch: number,
  opts?: { retryFailed?: boolean; retryRefused?: boolean },
): Promise<void> {
  if (opts?.retryFailed) {
    await requeueFailedOrders(Boolean(opts.retryRefused));
    lastError = null;
  }
  live(epoch);

  // Only sales still waiting for the cloud need its counter; nothing to
  // upload (most 1-minute timer passes), or only changes / expenses → skip
  // the server read. Numbering doesn't wait for this pass — app start,
  // coming online and opening checkout each reconcile it from the server first.
  const salesWaiting = (await listActiveQueuedOrders()).some(
    (q) => q.status !== "synced",
  );
  if (salesWaiting) {
    try {
      await reconcileFromServer(() =>
        cloudStep(
          epoch,
          () => getCloudLastOrderNumber({ fromServer: true }),
          QUICK_READ_TIMEOUT_MS,
        ),
      );
    } catch (err) {
      if (err instanceof PassAbandonedError) throw err;
      // ignore — even no answer: the first sale's upload then shows (as
      // "server isn't answering") whether the line really is down.
    }
  }
  live(epoch);

  // Server time first: offline sales get their PC-clock time settled
  // (resolveSaleTime) before they reach the cloud. Bounded in shop-clock.
  await ensureShopClock();

  let guard = 0;
  while (guard++ < MAX_PER_PASS) {
    live(epoch);
    if (typeof navigator !== "undefined" && !navigator.onLine) break;
    const active = await listActiveQueuedOrders();
    // Lowest number first: syncing in receipt order keeps the cloud counter
    // from jumping past sales still waiting (which forced renumbering).
    const next = active
      .filter((q) => q.status !== "failed" && q.stockStatus !== "failed")
      .sort((a, b) => a.orderNumber - b.orderNumber)[0];
    if (!next) break;
    await syncOne(next, user, epoch);
  }

  // A mutation waits until its order is fully on the cloud (order + stock):
  // cancel/delete then restore stock that was really deducted, and nothing
  // runs against an order that doesn't exist yet. It also never overtakes a
  // failed earlier mutation on the same order (edit → cancel stays ordered).
  guard = 0;
  while (guard++ < MAX_PER_PASS) {
    live(epoch);
    if (typeof navigator !== "undefined" && !navigator.onLine) break;
    const [active, queuedOrders] = await Promise.all([
      listActiveQueuedMutations(),
      listActiveQueuedOrders(),
    ]);
    const blocked = new Set(queuedOrders.map((q) => q.clientId));
    let next: QueuedMutation | undefined;
    for (const m of active) {
      if (m.status === "failed") {
        blocked.add(m.orderId);
        continue;
      }
      // Delete is owner-only: if staff is signed in now, wait for an owner
      // login instead of failing (or half-applying) it.
      if (m.kind === "delete" && user.role !== "owner") {
        blocked.add(m.orderId);
        continue;
      }
      if (blocked.has(m.orderId)) continue;
      next = m;
      break;
    }
    if (!next) break;
    await syncOneMutation(next, epoch);
  }

  // Expenses are independent of orders — FIFO among themselves, and an op
  // never overtakes a failed earlier op on the same expense (edit before add).
  guard = 0;
  while (guard++ < MAX_PER_PASS) {
    live(epoch);
    if (typeof navigator !== "undefined" && !navigator.onLine) break;
    const active = await listActiveQueuedExpenses();
    const blocked = new Set<string>();
    let next: QueuedExpense | undefined;
    for (const e of active) {
      const target = expenseOpTarget(e);
      if (e.status === "failed") {
        blocked.add(target);
        continue;
      }
      if (blocked.has(target)) continue;
      next = e;
      break;
    }
    if (!next) break;
    await syncOneExpense(next, user, epoch);
  }

  // Hand stock changes the server never took (their author was disabled,
  // or signed out with them waiting): put them on as whoever is in now.
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      await cloudStep(epoch, (signal) => redoWaitingStockChanges(user, signal));
    } catch (err) {
      if (err instanceof PassAbandonedError) throw err;
      console.error("[pos-queue] stock redo failed", err);
    }
  }

  // Synced rows stay as the local copy for 30 days, not forever.
  live(epoch);
  if (Date.now() - lastPruneAt >= PRUNE_EVERY_MS) {
    lastPruneAt = Date.now();
    try {
      await pruneOldSyncedLocalData();
    } catch (err) {
      console.error("[pos-queue] prune failed", err);
    }
  }
}

function deviceTimeIfChanged(q: QueuedOrder): string | undefined {
  if (!q.clock) return undefined;
  const device = new Date(q.clock.deviceMs).toISOString();
  return Math.abs(Date.parse(q.createdAt) - q.clock.deviceMs) >= 1000
    ? device
    : undefined;
}

async function syncOne(q: QueuedOrder, user: AppUser, epoch: number): Promise<void> {
  live(epoch);
  const now = Date.now();

  if (q.status !== "synced") {
    // The sale time to write. Saved on the row before the cloud write, so a
    // retry reuses it — but only once it is final: PC time alone while the
    // server clock hasn't answered yet (line down, PC still "online") stays
    // open, so the retry after the clock check can still correct or clamp it.
    let upload: Pick<QueuedOrder, "createdAt" | "timeSource"> = { createdAt: q.createdAt, timeSource: q.timeSource };
    if (!q.timeSource) {
      const { at, source } = resolveSaleTime(q.createdAt, q.clock);
      if (source) {
        upload = { createdAt: at, timeSource: source };
        if (source !== "device" || isShopClockMeasured()) q = { ...q, ...upload };
      }
    }
    await putQueuedOrder({
      ...q,
      status: "syncing",
      updatedAt: now,
    });
    emit();

    try {
      await cloudStep(epoch, (signal) => syncQueuedOrderToFirestore({
        clientId: q.clientId,
        orderNumber: q.orderNumber,
        branchId: q.branchId,
        branchName: q.branchName,
        orderType: q.orderType,
        customerName: q.customerName,
        customerPhone: q.customerPhone,
        deliveryAddress: q.deliveryAddress,
        tableNumber: q.tableNumber,
        items: q.items,
        subtotal: q.subtotal,
        taxAmount: q.taxAmount,
        taxPercent: q.taxPercent,
        deliveryCharges: q.deliveryCharges,
        discountType: q.discountType,
        discountValue: q.discountValue,
        discountAmount: q.discountAmount,
        total: q.total,
        paymentMethod: q.paymentMethod,
        createdBy: q.createdBy,
        createdByName: q.createdByName,
        createdByEmail: q.createdByEmail,
        createdAt: upload.createdAt,
        timeSource: upload.timeSource,
        deviceCreatedAt: deviceTimeIfChanged({ ...q, ...upload }),
        allowBelowCounter: q.keepNumber,
        printedOrderNumber: q.printedOrderNumber,
        signal,
      }));
      q = {
        ...q,
        ...upload,
        status: "synced",
        lastError: undefined,
        lastErrorCode: undefined,
        updatedAt: Date.now(),
      };
      await putQueuedOrder(q);
      await markOrderSynced(q.orderNumber);
    } catch (err) {
      let failure: unknown = err;
      if (err instanceof OrderNumberCollisionError) {
        try {
          // Counter is past this number — renumber only if another order
          // really has it; otherwise keep the number printed on the receipt.
          let taken = true;
          try {
            taken = await cloudStep(
              epoch,
              () => isOrderNumberTaken({
                orderNumber: q.orderNumber,
                clientId: q.clientId,
                branchId: q.branchId,
                isOwner: user.role === "owner",
              }),
              QUICK_READ_TIMEOUT_MS,
            );
          } catch (checkErr) {
            // No answer: never renumber on a guess — fail and retry the check.
            if (endsPass(checkErr)) throw checkErr;
            // Can't check (offline / rules) — fall back to a fresh number.
          }
          if (!taken) {
            q = { ...q, keepNumber: true, status: "pending", lastError: undefined, updatedAt: Date.now() };
          } else {
            // Re-allocate from cloud counter and retry on next loop iteration.
            const cloud = await cloudStep(
              epoch,
              () => getCloudLastOrderNumber(),
              QUICK_READ_TIMEOUT_MS,
            );
            const fresh = await reconcileAndAllocate(cloud);
            q = {
              ...q,
              orderNumber: fresh,
              printedOrderNumber: q.printedOrderNumber ?? q.orderNumber,
              keepNumber: false,
              status: "pending",
              lastError: undefined,
              updatedAt: Date.now(),
            };
          }
          live(epoch);
          await putQueuedOrder(q);
          emit();
          return;
        } catch (renumberErr) {
          if (endsPass(renumberErr)) failure = renumberErr;
          // Fallback: mark failed, will retry later
        }
      }
      // Abandoned pass: the running one owns the rows now — touch nothing.
      if (failure instanceof PassAbandonedError) throw failure;
      const msg = mapFirebaseError(failure);
      lastError = msg;
      await putQueuedOrder({
        ...q,
        status: "failed",
        lastError: msg,

        lastErrorCode: errorCode(failure),
        updatedAt: Date.now(),
      });
      emit();
      // The server isn't answering: the rest would only wait the same way.
      if (failure instanceof RequestTimeoutError) throw failure;
      return;
    }
  }

  if (q.stockStatus !== "synced") {
    live(epoch);
    await putQueuedOrder({
      ...q,
      stockStatus: "syncing",
      updatedAt: Date.now(),
    });
    emit();

    try {
      await cloudStep(epoch, (signal) => deductStockForOrder({
        branchId: q.branchId,
        items: q.items,
        // The cashier who made the sale (may not be the one signed in now);
        // the movement is written by the signed-in user with this name kept.
        user: {
          ...user,
          uid: q.createdBy,
          displayName: q.createdByName,
          email: q.createdByEmail || user.email,
        },
        idempotencyKey: q.clientId,
        // Stock "sale" movement is dated at the sale, not at sync.
        occurredAt: q.createdAt,
        saleAt: q.createdAt,
        signal,
      }));
      q = {
        ...q,
        status: "synced",
        stockStatus: "synced",
        lastError: undefined,
        lastErrorCode: undefined,
        updatedAt: Date.now(),
        syncedAt: Date.now(),
      };
      // Fully done — kept as this PC's local copy (pruned after 30 days, or cleared via Local data + PIN).
      await putQueuedOrder(q);
      lastError = null;
    } catch (err) {
      if (err instanceof PassAbandonedError) throw err;
      const msg = mapFirebaseError(err);
      lastError = msg;
      await putQueuedOrder({
        ...q,
        status: "synced",
        stockStatus: "failed",
        lastError: msg,

        lastErrorCode: errorCode(err),
        updatedAt: Date.now(),
      });
      emit();
      if (err instanceof RequestTimeoutError) throw err;
    }
  }

  emit();
}

async function syncOneMutation(m: QueuedMutation, epoch: number): Promise<void> {
  live(epoch);
  await putQueuedMutation({
    ...m,
    status: "syncing",
    updatedAt: Date.now(),
  });
  emit();

  try {
    const after = m.orderAfter;
    const before = m.orderBefore;
    const user = m.user;
    const occurredAt = m.occurredAt ?? new Date(m.enqueuedAt).toISOString();

    await cloudStep(epoch, async (signal) => {
      if (m.kind === "edit") {
        await updateOrderItems({
          order: before,
          items: after.items,
          user,
          orderType: after.orderType,
          paymentMethod: after.paymentMethod,
          customerName: after.customerName ?? "",
          customerPhone: after.customerPhone ?? "",
          deliveryAddress: after.deliveryAddress ?? "",
          tableNumber: after.tableNumber ?? "",
          deliveryFee: after.deliveryCharges ?? 0,
          discountType: after.discountType ?? null,
          discountValue: after.discountValue ?? 0,
          clientMutationId: m.mutationId,
          occurredAt,
          signal,
        });
      } else if (m.kind === "cancel") {
        await cancelOrder({
          order: before,
          user,
          clientMutationId: m.mutationId,
          skipStockRestore: m.skipStockRestore,
          occurredAt,
          signal,
        });
      } else if (m.kind === "delete") {
        await deleteOrder(before, user, {
          clientMutationId: m.mutationId,
          skipStockRestore: m.skipStockRestore,
          occurredAt,
          signal,
        });
      } else if (m.kind === "refund") {
        await refundOrder({
          orderId: m.orderId,
          refundAmount: m.refundAmount ?? 0,
          refundReason: m.refundReason ?? "",
          user,
          clientMutationId: m.mutationId,
          occurredAt,
          signal,
        });
      }
    });

    await putQueuedMutation({
      ...m,
      status: "synced",
      lastError: undefined,
      lastErrorCode: undefined,
      updatedAt: Date.now(),
      syncedAt: Date.now(),
    });
    lastError = null;
  } catch (err) {
    if (err instanceof PassAbandonedError) throw err;
    if (err instanceof OrderConflictError) {
      // Owner deleted/cancelled the order first — their change wins.
      await putQueuedMutation({
        ...m,
        status: "synced",
        outcome: "dropped",
        lastError: undefined,
        updatedAt: Date.now(),
        syncedAt: Date.now(),
      });
      emit();
      return;
    }
    const msg = mapFirebaseError(err);
    lastError = msg;
    await putQueuedMutation({
      ...m,
      status: "failed",
      lastError: msg,

      lastErrorCode: errorCode(err),
      updatedAt: Date.now(),
    });
    if (err instanceof RequestTimeoutError) {
      emit();
      throw err;
    }
  }
  emit();
}

async function syncOneExpense(e: QueuedExpense, user: AppUser, epoch: number): Promise<void> {
  live(epoch);
  await putQueuedExpense({ ...e, status: "syncing", updatedAt: Date.now() });
  emit();

  // Old create rows have no actor; fall back to the signed-in POS user.
  const actor = e.actor ?? user;
  const expenseId = expenseOpTarget(e);
  const queued = {
    opId: e.clientId,
    occurredAt: e.occurredAt ?? e.createdAt,
  };
  const current = {
    id: expenseId,
    branchId: e.branchId,
    category: e.category,
    description: e.description,
    amount: e.amount,
    date: e.date,
    createdBy: e.createdBy,
    createdByName: e.createdByName,
    createdAt: e.createdAt,
  };

  try {
    const kind = expenseOpKind(e);
    await cloudStep(epoch, async (signal) => {
      if (kind === "create") {
        await syncQueuedExpenseToFirestore({
          clientId: expenseId,
          branchId: e.branchId,
          category: e.category,
          description: e.description,
          amount: e.amount,
          date: e.date,
          createdBy: e.createdBy,
          createdByName: e.createdByName,
          createdAt: e.createdAt,
          user: actor,
          signal,
        });
      } else if (kind === "update") {
        await updateExpense(expenseId, {
          category: e.category,
          description: e.description,
          amount: e.amount,
          date: e.date,
          user: actor,
          previous: { ...current, ...e.previous },
          queued,
          signal,
        });
      } else {
        await deleteExpense(expenseId, { user: actor, previous: current, queued, signal });
      }
    });
    await putQueuedExpense({
      ...e,
      status: "synced",
      lastError: undefined,
      lastErrorCode: undefined,
      updatedAt: Date.now(),
      syncedAt: Date.now(),
    });
    lastError = null;
  } catch (err) {
    if (err instanceof PassAbandonedError) throw err;
    const msg = mapFirebaseError(err);
    lastError = msg;
    await putQueuedExpense({
      ...e,
      status: "failed",
      lastError: msg,

      lastErrorCode: errorCode(err),
      updatedAt: Date.now(),
    });
    if (err instanceof RequestTimeoutError) {
      emit();
      throw err;
    }
  }
  emit();
}

/**
 * Clear this PC's synced local copy (sales, order changes, expenses) and tell
 * every screen. Throws UnsyncedLocalDataError if anything is still waiting.
 */
export async function clearSyncedLocalCopy(): Promise<number> {
  const removed = await clearSyncedLocalData();
  emit();
  return removed;
}
