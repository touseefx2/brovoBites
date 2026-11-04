import type {
  ActivityLog,
  CashDrawerSession,
  Expense,
  InventoryItem,
  Order,
  OrderType,
  StockDayRow,
  StockMovement,
} from "@bravobites/domain";
import { money, summarizeStockDay } from "@bravobites/domain";
import { computeDayReport, type DayReport } from "@/lib/day-report";

/**
 * Owner report — who did what in a period: each person's sales, discounts,
 * cancels, edits, refunds and expenses, the cash drawer result, and a short
 * list of things worth checking (cash short, bill lowered after the sale,
 * cancels, deletes, big discounts, expense changes). Pure math over data the
 * caller already has: the period's orders + expenses (same as the Day report),
 * its activity logs (only sensitive changes are logged) and drawer sessions.
 */

export type ReportEventKind =
  | "edit"
  | "cancel"
  | "refund"
  | "delete"
  | "expenseAdd"
  | "expenseEdit"
  | "expenseDelete";

/** One logged change, with the amounts read from its log line. */
export interface ReportEvent {
  id: string;
  kind: ReportEventKind;
  at: string;
  byUid: string;
  byName: string;
  /** Order or expense the change is about. */
  entityId: string;
  branchId: string;
  orderNumber?: number;
  /** edit: bill before / after; expenseEdit: amount before / after. */
  before?: number;
  after?: number;
  /** cancel / refund / delete / expense add & delete. */
  amount?: number;
  summary: string;
  detail?: string;
  /** Still on this PC, not on the cloud yet. */
  pending?: boolean;
  /** The log line itself (its before / after bill for the details view). */
  log: ActivityLog;
}

export type FlagLevel = "high" | "medium" | "low";

export type FlagKind =
  | "drawerShort"
  | "drawerOver"
  | "drawerNotCounted"
  | "editDown"
  | "cancelCash"
  | "cancel"
  | "refund"
  | "delete"
  | "bigDiscount"
  | "expenseEdit"
  | "expenseDelete"
  | "manyEdits";

export interface ReportFlag {
  id: string;
  level: FlagLevel;
  kind: FlagKind;
  at: string;
  byUid?: string;
  byName?: string;
  branchId?: string;
  orderId?: string;
  orderNumber?: number;
  amount?: number;
  before?: number;
  after?: number;
  /** Discount %, edit count. */
  count?: number;
  /** Minutes between the sale and the change (when the sale is known). */
  minutesAfterSale?: number;
  /** Drawer business day. */
  date?: string;
  /** The change log line behind it (details view). */
  logId?: string;
}

export interface StaffAudit {
  uid: string;
  name: string;
  /** Orders they made (not cancelled) and their bill total. */
  orders: number;
  sales: number;
  /** Net of refunds, like the Day report. */
  cash: number;
  card: number;
  digital: number;
  dineIn: number;
  takeaway: number;
  delivery: number;
  discountOrders: number;
  discountAmount: number;
  /** Their own orders that ended up cancelled. */
  cancelledOrders: number;
  cancelledAmount: number;
  /** Changes they made (from the log), on anyone's order. */
  cancelsDone: number;
  cancelsDoneAmount: number;
  /** Of those cancels, the ones on their own orders (said once on their card, not twice). */
  cancelsOwn: number;
  edits: number;
  editsDown: number;
  editsDownAmount: number;
  refunds: number;
  refundAmount: number;
  deletes: number;
  deletesAmount: number;
  expensesAdded: number;
  expenseAmount: number;
  expenseEdits: number;
  expenseDeletes: number;
  /** "Check" / "look" items that involve them. */
  flags: number;
}

export interface TypeRow {
  type: OrderType | "unset";
  orders: number;
  amount: number;
}

export interface PaymentRow {
  method: "cash" | "card" | "digital";
  orders: number;
  /** After refunds. */
  amount: number;
}

export interface DrawerRow {
  id: string;
  branchId: string;
  date: string;
  openingBalance: number;
  expectedCash: number | null;
  closingCount: number | null;
  difference: number | null;
  status: "open" | "closed";
  autoClosed: boolean;
  openedByName: string;
  closedByName?: string;
}

/** One size / option of an item ("Full", "Half"…). */
export interface ItemVariant {
  label: string;
  qty: number;
  revenue: number;
}

export interface ItemRow {
  productId: string;
  name: string;
  qty: number;
  /** Line totals, before the bill's discount. */
  revenue: number;
  /** Sizes, most sold first (empty when the item has none). */
  variants: ItemVariant[];
}

/** The same dish sold in more than one menu item ("Sajji with Rice" + "Sajji without Rice"). */
export interface ItemFamily {
  name: string;
  qty: number;
  revenue: number;
  members: string[];
  /** Sizes added up across the members (Full of both, Half of both…). */
  variants: ItemVariant[];
}

/** One menu category's sales. */
export interface ItemGroup {
  id: string;
  /** Category name; null = items no longer on the menu. */
  name: string | null;
  qty: number;
  revenue: number;
  items: ItemRow[];
  families: ItemFamily[];
}

export interface ItemSales {
  qty: number;
  revenue: number;
  /** Grouped by menu category (false: the menu wasn't at hand — one list). */
  grouped: boolean;
  groups: ItemGroup[];
}

/** Menu names for grouping item sales (the POS keeps a copy offline). */
export interface ReportCatalog {
  categories: { id: string; name: string; sortOrder: number }[];
  products: { id: string; name: string; categoryId: string }[];
}

export interface OwnerReport {
  day: DayReport;
  items: ItemSales;
  totals: {
    orders: number;
    gross: number;
    refunds: number;
    refundOrders: number;
    net: number;
    avgOrder: number;
    discountAmount: number;
    discountOrders: number;
    cancelledOrders: number;
    cancelledAmount: number;
    expenses: number;
    expenseCount: number;
    netAfterExpenses: number;
    edits: number;
    editsDown: number;
    editsDownAmount: number;
    deletes: number;
    expenseEdits: number;
    expenseDeletes: number;
  };
  byType: TypeRow[];
  byPayment: PaymentRow[];
  staff: StaffAudit[];
  drawers: DrawerRow[];
  drawerShort: number;
  drawerOver: number;
  flags: ReportFlag[];
  events: ReportEvent[];
  /** Each stocked item: opening, in, sold, left. Absent when stock wasn't read. */
  stock?: StockDayRow[];
  /** Stock changes people made in the period (receive, waste, recount, add, edit, delete), newest first. */
  stockLog: StockLogLine[];
}

export interface StockLogLine {
  id: string;
  at: string;
  byName: string;
  action: ActivityLog["action"];
  summary: string;
  detail?: string;
  pending?: boolean;
}

/** Hand stock changes (inventory logs) in a period, newest first. */
export function stockLogLines(logs: ActivityLog[], fromIso: string, toIso: string, pendingIds?: Set<string>): StockLogLine[] {
  return logs
    .filter((l) => l.entityType === "inventory" && l.createdAt >= fromIso && l.createdAt <= toIso)
    .map((l) => ({
      id: l.id,
      at: l.createdAt,
      byName: l.createdByName || l.createdBy,
      action: l.action,
      summary: l.summary,
      detail: l.detail,
      pending: pendingIds?.has(l.id) || undefined,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** A discount this big (share of the bill, or rupees) is listed to check. */
export const BIG_DISCOUNT_SHARE = 0.15;
export const BIG_DISCOUNT_RUPEES = 500;

const AMOUNT = String.raw`Rs\s*(-?[\d,]+(?:\.\d+)?)`;

function rupees(s: string): number {
  return money(Number(s.replace(/,/g, "")));
}

function firstAmount(text: string): number | undefined {
  const m = new RegExp(AMOUNT).exec(text);
  return m ? rupees(m[1]) : undefined;
}

function lastAmount(text: string): number | undefined {
  const all = [...text.matchAll(new RegExp(AMOUNT, "g"))];
  return all.length ? rupees(all[all.length - 1][1]) : undefined;
}

/**
 * Reads one activity log line into an event. The log text is written by the
 * app itself (firestore.ts / pos-queue/activity.ts), always in English:
 *   "Edited order #12 · Rs 1,200 → Rs 900 · by Ali"
 *   "Cancelled order #12 · Rs 900 · by Ali"
 *   "Refunded order #12 · Rs 200 (total refunded Rs 200) · by Ali"
 *   "Deleted order #12 · Rs 900 · by Owner"
 *   "Added expense · Rs 500" / "Edited expense → Rs 800" (+ Before/After detail)
 *   "Deleted expense other · gas · Rs 500 · 2026-10-24"
 * Stock changes and anything unknown → null.
 */
export function eventFromLog(log: ActivityLog, pending = false): ReportEvent | null {
  const base = {
    id: log.id,
    at: log.createdAt,
    byUid: log.createdBy,
    byName: log.createdByName || log.createdBy,
    entityId: log.entityId,
    branchId: log.branchId,
    summary: log.summary,
    detail: log.detail,
    pending,
    log,
  };
  const num = /#(\d+)/.exec(log.summary);
  // Newer logs keep the bill / expense before and after — exact amounts.
  const order = log.change?.kind === "order" ? log.change : undefined;
  const expense = log.change?.kind === "expense" ? log.change : undefined;
  const orderNumber = order?.before?.orderNumber || (num ? Number(num[1]) : undefined);

  if (log.entityType === "order") {
    if (log.action === "update" && /^refund/i.test(log.summary)) {
      return { ...base, kind: "refund", orderNumber, amount: order?.refund?.amount ?? firstAmount(log.summary) };
    }
    if (log.action === "update") {
      const m = new RegExp(`${AMOUNT}\\s*→\\s*${AMOUNT}`).exec(log.summary);
      return {
        ...base,
        kind: "edit",
        orderNumber,
        before: order?.before?.total ?? (m ? rupees(m[1]) : undefined),
        after: order?.after?.total ?? (m ? rupees(m[2]) : undefined),
      };
    }
    if (log.action === "cancel") {
      return { ...base, kind: "cancel", orderNumber, amount: order?.before?.total ?? firstAmount(log.summary) };
    }
    if (log.action === "delete") {
      return { ...base, kind: "delete", orderNumber, amount: order?.before?.total ?? firstAmount(log.summary) };
    }
    return null;
  }

  if (log.entityType === "expense") {
    if (log.action === "create") {
      return { ...base, kind: "expenseAdd", amount: expense?.after?.amount ?? firstAmount(log.summary) };
    }
    if (log.action === "update") {
      const [beforePart, afterPart] = (log.detail ?? "").split(/\s*→\s*After:\s*/);
      return {
        ...base,
        kind: "expenseEdit",
        before: expense?.before?.amount ?? (afterPart != null ? lastAmount(beforePart) : undefined),
        after: expense?.after?.amount ?? lastAmount(log.summary) ?? (afterPart != null ? lastAmount(afterPart) : undefined),
      };
    }
    if (log.action === "delete") {
      return { ...base, kind: "expenseDelete", amount: expense?.before?.amount ?? lastAmount(log.summary) };
    }
  }
  return null;
}

/** "Sajji with Rice" / "Sajji without Rice" → "Sajji" (null when the name has no with / without part). */
function familyName(name: string): string | null {
  const m = /^(.+?)\s+(?:with|without|w\/o|w\/)\s+\S.*$/i.exec(name.trim());
  return m ? m[1].trim() : null;
}

function addVariant(list: ItemVariant[], label: string, qty: number, revenue: number) {
  const key = label.trim().toLowerCase();
  const v = list.find((x) => x.label.trim().toLowerCase() === key);
  if (v) {
    v.qty += qty;
    v.revenue += revenue;
  } else {
    list.push({ label, qty, revenue });
  }
}

const byQty = <T extends { qty: number; revenue: number }>(a: T, b: T) => b.qty - a.qty || b.revenue - a.revenue;

/**
 * What was sold: every item of the bills that weren't cancelled, by menu
 * category (menu order), with its sizes, and dishes sold under two menu items
 * ("… with Rice" + "… without Rice") added up together.
 */
export function computeItemSales(orders: Order[], catalog?: ReportCatalog | null): ItemSales {
  const products = new Map(catalog?.products.map((p) => [p.id, p]) ?? []);
  const rows = new Map<string, ItemRow>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const it of o.items) {
      if (!(it.qty > 0)) continue;
      const key = it.productId || it.productName;
      let row = rows.get(key);
      if (!row) {
        row = { productId: it.productId, name: products.get(it.productId)?.name || it.productName, qty: 0, revenue: 0, variants: [] };
        rows.set(key, row);
      }
      row.qty += it.qty;
      row.revenue += it.lineTotal;
      if (it.variationLabel) addVariant(row.variants, it.variationLabel, it.qty, it.lineTotal);
    }
  }

  const groups = new Map<string, ItemGroup>();
  for (const row of rows.values()) {
    row.revenue = money(row.revenue);
    // Lines sold before the item had sizes keep their own (unnamed) share.
    const sized = row.variants.reduce((s, v) => s + v.qty, 0);
    if (row.variants.length > 0 && sized < row.qty) addVariant(row.variants, "", row.qty - sized, 0);
    row.variants.sort(byQty);
    const catId = products.get(row.productId)?.categoryId ?? "";
    const cat = catalog?.categories.find((c) => c.id === catId);
    const id = cat ? cat.id : "";
    let g = groups.get(id);
    if (!g) {
      g = { id, name: cat ? cat.name : null, qty: 0, revenue: 0, items: [], families: [] };
      groups.set(id, g);
    }
    g.items.push(row);
    g.qty += row.qty;
    g.revenue += row.revenue;
  }

  for (const g of groups.values()) {
    g.revenue = money(g.revenue);
    g.items.sort(byQty);
    const fam = new Map<string, ItemFamily>();
    for (const row of g.items) {
      const base = familyName(row.name) ?? row.name;
      const key = base.toLowerCase();
      const f = fam.get(key) ?? { name: base, qty: 0, revenue: 0, members: [], variants: [] };
      f.qty += row.qty;
      f.revenue += row.revenue;
      f.members.push(row.name);
      for (const v of row.variants) addVariant(f.variants, v.label, v.qty, v.revenue);
      fam.set(key, f);
    }
    g.families = [...fam.values()]
      .filter((f) => f.members.length > 1)
      .map((f) => ({ ...f, revenue: money(f.revenue), variants: f.variants.sort(byQty) }))
      .sort(byQty);
  }

  const order = new Map(catalog?.categories.map((c) => [c.id, c.sortOrder]) ?? []);
  const list = [...groups.values()].sort((a, b) => {
    // Menu order; items no longer on the menu last.
    if (!a.name || !b.name) return a.name ? -1 : b.name ? 1 : 0;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || b.revenue - a.revenue;
  });
  return {
    qty: list.reduce((s, g) => s + g.qty, 0),
    revenue: money(list.reduce((s, g) => s + g.revenue, 0)),
    grouped: !!catalog,
    groups: list,
  };
}

function emptyStaff(uid: string, name: string): StaffAudit {
  return {
    uid,
    name,
    orders: 0,
    sales: 0,
    cash: 0,
    card: 0,
    digital: 0,
    dineIn: 0,
    takeaway: 0,
    delivery: 0,
    discountOrders: 0,
    discountAmount: 0,
    cancelledOrders: 0,
    cancelledAmount: 0,
    cancelsDone: 0,
    cancelsDoneAmount: 0,
    cancelsOwn: 0,
    edits: 0,
    editsDown: 0,
    editsDownAmount: 0,
    refunds: 0,
    refundAmount: 0,
    deletes: 0,
    deletesAmount: 0,
    expensesAdded: 0,
    expenseAmount: 0,
    expenseEdits: 0,
    expenseDeletes: 0,
    flags: 0,
  };
}

const LEVEL_RANK: Record<FlagLevel, number> = { high: 0, medium: 1, low: 2 };

function minutesBetween(fromIso: string | undefined, toIso: string): number | undefined {
  if (!fromIso) return undefined;
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : undefined;
}

export function computeOwnerReport(params: {
  /** Orders that may fall in the period (others are ignored). */
  orders: Order[];
  expenses: Expense[];
  /** Activity logs of the period (any order: a change today to yesterday's sale counts today). */
  logs: ActivityLog[];
  /** Log ids still waiting on this PC. */
  pendingLogIds?: Set<string>;
  drawers: CashDrawerSession[];
  /** Business-day window: null = from the beginning. */
  from: Date | null;
  to: Date;
  fromKey: string | null;
  toKey: string;
  /** Owners' own changes are listed as notes, not as things to check. */
  ownerUids?: Set<string>;
  /** Groups item sales by menu category (without it: one list). */
  catalog?: ReportCatalog | null;
  /** Stock rows + every stock movement from `from` up to now. */
  stock?: { items: InventoryItem[]; movements: StockMovement[] } | null;
}): OwnerReport {
  const from = params.from ?? new Date(0);
  const fromKey = params.fromKey ?? "0000-00-00";
  const day = computeDayReport({
    orders: params.orders,
    expenses: params.expenses,
    from,
    to: params.to,
    fromKey,
    toKey: params.toKey,
  });
  const isOwner = (uid: string | undefined) => !!uid && !!params.ownerUids?.has(uid);
  const ordersById = new Map<string, Order>();
  for (const o of params.orders) ordersById.set(o.id, o);

  const staff = new Map<string, StaffAudit>();
  const row = (uid: string, name: string) => {
    let r = staff.get(uid);
    if (!r) {
      r = emptyStaff(uid, name || uid);
      staff.set(uid, r);
    }
    return r;
  };

  // Orders they made in the period.
  const active = day.dayOrders.filter((o) => o.status !== "cancelled");
  const typeMap = new Map<TypeRow["type"], TypeRow>();
  const payMap = new Map<PaymentRow["method"], PaymentRow>();
  let discountOrders = 0;
  let refundOrders = 0;
  for (const o of day.dayOrders) {
    const r = row(o.createdBy, o.createdByName || o.createdByEmail || o.createdBy);
    if (o.status === "cancelled") {
      r.cancelledOrders += 1;
      r.cancelledAmount += o.total;
      continue;
    }
    const net = o.total - (o.refundAmount ?? 0);
    r.orders += 1;
    r.sales += o.total;
    if (o.paymentMethod === "cash") r.cash += net;
    else if (o.paymentMethod === "card") r.card += net;
    else if (o.paymentMethod === "digital") r.digital += net;
    if (o.orderType === "dine-in") r.dineIn += 1;
    else if (o.orderType === "takeaway") r.takeaway += 1;
    else if (o.orderType === "delivery") r.delivery += 1;
    if ((o.discountAmount ?? 0) > 0) {
      r.discountOrders += 1;
      r.discountAmount += o.discountAmount ?? 0;
      discountOrders += 1;
    }
    if ((o.refundAmount ?? 0) > 0) refundOrders += 1;

    const type = o.orderType ?? "unset";
    const t = typeMap.get(type) ?? { type, orders: 0, amount: 0 };
    t.orders += 1;
    t.amount += o.total;
    typeMap.set(type, t);
    const p = payMap.get(o.paymentMethod) ?? { method: o.paymentMethod, orders: 0, amount: 0 };
    p.orders += 1;
    p.amount += net;
    payMap.set(o.paymentMethod, p);
  }

  for (const e of day.dayExpenses) {
    const r = row(e.createdBy, e.createdByName || e.createdBy);
    r.expensesAdded += 1;
    r.expenseAmount += e.amount;
  }

  // Changes from the log — by whoever made them, in the period.
  const fromIso = from.toISOString();
  const toIso = params.to.toISOString();
  const events = params.logs
    .filter((l) => l.createdAt >= fromIso && l.createdAt <= toIso)
    .map((l) => eventFromLog(l, params.pendingLogIds?.has(l.id) ?? false))
    .filter((e): e is ReportEvent => e != null)
    .sort((a, b) => b.at.localeCompare(a.at));

  const stockLog = stockLogLines(params.logs, fromIso, toIso, params.pendingLogIds);

  const flags: ReportFlag[] = [];
  const cancelLogged = new Set<string>();
  const cancelledNumbers = new Set<string>();
  const editsPerOrder = new Map<string, ReportEvent[]>();
  let edits = 0;
  let editsDown = 0;
  let editsDownAmount = 0;
  let deletes = 0;
  let expenseEdits = 0;
  let expenseDeletes = 0;

  for (const ev of events) {
    const r = row(ev.byUid, ev.byName);
    const sale = ordersById.get(ev.entityId);
    const late = minutesBetween(sale?.createdAt, ev.at);
    const common = {
      logId: ev.id,
      at: ev.at,
      byUid: ev.byUid,
      byName: ev.byName,
      branchId: ev.branchId,
      orderId: ev.kind.startsWith("expense") ? undefined : ev.entityId,
      orderNumber: ev.orderNumber,
      minutesAfterSale: late,
    };
    switch (ev.kind) {
      case "edit": {
        edits += 1;
        r.edits += 1;
        const list = editsPerOrder.get(ev.entityId) ?? [];
        list.push(ev);
        editsPerOrder.set(ev.entityId, list);
        if (ev.before != null && ev.after != null && ev.after < ev.before) {
          const cut = money(ev.before - ev.after);
          editsDown += 1;
          editsDownAmount += cut;
          r.editsDown += 1;
          r.editsDownAmount += cut;
          flags.push({
            ...common,
            id: `flag_${ev.id}`,
            level: "high",
            kind: "editDown",
            amount: cut,
            before: ev.before,
            after: ev.after,
          });
        }
        break;
      }
      case "cancel": {
        cancelLogged.add(ev.entityId);
        if (ev.orderNumber != null) cancelledNumbers.add(`${ev.branchId}#${ev.orderNumber}`);
        r.cancelsDone += 1;
        r.cancelsDoneAmount += ev.amount ?? sale?.total ?? 0;
        if (sale && sale.createdBy === ev.byUid) r.cancelsOwn += 1;
        // A sale from before the period isn't loaded: the log's own copy of the bill says how it was paid.
        const before = ev.log.change?.kind === "order" ? ev.log.change.before : undefined;
        const cash = (sale?.paymentMethod ?? before?.paymentMethod) === "cash";
        flags.push({
          ...common,
          id: `flag_${ev.id}`,
          level: cash ? "high" : "medium",
          kind: cash ? "cancelCash" : "cancel",
          amount: ev.amount ?? sale?.total,
        });
        break;
      }
      case "refund":
        r.refunds += 1;
        r.refundAmount += ev.amount ?? 0;
        flags.push({ ...common, id: `flag_${ev.id}`, level: "medium", kind: "refund", amount: ev.amount });
        break;
      case "delete":
        deletes += 1;
        r.deletes += 1;
        r.deletesAmount += ev.amount ?? 0;
        flags.push({ ...common, id: `flag_${ev.id}`, level: "high", kind: "delete", amount: ev.amount });
        break;
      case "expenseEdit":
        expenseEdits += 1;
        r.expenseEdits += 1;
        if (ev.before == null || ev.after == null || ev.before !== ev.after) {
          flags.push({
            ...common,
            id: `flag_${ev.id}`,
            level: "medium",
            kind: "expenseEdit",
            before: ev.before,
            after: ev.after,
          });
        }
        break;
      case "expenseDelete":
        expenseDeletes += 1;
        r.expenseDeletes += 1;
        flags.push({ ...common, id: `flag_${ev.id}`, level: "medium", kind: "expenseDelete", amount: ev.amount });
        break;
      default:
        break;
    }
  }

  // A cancel whose log line is missing (e.g. the log write failed) still shows.
  for (const o of day.dayOrders) {
    if (o.status !== "cancelled" || cancelLogged.has(o.id)) continue;
    if (cancelledNumbers.has(`${o.branchId}#${o.orderNumber}`)) continue;
    const by = o.updatedBy ?? o.createdBy;
    const byName = o.updatedByName ?? o.createdByName;
    const at = o.updatedAt ?? o.createdAt;
    const cash = o.paymentMethod === "cash";
    flags.push({
      id: `flag_cancel_${o.id}`,
      level: cash ? "high" : "medium",
      kind: cash ? "cancelCash" : "cancel",
      at,
      byUid: by,
      byName,
      branchId: o.branchId,
      orderId: o.id,
      orderNumber: o.orderNumber,
      amount: o.total,
      minutesAfterSale: minutesBetween(o.createdAt, at),
    });
  }

  for (const [orderId, list] of editsPerOrder) {
    if (list.length < 2) continue;
    const last = list[0];
    flags.push({
      id: `flag_edits_${orderId}`,
      level: "low",
      kind: "manyEdits",
      at: last.at,
      byUid: last.byUid,
      byName: last.byName,
      branchId: last.branchId,
      logId: last.id,
      orderId,
      orderNumber: last.orderNumber,
      count: list.length,
    });
  }

  for (const o of active) {
    const disc = o.discountAmount ?? 0;
    if (disc <= 0) continue;
    const base = o.subtotal > 0 ? o.subtotal : o.total + disc;
    const share = base > 0 ? disc / base : 0;
    if (share < BIG_DISCOUNT_SHARE && disc < BIG_DISCOUNT_RUPEES) continue;
    flags.push({
      id: `flag_disc_${o.id}`,
      level: "medium",
      kind: "bigDiscount",
      at: o.createdAt,
      byUid: o.createdBy,
      byName: o.createdByName,
      branchId: o.branchId,
      orderId: o.id,
      orderNumber: o.orderNumber,
      amount: disc,
      count: Math.round(share * 100),
    });
  }

  // Cash drawer days in the period.
  const drawers: DrawerRow[] = params.drawers
    .filter((d) => d.date >= fromKey && d.date <= params.toKey)
    .sort((a, b) => b.date.localeCompare(a.date) || b.openedAt.localeCompare(a.openedAt))
    .map((d) => ({
      id: d.id,
      branchId: d.branchId,
      date: d.date,
      openingBalance: d.openingBalance,
      expectedCash: d.expectedCash,
      closingCount: d.closingCount,
      difference: d.difference,
      status: d.status,
      autoClosed: Boolean(d.autoClosed),
      openedByName: d.openedByName,
      closedByName: d.closedByName,
    }));
  let drawerShort = 0;
  let drawerOver = 0;
  for (const d of drawers) {
    if (d.status !== "closed") continue;
    const base = {
      at: params.drawers.find((x) => x.id === d.id)?.closedAt ?? `${d.date}T23:59:59.000Z`,
      byName: d.closedByName,
      byUid: params.drawers.find((x) => x.id === d.id)?.closedBy,
      branchId: d.branchId,
      date: d.date,
    };
    if (d.autoClosed || d.closingCount == null) {
      flags.push({ ...base, id: `flag_drawer_${d.id}`, level: "medium", kind: "drawerNotCounted" });
      continue;
    }
    const diff = d.difference ?? 0;
    if (diff < 0) {
      drawerShort += -diff;
      flags.push({
        ...base,
        id: `flag_drawer_${d.id}`,
        level: "high",
        kind: "drawerShort",
        amount: money(-diff),
        before: d.expectedCash ?? undefined,
        after: d.closingCount ?? undefined,
      });
    } else if (diff > 0) {
      drawerOver += diff;
      flags.push({
        ...base,
        id: `flag_drawer_${d.id}`,
        level: "low",
        kind: "drawerOver",
        amount: money(diff),
        before: d.expectedCash ?? undefined,
        after: d.closingCount ?? undefined,
      });
    }
  }

  // An owner's own changes are notes, not something to check.
  for (const f of flags) {
    if (f.level !== "low" && isOwner(f.byUid) && f.kind !== "drawerShort") f.level = "low";
    if (f.level !== "low" && f.byUid) {
      const r = staff.get(f.byUid);
      if (r) r.flags += 1;
    }
  }
  flags.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.at.localeCompare(a.at));

  const TYPE_ORDER: TypeRow["type"][] = ["dine-in", "takeaway", "delivery", "unset"];
  const byType = TYPE_ORDER.map((t) => typeMap.get(t)).filter((x): x is TypeRow => !!x);
  const byPayment = (["cash", "card", "digital"] as const).map(
    (m) => payMap.get(m) ?? { method: m, orders: 0, amount: 0 },
  );

  const gross = day.totalSales;
  const net = money(gross - day.totalRefunds);
  return {
    day,
    items: computeItemSales(day.dayOrders, params.catalog),
    totals: {
      orders: day.totalOrders,
      gross,
      refunds: day.totalRefunds,
      refundOrders,
      net,
      avgOrder: day.totalOrders > 0 ? money(gross / day.totalOrders) : 0,
      discountAmount: day.totalDiscounts,
      discountOrders,
      cancelledOrders: day.cancelledOrders,
      cancelledAmount: day.cancelledAmount,
      expenses: day.totalExpenses,
      expenseCount: day.dayExpenses.length,
      netAfterExpenses: day.netProfit,
      edits,
      editsDown,
      editsDownAmount: money(editsDownAmount),
      deletes,
      expenseEdits,
      expenseDeletes,
    },
    byType,
    byPayment,
    staff: [...staff.values()].sort((a, b) => b.sales - a.sales || b.flags - a.flags),
    drawers,
    drawerShort: money(drawerShort),
    drawerOver: money(drawerOver),
    flags,
    events,
    stockLog,
    ...(params.stock && params.from
      ? {
          stock: summarizeStockDay({
            items: params.stock.items,
            movements: params.stock.movements,
            fromIso: params.from.toISOString(),
            toIso: params.to.toISOString(),
          }),
        }
      : {}),
  };
}
