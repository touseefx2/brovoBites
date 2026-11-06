import {
  collection,
  count,
  deleteDoc,
  deleteField,
  doc,
  getAggregateFromServer,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  sum,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";
import type {
  ActivityAction,
  ActivityChange,
  ActivityEntityType,
  ActivityExpenseSnapshot,
  ActivityLog,
  ActivityOrderSnapshot,
  AppUser,
  Branch,
  CartLine,
  CashDrawerSession,
  Category,
  DealLineItem,
  DiscountType,
  Expense,
  ExpenseCategory,
  InventoryItem,
  Order,
  OrderItem,
  OrderType,
  PaymentMethod,
  Product,
  ShopSettings,
  StockMovement,
  StockMovementType,
  StockUnit,
} from "@bravobites/domain";
import {
  labelNamesSize,
  DEFAULT_SETTINGS,
  SHARED_MENU_ID,
  amendOrderTotals,
  businessDateKey,
  businessDayHoursFromSettings,
  computeOrderTotals,
  formatPkr,
  inventoryDocId,
  lineTotal,
  isFullyRefunded,
  money,
  orderRefundableAmount,
  orderRefundedAmount,
  orderTaxPercent,
  shiftBusinessDateKey,
  stockKey,
  toOrderItems,
} from "@bravobites/domain";
import { getClientAuth, getClientDb } from "@/lib/firebase/client";
import {
  asActivityLog,
  asCashDrawer,
  asCategory,
  asExpense,
  asInventoryItem,
  asOrder,
  asOrderItem,
  asOrderRefunds,
  asProduct,
  asStockMovement,
  parseShopSettings,
  resolveCreatedAt,
  resolveServerTime,
} from "@/lib/firestore-parse";
import {
  parseReportEmailSettings,
  REPORT_EMAIL_COLLECTION,
  REPORT_EMAIL_DOC_ID,
  REPORT_EMAIL_LOG_COLLECTION,
  type ReportEmailSettings,
} from "@/lib/report-email";
import { shopNow, type SaleTimeSource } from "@/lib/shop-clock";
import { invalidatePublicMenuCache } from "@/lib/menu-data";
import { listStockOutbox, putStockOutbox, removeStockOutbox, type StockOutboxEntry } from "@/lib/stock-outbox";

function parseOptionalCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBranch(id: string, data: DocumentData): Branch {
  return {
    id,
    name: String(data.name),
    phone: String(data.phone ?? ""),
    address: String(data.address ?? ""),
    latitude: parseOptionalCoord(data.latitude),
    longitude: parseOptionalCoord(data.longitude),
    isActive: data.isActive !== false,
    createdAt: String(data.createdAt ?? ""),
  };
}

async function readDocAfterWrite<T>(
  ref: ReturnType<typeof doc>,
  mapFn: (id: string, data: DocumentData) => T,
): Promise<T | null> {
  try {
    const snap = await getDocFromServer(ref);
    if (snap.exists()) return mapFn(snap.id, snap.data());
  } catch {
    // Fall through to cache read.
  }
  try {
    const cached = await getDoc(ref);
    if (cached.exists()) return mapFn(cached.id, cached.data());
  } catch {
    // Never fail the caller — write already succeeded.
  }
  return null;
}

/** Max lastOrderNumber from legacy per-branch counters (owner-only list). */
async function maxLegacyCounterValue(): Promise<number> {
  try {
    const allCounters = await getDocs(collection(getClientDb(), "counters"));
    let max = 0;
    for (const d of allCounters.docs) {
      if (d.id === "global") continue;
      const val = Number(d.data().lastOrderNumber ?? 0);
      if (Number.isFinite(val) && val > max) max = val;
    }
    return max;
  } catch {
    // Staff cannot list every counter doc (permission-denied). Skip migrate.
    return 0;
  }
}

/** Firestore-safe order lines (no undefined fields). */
export function sanitizeOrderItems(items: OrderItem[]): OrderItem[] {
  return items
    .filter((i) => i.qty > 0)
    .map((i) => {
      const unitPrice = money(i.unitPrice);
      const qty = Math.max(0, Math.floor(Number(i.qty) || 0));
      const item: OrderItem = {
        productId: String(i.productId),
        productName: String(i.productName),
        unitPrice,
        qty,
        lineTotal: lineTotal(unitPrice, qty),
      };
      if (i.variationId) item.variationId = String(i.variationId);
      if (i.variationLabel) item.variationLabel = String(i.variationLabel);
      if (i.note) item.note = String(i.note);
      return item;
    });
}

export function orderItemsTotal(items: OrderItem[]): number {
  return money(items.reduce((sum, i) => sum + lineTotal(i.unitPrice, i.qty), 0));
}

/** Human-readable add / remove / qty changes for activity logs. */
function orderItemLineKey(item: OrderItem): string {
  return `${item.productId}::${item.variationId ?? ""}`;
}

function orderItemLabel(item: OrderItem): string {
  const name = item.productName.trim() || item.productId;
  return item.variationLabel ? `${name} (${item.variationLabel})` : name;
}

/**
 * The bill as an activity log keeps it, so the log can show "before → after"
 * (items, discount, tax, delivery, total…). No undefined fields — Firestore
 * refuses them.
 */
export function orderLogSnapshot(o: {
  orderNumber: number;
  items: OrderItem[];
  subtotal: number;
  discountType?: DiscountType | null;
  discountValue?: number | null;
  discountAmount?: number | null;
  taxAmount?: number;
  deliveryCharges?: number;
  total: number;
  paymentMethod: PaymentMethod;
  orderType?: OrderType;
  customerName?: string;
  customerPhone?: string;
  tableNumber?: string;
  deliveryAddress?: string;
  refundAmount?: number;
  createdAt?: string;
}): ActivityOrderSnapshot {
  const snap: ActivityOrderSnapshot = {
    orderNumber: Number(o.orderNumber) || 0,
    items: o.items.map((i) => ({
      name: orderItemLabel(i),
      qty: Number(i.qty) || 0,
      unitPrice: money(i.unitPrice),
      lineTotal: money(i.lineTotal),
    })),
    subtotal: money(o.subtotal),
    discountAmount: money(o.discountAmount ?? 0),
    taxAmount: money(o.taxAmount ?? 0),
    deliveryCharges: money(o.deliveryCharges ?? 0),
    total: money(o.total),
    paymentMethod: o.paymentMethod,
  };
  if (o.discountType === "percent" && (o.discountValue ?? 0) > 0 && snap.discountAmount > 0) {
    snap.discountLabel = `${o.discountValue}%`;
  }
  if (o.orderType) snap.orderType = o.orderType;
  for (const k of ["customerName", "customerPhone", "tableNumber", "deliveryAddress"] as const) {
    const v = (o[k] ?? "").trim();
    if (v) snap[k] = v;
  }
  if ((o.refundAmount ?? 0) > 0) snap.refundAmount = money(o.refundAmount ?? 0);
  if (o.createdAt) snap.createdAt = o.createdAt;
  return snap;
}

export function expenseLogSnapshot(e: {
  category: string;
  description: string;
  amount: number;
  date: string;
}): ActivityExpenseSnapshot {
  return {
    category: String(e.category),
    description: (e.description ?? "").trim(),
    amount: money(e.amount),
    date: e.date ?? "",
  };
}

export function describeOrderItemsDiff(
  previous: OrderItem[],
  next: OrderItem[],
): string {
  const before = new Map<string, OrderItem>();
  for (const item of previous) {
    const key = orderItemLineKey(item);
    const existing = before.get(key);
    if (existing) existing.qty += item.qty;
    else before.set(key, { ...item });
  }
  const after = new Map<string, OrderItem>();
  for (const item of next) {
    const key = orderItemLineKey(item);
    const existing = after.get(key);
    if (existing) existing.qty += item.qty;
    else after.set(key, { ...item });
  }

  const parts: string[] = [];
  for (const [key, item] of after) {
    const prev = before.get(key);
    if (!prev) {
      parts.push(`Added item: ${orderItemLabel(item)} ×${item.qty}`);
    } else if (prev.qty !== item.qty) {
      parts.push(
        `Qty change: ${orderItemLabel(item)} ${prev.qty} → ${item.qty}`,
      );
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) {
      parts.push(`Removed item: ${orderItemLabel(item)} ×${item.qty}`);
    }
  }

  return parts.join(" · ");
}

function describeDiscountLine(params: {
  discountType?: DiscountType | null;
  discountValue?: number | null;
  discountAmount?: number | null;
}): string {
  const amount = money(params.discountAmount ?? 0);
  if (!(amount > 0)) return "";
  if (params.discountType === "percent" && (params.discountValue ?? 0) > 0) {
    return `Discount ${params.discountValue}% (−${formatPkr(amount)})`;
  }
  return `Discount (−${formatPkr(amount)})`;
}

function describeOrderMetaDiff(
  previous: Order,
  next: {
    orderType: OrderType;
    paymentMethod: PaymentMethod;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    tableNumber: string;
    deliveryCharges: number;
    discountType?: DiscountType | null;
    discountValue?: number | null;
    discountAmount?: number | null;
  },
): string {
  const parts: string[] = [];
  const prevType = previous.orderType ?? "dine-in";
  if (prevType !== next.orderType) {
    parts.push(`Type: ${prevType} → ${next.orderType}`);
  }
  if (previous.paymentMethod !== next.paymentMethod) {
    parts.push(`Payment: ${previous.paymentMethod} → ${next.paymentMethod}`);
  }
  const prevName = (previous.customerName || "").trim();
  if (prevName !== next.customerName) {
    parts.push(`Customer: “${prevName || "—"}” → “${next.customerName || "—"}”`);
  }
  const prevPhone = (previous.customerPhone || "").trim();
  if (prevPhone !== next.customerPhone) {
    parts.push(`Phone: ${prevPhone || "—"} → ${next.customerPhone || "—"}`);
  }
  const prevAddr = (previous.deliveryAddress || "").trim();
  if (prevAddr !== next.deliveryAddress) {
    parts.push(`Address: “${prevAddr || "—"}” → “${next.deliveryAddress || "—"}”`);
  }
  const prevTable = (previous.tableNumber || "").trim();
  if (prevTable !== next.tableNumber) {
    parts.push(`Table: ${prevTable || "—"} → ${next.tableNumber || "—"}`);
  }
  const prevDlv = money(previous.deliveryCharges ?? 0);
  if (prevDlv !== next.deliveryCharges) {
    parts.push(
      `Delivery: ${formatPkr(prevDlv)} → ${formatPkr(next.deliveryCharges)}`,
    );
  }
  const prevDiscount = describeDiscountLine({
    discountType: previous.discountType,
    discountValue: previous.discountValue,
    discountAmount: previous.discountAmount,
  });
  const nextDiscount = describeDiscountLine({
    discountType: next.discountType,
    discountValue: next.discountValue,
    discountAmount: next.discountAmount,
  });
  if (prevDiscount !== nextDiscount) {
    parts.push(
      `Discount: ${prevDiscount || "—"} → ${nextDiscount || "—"}`,
    );
  }
  return parts.join(" · ");
}

function describeOrderItemsList(items: OrderItem[]): string {
  if (items.length === 0) return "";
  return items
    .map((i) => `${orderItemLabel(i)} ×${i.qty}`)
    .join(", ");
}

export async function fetchBranches(): Promise<Branch[]> {
  const snap = await getDocs(collection(getClientDb(), "branches"));
  return snap.docs.map((d) => asBranch(d.id, d.data()));
}

/** Real-time all branches (caller filters active / access). */
export function onBranchesSnapshot(
  callback: (branches: Branch[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getClientDb(), "branches"),
    (snap) => {
      callback(snap.docs.map((d) => asBranch(d.id, d.data())));
    },
    (err) => onError?.(err),
  );
}

/** Central menu — `branchId` arg ignored (kept for call-site compat). */
export async function fetchCategories(_branchId?: string): Promise<Category[]> {
  const snap = await getDocs(collection(getClientDb(), "categories"));
  return snap.docs
    .map((d) => asCategory(d.id, d.data()))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Central menu — `branchId` arg ignored (kept for call-site compat). */
export async function fetchProducts(_branchId?: string): Promise<Product[]> {
  const snap = await getDocs(collection(getClientDb(), "products"));
  return snap.docs
    .map((d) => asProduct(d.id, d.data()))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function fetchSettings(): Promise<ShopSettings> {
  const snap = await getDocs(collection(getClientDb(), "settings"));
  const first = snap.docs[0];
  if (!first) return DEFAULT_SETTINGS;
  return parseShopSettings(first.data());
}

export async function saveSettings(settings: Partial<ShopSettings>): Promise<void> {
  const snap = await getDocs(collection(getClientDb(), "settings"));
  const first = snap.docs[0];
  const docRef = first ? doc(getClientDb(), "settings", first.id) : doc(collection(getClientDb(), "settings"));
  await setDoc(docRef, settings, { merge: true });
  invalidatePublicMenuCache();
}

export async function fetchOrders(
  branchId: string,
  /** Keep orders from the last N days. Pass `null` for all history. */
  limitDays: number | null = 30,
  opts?: {
    createdBy?: string;
    /** "cache" reads only the local Firestore cache — instant, never waits on the network. */
    source?: "cache";
    /** Only orders with createdAt >= this ISO time — queried on the server, not the whole history. */
    sinceIso?: string;
  },
): Promise<Order[]> {
  const since =
    limitDays == null
      ? null
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - limitDays);
          return d;
        })();
  const constraints = [where("branchId", "==", branchId)];
  if (opts?.createdBy) constraints.push(where("createdBy", "==", opts.createdBy));
  const base = query(collection(getClientDb(), "orders"), ...constraints);
  const ranged = opts?.sinceIso
    ? query(base, where("createdAt", ">=", opts.sinceIso))
    : base;
  const read = (q: typeof base) =>
    opts?.source === "cache" ? getDocsFromCache(q) : getDocs(q);
  let snap;
  try {
    snap = await read(ranged);
  } catch (err) {
    // Date index not deployed yet → whole branch (old behaviour), filtered below.
    if (ranged === base || !isMissingIndex(err)) throw err;
    snap = await read(base);
  }
  const orders = snap.docs
    .map((d) => asOrder(d.id, d.data()))
    .filter((o) => (since ? new Date(o.createdAt) >= since : true))
    .filter((o) => (opts?.sinceIso ? o.createdAt >= opts.sinceIso : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Email backfill hits the network per user — skip it on the instant cache read.
  if (opts?.source === "cache") return orders;

  // Older orders lack createdByEmail — fill from users/{uid} when readable
  const needEmail = [
    ...new Set(
      orders
        .filter((o) => !o.createdByEmail?.trim() && o.createdBy)
        .map((o) => o.createdBy),
    ),
  ];
  if (needEmail.length === 0) return orders;

  const emailByUid = new Map<string, string>();
  const nameByUid = new Map<string, string>();
  await Promise.all(
    needEmail.map(async (uid) => {
      try {
        const userSnap = await getDoc(doc(getClientDb(), "users", uid));
        if (!userSnap.exists()) return;
        const data = userSnap.data();
        const email = String(data.email ?? "").trim();
        const displayName = String(data.displayName ?? "").trim();
        if (email) emailByUid.set(uid, email);
        if (displayName) nameByUid.set(uid, displayName);
      } catch {
        // Staff can only read own user doc — skip others
      }
    }),
  );

  return orders.map((o) => {
    if (o.createdByEmail?.trim()) return o;
    const email = emailByUid.get(o.createdBy);
    const name = nameByUid.get(o.createdBy);
    if (!email && !name) return o;
    return {
      ...o,
      ...(email ? { createdByEmail: email } : {}),
      ...(name && (!o.createdByName || o.createdByName.includes("@"))
        ? { createdByName: name }
        : {}),
    };
  });
}

export async function fetchUsers(): Promise<AppUser[]> {
  const snap = await getDocs(collection(getClientDb(), "users"));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      email: String(data.email ?? ""),
      displayName: String(data.displayName ?? ""),
      phone: String(data.phone ?? ""),
      role: data.role === "owner" ? "owner" : "counter",
      branchIds: Array.isArray(data.branchIds) ? data.branchIds.map(String) : [],
      isActive: data.isActive !== false,
      createdAt: String(data.createdAt ?? ""),
      isPrimaryOwner: data.isPrimaryOwner === true,
      permissions: data.permissions && typeof data.permissions === "object"
        ? {
            canAddExpenses: (data.permissions as Record<string, unknown>).canAddExpenses !== false,
            canDeleteExpenses: (data.permissions as Record<string, unknown>).canDeleteExpenses !== false,
            canApplyDiscount: (data.permissions as Record<string, unknown>).canApplyDiscount !== false,
            canEditOrders: (data.permissions as Record<string, unknown>).canEditOrders !== false,
            canCancelOrders: (data.permissions as Record<string, unknown>).canCancelOrders !== false,
            canManageInventory: (data.permissions as Record<string, unknown>).canManageInventory !== false,
          }
        : undefined,
    };
  });
}

export async function createOrder(params: {
  branchId: string;
  branchName?: string;
  lines: CartLine[];
  paymentMethod: PaymentMethod;
  orderType: OrderType;
  /** Optional counter-entered customer name */
  customerName?: string;
  /** Optional counter-entered customer phone */
  customerPhone?: string;
  /** Delivery address (delivery orders) */
  deliveryAddress?: string;
  /** Optional table number (dine-in) */
  tableNumber?: string;
  taxAmount: number;
  /** Rate used for taxAmount — stored so amendments can re-derive tax */
  taxPercent?: number;
  deliveryCharges: number;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  user: AppUser;
}): Promise<Order> {
  const { branchId, branchName, lines, paymentMethod, orderType, deliveryCharges, user, discountType, discountValue } = params;
  const customerName = (params.customerName || "").trim();
  const customerPhone = (params.customerPhone || "").trim();
  const deliveryAddress =
    orderType === "delivery" ? (params.deliveryAddress || "").trim() : "";
  const tableNumber =
    orderType === "dine-in" ? (params.tableNumber || "").trim() : "";
  const items = toOrderItems(lines);
  const taxPercent = params.taxPercent ?? 0;
  const totals = computeOrderTotals({
    subtotal: orderItemsTotal(items),
    taxPercent,
    taxAmount: params.taxAmount,
    deliveryCharges,
    discountType,
    discountValue,
    discountAmount: params.discountAmount,
  });
  const { subtotal, taxAmount, discountAmount, total } = totals;
  const db = getClientDb();
  const counterRef = doc(db, "counters", "global");
  const orderRef = doc(collection(db, "orders"));
  const branchLabel = (branchName || "").trim();

  // Seed migrate OUTSIDE the transaction. Listing all counters fails for staff
  // (rules only allow global + own-branch counter docs) → permission-denied on checkout.
  let seedLast = 0;
  {
    const pre = await getDoc(counterRef);
    if (!pre.exists()) {
      seedLast = await maxLegacyCounterValue();
    }
  }

  const orderNumber = await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    let last = counterSnap.exists()
      ? Number(counterSnap.data().lastOrderNumber ?? 0)
      : seedLast;
    if (!Number.isFinite(last) || last < 0) last = 0;
    last = Math.floor(last);

    const next = last + 1;
    tx.set(
      counterRef,
      { lastOrderNumber: next },
      { merge: true },
    );
    const createdAt = new Date().toISOString();
    const payload = {
      branchId,
      ...(branchLabel ? { branchName: branchLabel } : {}),
      orderNumber: next,
      orderType,
      ...(customerName ? { customerName } : {}),
      ...(customerPhone ? { customerPhone } : {}),
      ...(deliveryAddress ? { deliveryAddress } : {}),
      ...(tableNumber ? { tableNumber } : {}),
      items,
      subtotal,
      ...(taxAmount > 0 ? { taxAmount } : {}),
      ...(taxPercent > 0 ? { taxPercent } : {}),
      ...(deliveryCharges > 0 ? { deliveryCharges } : {}),
      ...(discountAmount > 0 ? { discountType, discountValue, discountAmount } : {}),
      total,
      paymentMethod,
      status: "completed" as const,
      createdBy: user.uid,
      createdByName: user.displayName || user.email,
      createdByEmail: user.email || "",
      createdAt,
      createdAtServer: serverTimestamp(),
    };
    tx.set(orderRef, payload);
    return next;
  });

  // Normal POS sale is already in `orders` — skip activity write to save quota.
  // Fraud-sensitive actions (edit / cancel / delete / refund) still write logs.

  // Re-read so receipt/UI use Firebase server time, not the POS PC clock.
  const fresh = await readDocAfterWrite(orderRef, asOrder);
  if (fresh) return fresh;

  return {
    id: orderRef.id,
    branchId,
    ...(branchLabel ? { branchName: branchLabel } : {}),
    orderNumber,
    orderType,
    ...(customerName ? { customerName } : {}),
    ...(customerPhone ? { customerPhone } : {}),
    ...(deliveryAddress ? { deliveryAddress } : {}),
    ...(tableNumber ? { tableNumber } : {}),
    items,
    subtotal,
    ...(taxAmount > 0 ? { taxAmount } : {}),
    ...(taxPercent > 0 ? { taxPercent } : {}),
    ...(deliveryCharges > 0 ? { deliveryCharges } : {}),
    ...(discountAmount > 0 ? { discountType, discountValue, discountAmount } : {}),
    total,
    paymentMethod,
    status: "completed",
    createdBy: user.uid,
    createdByName: user.displayName || user.email,
    createdByEmail: user.email || "",
    createdAt: new Date().toISOString(),
  };
}

/** Next order # for receipt preview (assigned for real on checkout). */
export async function peekNextOrderNumber(_branchId?: string): Promise<number> {
  const last = await getCloudLastOrderNumber();
  return last + 1;
}

/** Current `counters/global.lastOrderNumber` (0 if missing). */
export async function getCloudLastOrderNumber(opts?: {
  /** Throw instead of falling back to the offline cache — required before lowering the local counter. */
  fromServer?: boolean;
}): Promise<number> {
  const db = getClientDb();
  const counterRef = doc(db, "counters", "global");
  const counterSnap = opts?.fromServer
    ? await getDocFromServer(counterRef)
    : await getDoc(counterRef);
  let last = counterSnap.exists()
    ? Number(counterSnap.data().lastOrderNumber ?? 0)
    : 0;

  if (!counterSnap.exists()) {
    last = await maxLegacyCounterValue();
  }
  if (!Number.isFinite(last) || last < 0) last = 0;
  return Math.floor(last);
}

/**
 * Does another cloud order already use this number? The counter alone can't
 * tell: sales syncing out of order (an earlier one failed first) push it past
 * numbers nobody used. Staff may only query their own branch (rules).
 */
export async function isOrderNumberTaken(params: {
  orderNumber: number;
  clientId: string;
  branchId: string;
  isOwner: boolean;
}): Promise<boolean> {
  const constraints = [where("orderNumber", "==", params.orderNumber)];
  if (!params.isOwner) constraints.push(where("branchId", "==", params.branchId));
  const snap = await getDocs(
    query(collection(getClientDb(), "orders"), ...constraints, limit(2)),
  );
  if (snap.metadata.fromCache) throw new Error("Order number check needs the server");
  return snap.docs.some((d) => d.id !== params.clientId);
}

export class OrderNumberCollisionError extends Error {
  constructor(
    public readonly orderNumber: number,
    public readonly cloudLast: number,
  ) {
    super(
      `Order #${orderNumber} collides with cloud counter (last=${cloudLast})`,
    );
    this.name = "OrderNumberCollisionError";
  }
}

/**
 * Idempotent POS sync: write `orders/{clientId}` with a fixed orderNumber,
 * bumping `counters/global` by exactly +1 when last+1 === orderNumber.
 * If the doc already exists, returns it without touching the counter.
 */
export async function syncQueuedOrderToFirestore(params: {
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
  createdBy: string;
  createdByName: string;
  createdByEmail?: string;
  createdAt: string;
  /** Where createdAt came from (offline clock check) — audit only. */
  timeSource?: SaleTimeSource;
  /** Raw PC time of the sale, when createdAt was corrected away from it. */
  deviceCreatedAt?: string;
  /**
   * The counter is past this number but no order uses it (checked by
   * isOrderNumberTaken) — write it anyway instead of renumbering.
   */
  allowBelowCounter?: boolean;
  /** Number printed on the receipt, when sync had to give the sale a new one. */
  printedOrderNumber?: number;
  /** POS offline queue — aborted when the sync gave up waiting: a late wake-up stops instead of committing. */
  signal?: AbortSignal;
}): Promise<Order> {
  const db = getClientDb();
  const counterRef = doc(db, "counters", "global");
  const orderRef = doc(db, "orders", params.clientId);
  const branchLabel = (params.branchName || "").trim();
  const items = sanitizeOrderItems(params.items);

  // Fast path: already on server (retry after mid-write drop).
  try {
    const existing = await getDocFromServer(orderRef);
    if (existing.exists()) {
      return asOrder(existing.id, existing.data());
    }
  } catch {
    const cached = await getDoc(orderRef);
    if (cached.exists()) return asOrder(cached.id, cached.data());
  }

  params.signal?.throwIfAborted();
  let seedLast = 0;
  {
    const pre = await getDoc(counterRef);
    if (!pre.exists()) {
      seedLast = await maxLegacyCounterValue();
    }
  }

  await runTransaction(db, async (tx) => {
    params.signal?.throwIfAborted();
    const existing = await tx.get(orderRef);
    if (existing.exists()) return;

    const counterSnap = await tx.get(counterRef);
    let last = counterSnap.exists()
      ? Number(counterSnap.data().lastOrderNumber ?? 0)
      : seedLast;
    if (!Number.isFinite(last) || last < 0) last = 0;
    last = Math.floor(last);

    if (last >= params.orderNumber && !params.allowBelowCounter) {
      throw new OrderNumberCollisionError(params.orderNumber, last);
    }
    // Allow gaps: multiple offline terminals legitimately produce non-consecutive numbers.
    // The counter only moves up (an out-of-order sale below it leaves it as is).
    if (params.orderNumber > last) {
      tx.set(
        counterRef,
        { lastOrderNumber: params.orderNumber },
        { merge: true },
      );
    }

    const payload = {
      clientId: params.clientId,
      branchId: params.branchId,
      ...(branchLabel ? { branchName: branchLabel } : {}),
      orderNumber: params.orderNumber,
      orderType: params.orderType,
      ...(params.customerName ? { customerName: params.customerName } : {}),
      ...(params.customerPhone ? { customerPhone: params.customerPhone } : {}),
      ...(params.deliveryAddress
        ? { deliveryAddress: params.deliveryAddress }
        : {}),
      ...(params.tableNumber ? { tableNumber: params.tableNumber } : {}),
      items,
      subtotal: params.subtotal,
      ...(params.taxAmount && params.taxAmount > 0
        ? { taxAmount: params.taxAmount }
        : {}),
      ...(params.taxPercent && params.taxPercent > 0
        ? { taxPercent: params.taxPercent }
        : {}),
      ...(params.deliveryCharges && params.deliveryCharges > 0
        ? { deliveryCharges: params.deliveryCharges }
        : {}),
      ...(params.discountAmount && params.discountAmount > 0
        ? {
            discountType: params.discountType,
            discountValue: params.discountValue,
            discountAmount: params.discountAmount,
          }
        : {}),
      total: params.total,
      paymentMethod: params.paymentMethod,
      status: "completed" as const,
      createdBy: params.createdBy,
      createdByName: params.createdByName,
      createdByEmail: params.createdByEmail || "",
      // Order time = the sale time the POS saved (clock corrected via
      // shopNow), never the sync time — so local and cloud always agree and a
      // late sync can't move the sale into another business day.
      // syncedAtServer = when it reached the cloud (rules' staff window anchor).
      createdAt: params.createdAt,
      ...(params.timeSource ? { timeSource: params.timeSource } : {}),
      ...(params.deviceCreatedAt
        ? { deviceCreatedAt: params.deviceCreatedAt }
        : {}),
      ...(params.printedOrderNumber &&
      params.printedOrderNumber !== params.orderNumber
        ? { printedOrderNumber: params.printedOrderNumber }
        : {}),
      syncedAtServer: serverTimestamp(),
      ...uploadStamp(params.createdBy),
    };
    tx.set(orderRef, payload);
  });

  params.signal?.throwIfAborted();
  const fresh = await readDocAfterWrite(orderRef, asOrder);
  if (fresh) return fresh;

  return {
    id: params.clientId,
    clientId: params.clientId,
    branchId: params.branchId,
    ...(branchLabel ? { branchName: branchLabel } : {}),
    orderNumber: params.orderNumber,
    orderType: params.orderType,
    ...(params.customerName ? { customerName: params.customerName } : {}),
    ...(params.customerPhone ? { customerPhone: params.customerPhone } : {}),
    ...(params.deliveryAddress
      ? { deliveryAddress: params.deliveryAddress }
      : {}),
    ...(params.tableNumber ? { tableNumber: params.tableNumber } : {}),
    items,
    subtotal: params.subtotal,
    ...(params.taxAmount && params.taxAmount > 0
      ? { taxAmount: params.taxAmount }
      : {}),
    ...(params.taxPercent && params.taxPercent > 0
      ? { taxPercent: params.taxPercent }
      : {}),
    ...(params.deliveryCharges && params.deliveryCharges > 0
      ? { deliveryCharges: params.deliveryCharges }
      : {}),
    ...(params.discountAmount && params.discountAmount > 0
      ? {
          discountType: params.discountType,
          discountValue: params.discountValue,
          discountAmount: params.discountAmount,
        }
      : {}),
    total: params.total,
    paymentMethod: params.paymentMethod,
    status: "completed",
    createdBy: params.createdBy,
    createdByName: params.createdByName,
    createdByEmail: params.createdByEmail || "",
    createdAt: params.createdAt,
  };
}

/** Amend order lines + meta (type / payment / customer / discount). Owner or staff with edit access. */
/** A queued edit hit an order the owner already deleted or cancelled. */
export class OrderConflictError extends Error {
  constructor(public reason: "deleted" | "cancelled" | "refunded") {
    super(`Order was ${reason} before this edit synced`);
    this.name = "OrderConflictError";
  }
}

export async function updateOrderItems(params: {
  order: Order;
  items: OrderItem[];
  user: AppUser;
  orderType?: OrderType;
  paymentMethod?: PaymentMethod;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  tableNumber?: string;
  /** Shop delivery fee — used when orderType is delivery */
  deliveryFee?: number;
  /** When set, replaces the order's discount (0 clears it). */
  discountType?: DiscountType | null;
  discountValue?: number | null;
  /** POS offline queue — skip if this mutation already applied. */
  clientMutationId?: string;
  /** POS offline queue — when the edit was made (activity log time). */
  occurredAt?: string;
  /**
   * POS offline queue — aborted when the sync gave up waiting (timeout): stop
   * before the next write so a late wake-up never writes from a stale check.
   */
  signal?: AbortSignal;
}): Promise<Order> {
  if (params.order.status === "cancelled") {
    throw new Error("Cancelled orders cannot be edited");
  }
  if (orderRefundedAmount(params.order) > 0) {
    throw new Error("Refunded orders cannot be edited");
  }

  // POS offline queue: look at the live order first. No answer from the
  // server (e.g. the line is down while the PC still says "online") → fail
  // and retry later: a write sent blind would wait in the SDK's own queue,
  // hang this sync pass, and could land much later over newer changes.
  let alreadyApplied = false;
  if (params.clientMutationId) {
    const existing = await getDocFromServer(doc(getClientDb(), "orders", params.order.id));
    // Owner deleted or cancelled it meanwhile → their change wins; the sync
    // marks this edit "dropped" instead of failing forever.
    if (!existing.exists()) throw new OrderConflictError("deleted");
    if (asOrder(existing.id, existing.data()).status === "cancelled") {
      throw new OrderConflictError("cancelled");
    }
    // Refunded meanwhile (e.g. by the owner on another device) → edit dropped.
    if (
      existing.data().lastClientMutationId !== params.clientMutationId &&
      orderRefundedAmount(asOrder(existing.id, existing.data())) > 0
    ) {
      throw new OrderConflictError("refunded");
    }
    // Write already landed (ack lost): skip the write but still finish the
    // stock movements and log — both have fixed ids, so no double counting.
    alreadyApplied = existing.data().lastClientMutationId === params.clientMutationId;
  }
  const items = sanitizeOrderItems(params.items);
  if (items.length === 0) {
    throw new Error("Order must have at least one item");
  }

  const orderType = params.orderType ?? params.order.orderType ?? "dine-in";
  const paymentMethod = params.paymentMethod ?? params.order.paymentMethod;
  const customerName = (params.customerName ?? params.order.customerName ?? "").trim();
  const customerPhone = (params.customerPhone ?? params.order.customerPhone ?? "").trim();
  const deliveryAddress =
    orderType === "delivery"
      ? (params.deliveryAddress ?? params.order.deliveryAddress ?? "").trim()
      : "";
  const tableNumber =
    orderType === "dine-in"
      ? (params.tableNumber ?? params.order.tableNumber ?? "").trim()
      : "";
  const deliveryCharges =
    orderType === "delivery"
      ? money(
          params.deliveryFee ??
            params.order.deliveryCharges ??
            0,
        )
      : 0;

  const discountProvided = params.discountType !== undefined;
  const nextDiscountType = discountProvided
    ? params.discountType
    : params.order.discountType;
  const nextDiscountValue = discountProvided
    ? money(params.discountValue ?? 0)
    : money(params.order.discountValue ?? 0);
  const hasDiscount =
    Boolean(nextDiscountType) && nextDiscountValue > 0;

  // Re-apply tax % and discount against the new subtotal (or the edited discount).
  const totals = amendOrderTotals(
    {
      ...params.order,
      deliveryCharges,
      discountType: hasDiscount ? nextDiscountType : null,
      discountValue: hasDiscount ? nextDiscountValue : 0,
      // Clearing must not fall back to a stale stored amount.
      discountAmount: hasDiscount ? params.order.discountAmount : 0,
    },
    orderItemsTotal(items),
  );
  const taxPercent = orderTaxPercent(params.order);
  // Queued edit keeps the real edit time (no server stamp = sync time).
  const updatedAt = params.occurredAt ?? shopNow().toISOString();
  const updatedBy = params.user.uid;
  const updatedByName = params.user.displayName || params.user.email;

  params.signal?.throwIfAborted();
  if (!alreadyApplied) await setDoc(
    doc(getClientDb(), "orders", params.order.id),
    {
      items,
      orderType,
      paymentMethod,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      ...(taxPercent > 0 ? { taxPercent } : {}),
      ...(totals.discountAmount > 0 && hasDiscount
        ? {
            discountType: nextDiscountType,
            discountValue: nextDiscountValue,
            discountAmount: totals.discountAmount,
          }
        : {
            discountType: deleteField(),
            discountValue: deleteField(),
            discountAmount: deleteField(),
          }),
      total: totals.total,
      deliveryCharges: deliveryCharges > 0 ? deliveryCharges : deleteField(),
      customerName: customerName ? customerName : deleteField(),
      customerPhone: customerPhone ? customerPhone : deleteField(),
      deliveryAddress: deliveryAddress ? deliveryAddress : deleteField(),
      tableNumber: tableNumber ? tableNumber : deleteField(),
      updatedAt,
      updatedBy,
      updatedByName,
      updatedAtServer: params.occurredAt ? deleteField() : serverTimestamp(),
      ...uploadStamp(updatedBy),
      ...(params.clientMutationId
        ? { lastClientMutationId: params.clientMutationId }
        : {}),
    },
    { merge: true },
  );

  // Keep inventory in sync when line qtys change (add → deduct, remove → restock).
  params.signal?.throwIfAborted();
  await syncStockForOrderAmend({
    branchId: params.order.branchId,
    previousItems: params.order.items,
    nextItems: items,
    user: params.user,
    orderNumber: params.order.orderNumber,
    idempotencyKey: params.clientMutationId,
    occurredAt: params.occurredAt,
    saleAt: params.order.createdAt,
  });

  params.signal?.throwIfAborted();
  try {
    const staffName = params.user.displayName || params.user.email;
    const itemDiff = describeOrderItemsDiff(params.order.items, items);
    const metaDiff = describeOrderMetaDiff(params.order, {
      orderType,
      paymentMethod,
      customerName,
      customerPhone,
      deliveryAddress,
      tableNumber,
      deliveryCharges,
      discountType: hasDiscount ? nextDiscountType : null,
      discountValue: hasDiscount ? nextDiscountValue : 0,
      discountAmount: totals.discountAmount,
    });
    const beforeItems = describeOrderItemsList(params.order.items);
    const afterItems = describeOrderItemsList(items);
    const detail = [
      itemDiff,
      metaDiff,
      beforeItems ? `Before: ${beforeItems}` : "",
      afterItems ? `After: ${afterItems}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    await writeActivityLog({
      branchId: params.order.branchId,
      entityType: "order",
      entityId: params.order.id,
      action: "update",
      summary: `Edited order #${params.order.orderNumber} · ${formatPkr(params.order.total)} → ${formatPkr(totals.total)} · by ${staffName}`,
      detail: detail || "Updated",
      change: {
        kind: "order",
        before: orderLogSnapshot(params.order),
        after: orderLogSnapshot({
          ...params.order,
          items,
          orderType,
          paymentMethod,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discountType: hasDiscount ? nextDiscountType : null,
          discountValue: hasDiscount ? nextDiscountValue : 0,
          discountAmount: hasDiscount ? totals.discountAmount : 0,
          deliveryCharges,
          total: totals.total,
          customerName,
          customerPhone,
          deliveryAddress,
          tableNumber,
        }),
      },
      user: params.user,
      ...queuedLogFields(params.clientMutationId, params.occurredAt),
    });
  } catch {
    // ignore audit failure
  }

  const orderRef = doc(getClientDb(), "orders", params.order.id);
  const fresh = await readDocAfterWrite(orderRef, asOrder);
  if (fresh) return fresh;

  return {
    ...params.order,
    items,
    orderType,
    paymentMethod,
    ...(customerName ? { customerName } : { customerName: undefined }),
    ...(customerPhone ? { customerPhone } : { customerPhone: undefined }),
    ...(deliveryAddress ? { deliveryAddress } : { deliveryAddress: undefined }),
    ...(tableNumber ? { tableNumber } : { tableNumber: undefined }),
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    ...(taxPercent > 0 ? { taxPercent } : {}),
    ...(totals.discountAmount > 0 && hasDiscount
      ? {
          discountType: nextDiscountType ?? undefined,
          discountValue: nextDiscountValue,
          discountAmount: totals.discountAmount,
        }
      : {
          discountType: undefined,
          discountValue: undefined,
          discountAmount: undefined,
        }),
    deliveryCharges: deliveryCharges > 0 ? deliveryCharges : undefined,
    total: totals.total,
    updatedAt,
    updatedBy,
    updatedByName,
  };
}

export async function cancelOrder(params: {
  order: Order;
  user: AppUser;
  /** POS offline queue — retries must not double-cancel / double-restock. */
  clientMutationId?: string;
  /** Skip stock restore when stock was never deducted (e.g. cancel before stock sync). */
  skipStockRestore?: boolean;
  /** POS offline queue — when the cancel was made (activity log time). */
  occurredAt?: string;
  /**
   * POS offline queue — aborted when the sync gave up waiting (timeout): stop
   * before the next write so a late wake-up never writes from a stale check.
   */
  signal?: AbortSignal;
}): Promise<Order> {
  const orderRef = doc(getClientDb(), "orders", params.order.id);
  let liveStatus = params.order.status;
  let alreadyApplied = false;
  let exists = true;
  let readFromServer = false;
  try {
    const snap = await getDocFromServer(orderRef);
    readFromServer = true;
    exists = snap.exists();
    if (exists) {
      const data = snap.data()!;
      liveStatus = data.status === "cancelled" ? "cancelled" : "completed";
      if (
        params.clientMutationId &&
        data.lastClientMutationId === params.clientMutationId
      ) {
        alreadyApplied = true;
      }
    }
  } catch (err) {
    // Queued cancel: never write blind (see updateOrderItems) — retry later.
    if (params.clientMutationId) throw err;
    // fall through with params.order
  }

  if (liveStatus === "cancelled" && !params.clientMutationId) {
    throw new Error("Order is already cancelled");
  }
  // Queued cancel, but someone else already deleted / cancelled the order:
  // their change wins and they already restocked — the sync marks ours
  // "dropped" (no second restock, no endless retry against the rules).
  if (params.clientMutationId && readFromServer && !alreadyApplied) {
    if (!exists) throw new OrderConflictError("deleted");
    if (liveStatus === "cancelled") throw new OrderConflictError("cancelled");
  }

  const updatedAt = params.occurredAt ?? shopNow().toISOString();
  params.signal?.throwIfAborted();
  if (exists && liveStatus !== "cancelled" && !alreadyApplied) {
    await setDoc(
      orderRef,
      {
        status: "cancelled",
        updatedAt,
        updatedBy: params.user.uid,
        updatedByName: params.user.displayName || params.user.email,
        updatedAtServer: params.occurredAt ? deleteField() : serverTimestamp(),
        ...uploadStamp(params.user.uid),
        ...(params.clientMutationId
          ? { lastClientMutationId: params.clientMutationId }
          : {}),
      },
      { merge: true },
    );
  }

  // Also on a retry where the cancel already landed: the restock and log ids are
  // fixed, so a step that finished is skipped and one that didn't is completed.
  params.signal?.throwIfAborted();
  if (!params.skipStockRestore && !isFullyRefunded(params.order)) {
    await restoreStockForOrder({
      branchId: params.order.branchId,
      items: params.order.items,
      user: params.user,
      notes: `Cancel #${params.order.orderNumber}`,
      idempotencyKey: `restock_${params.order.id}`,
      occurredAt: params.occurredAt,
      saleAt: params.order.createdAt,
    });
  }

  params.signal?.throwIfAborted();
  if (exists && (alreadyApplied || liveStatus !== "cancelled")) {
    try {
      const staffName = params.user.displayName || params.user.email;
      const itemsLine = describeOrderItemsList(params.order.items);
      await writeActivityLog({
        branchId: params.order.branchId,
        entityType: "order",
        entityId: params.order.id,
        action: "cancel",
        summary: `Cancelled order #${params.order.orderNumber} · ${formatPkr(params.order.total)} · by ${staffName}`,
        detail: itemsLine
          ? `Cancelled items: ${itemsLine}`
          : "Order cancelled",
        change: { kind: "order", before: orderLogSnapshot(params.order) },
        user: params.user,
        ...queuedLogFields(params.clientMutationId, params.occurredAt),
      });
    } catch {
      // ignore
    }
  }

  if (!exists) {
    return {
      ...params.order,
      status: "cancelled",
      updatedAt,
      updatedBy: params.user.uid,
      updatedByName: params.user.displayName || params.user.email,
    };
  }

  const fresh = await readDocAfterWrite(orderRef, asOrder);
  if (fresh) return fresh;

  return {
    ...params.order,
    status: "cancelled",
    updatedAt,
    updatedBy: params.user.uid,
    updatedByName: params.user.displayName || params.user.email,
  };
}

export async function deleteOrder(
  order: Order,
  user: AppUser,
  opts?: {
    skipStockRestore?: boolean;
    clientMutationId?: string;
    /** POS offline queue — when the delete was made (activity log time). */
    occurredAt?: string;
    /** POS offline queue — aborted when the sync gave up waiting (see updateOrderItems). */
    signal?: AbortSignal;
  },
) {
  const orderRef = doc(getClientDb(), "orders", order.id);
  const queued = Boolean(opts?.clientMutationId);
  let existed = false;
  let readFromServer = false;
  try {
    const snap = await getDocFromServer(orderRef);
    readFromServer = true;
    existed = snap.exists();
  } catch (err) {
    // Queued delete: never write blind (see updateOrderItems) — retry later.
    if (queued) throw err;
    existed = true;
  }
  // Queued delete that finds the order already gone: either our earlier
  // attempt finished (queued deletes restock BEFORE deleting) or someone else
  // deleted it (and restocked). Either way stock is done — never restock again.
  const alreadyGone = queued && readFromServer && !existed;

  const restock = async () => {
    if (alreadyGone || opts?.skipStockRestore) return;
    opts?.signal?.throwIfAborted();
    if (order.status === "cancelled" || isFullyRefunded(order)) return;
    await restoreStockForOrder({
      branchId: order.branchId,
      items: order.items,
      user,
      notes: `Delete #${order.orderNumber}`,
      idempotencyKey: `restock_${order.id}`,
      occurredAt: opts?.occurredAt,
      saleAt: order.createdAt,
    });
  };

  // Queued: restock first, so a retry after a dropped ack never needs to.
  if (queued) await restock();
  // Real failures (e.g. permission) must surface — the sync retries them
  // instead of marking a delete that never happened as done.
  opts?.signal?.throwIfAborted();
  if (existed) await deleteDoc(orderRef);
  if (!queued) await restock();

  opts?.signal?.throwIfAborted();
  if (existed || opts?.clientMutationId) {
    try {
      const staffName = user.displayName || user.email;
      const itemsLine = describeOrderItemsList(order.items);
      await writeActivityLog({
        branchId: order.branchId,
        entityType: "order",
        entityId: order.id,
        action: "delete",
        summary: `Deleted order #${order.orderNumber} · ${formatPkr(order.total)} · by ${staffName}`,
        detail: itemsLine ? `Deleted items: ${itemsLine}` : undefined,
        change: { kind: "order", before: orderLogSnapshot(order) },
        user,
        ...queuedLogFields(opts?.clientMutationId, opts?.occurredAt),
      });
    } catch {
      // ignore
    }
  }
}

export async function upsertBranch(branch: Omit<Branch, "createdAt"> & { createdAt?: string }) {
  await setDoc(
    doc(getClientDb(), "branches", branch.id),
    {
      name: branch.name,
      phone: branch.phone,
      address: branch.address,
      latitude: branch.latitude,
      longitude: branch.longitude,
      isActive: branch.isActive,
      createdAt: branch.createdAt ?? new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function saveCategory(cat: Category) {
  const { id, ...rest } = cat;
  await setDoc(
    doc(getClientDb(), "categories", id),
    { ...rest, branchId: SHARED_MENU_ID },
    { merge: true },
  );
  invalidatePublicMenuCache();
}

export async function saveProduct(product: Product) {
  const { id, ...rest } = product;
  await setDoc(
    doc(getClientDb(), "products", id),
    { ...rest, branchId: SHARED_MENU_ID },
    { merge: true },
  );
  invalidatePublicMenuCache();
}

export async function fetchProduct(productId: string): Promise<Product | null> {
  const snap = await getDoc(doc(getClientDb(), "products", productId));
  if (!snap.exists()) return null;
  return asProduct(snap.id, snap.data());
}

export async function fetchCategory(categoryId: string): Promise<Category | null> {
  const snap = await getDoc(doc(getClientDb(), "categories", categoryId));
  if (!snap.exists()) return null;
  return asCategory(snap.id, snap.data());
}

export async function deleteProduct(productId: string) {
  await deleteDoc(doc(getClientDb(), "products", productId));
  invalidatePublicMenuCache();
}

/** Deletes a category and optionally all of its products (cascade). */
export async function deleteCategory(
  categoryId: string,
  productIds: string[] = [],
) {
  const db = getClientDb();
  const ids = [...new Set(productIds.filter(Boolean))];

  // Firestore batch max = 500 writes
  let batch = writeBatch(db);
  let ops = 0;
  const commitIfNeeded = async (force = false) => {
    if (ops === 0) return;
    if (!force && ops < 450) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  for (const pid of ids) {
    batch.delete(doc(db, "products", pid));
    ops += 1;
    await commitIfNeeded();
  }
  batch.delete(doc(db, "categories", categoryId));
  ops += 1;
  await commitIfNeeded(true);

  invalidatePublicMenuCache();
}

export async function setUserActive(uid: string, isActive: boolean) {
  const snap = await getDoc(doc(getClientDb(), "users", uid));
  if (snap.exists() && snap.data()?.isPrimaryOwner === true && !isActive) {
    throw new Error("Main owner cannot be disabled");
  }
  await setDoc(
    doc(getClientDb(), "users", uid),
    { isActive },
    { merge: true },
  );
}

/** Firestore says the query needs a composite index that isn't deployed yet. */
function isMissingIndex(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    String((err as { code: unknown }).code).includes("failed-precondition")
  );
}

export function onOrdersSnapshot(
  branchId: string,
  /** fromCache: served from this PC's Firestore cache (offline), not the server. */
  callback: (orders: Order[], fromCache: boolean) => void,
  onError?: (err: Error) => void,
  opts?: {
    createdBy?: string;
    /** Only orders with sinceIso <= createdAt <= untilIso (one report day), not the whole history. */
    sinceIso?: string;
    untilIso?: string;
    /** Only the newest N orders (a list with no start date), not the whole history. */
    limitCount?: number;
    /**
     * Also call back when the same data is confirmed by the server (fromCache
     * true → false). Without it an empty result that the cache already had
     * never reports that it came from the server.
     */
    serverConfirm?: boolean;
  },
): Unsubscribe {
  const constraints = [where("branchId", "==", branchId)];
  if (opts?.createdBy) constraints.push(where("createdBy", "==", opts.createdBy));
  const base = query(collection(getClientDb(), "orders"), ...constraints);
  let ranged = base;
  if (opts?.sinceIso) ranged = query(ranged, where("createdAt", ">=", opts.sinceIso));
  if (opts?.untilIso) ranged = query(ranged, where("createdAt", "<=", opts.untilIso));
  if (opts?.limitCount) {
    ranged = query(ranged, orderBy("createdAt", "desc"), limit(opts.limitCount));
  }
  const inRange = (o: Order) =>
    (!opts?.sinceIso || o.createdAt >= opts.sinceIso) &&
    (!opts?.untilIso || o.createdAt <= opts.untilIso);

  let unsub: Unsubscribe = () => {};
  const listen = (q: typeof base) =>
    onSnapshot(
      q,
      { includeMetadataChanges: Boolean(opts?.serverConfirm) },
      (snap) => {
        const orders = snap.docs
          .map((d) => asOrder(d.id, d.data()))
          .filter(inRange)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        // Whole-branch fallback still hands over only the newest N.
        callback(
          opts?.limitCount ? orders.slice(0, opts.limitCount) : orders,
          snap.metadata.fromCache,
        );
      },
      (err) => {
        // Date / newest-first index not deployed yet → whole-branch listener (old behaviour).
        if (q !== base && isMissingIndex(err)) {
          unsub = listen(base);
          return;
        }
        onError?.(err);
      },
    );
  unsub = listen(ranged);
  return () => unsub();
}

/**
 * All-time count + sum(total) of a branch's orders that aren't cancelled
 * (refunds not subtracted) — server aggregates, about one read per 1000
 * orders instead of the whole history. Throws offline (never from cache) and
 * until the aggregate index is deployed.
 */
export async function fetchActiveOrderTotals(
  branchId: string,
): Promise<{ orders: number; sales: number }> {
  const all = query(collection(getClientDb(), "orders"), where("branchId", "==", branchId));
  const cancelled = query(all, where("status", "==", "cancelled"));
  const spec = { orders: count(), sales: sum("total") };
  try {
    const [a, c] = await Promise.all([
      getAggregateFromServer(all, spec),
      getAggregateFromServer(cancelled, spec),
    ]);
    return {
      orders: a.data().orders - c.data().orders,
      sales: a.data().sales - c.data().sales,
    };
  } catch (err) {
    // sum() index not deployed yet: no number rather than reading the branch's
    // whole history on every dashboard open (the card shows "—" until then).
    if (isMissingIndex(err)) console.warn("[dashboard] all-time totals need the orders sum index");
    throw err;
  }
}

/**
 * Non-cancelled orders of a branch sold in [sinceIso, untilIso): count +
 * sum(total) from server aggregates (~1 read per 1000 orders) instead of
 * reading every order. Until the (branchId, createdAt, total) indexes are
 * deployed: one plain read of the range, as before. Throws offline.
 */
export async function fetchOrderTotalsBetween(
  branchId: string,
  sinceIso: string,
  untilIso: string,
): Promise<{ orders: number; sales: number }> {
  const range = query(
    collection(getClientDb(), "orders"),
    where("branchId", "==", branchId),
    where("createdAt", ">=", sinceIso),
    where("createdAt", "<", untilIso),
  );
  const cancelled = query(range, where("status", "==", "cancelled"));
  const spec = { orders: count(), sales: sum("total") };
  try {
    const [a, c] = await Promise.all([
      getAggregateFromServer(range, spec),
      getAggregateFromServer(cancelled, spec),
    ]);
    return {
      orders: (a.data().orders ?? 0) - (c.data().orders ?? 0),
      sales: (a.data().sales ?? 0) - (c.data().sales ?? 0),
    };
  } catch (err) {
    // Offline: nothing to fall back to. Otherwise (index missing or still
    // building, …) read the range once so the card still shows a number.
    if (typeof navigator !== "undefined" && !navigator.onLine) throw err;
    console.warn("[dashboard] month totals: server count/sum failed, reading the orders instead", err);
    const snap = await getDocs(range);
    if (snap.metadata.fromCache) throw new Error("Server data needed");
    let orders = 0;
    let sales = 0;
    for (const d of snap.docs) {
      const o = asOrder(d.id, d.data());
      if (o.status === "cancelled") continue;
      orders += 1;
      sales += o.total;
    }
    return { orders, sales };
  }
}

/**
 * Every owner (staff may read owners' profiles only): who counts as an owner
 * in the owner report.
 */
export async function fetchOwners(): Promise<{ uid: string; isPrimaryOwner: boolean }[]> {
  const snap = await getDocs(query(collection(getClientDb(), "users"), where("role", "==", "owner")));
  return snap.docs.map((d) => ({ uid: d.id, isPrimaryOwner: d.data().isPrimaryOwner === true }));
}

/** Who gets the owner report by email (owner-only doc — never the public settings). */
export async function fetchReportEmailSettings(): Promise<ReportEmailSettings> {
  const snap = await getDocFromServer(doc(getClientDb(), REPORT_EMAIL_COLLECTION, REPORT_EMAIL_DOC_ID));
  return parseReportEmailSettings(snap.data());
}

export async function saveReportEmailSettings(settings: ReportEmailSettings, user: AppUser): Promise<void> {
  await setDoc(doc(getClientDb(), REPORT_EMAIL_COLLECTION, REPORT_EMAIL_DOC_ID), {
    emails: settings.emails,
    autoDaily: settings.autoDaily,
    updatedAt: new Date().toISOString(),
    updatedBy: user.uid,
  });
}

/** One sent-report log row (the daily email's result). Owners only. */
export async function fetchReportEmailLog(id: string): Promise<{
  status: "sending" | "sent" | "failed";
  dateKey?: string;
  sentAt?: string;
  error?: string;
} | null> {
  const snap = await getDocFromServer(doc(getClientDb(), REPORT_EMAIL_LOG_COLLECTION, id));
  const d = snap.data();
  if (!d) return null;
  return {
    status: d.status === "sent" || d.status === "failed" ? d.status : "sending",
    ...(d.dateKey ? { dateKey: String(d.dateKey) } : {}),
    ...(d.sentAt ? { sentAt: String(d.sentAt) } : {}),
    ...(d.error ? { error: String(d.error) } : {}),
  };
}

/**
 * One small server read (the signed-in user's own profile). Throws while this
 * PC can't reach the cloud — also for a few seconds after the line comes
 * back, until the SDK has reconnected.
 */
export async function pingCloud(): Promise<void> {
  const uid = getClientAuth().currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  await getDocFromServer(doc(getClientDb(), "users", uid));
}

/**
 * How many orders a branch has between two times (cancelled included) —
 * one server count (~1 read per 1000 orders), asked before a long report
 * period is read. Throws offline.
 */
export async function countOrdersInRange(
  branchId: string,
  sinceIso: string | undefined,
  untilIso: string,
): Promise<number> {
  let q = query(collection(getClientDb(), "orders"), where("branchId", "==", branchId));
  if (sinceIso) q = query(q, where("createdAt", ">=", sinceIso));
  q = query(q, where("createdAt", "<=", untilIso));
  const snap = await getAggregateFromServer(q, { n: count() });
  return snap.data().n ?? 0;
}

/**
 * Order ids this PC's Firestore cache knows nothing about — not even that they
 * were deleted. Orders synced in a transaction only reach the cache once a
 * listener sees them, so a day never opened online can be missing offline.
 */
export async function uncachedOrderIds(ids: string[]): Promise<string[]> {
  return uncachedDocIds("orders", ids);
}

/** Same for expenses (an uploaded expense reaches the cache only once a listener sees it). */
export async function uncachedExpenseIds(ids: string[]): Promise<string[]> {
  return uncachedDocIds("expenses", ids);
}

async function uncachedDocIds(collectionId: string, ids: string[]): Promise<string[]> {
  const db = getClientDb();
  const res = await Promise.all(
    ids.map((id) =>
      getDocFromCache(doc(db, collectionId, id)).then(
        () => null,
        () => id,
      ),
    ),
  );
  return res.filter((id): id is string => id !== null);
}

/** Central menu — branchId arg ignored. */
export function onCategoriesSnapshot(
  _branchId: string,
  callback: (categories: Category[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getClientDb(), "categories"),
    (snap) => {
      const cats = snap.docs
        .map((d) => asCategory(d.id, d.data()))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      callback(cats);
    },
    (err) => onError?.(err),
  );
}

/** Central menu — branchId arg ignored. */
export function onProductsSnapshot(
  _branchId: string,
  callback: (products: Product[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getClientDb(), "products"),
    (snap) => {
      const prods = snap.docs
        .map((d) => asProduct(d.id, d.data()))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      callback(prods);
    },
    (err) => onError?.(err),
  );
}

export function onSettingsSnapshot(
  callback: (settings: ShopSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getClientDb(), "settings"),
    (snap) => {
      const first = snap.docs[0];
      if (!first) {
        callback(DEFAULT_SETTINGS);
        return;
      }
      callback(parseShopSettings(first.data()));
    },
    (err) => onError?.(err),
  );
}

/* ── Expenses ── */

export function expenseSnapshotLabel(e: {
  category: string;
  description: string;
  amount: number;
  date: string;
}): string {
  const desc = e.description.trim() ? ` · ${e.description.trim()}` : "";
  return `${e.category}${desc} · ${formatPkr(e.amount)} · ${e.date}`;
}

/**
 * Offline-queue audit fields: fixed log id (a retry's second create is
 * rejected by rules → no duplicate) + the time the action really happened.
 */
function queuedLogFields(
  clientMutationId?: string,
  occurredAt?: string,
): { id?: string; occurredAt?: string } {
  return {
    ...(clientMutationId ? { id: `act_${clientMutationId}` } : {}),
    ...(occurredAt ? { occurredAt } : {}),
  };
}

/**
 * Create a new doc. If the network drops the reply, the SDK sends the write
 * again — the rules refuse that second copy (its server stamp would change),
 * though the first one was saved: then it's a success, not an error.
 */
async function setOnce(ref: DocumentReference, data: Record<string, unknown>): Promise<void> {
  try {
    await setDoc(ref, data);
  } catch (err) {
    const saved = await getDocFromServer(ref).then((d) => d.exists(), () => false);
    if (!saved) throw err;
  }
}

/**
 * Offline queue on a shared PC: A acted, B is signed in at sync. The row keeps
 * A as author; rules let B write it only with B stamped as uploader at this
 * write. Empty when the signed-in user is the one who acted.
 */
function uploadStamp(actorUid: string): Record<string, unknown> {
  const signedIn = getClientAuth().currentUser;
  if (!signedIn || signedIn.uid === actorUid) return {};
  return {
    uploadedBy: signedIn.uid,
    uploadedByName: signedIn.displayName || signedIn.email || "",
    uploadedAt: serverTimestamp(),
  };
}

async function writeActivityLog(params: {
  /** Fixed doc id makes retries idempotent (second create is rejected). */
  id?: string;
  /**
   * When the action happened (offline queue). Stored as createdAt with no
   * createdAtServer, so the log sorts/displays by action time, not sync time.
   */
  occurredAt?: string;
  branchId: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  summary: string;
  detail?: string;
  /** Before / after of the order or expense (shown as a comparison). */
  change?: ActivityChange;
  user: AppUser;
}): Promise<void> {
  const createdAt = params.occurredAt || shopNow().toISOString();
  const ref = params.id
    ? doc(getClientDb(), "activityLogs", params.id)
    : doc(collection(getClientDb(), "activityLogs"));
  const actorName = params.user.displayName || params.user.email;
  // Offline queue: A acted, then B signed in on this PC before sync. Rules only
  // let B write rows as B, so keep A as the visible name and record who synced.
  const signedIn = getClientAuth().currentUser;
  const syncedByOther = Boolean(signedIn && signedIn.uid !== params.user.uid);
  const syncedByName = signedIn?.displayName || signedIn?.email || "";
  const detail = syncedByOther
    ? [params.detail, `Synced by ${syncedByName}`].filter(Boolean).join(" · ")
    : params.detail;
  const base = {
    branchId: params.branchId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    summary: params.summary,
    ...(detail ? { detail } : {}),
    ...(params.change ? { change: params.change } : {}),
    createdByName: actorName,
    createdAt,
    ...(params.occurredAt
      ? { syncedAtServer: serverTimestamp() }
      : { createdAtServer: serverTimestamp() }),
  };
  if (!syncedByOther) {
    await setDoc(ref, { ...base, createdBy: params.user.uid });
    return;
  }
  // Someone else is signed in at sync: file the log under the person who acted
  // (so it shows in their own activity), with syncedBy on record. If rules
  // refuse (e.g. that person was deactivated), fall back to the signed-in uid
  // with the actor kept in actorUid.
  try {
    await setDoc(ref, { ...base, createdBy: params.user.uid, syncedBy: signedIn!.uid });
  } catch {
    await setDoc(ref, { ...base, createdBy: signedIn!.uid, actorUid: params.user.uid });
  }
}

export async function createExpense(params: {
  branchId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  user: AppUser;
}): Promise<Expense> {
  if (!params.branchId.trim()) {
    throw new Error("Branch is required");
  }
  const db = getClientDb();
  const ref = doc(collection(db, "expenses"));
  const createdAt = new Date().toISOString();
  const hours = businessDayHoursFromSettings(await fetchSettings());
  const businessDate = params.date.trim() || businessDateKey(shopNow(), hours);
  const payload = {
    branchId: params.branchId,
    category: params.category,
    description: params.description,
    amount: money(params.amount),
    date: businessDate,
    createdBy: params.user.uid,
    createdByName: params.user.displayName || params.user.email,
    createdAt,
    createdAtServer: serverTimestamp(),
  };
  await setOnce(ref, payload);
  try {
    await writeActivityLog({
      branchId: params.branchId,
      entityType: "expense",
      entityId: ref.id,
      action: "create",
      summary: `Added expense · ${formatPkr(money(params.amount))}`,
      detail: expenseSnapshotLabel(payload),
      change: { kind: "expense", after: expenseLogSnapshot(payload) },
      user: params.user,
    });
  } catch {
    // Expense already saved — don't fail the user action on audit write.
  }

  const fresh = await readDocAfterWrite(ref, asExpense);
  if (fresh) return fresh;

  return { id: ref.id, ...payload, createdAt, date: businessDate };
}

/**
 * Write a POS-queued expense. Doc id = clientId, so a retry after a dropped
 * ack never duplicates. Keeps the client `createdAt` (no createdAtServer) so
 * offline entries sort by when they were entered, not when they synced.
 */
export async function syncQueuedExpenseToFirestore(params: {
  clientId: string;
  branchId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  user: AppUser;
  /** POS offline queue — aborted when the sync gave up waiting: a late wake-up stops instead of committing. */
  signal?: AbortSignal;
}): Promise<void> {
  const db = getClientDb();
  const ref = doc(db, "expenses", params.clientId);

  const payload = {
    branchId: params.branchId,
    category: params.category,
    description: params.description,
    amount: money(params.amount),
    date: params.date,
    createdBy: params.createdBy,
    createdByName: params.createdByName,
    createdAt: params.createdAt,
    syncedAtServer: serverTimestamp(),
    source: "pos",
    ...uploadStamp(params.createdBy),
  };
  // Created once: a retry after a lost ack finds it and leaves it alone (a
  // blind re-write would be refused — its server stamp can't change). The
  // activity log is still made sure of below (fixed id → never duplicated).
  await runTransaction(db, async (tx) => {
    params.signal?.throwIfAborted();
    if ((await tx.get(ref)).exists()) return;
    tx.set(ref, payload);
  });
  params.signal?.throwIfAborted();
  // A transaction writes to the server only: pull the row into this PC's
  // cache, so an offline Expenses list / Day End report still shows it.
  try {
    await getDocFromServer(ref);
  } catch {
    // best effort — the offline view falls back to the PC's synced copy
  }
  try {
    await writeActivityLog({
      ...queuedLogFields(params.clientId, params.createdAt),
      branchId: params.branchId,
      entityType: "expense",
      entityId: params.clientId,
      action: "create",
      summary: `Added expense · ${formatPkr(money(params.amount))}`,
      detail: expenseSnapshotLabel(payload),
      change: { kind: "expense", after: expenseLogSnapshot(payload) },
      user: params.user,
    });
  } catch {
    // Expense already saved — don't fail sync on audit write.
  }
}

export async function updateExpense(
  expenseId: string,
  params: {
    category: ExpenseCategory;
    description: string;
    amount: number;
    date: string;
    user: AppUser;
    previous: Expense;
    /** POS offline queue op — fixed log id + real edit time. */
    queued?: { opId: string; occurredAt: string };
    /** POS offline queue — aborted when the sync gave up waiting (see updateOrderItems). */
    signal?: AbortSignal;
  },
): Promise<void> {
  const ref = doc(getClientDb(), "expenses", expenseId);
  if (params.queued && !(await getDocFromServer(ref)).exists()) {
    // Owner deleted it meanwhile — nothing left to edit.
    return;
  }
  params.signal?.throwIfAborted();
  await updateDoc(ref, {
    category: params.category,
    description: params.description,
    amount: money(params.amount),
    date: params.date,
    updatedAt: params.queued?.occurredAt ?? shopNow().toISOString(),
    updatedBy: params.user.uid,
    updatedByName: params.user.displayName || params.user.email,
    // Queued edits keep the real edit time (client) instead of sync time.
    updatedAtServer: params.queued ? deleteField() : serverTimestamp(),
    ...uploadStamp(params.user.uid),
  });
  params.signal?.throwIfAborted();
  try {
    await writeActivityLog({
      branchId: params.previous.branchId,
      entityType: "expense",
      entityId: expenseId,
      action: "update",
      summary: `Edited expense → ${formatPkr(money(params.amount))}`,
      detail: `Before: ${expenseSnapshotLabel(params.previous)} → After: ${expenseSnapshotLabel({
        category: params.category,
        description: params.description,
        amount: money(params.amount),
        date: params.date,
      })}`,
      change: {
        kind: "expense",
        before: expenseLogSnapshot(params.previous),
        after: expenseLogSnapshot({
          category: params.category,
          description: params.description,
          amount: params.amount,
          date: params.date,
        }),
      },
      user: params.user,
      ...queuedLogFields(params.queued?.opId, params.queued?.occurredAt),
    });
  } catch {
    // ignore audit failure
  }
}

export async function deleteExpense(
  expenseId: string,
  params: {
    user: AppUser;
    previous: Expense;
    /** POS offline queue op — fixed log id + real delete time. */
    queued?: { opId: string; occurredAt: string };
    /** POS offline queue — aborted when the sync gave up waiting (see updateOrderItems). */
    signal?: AbortSignal;
  },
): Promise<void> {
  const ref = doc(getClientDb(), "expenses", expenseId);
  // Retry after a dropped ack: doc already gone → rules would deny (no resource).
  const exists = params.queued ? (await getDocFromServer(ref)).exists() : true;
  params.signal?.throwIfAborted();
  if (exists) {
    // Someone else signed in (shared PC): a delete carries no data, so stamp
    // who deleted it and who uploads it first — rules require that step.
    const stamp = uploadStamp(params.user.uid);
    if (Object.keys(stamp).length > 0) {
      await updateDoc(ref, { deleteRequestedBy: params.user.uid, ...stamp });
    }
    params.signal?.throwIfAborted();
    await deleteDoc(ref);
  }
  params.signal?.throwIfAborted();
  try {
    await writeActivityLog({
      branchId: params.previous.branchId,
      entityType: "expense",
      entityId: expenseId,
      action: "delete",
      summary: `Deleted expense ${expenseSnapshotLabel(params.previous)}`,
      change: { kind: "expense", before: expenseLogSnapshot(params.previous) },
      user: params.user,
      ...queuedLogFields(params.queued?.opId, params.queued?.occurredAt),
    });
  } catch {
    // ignore audit failure
  }
}

/**
 * Expenses dated fromKey..toKey as one `in` filter — equality only, so no
 * composite index needed. Undated ("") rows come too: screens count those by
 * their createdAt day. Null when the span is too long for `in` (30 values).
 */
function expenseDaysFilter(fromKey: string, toKey: string): QueryConstraint | null {
  const keys = [""];
  for (let k = fromKey; k <= toKey; k = shiftBusinessDateKey(k, 1)) {
    if (keys.length >= 30) return null;
    keys.push(k);
  }
  return where("date", "in", keys);
}

export function onExpensesSnapshot(
  branchId: string | "all",
  /** fromCache: served from this PC's Firestore cache (offline), not the server. */
  callback: (expenses: Expense[], fromCache: boolean) => void,
  onError?: (err: Error) => void,
  opts?: {
    /** Only expenses dated fromKey..toKey (YYYY-MM-DD, inclusive) + undated ones, not the whole history. */
    fromKey?: string;
    toKey?: string;
    /**
     * Also call back when the same data is confirmed by the server (fromCache
     * true → false) or the connection drops — for screens that fill gaps from
     * this PC's own copy only while the data comes from the cache.
     */
    serverConfirm?: boolean;
  },
): Unsubscribe {
  const col = collection(getClientDb(), "expenses");
  const base = branchId === "all" ? query(col) : query(col, where("branchId", "==", branchId));
  const fromKey = opts?.fromKey;
  const toKey = opts?.toKey;
  const days = fromKey && toKey ? expenseDaysFilter(fromKey, toKey) : null;
  const queries = [base];
  if (days) {
    queries[0] = query(base, days);
  } else if (fromKey || toKey) {
    // Longer span → date range; a range skips "", so undated rows get their own query.
    if (fromKey) queries[0] = query(queries[0], where("date", ">=", fromKey));
    if (toKey) queries[0] = query(queries[0], where("date", "<=", toKey));
    if (fromKey) queries.push(query(base, where("date", "==", "")));
  }
  const inRange = (e: Expense) =>
    !e.date || ((!fromKey || e.date >= fromKey) && (!toKey || e.date <= toKey));

  const parts: (Expense[] | undefined)[] = queries.map(() => undefined);
  const cached: boolean[] = queries.map(() => false);
  const unsubs: Unsubscribe[] = [];
  const emit = () => {
    if (parts.some((p) => !p)) return;
    const byId = new Map<string, Expense>();
    for (const p of parts) for (const e of p!) byId.set(e.id, e);
    callback(
      [...byId.values()]
        .filter(inRange)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      cached.some(Boolean),
    );
  };
  const listen = (q: typeof base, i: number): Unsubscribe =>
    onSnapshot(
      q,
      { includeMetadataChanges: Boolean(opts?.serverConfirm) },
      (snap) => {
        parts[i] = snap.docs.map((d) => asExpense(d.id, d.data()));
        cached[i] = snap.metadata.fromCache;
        emit();
      },
      (err) => {
        // Date index not deployed yet → whole-branch listener (old behaviour), filtered above.
        if (q !== base && isMissingIndex(err)) {
          unsubs[i] = listen(base, i);
          return;
        }
        onError?.(err);
      },
    );
  queries.forEach((q, i) => {
    unsubs[i] = listen(q, i);
  });
  return () => unsubs.forEach((u) => u());
}

/**
 * Activity feed — bounded query only (never full collection).
 * Opens only when the Activity page is visited.
 */
export function onActivityLogsSnapshot(
  opts: {
    branchId: string | "all";
    entityType: ActivityEntityType;
    /** Staff: pass their uid — rules only allow reading own rows. */
    createdBy?: string;
    limitCount?: number;
    /** Only logs at/after this ISO time (date filters) — same index as the sort. */
    sinceIso?: string;
  },
  callback: (logs: ActivityLog[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const limitCount = Math.min(Math.max(opts.limitCount ?? 50, 1), 100);
  const createdBy = opts.createdBy?.trim();
  const constraints: QueryConstraint[] = [
    where("entityType", "==", opts.entityType),
  ];
  if (opts.branchId !== "all") {
    constraints.push(where("branchId", "==", opts.branchId));
  }
  if (createdBy) {
    constraints.push(where("createdBy", "==", createdBy));
  }
  if (opts.sinceIso) {
    constraints.push(where("createdAt", ">=", opts.sinceIso));
  }
  constraints.push(orderBy("createdAt", "desc"));
  constraints.push(limit(limitCount));

  return onSnapshot(
    query(collection(getClientDb(), "activityLogs"), ...constraints),
    (snap) => {
      callback(snap.docs.map((d) => asActivityLog(d.id, d.data())));
    },
    (err) => onError?.(err),
  );
}

/**
 * One branch's logs of one type between two times, newest first (owner
 * report). Only sensitive changes are logged, so a period holds few rows;
 * `limitCount` (default 2000) is a guard, not paging. Same index as the feed.
 */
export function onActivityLogsInRange(
  opts: {
    branchId: string;
    entityType: ActivityEntityType;
    /** Omit for "from the beginning". */
    sinceIso?: string;
    untilIso: string;
    limitCount?: number;
  },
  callback: (logs: ActivityLog[], fromCache: boolean) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const constraints: QueryConstraint[] = [
    where("entityType", "==", opts.entityType),
    where("branchId", "==", opts.branchId),
  ];
  if (opts.sinceIso) constraints.push(where("createdAt", ">=", opts.sinceIso));
  constraints.push(where("createdAt", "<=", opts.untilIso));
  constraints.push(orderBy("createdAt", "desc"));
  constraints.push(limit(Math.min(Math.max(opts.limitCount ?? 2000, 1), 5000)));
  return onSnapshot(
    query(collection(getClientDb(), "activityLogs"), ...constraints),
    (snap) =>
      callback(
        snap.docs.map((d) => asActivityLog(d.id, d.data())),
        snap.metadata.fromCache,
      ),
    (err) => onError?.(err),
  );
}

/* ── Inventory ── */

/**
 * Inventory writes are offline-first: Firestore applies them to its local
 * cache at once (the list updates) and sends them when the net is back, even
 * after a restart. Online, wait briefly for the server so a refusal (rules)
 * still shows; offline, don't wait at all.
 */
async function settleLocalFirst(write: Promise<unknown>): Promise<void> {
  write.catch((err) => console.warn("Inventory write refused by the server", err));
  trackInventoryWrite(write);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queued = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 4000);
  });
  try {
    await Promise.race([write, queued]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * This page's inventory writes the server hasn't answered yet. Not Firestore's
 * waitForPendingWrites: when the signed-in person has nothing waiting, it can
 * pick another person's leftover write on a shared PC and wait forever.
 */
const pendingInventoryWrites = new Set<Promise<unknown>>();

/** Counted until the server answers — the logout guard waits for it. */
function trackInventoryWrite(write: Promise<unknown>): void {
  pendingInventoryWrites.add(write);
  void write.then(
    () => pendingInventoryWrites.delete(write),
    () => pendingInventoryWrites.delete(write),
  );
}

/** True once every inventory write this page made has been answered (taken or refused). */
export async function inventoryWritesSettled(timeoutMs: number): Promise<boolean> {
  const all = [...pendingInventoryWrites];
  if (all.length === 0) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([Promise.allSettled(all).then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

function logInventory(params: Parameters<typeof writeActivityLog>[0]): void {
  // Local first like the write itself — never hold the screen for the log.
  // Tracked like the stock write: it waits in the same per-person queue, so
  // logout must not leave it behind for someone else's login.
  const write = writeActivityLog(params);
  write.catch(() => {});
  trackInventoryWrite(write);
}

function stockChangeText(item: Pick<InventoryItem, "productName" | "variationLabel">): string {
  return item.variationLabel ? `${item.productName} · ${item.variationLabel}` : item.productName;
}

/** Add an item (or one size of it) to a branch's stock list, or edit its details. */
export async function saveInventoryItem(params: {
  /** Existing row when editing. */
  previous?: InventoryItem;
  branchId: string;
  productId: string;
  productName: string;
  variationId?: string;
  variationLabel?: string;
  description?: string;
  /** Opening count when adding. Editing never touches the count — use recordStockChange. */
  openingStock?: number;
  lowStockThreshold: number;
  unit: StockUnit;
  user: AppUser;
}): Promise<void> {
  if (!params.branchId.trim()) {
    throw new Error("Branch is required");
  }
  const db = getClientDb();
  const prev = params.previous;
  const id = prev?.id ?? inventoryDocId(params.branchId, params.productId, params.variationId);
  const ref = doc(db, "inventory", id);
  const now = shopNow().toISOString();
  const by = params.user.displayName || params.user.email;
  const description = params.description?.trim() ?? "";
  const payload: Record<string, unknown> = {
    lowStockThreshold: params.lowStockThreshold,
    unit: params.unit,
    description,
    lastUpdated: now,
    lastUpdatedServer: serverTimestamp(),
  };
  if (!prev) {
    Object.assign(payload, {
      branchId: params.branchId,
      productId: params.productId,
      productName: params.productName,
      ...(params.variationId
        ? { variationId: params.variationId, variationLabel: params.variationLabel ?? "" }
        : {}),
      currentStock: Math.max(0, params.openingStock ?? 0),
      createdBy: params.user.uid,
      createdByName: by,
      createdAt: now,
    });
  } else {
    Object.assign(payload, { updatedBy: params.user.uid, updatedByName: by, updatedAt: now });
  }
  await settleLocalFirst(setDoc(ref, payload, { merge: true }));

  const name = stockChangeText({ productName: params.productName, variationLabel: params.variationLabel });
  if (!prev) {
    logInventory({
      branchId: params.branchId,
      entityType: "inventory",
      entityId: id,
      action: "create",
      summary: `Added “${name}” to stock · ${Math.max(0, params.openingStock ?? 0)} ${params.unit}`,
      user: params.user,
    });
    return;
  }
  const changes = [
    prev.lowStockThreshold !== params.lowStockThreshold
      ? `Alert: ${prev.lowStockThreshold} → ${params.lowStockThreshold}`
      : "",
    prev.unit !== params.unit ? `Unit: ${prev.unit} → ${params.unit}` : "",
    (prev.description ?? "") !== description ? `Note: “${prev.description ?? ""}” → “${description}”` : "",
  ].filter(Boolean);
  if (changes.length === 0) return;
  logInventory({
    branchId: params.branchId,
    entityType: "inventory",
    entityId: id,
    action: "update",
    summary: `Edited stock item “${name}”`,
    detail: changes.join(" · "),
    user: params.user,
  });
}

/**
 * Receive, waste or recount stock. The count moves by a delta (increment), so
 * a change made offline adds onto sales that synced meanwhile instead of
 * overwriting them. A recount (adjustment) is the delta from the count shown.
 */
export async function recordStockChange(params: {
  item: InventoryItem;
  movementType: "purchase" | "waste" | "adjustment";
  /** Received / wasted amount, or the counted stock for an adjustment. */
  quantity: number;
  notes: string;
  user: AppUser;
}): Promise<void> {
  const { item } = params;
  const qty = Math.abs(params.quantity);
  const prevStock = item.currentStock;
  const delta =
    params.movementType === "purchase"
      ? qty
      : params.movementType === "waste"
        ? -qty
        : Math.max(0, params.quantity) - prevStock;
  if (delta === 0 && params.movementType === "adjustment") return;
  const newStock = prevStock + delta;
  const db = getClientDb();
  const now = shopNow().toISOString();
  const by = params.user.displayName || params.user.email;
  const movRef = doc(collection(db, "stockMovements"));
  const batch = writeBatch(db);
  batch.update(doc(db, "inventory", item.id), {
    currentStock: increment(delta),
    lastUpdated: now,
    lastUpdatedServer: serverTimestamp(),
  });
  batch.set(movRef, {
    branchId: item.branchId,
    inventoryItemId: item.id,
    productId: item.productId,
    productName: item.productName,
    ...(item.variationId ? { variationId: item.variationId } : {}),
    movementType: params.movementType,
    quantity: Math.abs(delta),
    previousStock: prevStock,
    newStock,
    delta,
    notes: params.notes.trim(),
    createdBy: params.user.uid,
    createdByName: by,
    createdAt: now,
    createdAtServer: serverTimestamp(),
  });
  const verb =
    params.movementType === "purchase"
      ? "Received stock"
      : params.movementType === "waste"
        ? "Recorded waste"
        : "Adjusted stock";
  const log = {
    summary: `${verb} “${stockChangeText(item)}” · ${prevStock} → ${newStock}`,
    detail: [
      `Type: ${params.movementType}`,
      `Qty: ${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${item.unit}`,
      params.notes.trim() ? `Notes: ${params.notes.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
  // A copy outside Firestore's per-person queue until the server has it.
  await putStockOutbox({
    id: movRef.id,
    branchId: item.branchId,
    inventoryItemId: item.id,
    productId: item.productId,
    productName: item.productName,
    ...(item.variationId ? { variationId: item.variationId } : {}),
    movementType: params.movementType,
    delta,
    notes: params.notes.trim(),
    byUid: params.user.uid,
    byName: by,
    at: now,
    log,
    savedAt: Date.now(),
  }).catch(() => {});
  const write = batch.commit();
  // Refused: the copy stays for redoWaitingStockChanges.
  write.then(() => removeStockOutbox(movRef.id)).catch(() => {});
  await settleLocalFirst(write);

  logInventory({
    branchId: item.branchId,
    entityType: "inventory",
    entityId: item.id,
    action: "update",
    ...log,
    user: params.user,
  });
}

/**
 * Hand stock changes still in this PC's copy (see stock-outbox): normally the
 * server took them and the copy is just stale; if the server refused one
 * (its author was disabled when the line came back) or it is still in a
 * signed-out person's queue, put it on now as the signed-in user — under its
 * author's name, dated when it was made. The movement keeps its id and
 * movements can't be rewritten, so it lands once: a late original is refused.
 */
export async function redoWaitingStockChanges(
  user: AppUser,
  /** Aborted when the sync gave up waiting: stop instead of overlapping the next pass. */
  signal?: AbortSignal,
): Promise<void> {
  let list: StockOutboxEntry[];
  try {
    list = await listStockOutbox();
  } catch {
    return;
  }
  const now = Date.now();
  // Nobody here could put it on for a week (row gone, no one permitted): give up.
  const stale = list.filter((e) => now - e.savedAt > REDO_GIVE_UP_MS);
  for (const e of stale) await removeStockOutbox(e.id).catch(() => {});
  const due = list.filter(
    (e) =>
      now - e.savedAt <= REDO_GIVE_UP_MS &&
      now - e.savedAt > REDO_AFTER_MS &&
      (!e.refusedAt || now - e.refusedAt > REDO_REFUSED_WAIT_MS) &&
      (user.role === "owner" || user.branchIds.includes(e.branchId)),
  );
  if (due.length === 0) return;
  // This page's own changes go up first (they may be these very ones). A redo
  // racing an original can't double it: a movement id is written once.
  await inventoryWritesSettled(20_000);
  for (const e of due) {
    signal?.throwIfAborted();
    try {
      const outcome = await applyStockMovementTx({
        branchId: e.branchId,
        inventoryItemId: e.inventoryItemId,
        productId: e.productId,
        productName: e.productName,
        variationId: e.variationId,
        movementType: e.movementType,
        quantity: Math.abs(e.delta),
        signedDelta: e.delta,
        notes: e.notes,
        user: { ...user, uid: e.byUid, displayName: e.byName },
        movementId: e.id,
        occurredAt: e.at,
        // A row (re)added after the change was counted with it already on the shelf.
        saleAt: e.at,
        signal,
      });
      if (outcome === "no-row") {
        // The row isn't on the server (yet): its add may still come up — keep, ask again later.
        await putStockOutbox({ ...e, refusedAt: now });
        continue;
      }
      await removeStockOutbox(e.id);
      if (outcome === "applied") {
        const by = user.displayName || user.email;
        logInventory({
          branchId: e.branchId,
          entityType: "inventory",
          entityId: e.inventoryItemId,
          action: "update",
          summary: `${e.log.summary} · by ${e.byName}`,
          detail: [e.log.detail, `Uploaded later by ${by}`].filter(Boolean).join(" · "),
          user,
        });
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      if (/permission-denied/.test(errorCodeOf(err) ?? "")) {
        await putStockOutbox({ ...e, refusedAt: now }).catch(() => {});
      }
      // Anything else (line down): tried again on the next pass.
    }
  }
}

/** A hand change waits this long before a redo (the normal upload takes seconds). */
const REDO_AFTER_MS = 2 * 60_000;
/** Refused for the signed-in person, or no row yet: ask again only after this long. */
const REDO_REFUSED_WAIT_MS = 15 * 60_000;
/** Still not on after a week (row gone for good, nobody here permitted): dropped. */
const REDO_GIVE_UP_MS = 7 * 24 * 60 * 60_000;

function errorCodeOf(err: unknown): string | undefined {
  return typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

export function onInventorySnapshot(
  branchId: string,
  callback: (items: InventoryItem[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(getClientDb(), "inventory"), where("branchId", "==", branchId)),
    // Metadata too: a row's "waiting to sync" mark clears when the server confirms.
    { includeMetadataChanges: true },
    (snap) => {
      const items = snap.docs
        .map((d) => asInventoryItem(d.id, d.data(), d.metadata.hasPendingWrites))
        .sort((a, b) => stockChangeText(a).localeCompare(stockChangeText(b)));
      callback(items);
    },
    (err) => onError?.(err),
  );
}

/** A branch's stock movements since `sinceIso`, live (owner report: the day's stock). */
export function onStockMovementsSince(
  branchId: string,
  sinceIso: string,
  callback: (movements: StockMovement[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(getClientDb(), "stockMovements"),
      where("branchId", "==", branchId),
      where("createdAt", ">=", sinceIso),
    ),
    (snap) => callback(snap.docs.map((d) => asStockMovement(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

/** One item's newest stock movements (history popup), not the branch's whole log. */
export function onStockMovementsSnapshot(
  branchId: string,
  inventoryItemId: string,
  callback: (movements: StockMovement[]) => void,
  onError?: (err: Error) => void,
  limitCount = 50,
): Unsubscribe {
  // branchId filter: staff may only read their own branches (rules).
  const base = query(
    collection(getClientDb(), "stockMovements"),
    where("branchId", "==", branchId),
    where("inventoryItemId", "==", inventoryItemId),
  );
  let unsub: Unsubscribe = () => {};
  const listen = (q: typeof base) =>
    onSnapshot(
      q,
      (snap) => {
        const items = snap.docs
          .map((d) => asStockMovement(d.id, d.data()))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limitCount);
        callback(items);
      },
      (err) => {
        // Newest-first index not deployed yet → all of this item's movements, cut above.
        if (q !== base && isMissingIndex(err)) {
          unsub = listen(base);
          return;
        }
        onError?.(err);
      },
    );
  unsub = listen(query(base, orderBy("createdAt", "desc"), limit(limitCount)));
  return () => unsub();
}

export async function deleteInventoryItem(params: {
  item: InventoryItem;
  user: AppUser;
}): Promise<void> {
  const { item } = params;
  await settleLocalFirst(deleteDoc(doc(getClientDb(), "inventory", item.id)));
  logInventory({
    branchId: item.branchId,
    entityType: "inventory",
    entityId: item.id,
    action: "delete",
    summary: `Deleted stock item “${stockChangeText(item)}” · had ${item.currentStock} ${item.unit}`,
    user: params.user,
  });
}

function normStockName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Expand order lines for inventory: bundle/deal lines become their menu
 * components (productId first, then label → product name fallback).
 * If nothing matches, fall back to the deal product itself when inventoried.
 * A sized line takes its own size's row, else the item's all-sizes row.
 * Returns only lines that hit a row, one per row (qtys summed), carrying that
 * row's productId / variationId.
 */
function expandItemsForStock(
  items: OrderItem[],
  products: Product[],
  invByKey: Map<string, InventoryItem>,
): OrderItem[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const byName = new Map(products.map((p) => [normStockName(p.name), p]));
  const invByName = new Map<string, InventoryItem>();
  for (const inv of invByKey.values()) {
    if (!inv.variationId) invByName.set(normStockName(inv.productName), inv);
  }
  const invFor = (productId: string, variationId?: string) =>
    (variationId ? invByKey.get(stockKey(productId, variationId)) : undefined) ?? invByKey.get(productId);
  // Deal text often names only a size ("1.5 Litre Bottle"): the stocked size
  // whose label it contains — the longest such label, and only if just one.
  const sizeRows = [...invByKey.values()].filter((i) => i.variationId && i.variationLabel);
  const invBySizeText = (label: string) => {
    const hits = sizeRows.filter((i) => labelNamesSize(label, i.variationLabel!));
    const longest = Math.max(0, ...hits.map((i) => i.variationLabel!.length));
    const top = hits.filter((i) => i.variationLabel!.length === longest);
    return top.length === 1 ? top[0] : undefined;
  };

  const out: { inv: InventoryItem; name: string; qty: number }[] = [];
  for (const item of items) {
    const product = byId.get(item.productId);
    if (product?.type === "bundle" && product.dealItems.length > 0) {
      let matched = 0;
      for (const d of product.dealItems) {
        if (d.noStock) continue;
        let invHit: InventoryItem | undefined;
        if (d.productId) {
          invHit = invFor(d.productId);
        }
        if (!invHit) {
          const key = normStockName(d.label);
          const named = byName.get(key);
          invHit = named
            ? invFor(named.id)
            : invByName.get(key);
        }
        if (!invHit) invHit = invBySizeText(d.label);
        if (!invHit) continue;
        const linked = d.productId ? byId.get(d.productId) : undefined;
        out.push({ inv: invHit, name: linked?.name || invHit.productName, qty: d.qty * item.qty });
        matched++;
      }
      const own = matched === 0 ? invFor(item.productId, item.variationId) : undefined;
      if (own) out.push({ inv: own, name: item.productName, qty: item.qty });
    } else {
      const inv = invFor(item.productId, item.variationId);
      if (inv) out.push({ inv, name: item.productName, qty: item.qty });
    }
  }

  // One line per stock row (deal can list same item twice, or multi-line orders).
  const merged = new Map<string, OrderItem>();
  for (const { inv, name, qty } of out) {
    const prev = merged.get(inv.id);
    if (prev) prev.qty += qty;
    else
      merged.set(inv.id, {
        productId: inv.productId,
        ...(inv.variationId ? { variationId: inv.variationId, variationLabel: inv.variationLabel } : {}),
        productName: name,
        qty,
        unitPrice: 0,
        lineTotal: 0,
      });
  }
  return Array.from(merged.values());
}

/**
 * Order lines → the stock rows they move, without the network (same matching
 * as a synced sale: deals, sizes). For showing a not-yet-synced sale at once.
 */
export function stockLinesForLocal(
  items: OrderItem[],
  products: Product[],
  inventory: InventoryItem[],
): { inv: InventoryItem; line: OrderItem }[] {
  const invByKey = new Map<string, InventoryItem>();
  for (const i of inventory) {
    if (!i.productId.startsWith("manual_")) invByKey.set(stockKey(i.productId, i.variationId), i);
  }
  return expandItemsForStock(items, products, invByKey)
    .map((line) => ({ inv: invForLine(invByKey, line), line }))
    .filter((x): x is { inv: InventoryItem; line: OrderItem } => Boolean(x.inv) && x.line.qty > 0);
}

/** Stock row of an expanded line (see expandItemsForStock). */
function invForLine(invMap: Map<string, InventoryItem>, line: OrderItem): InventoryItem | undefined {
  return invMap.get(stockKey(line.productId, line.variationId));
}

/** Deterministic movement id — product rows keep the old `{key}__{productId}` form. */
function stockMovementId(key: string, line: OrderItem): string {
  return line.variationId ? `${key}__${line.productId}__${line.variationId}` : `${key}__${line.productId}`;
}

/**
 * Menu for stock expansion without reading the whole catalog per sale: the
 * local cache (the POS keeps it live with a listener), re-reading only the
 * order's deals from the server — their contents decide what moves. Anything
 * the lines need that isn't cached → the server catalog, as before.
 */
async function fetchProductsForStock(items: OrderItem[]): Promise<Product[]> {
  const db = getClientDb();
  const byId = new Map<string, Product>();
  try {
    const cached = await getDocsFromCache(collection(db, "products"));
    for (const d of cached.docs) byId.set(d.id, asProduct(d.id, d.data()));
  } catch {
    // nothing cached
  }
  const lineIds = [...new Set(items.map((i) => i.productId))];
  if (lineIds.some((id) => !byId.has(id))) return fetchProducts();

  const dealIds = lineIds.filter((id) => byId.get(id)?.type === "bundle");
  const fresh = await Promise.all(dealIds.map((id) => getDoc(doc(db, "products", id))));
  for (const snap of fresh) {
    if (snap.exists()) byId.set(snap.id, asProduct(snap.id, snap.data()));
    else byId.delete(snap.id);
  }
  const partMissing = dealIds.some((id) =>
    byId.get(id)?.dealItems.some((d) => d.productId && !byId.has(d.productId)),
  );
  if (partMissing) return fetchProducts();
  return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Branch inventory by productId — only these products' rows, or all of them. */
async function fetchInventoryByProduct(
  branchId: string,
  productIds?: string[],
): Promise<Map<string, InventoryItem>> {
  const col = collection(getClientDb(), "inventory");
  // branchId equality is what lets the rules allow the query.
  const inBranch = where("branchId", "==", branchId);
  // `in` takes up to 30 values per query.
  const queries = productIds
    ? Array.from({ length: Math.ceil(productIds.length / 30) }, (_, i) =>
        query(col, inBranch, where("productId", "in", productIds.slice(i * 30, i * 30 + 30))),
      )
    : [query(col, inBranch)];
  const snaps = await Promise.all(queries.map((q) => getDocs(q))).catch((err) => {
    if (!productIds) throw err;
    return null;
  });
  // Targeted query refused (e.g. an index) — read the whole branch as before.
  if (!snaps) return fetchInventoryByProduct(branchId);
  // A dropped connection answers from the cache: rows it lacks would be
  // skipped and the sale marked stock-synced — fail so the stock step retries.
  if (snaps.some((snap) => snap.metadata.fromCache)) {
    throw new Error("Stock update needs the server");
  }
  const map = new Map<string, InventoryItem>();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const item = asInventoryItem(d.id, d.data());
      // Skip legacy manual entries — they never match POS product ids.
      if (item.productId.startsWith("manual_")) continue;
      map.set(stockKey(item.productId, item.variationId), item);
    }
  }
  return map;
}

/**
 * Stock rows added or changed on this PC go up through Firestore's own queue,
 * a sale's stock through a transaction that reads the server: let this page's
 * stock writes land first. A row still missing on the server after that (added
 * before a reload) is caught per line — see stockRowStillComing.
 */
async function stockChangesOnServer(timeoutMs = 20_000): Promise<void> {
  await inventoryWritesSettled(timeoutMs);
}

/**
 * The server has no such row but this PC does (its add is still on the way):
 * the stock step must wait, not skip the line.
 */
async function stockRowStillComing(inventoryItemId: string): Promise<boolean> {
  try {
    return (await getDocFromCache(doc(getClientDb(), "inventory", inventoryItemId))).exists();
  } catch {
    return false;
  }
}

/**
 * Order lines → stock lines (deals expanded) + the inventory rows they hit.
 * Reads only the rows those lines can match: every product id
 * expandItemsForStock may look up, and the whole branch only when a deal part
 * can match an inventory row by name alone.
 */
async function stockLinesForOrder(
  branchId: string,
  items: OrderItem[],
): Promise<{ lines: OrderItem[]; invMap: Map<string, InventoryItem> }> {
  if (items.length === 0) return { lines: [], invMap: new Map() };
  await stockChangesOnServer();
  const products = await fetchProductsForStock(items);
  const byId = new Map(products.map((p) => [p.id, p]));
  const byName = new Map(products.map((p) => [normStockName(p.name), p]));
  const ids = new Set<string>();
  const parts: DealLineItem[] = [];
  for (const item of items) {
    ids.add(item.productId);
    const product = byId.get(item.productId);
    if (product?.type !== "bundle") continue;
    for (const d of product.dealItems) {
      if (d.noStock) continue;
      if (d.productId) ids.add(d.productId);
      const named = byName.get(normStockName(d.label));
      if (named) ids.add(named.id);
      parts.push(d);
    }
  }
  let invMap = await fetchInventoryByProduct(branchId, [...ids]);
  // Not stocked under its own product and named like no product: only the
  // inventory names (all rows) can still match it.
  const byInventoryName = parts.some(
    (d) =>
      !(d.productId && invMap.has(d.productId)) &&
      !byName.has(normStockName(d.label)),
  );
  if (byInventoryName) invMap = await fetchInventoryByProduct(branchId);
  return { lines: expandItemsForStock(items, products, invMap), invMap };
}

/** The row was added to stock after `saleAt` (rows without a date: always tracked). */
export function isTrackedAfter(createdAt: unknown, saleAt: string): boolean {
  return typeof createdAt === "string" && createdAt !== "" && Date.parse(createdAt) > Date.parse(saleAt);
}

/**
 * applied: written now. already: this movement id is on the server. no-row:
 * no stock row on the server (deleted, or its offline add never got there).
 * untracked: the row was added after the sale.
 */
type StockTxOutcome = "applied" | "already" | "no-row" | "untracked";

async function applyStockMovementTx(params: {
  branchId: string;
  inventoryItemId: string;
  productId: string;
  productName: string;
  variationId?: string;
  movementType: StockMovementType;
  quantity: number;
  /** Applied as newStock = prev + signedDelta when absoluteStock omitted (may go below 0). */
  signedDelta: number;
  /** When set (adjustment), stock becomes this value (min 0) regardless of concurrent writes. */
  absoluteStock?: number;
  notes: string;
  user: AppUser;
  /** Deterministic id for idempotent POS queue stock sync. */
  movementId?: string;
  /**
   * POS offline queue: when the sale / cancel / edit really happened. The
   * movement is dated then (no createdAtServer) instead of at sync time.
   */
  occurredAt?: string;
  /** When the order was made: a row added to stock after it is left alone. */
  saleAt?: string;
  /** POS offline queue — aborted when the sync gave up waiting: a late wake-up stops instead of committing. */
  signal?: AbortSignal;
}): Promise<StockTxOutcome> {
  const db = getClientDb();
  const invRef = doc(db, "inventory", params.inventoryItemId);
  const movRef = params.movementId
    ? doc(db, "stockMovements", params.movementId)
    : doc(collection(db, "stockMovements"));
  const createdAt = new Date().toISOString();
  const movementAt = params.occurredAt ?? createdAt;
  // Offline queue: A acted, B is signed in at sync. Rules require createdBy =
  // signed-in user, so B is the writer and A stays the visible name (actorUid).
  const signedIn = getClientAuth().currentUser;
  const writerUid = signedIn?.uid ?? params.user.uid;

  return runTransaction<StockTxOutcome>(db, async (tx) => {
    params.signal?.throwIfAborted();
    if (params.movementId) {
      const existingMov = await tx.get(movRef);
      if (existingMov.exists()) return "already";
    }
    const snap = await tx.get(invRef);
    if (!snap.exists()) return "no-row";
    // Counted when added: a sale from before that (synced late, offline) is
    // already off the shelf — and so its cancel / edit has nothing to give back.
    if (params.saleAt && isTrackedAfter(snap.data().createdAt, params.saleAt)) return "untracked";
    const prev = Number(snap.data().currentStock ?? 0);
    // A delta applies in full, even below 0: selling more than was counted
    // shows as negative (oversold), a cancel gives back exactly what its sale
    // took, and the next purchase lands on the right number. Only a counted
    // (absolute) stock is floored at 0.
    const newStock =
      params.absoluteStock != null
        ? Math.max(0, params.absoluteStock)
        : prev + params.signedDelta;
    const quantity = Math.abs(newStock - prev) || params.quantity;
    tx.set(
      invRef,
      {
        currentStock: newStock,
        lastUpdated: createdAt,
        lastUpdatedServer: serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(movRef, {
      branchId: params.branchId,
      inventoryItemId: params.inventoryItemId,
      productId: params.productId,
      productName: params.productName,
      ...(params.variationId ? { variationId: params.variationId } : {}),
      movementType: params.movementType,
      quantity,
      previousStock: prev,
      newStock,
      delta: newStock - prev,
      notes: params.notes,
      createdBy: writerUid,
      createdByName: params.user.displayName || params.user.email,
      ...(writerUid !== params.user.uid ? { actorUid: params.user.uid } : {}),
      createdAt: movementAt,
      ...(params.occurredAt
        ? { syncedAtServer: serverTimestamp() }
        : { createdAtServer: serverTimestamp() }),
    });
    return "applied";
  });
}

/** Deduct stock for each order item after a successful checkout. */
export async function deductStockForOrder(params: {
  branchId: string;
  items: OrderItem[];
  user: AppUser;
  /**
   * When set (POS queue sync), movement docs use deterministic ids so retries
   * never double-deduct: `stockMovements/{key}__{productId}`.
   */
  idempotencyKey?: string;
  /** POS offline queue — date the movements at the sale time. */
  occurredAt?: string;
  /** When the order was made (see applyStockMovementTx). */
  saleAt?: string;
  /** POS offline queue — aborted when the sync gave up waiting: a late wake-up stops instead of committing. */
  signal?: AbortSignal;
}): Promise<void> {
  const { lines, invMap } = await stockLinesForOrder(params.branchId, params.items);
  const deducted: OrderItem[] = [];
  try {
    for (const line of lines) {
      const inv = invForLine(invMap, line);
      if (!inv || line.qty <= 0) continue;
      const movementId = params.idempotencyKey
        ? stockMovementId(params.idempotencyKey, line)
        : undefined;
      const outcome = await applyStockMovementTx({
        branchId: params.branchId,
        inventoryItemId: inv.id,
        productId: line.productId,
        productName: line.productName,
        variationId: line.variationId,
        movementType: "sale",
        quantity: line.qty,
        signedDelta: -line.qty,
        notes: params.idempotencyKey
          ? `queue:${params.idempotencyKey}`
          : "",
        user: params.user,
        movementId,
        occurredAt: params.occurredAt,
        saleAt: params.saleAt,
        signal: params.signal,
      });
      if (outcome === "no-row" && (await stockRowStillComing(inv.id))) {
        throw new Error("Stock update needs the server");
      }
      deducted.push(line);
    }
  } catch (err) {
    // Undo partial deduct so checkout can safely roll back the order.
    // Queued sync path should pass idempotencyKey and NOT roll back the order;
    // undo still keeps inventory consistent for a failed attempt without key reuse.
    if (deducted.length > 0 && !params.idempotencyKey) {
      try {
        await restoreStockForOrder({
          branchId: params.branchId,
          items: deducted,
          user: params.user,
          notes: "Rollback failed checkout deduct",
        });
      } catch {
        // ignore nested failure
      }
    }
    throw err;
  }
}

/** Put deducted stock back after cancel or delete of a completed order. */
export async function restoreStockForOrder(params: {
  branchId: string;
  items: OrderItem[];
  user: AppUser;
  notes?: string;
  idempotencyKey?: string;
  /** POS offline queue — date the movements at the cancel / edit time. */
  occurredAt?: string;
  /** When the order was made (see applyStockMovementTx). */
  saleAt?: string;
}): Promise<void> {
  const { lines, invMap } = await stockLinesForOrder(params.branchId, params.items);
  for (const line of lines) {
    const inv = invForLine(invMap, line);
    if (!inv || line.qty <= 0) continue;
    const movementId = params.idempotencyKey
      ? stockMovementId(params.idempotencyKey, line)
      : undefined;
    const outcome = await applyStockMovementTx({
      branchId: params.branchId,
      inventoryItemId: inv.id,
      productId: line.productId,
      productName: line.productName,
      variationId: line.variationId,
      movementType: "restock",
      quantity: line.qty,
      signedDelta: line.qty,
      notes: params.notes || "Order restock",
      user: params.user,
      movementId,
      occurredAt: params.occurredAt,
      saleAt: params.saleAt,
    });
    if (outcome === "no-row" && (await stockRowStillComing(inv.id))) {
      throw new Error("Stock update needs the server");
    }
  }
}

/** An order edit as stock lines: qty added (to deduct) and taken off (to restock), per item and size. */
export function amendStockLines(
  previousItems: OrderItem[],
  nextItems: OrderItem[],
): { toDeduct: OrderItem[]; toRestock: OrderItem[] } {
  // Per item and size — a 1.5 Litre swapped for a Tin Can moves both sizes.
  const qtyMap = (items: OrderItem[]) => {
    const map = new Map<string, { qty: number; line: OrderItem }>();
    for (const it of items) {
      const key = stockKey(it.productId, it.variationId);
      const prev = map.get(key);
      if (prev) prev.qty += it.qty;
      else map.set(key, { qty: it.qty, line: it });
    }
    return map;
  };
  const before = qtyMap(previousItems);
  const after = qtyMap(nextItems);
  const keys = new Set([...before.keys(), ...after.keys()]);

  const toDeduct: OrderItem[] = [];
  const toRestock: OrderItem[] = [];
  for (const key of keys) {
    const oldQty = before.get(key)?.qty ?? 0;
    const newQty = after.get(key)?.qty ?? 0;
    const delta = newQty - oldQty;
    if (delta === 0) continue;
    const src = (after.get(key) ?? before.get(key))!.line;
    const line: OrderItem = {
      productId: src.productId,
      ...(src.variationId ? { variationId: src.variationId, variationLabel: src.variationLabel } : {}),
      productName: src.productName || src.productId,
      qty: Math.abs(delta),
      unitPrice: 0,
      lineTotal: 0,
    };
    if (delta > 0) toDeduct.push(line);
    else toRestock.push(line);
  }
  return { toDeduct, toRestock };
}

/**
 * After an order amend: deduct stock for qty increases, restock for qty decreases.
 * Products without an inventory row are skipped (same as checkout).
 */
export async function syncStockForOrderAmend(params: {
  branchId: string;
  previousItems: OrderItem[];
  nextItems: OrderItem[];
  user: AppUser;
  orderNumber: number;
  /** When set, sale/restock movements use deterministic ids (offline mutation retry). */
  idempotencyKey?: string;
  /** POS offline queue — when the edit was made. */
  occurredAt?: string;
  /** When the order was made (see applyStockMovementTx). */
  saleAt?: string;
}): Promise<void> {
  const { toDeduct, toRestock } = amendStockLines(params.previousItems, params.nextItems);

  if (toDeduct.length > 0) {
    await deductStockForOrder({
      branchId: params.branchId,
      items: toDeduct,
      user: params.user,
      idempotencyKey: params.idempotencyKey
        ? `${params.idempotencyKey}_d`
        : undefined,
      occurredAt: params.occurredAt,
      saleAt: params.saleAt,
    });
  }
  if (toRestock.length > 0) {
    await restoreStockForOrder({
      branchId: params.branchId,
      items: toRestock,
      user: params.user,
      notes: `Amend #${params.orderNumber}`,
      idempotencyKey: params.idempotencyKey
        ? `${params.idempotencyKey}_r`
        : undefined,
      occurredAt: params.occurredAt,
      saleAt: params.saleAt,
    });
  }
}

/* ── Refund ── */

/**
 * Issue a refund. Partial refunds accumulate, so the stored `refundAmount` is
 * always the lifetime total and can never exceed the order total.
 * Runs in a transaction because two owners could refund the same order at once.
 * When the order becomes fully refunded, stock is restored (same as cancel).
 */
export async function refundOrder(params: {
  orderId: string;
  refundAmount: number;
  refundReason: string;
  user: AppUser;
  /** POS offline queue — same id must never add money twice. */
  clientMutationId?: string;
  /** POS offline queue — when the refund was made (activity log time). */
  occurredAt?: string;
  /** POS offline queue — aborted when the sync gave up waiting: a late wake-up stops instead of committing. */
  signal?: AbortSignal;
}): Promise<{ refundAmount: number; stockRestored: boolean; order?: Order }> {
  const { orderId, refundAmount, refundReason, user, clientMutationId } = params;
  const requested = money(refundAmount);
  if (!(requested > 0)) {
    throw new Error("Refund amount must be greater than zero");
  }

  const db = getClientDb();
  const orderRef = doc(db, "orders", orderId);

  const meta = await runTransaction(db, async (tx) => {
    params.signal?.throwIfAborted();
    const snap = await tx.get(orderRef);
    if (!snap.exists()) {
      // Queued refund on an order someone deleted meanwhile — drop, don't loop.
      if (clientMutationId) throw new OrderConflictError("deleted");
      throw new Error("Order not found");
    }
    const data = snap.data();

    if (data.status === "cancelled") {
      if (clientMutationId) throw new OrderConflictError("cancelled");
      throw new Error("Cancelled orders cannot be refunded");
    }

    const appliedIds = Array.isArray(data.appliedClientMutationIds)
      ? (data.appliedClientMutationIds as string[])
      : [];
    if (clientMutationId && appliedIds.includes(clientMutationId)) {
      // Already applied this offline mutation (the answer was lost, e.g. the
      // line dropped during the stock restore) — no second bump. Rebuild the
      // bill as it was before this refund, so the activity log can still be
      // completed below (its id is fixed: written once, never twice).
      const items = Array.isArray(data.items) ? data.items.map(asOrderItem) : [];
      const nextTotal = money(Number(data.refundAmount ?? 0));
      const entries = asOrderRefunds(Array.isArray(data.refunds) ? data.refunds : []);
      let own = -1;
      entries.forEach((r, i) => {
        if (money(r.amount) === requested && (!params.occurredAt || r.at === params.occurredAt)) own = i;
      });
      const beforeRefund = {
        ...asOrder(snap.id, data),
        refundAmount: money(Math.max(0, nextTotal - requested)),
        refunds: entries.filter((_, i) => i !== own),
      };
      return {
        nextTotal,
        branchId: String(data.branchId ?? ""),
        orderNumber: Number(data.orderNumber ?? 0),
        createdAt: String(data.createdAt ?? ""),
        total: Number(data.total ?? 0),
        items,
        fullyRefunded: isFullyRefunded({
          total: Number(data.total ?? 0),
          refundAmount: nextTotal,
        }),
        skippedDuplicate: true,
        requested,
        snapshot: orderLogSnapshot(beforeRefund) as ActivityOrderSnapshot | undefined,
      };
    }

    const current = {
      total: Number(data.total ?? 0),
      refundAmount: Number(data.refundAmount ?? 0),
    };
    const remaining = orderRefundableAmount(current);
    // Queued refund that no longer fits (refunded meanwhile on another device):
    // drop it like a conflict instead of failing and retrying forever.
    if (clientMutationId && requested > remaining) {
      throw new OrderConflictError("refunded");
    }
    if (remaining <= 0) {
      throw new Error("This order is already fully refunded");
    }
    if (requested > remaining) {
      throw new Error("Refund amount is more than the remaining balance");
    }

    const nextTotal = money(orderRefundedAmount(current) + requested);
    const nextApplied = clientMutationId
      ? [...appliedIds, clientMutationId].slice(-40)
      : appliedIds;
    // Queued refund keeps the real refund time instead of sync time.
    const refundedAt = params.occurredAt ?? shopNow().toISOString();
    const refunds = [
      ...(Array.isArray(data.refunds) ? asOrderRefunds(data.refunds) : []),
      { amount: requested, at: refundedAt },
    ];

    tx.set(
      orderRef,
      {
        refundAmount: nextTotal,
        refundReason,
        refunds,
        ...(params.occurredAt
          ? {
              refundedAt: params.occurredAt,
              refundedAtServer: deleteField(),
              updatedAt: params.occurredAt,
              updatedAtServer: deleteField(),
            }
          : {
              refundedAt,
              refundedAtServer: serverTimestamp(),
              updatedAtServer: serverTimestamp(),
            }),
        refundedBy: user.uid,
        refundedByName: user.displayName || user.email,
        refundCount: Number(data.refundCount ?? 0) + 1,
        // Someone else signed in on the shared PC uploads it: on record.
        ...uploadStamp(user.uid),
        ...(clientMutationId
          ? {
              lastClientMutationId: clientMutationId,
              appliedClientMutationIds: nextApplied,
            }
          : {}),
      },
      { merge: true },
    );

    const items = Array.isArray(data.items) ? data.items.map(asOrderItem) : [];
    return {
      nextTotal,
      branchId: String(data.branchId ?? ""),
      orderNumber: Number(data.orderNumber ?? 0),
      createdAt: String(data.createdAt ?? ""),
      total: current.total,
      items,
      fullyRefunded: isFullyRefunded({
        total: current.total,
        refundAmount: nextTotal,
      }),
      skippedDuplicate: false,
      requested,
      snapshot: orderLogSnapshot(asOrder(snap.id, data)) as ActivityOrderSnapshot | undefined,
    };
  });

  let stockRestored = false;
  params.signal?.throwIfAborted();
  if (meta.fullyRefunded && meta.items.length > 0 && meta.branchId) {
    await restoreStockForOrder({
      branchId: meta.branchId,
      items: meta.items,
      user,
      notes: `Refund #${meta.orderNumber}`,
      idempotencyKey: `restock_${orderId}`,
      occurredAt: params.occurredAt,
      saleAt: meta.createdAt || undefined,
    });
    stockRestored = true;
  }

  // Also on a queued retry whose refund already landed: the log id is fixed,
  // so a log that was written is refused again (ignored) and a missing one is made.
  if (!meta.skippedDuplicate || clientMutationId) {
    try {
      const staffName = user.displayName || user.email;
      const itemsLine = describeOrderItemsList(meta.items);
      await writeActivityLog({
        branchId: meta.branchId,
        entityType: "order",
        entityId: orderId,
        action: "update",
        summary: `Refunded order #${meta.orderNumber} · ${formatPkr(meta.requested)} (total refunded ${formatPkr(meta.nextTotal)}) · by ${staffName}`,
        ...(meta.snapshot
          ? {
              change: {
                kind: "order" as const,
                before: meta.snapshot,
                refund: {
                  amount: meta.requested,
                  ...(refundReason.trim() ? { reason: refundReason.trim() } : {}),
                  totalRefunded: meta.nextTotal,
                },
              },
            }
          : {}),
        detail: [
          refundReason.trim(),
          itemsLine ? `Items: ${itemsLine}` : "",
          stockRestored
            ? "Stock restored"
            : "Partial — stock unchanged until fully refunded",
        ]
          .filter(Boolean)
          .join(" · "),
        user,
        ...queuedLogFields(clientMutationId, params.occurredAt),
      });
    } catch {
      // ignore
    }
  }

  const fresh = await readDocAfterWrite(orderRef, asOrder);

  return {
    refundAmount: meta.nextTotal,
    stockRestored,
    order: fresh ?? undefined,
  };
}

/* ── Cash Drawer ── */

export async function openCashDrawer(params: {
  branchId: string;
  openingBalance: number;
  user: AppUser;
}): Promise<{ session: CashDrawerSession; alreadyOpen: boolean }> {
  const db = getClientDb();
  const hours = businessDayHoursFromSettings(await fetchSettings());
  const date = businessDateKey(shopNow(), hours);
  // One open drawer per branch: another device may have opened it a moment ago
  // (two open drawers would each count the day's cash sales).
  const open = await getDocs(
    query(
      collection(db, "cashDrawers"),
      where("branchId", "==", params.branchId),
      where("status", "==", "open"),
    ),
  );
  const alreadyOpen = open.docs
    .map((d) => asCashDrawer(d.id, d.data()))
    .find((s) => s.date === date);
  if (alreadyOpen) return { session: alreadyOpen, alreadyOpen: true };

  const ref = doc(collection(db, "cashDrawers"));
  const openedAt = new Date().toISOString();
  const data = {
    branchId: params.branchId,
    date,
    openingBalance: money(params.openingBalance),
    closingCount: null,
    expectedCash: null,
    difference: null,
    status: "open",
    openedBy: params.user.uid,
    openedByName: params.user.displayName || params.user.email,
    openedAt,
    createdAtServer: serverTimestamp(),
  };
  await setOnce(ref, data);

  const fresh = await readDocAfterWrite(ref, asCashDrawer);
  return { session: fresh ?? asCashDrawer(ref.id, data), alreadyOpen: false };
}

/**
 * One business day's orders + that day's expenses, read from the SERVER.
 * Throws when only the local cache answered — a drawer auto-close writes money
 * totals permanently and must never use stale (cached) data.
 */
export async function fetchDayFromServer(params: {
  branchId: string;
  sinceIso: string;
  untilIso: string;
}): Promise<{ orders: Order[]; expenses: Expense[] }> {
  const db = getClientDb();
  const branch = where("branchId", "==", params.branchId);
  let ordersSnap;
  try {
    ordersSnap = await getDocs(
      query(
        collection(db, "orders"),
        branch,
        where("createdAt", ">=", params.sinceIso),
        where("createdAt", "<=", params.untilIso),
      ),
    );
  } catch (err) {
    // Date index not deployed yet → whole branch, filtered by the caller.
    if (!isMissingIndex(err)) throw err;
    ordersSnap = await getDocs(query(collection(db, "orders"), branch));
  }
  // Only the calendar days this window touches (+ undated rows) — the caller
  // matches each expense by its (date || createdAt) day, not the whole history.
  const days = expenseDaysFilter(
    businessDateKey(new Date(params.sinceIso)),
    businessDateKey(new Date(params.untilIso)),
  );
  let expensesSnap;
  try {
    expensesSnap = await getDocs(
      query(collection(db, "expenses"), branch, ...(days ? [days] : [])),
    );
  } catch (err) {
    // Index merge refused → whole branch, filtered by the caller (old behaviour).
    if (!days || !isMissingIndex(err)) throw err;
    expensesSnap = await getDocs(query(collection(db, "expenses"), branch));
  }
  if (ordersSnap.metadata.fromCache || expensesSnap.metadata.fromCache) {
    throw new Error("Server data needed");
  }
  return {
    orders: ordersSnap.docs.map((d) => asOrder(d.id, d.data())),
    expenses: expensesSnap.docs.map((d) => asExpense(d.id, d.data())),
  };
}

export async function closeCashDrawer(params: {
  sessionId: string;
  closingCount: number;
  expectedCash: number;
  user: AppUser;
  /** System close at business-day end — nobody counted: no count, no difference. */
  auto?: boolean;
}): Promise<void> {
  const expectedCash = money(params.expectedCash);
  const closingCount = params.auto ? null : money(params.closingCount);
  const difference = closingCount == null ? null : money(closingCount - expectedCash);
  const ref = doc(getClientDb(), "cashDrawers", params.sessionId);
  // Auto close never overwrites a drawer already closed (e.g. by hand on another device).
  if (params.auto) {
    const current = await getDocFromServer(ref);
    if (current.data()?.status !== "open") return;
  }
  await setDoc(
    ref,
    {
      closingCount,
      expectedCash,
      difference,
      status: "closed",
      closedBy: params.auto ? "system" : params.user.uid,
      closedByName: params.auto
        ? "Auto close"
        : params.user.displayName || params.user.email,
      closedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp(),
      ...(params.auto ? { autoClosed: true } : { autoClosed: false }),
    },
    { merge: true },
  );
}

// No upper bound: refundedAt is only the LATEST refund, so an order refunded
// in a window and again later must still come back — callers match each
// refund (order.refunds) to their window.
function refundedSince(branchId: string, sinceIso: string) {
  return query(
    collection(getClientDb(), "orders"),
    where("branchId", "==", branchId),
    where("refundedAt", ">=", sinceIso),
  );
}

/** Changed since (a cancel stamps updatedAt with its time — the cash goes back then). */
function changedSince(branchId: string, sinceIso: string) {
  return query(
    collection(getClientDb(), "orders"),
    where("branchId", "==", branchId),
    where("updatedAt", ">=", sinceIso),
  );
}

/**
 * Orders that may have handed cash back since sinceIso, whatever day they were
 * sold: refunded, or changed (cancelled) since then — the cash leaves the
 * drawer when that happens. Until an index ((branchId, refundedAt) /
 * (branchId, updatedAt)) is deployed that part is empty, as before.
 */
export function onCashBackOrdersSnapshot(
  branchId: string,
  sinceIso: string,
  callback: (orders: Order[]) => void,
): Unsubscribe {
  const parts: (Order[] | undefined)[] = [undefined, undefined];
  const emit = () => {
    if (parts.some((p) => !p)) return;
    const byId = new Map<string, Order>();
    for (const p of parts) for (const o of p!) byId.set(o.id, o);
    callback([...byId.values()]);
  };
  const unsubs = [refundedSince(branchId, sinceIso), changedSince(branchId, sinceIso)].map((q, i) =>
    onSnapshot(
      q,
      (snap) => {
        parts[i] = snap.docs.map((d) => asOrder(d.id, d.data()));
        emit();
      },
      () => {
        parts[i] = [];
        emit();
      },
    ),
  );
  return () => unsubs.forEach((u) => u());
}

/** Server-only twin of onCashBackOrdersSnapshot, for the drawer auto close. */
export async function fetchCashBackFromServer(params: {
  branchId: string;
  sinceIso: string;
}): Promise<Order[]> {
  const one = async (q: ReturnType<typeof refundedSince>) => {
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      if (isMissingIndex(err)) return [];
      throw err;
    }
    if (snap.metadata.fromCache) throw new Error("Server data needed");
    return snap.docs.map((d) => asOrder(d.id, d.data()));
  };
  const [refunded, changed] = await Promise.all([
    one(refundedSince(params.branchId, params.sinceIso)),
    one(changedSince(params.branchId, params.sinceIso)),
  ]);
  const byId = new Map<string, Order>();
  for (const o of [...refunded, ...changed]) byId.set(o.id, o);
  return [...byId.values()];
}

/**
 * A branch's drawer sessions for business days fromKey..toKey (owner report)
 * — not the whole history. One day needs no extra index; a longer span uses
 * (branchId, date) and, until that index is deployed, the branch's sessions
 * (one per day) filtered here.
 */
export function onCashDrawersInRange(
  branchId: string,
  /** null = from the beginning. */
  fromKey: string | null,
  toKey: string,
  callback: (sessions: CashDrawerSession[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const base = query(collection(getClientDb(), "cashDrawers"), where("branchId", "==", branchId));
  const ranged =
    fromKey === toKey
      ? query(base, where("date", "==", toKey))
      : fromKey
        ? query(base, where("date", ">=", fromKey), where("date", "<=", toKey))
        : query(base, where("date", "<=", toKey));
  const inRange = (s: CashDrawerSession) => (!fromKey || s.date >= fromKey) && s.date <= toKey;
  let unsub: Unsubscribe = () => {};
  const listen = (q: typeof base) =>
    onSnapshot(
      q,
      (snap) =>
        callback(
          snap.docs
            .map((d) => asCashDrawer(d.id, d.data()))
            .filter(inRange)
            .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
        ),
      (err) => {
        if (q !== base && isMissingIndex(err)) {
          unsub = listen(base);
          return;
        }
        onError?.(err);
      },
    );
  unsub = listen(ranged);
  return () => unsub();
}

export function onCashDrawersSnapshot(
  branchId: string,
  callback: (sessions: CashDrawerSession[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getClientDb(), "cashDrawers"),
    where("branchId", "==", branchId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => asCashDrawer(d.id, d.data()))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
      callback(items);
    },
    (err) => onError?.(err),
  );
}
