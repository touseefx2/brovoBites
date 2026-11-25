import type {
  BusinessDayHours,
  AppUser,
  DiscountType,
  Expense,
  ExpenseCategory,
  Order,
  OrderItem,
  OrderType,
  PaymentMethod,
} from "@bravobites/domain";
import type { ClockStamp, SaleTimeSource } from "@/lib/shop-clock";

export type QueueOrderStatus = "pending" | "syncing" | "synced" | "failed";
export type QueueStockStatus = "pending" | "syncing" | "synced" | "failed";

/** Full sale payload stored locally until Firestore + stock succeed. */
export interface QueuedOrder {
  clientId: string;
  orderNumber: number;
  branchId: string;
  branchName?: string;
  orderType: OrderType;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  tableNumber?: string;
  items: OrderItem[];
  subtotal: number;
  taxAmount?: number;
  taxPercent?: number;
  deliveryCharges?: number;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  total: number;
  paymentMethod: PaymentMethod;
  /**
   * "pending" = customer pays later (payment pending). Absent = paid, as on
   * every row from before this field existed. Only ever written when pending.
   */
  paymentStatus?: "pending";
  createdBy: string;
  createdByName: string;
  createdByEmail?: string;
  createdAt: string;
  /** How far createdAt can be trusted (missing on old rows). */
  clock?: ClockStamp;
  /** Set once sync settled createdAt against server time (see resolveSaleTime). */
  timeSource?: SaleTimeSource;
  /** Number on the printed receipt, kept when sync had to renumber the sale. */
  printedOrderNumber?: number;
  /** Cloud checked: nobody else uses orderNumber — sync it even below the counter. */
  keepNumber?: boolean;
  /** Order cloud sync */
  status: QueueOrderStatus;
  /** Stock deduct after order is on Firestore */
  stockStatus: QueueStockStatus;
  lastError?: string;
  /** Firestore error code of the last failure (e.g. permission-denied). */
  lastErrorCode?: string;
  /** FIFO / display */
  enqueuedAt: number;
  updatedAt: number;
  /**
   * When the sale was fully on the cloud (order + stock). Synced rows stay as
   * this PC's local copy until pruned (30 days) or cleared from "Local data" (PIN).
   */
  syncedAt?: number;
}

export interface QueueMeta {
  id: "meta";
  lastOrderNumber: number;
  /** ISO when we last reconciled with counters/global */
  lastCloudSyncAt?: string;
  /**
   * Bumped every time an order reaches the cloud. reconcileFromServer only
   * lowers the counter when this didn't change while its server read was in
   * flight (a stale read must never rewind past a just-synced number).
   */
  syncSeq?: number;
}

export type EnqueueCheckoutInput = {
  branchId: string;
  branchName?: string;
  lines: import("@bravobites/domain").CartLine[];
  paymentMethod: PaymentMethod;
  /**
   * "pending" = the customer pays later: needs a customer name or phone.
   * Missing / "paid" = paid now (the default).
   */
  paymentStatus?: "paid" | "pending";
  orderType: OrderType;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  tableNumber?: string;
  taxAmount: number;
  taxPercent?: number;
  deliveryCharges: number;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  user: AppUser;
};

export function queuedToOrder(q: QueuedOrder): Order {
  return {
    id: q.clientId,
    branchId: q.branchId,
    ...(q.branchName ? { branchName: q.branchName } : {}),
    orderNumber: q.orderNumber,
    ...(q.printedOrderNumber && q.printedOrderNumber !== q.orderNumber
      ? { printedOrderNumber: q.printedOrderNumber }
      : {}),
    orderType: q.orderType,
    ...(q.customerName ? { customerName: q.customerName } : {}),
    ...(q.customerPhone ? { customerPhone: q.customerPhone } : {}),
    ...(q.deliveryAddress ? { deliveryAddress: q.deliveryAddress } : {}),
    ...(q.tableNumber ? { tableNumber: q.tableNumber } : {}),
    items: q.items,
    subtotal: q.subtotal,
    ...(q.taxAmount && q.taxAmount > 0 ? { taxAmount: q.taxAmount } : {}),
    ...(q.taxPercent && q.taxPercent > 0 ? { taxPercent: q.taxPercent } : {}),
    ...(q.deliveryCharges && q.deliveryCharges > 0
      ? { deliveryCharges: q.deliveryCharges }
      : {}),
    ...(q.discountAmount && q.discountAmount > 0
      ? {
          discountType: q.discountType,
          discountValue: q.discountValue,
          discountAmount: q.discountAmount,
        }
      : {}),
    total: q.total,
    paymentMethod: q.paymentMethod,
    ...(q.paymentStatus === "pending" ? { paymentStatus: "pending" as const } : {}),
    status: "completed",
    createdBy: q.createdBy,
    createdByName: q.createdByName,
    ...(q.createdByEmail ? { createdByEmail: q.createdByEmail } : {}),
    createdAt: q.createdAt,
    clientId: q.clientId,
  };
}

/** Still needs cloud work (order and/or stock). */
export function isQueueActive(q: QueuedOrder): boolean {
  if (q.status !== "synced") return true;
  if (q.stockStatus !== "synced") return true;
  return false;
}

export function isQueueFailed(q: QueuedOrder): boolean {
  return q.status === "failed" || q.stockStatus === "failed";
}

export type MutationKind = "edit" | "cancel" | "refund" | "delete" | "payment";

/** Why sync dropped a change (OrderConflictError reason on the cloud). */
export type MutationDropReason = "deleted" | "cancelled" | "refunded" | "paid" | "unpaid";

/** Offline edit / cancel / refund / delete / payment — synced after create queue. */
export interface QueuedMutation {
  mutationId: string;
  kind: MutationKind;
  orderId: string;
  /** Baseline used for stock amend / cloud write */
  orderBefore: Order;
  /** Local result after applying the mutation */
  orderAfter: Order;
  refundAmount?: number;
  refundReason?: string;
  /** kind "payment": mark paid, or (owner only) set back to payment pending. */
  paymentTo?: "paid" | "pending";
  /** kind "payment" + paymentTo "paid": the method the customer actually paid with. */
  paidMethod?: PaymentMethod;
  /** Skip stock restore on cancel/delete when stock was never deducted. */
  skipStockRestore?: boolean;
  user: AppUser;
  /** When the action happened (activity log time). Missing on old rows. */
  occurredAt?: string;
  status: QueueOrderStatus;
  lastError?: string;
  /** Firestore error code of the last failure (e.g. permission-denied). */
  lastErrorCode?: string;
  enqueuedAt: number;
  updatedAt: number;
  /** When it reached the cloud (row kept as local copy). */
  syncedAt?: number;
  /** "dropped": owner had deleted/cancelled the order first — not applied. */
  outcome?: "dropped";
  /**
   * Why it was dropped (set on rows dropped since payment status existed).
   * Payment changes and refunds of a payment-pending order stay visible in
   * the sync-status sheet — cash may be in the drawer (listSyncIssues).
   */
  droppedReason?: MutationDropReason;
  /**
   * When the cashier tapped "Got it" on this dropped change in the sync-status
   * sheet. Until then it counts in QueueSnapshot.droppedCount (red pill).
   */
  droppedSeenAt?: number;
}

export function isMutationActive(m: QueuedMutation): boolean {
  return m.status !== "synced";
}

export function isMutationFailed(m: QueuedMutation): boolean {
  return m.status === "failed";
}

export type ExpenseOpKind = "create" | "update" | "delete";

export type ExpenseFields = Pick<
  Expense,
  "category" | "description" | "amount" | "date"
>;

/**
 * One POS expense action (add / edit / delete), stored locally until written
 * to Firestore. Synced FIFO; ops on the same expense never overtake each other.
 */
export interface QueuedExpense {
  /** Op id (IDB key). For "create" it is also the expense doc id. */
  clientId: string;
  /** Missing on rows written before edit/delete existed → "create". */
  kind?: ExpenseOpKind;
  /** Target expense doc id (defaults to clientId). */
  expenseId?: string;
  branchId: string;
  /** Expense state after the op (for delete: the state being deleted). */
  category: ExpenseCategory;
  description: string;
  amount: number;
  /** Business day (YYYY-MM-DD) */
  date: string;
  createdBy: string;
  createdByName: string;
  /** When the expense itself was first entered. */
  createdAt: string;
  /** update: values before the edit (for the activity log). */
  previous?: ExpenseFields;
  /** Who performed this op; missing on old create rows → createdBy. */
  actor?: AppUser;
  /** When this op happened (activity log time). Defaults to createdAt. */
  occurredAt?: string;
  status: QueueOrderStatus;
  lastError?: string;
  /** Firestore error code of the last failure (e.g. permission-denied). */
  lastErrorCode?: string;
  enqueuedAt: number;
  updatedAt: number;
  /** When it reached the cloud (row kept as local copy). */
  syncedAt?: number;
}

export type EnqueueExpenseInput = {
  branchId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  user: AppUser;
  /** Shop hours — staff may file expenses under today's business day only. */
  hours: BusinessDayHours;
};

export function expenseOpKind(q: QueuedExpense): ExpenseOpKind {
  return q.kind ?? "create";
}

export function expenseOpTarget(q: QueuedExpense): string {
  return q.expenseId ?? q.clientId;
}

export function isExpenseActive(e: QueuedExpense): boolean {
  return e.status !== "synced";
}

export function queuedToExpense(q: QueuedExpense): Expense {
  const kind = expenseOpKind(q);
  return {
    id: expenseOpTarget(q),
    branchId: q.branchId,
    category: q.category,
    description: q.description,
    amount: q.amount,
    date: q.date,
    createdBy: q.createdBy,
    createdByName: q.createdByName,
    createdAt: q.createdAt,
    ...(kind === "update" && q.actor
      ? {
          updatedAt: q.occurredAt,
          updatedBy: q.actor.uid,
          updatedByName: q.actor.displayName || q.actor.email,
        }
      : {}),
  };
}

/**
 * Cloud list + local pending ops (FIFO) → what the user should see now.
 * `pendingIds` = expenses with an op not yet on Firestore.
 */
export function applyPendingExpenseOps(
  cloud: Expense[],
  ops: QueuedExpense[],
): { list: Expense[]; pendingIds: Set<string> } {
  const byId = new Map(cloud.map((e) => [e.id, e]));
  const pendingIds = new Set<string>();
  const sorted = [...ops].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  for (const op of sorted) {
    const id = expenseOpTarget(op);
    pendingIds.add(id);
    if (expenseOpKind(op) === "delete") byId.delete(id);
    else byId.set(id, { ...byId.get(id), ...queuedToExpense(op) });
  }
  const list = [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return { list, pendingIds };
}

const PAYMENT_KEYS = ["paymentStatus", "paidAt", "paidBy", "paidByName"] as const;

/** Payment state of an order, for "did it change?" checks. */
function paymentState(o: Order): string {
  return `${o.paymentStatus === "pending" ? "pending" : ""}|${o.paidAt ?? ""}`;
}

/** `target` with the payment fields (and, if asked, the method) of `source`. */
function withPaymentOf(target: Order, source: Order, takeMethod: boolean): Order {
  const out: Order = { ...target };
  for (const k of PAYMENT_KEYS) delete out[k];
  if (source.paymentStatus === "pending") out.paymentStatus = "pending";
  if (source.paidAt) out.paidAt = source.paidAt;
  if (source.paidBy) out.paidBy = source.paidBy;
  if (source.paidByName) out.paidByName = source.paidByName;
  if (takeMethod) out.paymentMethod = source.paymentMethod;
  return out;
}

/**
 * The order after mutation `m`, given the copy shown so far (`current`).
 * - "payment": only the payment fields change — never the stale rest of
 *   orderAfter over a newer cloud copy.
 * - edit / cancel / refund never change payment: keep the current copy's
 *   payment fields (marked paid on another device meanwhile), and its method
 *   too when its payment state moved since the change was made (same rule
 *   as updateOrderItems on the cloud).
 * Missing `current` (an order outside the list): orderAfter, as before.
 */
function applyMutation(current: Order | undefined, m: QueuedMutation): Order {
  if (!current) return m.orderAfter;
  if (m.kind === "payment") {
    return withPaymentOf(current, m.orderAfter, m.paymentTo === "paid");
  }
  if (paymentState(current) === paymentState(m.orderAfter)) return m.orderAfter;
  return withPaymentOf(
    m.orderAfter,
    current,
    paymentState(current) !== paymentState(m.orderBefore),
  );
}

/**
 * Cloud orders + this PC's queue → what the POS should count right now.
 * Unsynced sales are added, queued edit/cancel/refund apply their result,
 * queued deletes remove the order. Same id ⇒ never counted twice.
 * `pendingIds` = orders with anything not yet on Firestore.
 */
export function applyPendingOrderOps(
  cloud: Order[],
  queued: QueuedOrder[],
  mutations: QueuedMutation[],
): { list: Order[]; pendingIds: Set<string> } {
  const byId = new Map(cloud.map((o) => [o.id, o]));
  const pendingIds = new Set<string>();
  for (const q of queued) {
    pendingIds.add(q.clientId);
    if (!byId.has(q.clientId)) byId.set(q.clientId, queuedToOrder(q));
  }
  const sorted = [...mutations].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  for (const m of sorted) {
    pendingIds.add(m.orderId);
    if (m.kind === "delete") byId.delete(m.orderId);
    else byId.set(m.orderId, applyMutation(byId.get(m.orderId), m));
  }
  const list = [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return { list, pendingIds };
}

/**
 * This PC's synced local copy of expenses (adds, edits and deletes that reached
 * the cloud, in order). Offline fallback for rows the Firestore cache never got.
 */
export function syncedLocalExpenses(ops: QueuedExpense[]): Expense[] {
  const byId = new Map<string, Expense>();
  const synced = ops.filter((op) => !isExpenseActive(op)).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  for (const op of synced) {
    const id = expenseOpTarget(op);
    if (expenseOpKind(op) === "delete") byId.delete(id);
    else byId.set(id, { ...byId.get(id), ...queuedToExpense(op) });
  }
  return [...byId.values()];
}

/**
 * This PC's synced local copy as orders (synced sales + synced edits / cancels /
 * refunds / deletes). Offline fallback for days the Firestore cache never got.
 */
export function syncedLocalOrders(
  queued: QueuedOrder[],
  mutations: QueuedMutation[],
): Order[] {
  const byId = new Map<string, Order>();
  for (const q of queued) {
    if (!isQueueActive(q)) byId.set(q.clientId, queuedToOrder(q));
  }
  const synced = mutations
    .filter((m) => !isMutationActive(m) && m.outcome !== "dropped")
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  for (const m of synced) {
    if (m.kind === "delete") byId.delete(m.orderId);
    else byId.set(m.orderId, applyMutation(byId.get(m.orderId), m));
  }
  return [...byId.values()];
}
