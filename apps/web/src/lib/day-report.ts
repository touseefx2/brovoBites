import type { Expense, Order } from "@bravobites/domain";
import { money } from "@bravobites/domain";

/**
 * Day-end math shared by admin Day report, Item sales and the POS report
 * popup — one formula everywhere, so offline POS numbers match the cloud ones.
 */

export type DayReportStaffRow = {
  key: string;
  uid: string;
  name: string;
  email: string;
  branchId: string;
  branchName: string;
  orders: number;
  total: number;
  refunds: number;
  cancelledOrders: number;
  cancelledAmount: number;
  cash: number;
  card: number;
  digital: number;
};

export type DayReport = {
  /** Orders in range (incl. cancelled), newest first. */
  dayOrders: Order[];
  /** Expenses in range, newest first. */
  dayExpenses: Expense[];
  totalSales: number;
  cashSales: number;
  cardSales: number;
  digitalSales: number;
  totalDiscounts: number;
  totalTax: number;
  totalDelivery: number;
  totalRefunds: number;
  cancelledAmount: number;
  totalExpenses: number;
  netProfit: number;
  totalOrders: number;
  cancelledOrders: number;
  staffBreakdown: DayReportStaffRow[];
};

export function ordersInRange(
  orders: Order[],
  from: Date | null,
  to: Date | null,
): Order[] {
  return orders.filter((o) => {
    const ts = new Date(o.createdAt).getTime();
    if (from && ts < from.getTime()) return false;
    if (to && ts > to.getTime()) return false;
    return true;
  });
}

export function computeDayReport(params: {
  orders: Order[];
  expenses: Expense[];
  /** Business-day window for orders (startOfBusinessDay / endOfBusinessDay). */
  from: Date;
  to: Date;
  /** Business-day keys (YYYY-MM-DD) for expenses, which carry their own `date`. */
  fromKey: string;
  toKey: string;
  /** uid or "all" */
  staffFilter?: string;
  branchNameFor?: (branchId: string) => string | undefined;
}): DayReport {
  const staffFilter = params.staffFilter ?? "all";

  let dayOrders = ordersInRange(params.orders, params.from, params.to);
  if (staffFilter !== "all") {
    dayOrders = dayOrders.filter((o) => o.createdBy === staffFilter);
  }
  dayOrders = [...dayOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const activeOrders = dayOrders.filter((o) => o.status !== "cancelled");
  const cancelledOrders = dayOrders.filter((o) => o.status === "cancelled");

  const net = (o: Order) => o.total - (o.refundAmount ?? 0);
  const totalSales = activeOrders.reduce((s, o) => s + o.total, 0);
  const cashSales = activeOrders.filter((o) => o.paymentMethod === "cash").reduce((s, o) => s + net(o), 0);
  const cardSales = activeOrders.filter((o) => o.paymentMethod === "card").reduce((s, o) => s + net(o), 0);
  const digitalSales = activeOrders.filter((o) => o.paymentMethod === "digital").reduce((s, o) => s + net(o), 0);

  const totalDiscounts = activeOrders.reduce((s, o) => s + (o.discountAmount ?? 0), 0);
  const totalTax = activeOrders.reduce((s, o) => s + (o.taxAmount ?? 0), 0);
  const totalDelivery = activeOrders.reduce((s, o) => s + (o.deliveryCharges ?? 0), 0);
  const totalRefunds = activeOrders.reduce((s, o) => s + (o.refundAmount ?? 0), 0);
  const cancelledAmount = cancelledOrders.reduce((s, o) => s + o.total, 0);

  let dayExpenses = params.expenses.filter((e) => {
    const day = (e.date || e.createdAt || "").slice(0, 10);
    if (day < params.fromKey) return false;
    if (day > params.toKey) return false;
    return true;
  });
  if (staffFilter !== "all") {
    dayExpenses = dayExpenses.filter((e) => e.createdBy === staffFilter);
  }
  dayExpenses = [...dayExpenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totalExpenses = dayExpenses.reduce((s, e) => s + e.amount, 0);

  // Staff breakdown — one row per staff × branch
  const staffMap = new Map<string, DayReportStaffRow>();
  for (const o of dayOrders) {
    const key = `${o.createdBy}::${o.branchId}`;
    const branchName =
      o.branchName || params.branchNameFor?.(o.branchId) || o.branchId;
    let row = staffMap.get(key);
    if (!row) {
      row = {
        key,
        uid: o.createdBy,
        name: o.createdByName || o.createdByEmail || o.createdBy,
        email: o.createdByEmail || "",
        branchId: o.branchId,
        branchName,
        orders: 0,
        total: 0,
        refunds: 0,
        cancelledOrders: 0,
        cancelledAmount: 0,
        cash: 0,
        card: 0,
        digital: 0,
      };
      staffMap.set(key, row);
    }
    if (o.status === "cancelled") {
      row.cancelledOrders += 1;
      row.cancelledAmount += o.total;
      continue;
    }
    row.orders += 1;
    row.total += o.total;
    row.refunds += o.refundAmount ?? 0;
    if (o.paymentMethod === "cash") row.cash += net(o);
    else if (o.paymentMethod === "card") row.card += net(o);
    else if (o.paymentMethod === "digital") row.digital += net(o);
  }

  return {
    dayOrders,
    dayExpenses,
    totalSales,
    cashSales,
    cardSales,
    digitalSales,
    totalDiscounts,
    totalTax,
    totalDelivery,
    totalRefunds,
    cancelledAmount,
    totalExpenses,
    netProfit: money(totalSales - totalExpenses - totalRefunds),
    totalOrders: activeOrders.length,
    cancelledOrders: cancelledOrders.length,
    staffBreakdown: Array.from(staffMap.values()).sort((a, b) => b.total - a.total),
  };
}

export interface ItemStat {
  key: string;
  productId: string;
  productName: string;
  variationLabel?: string;
  qty: number;
  revenue: number;
}

/** Qty + line revenue per item (variation-aware) over non-cancelled orders. Sorted by qty. */
export function computeItemSales(
  orders: Order[],
  from: Date | null,
  to: Date | null,
): ItemStat[] {
  const active = ordersInRange(orders, from, to).filter(
    (o) => o.status !== "cancelled",
  );
  const map = new Map<string, ItemStat>();
  for (const order of active) {
    for (const item of order.items) {
      const key = item.variationId
        ? `${item.productId}__${item.variationId}`
        : item.productId;
      const existing = map.get(key);
      if (existing) {
        existing.qty += item.qty;
        existing.revenue += item.lineTotal;
      } else {
        map.set(key, {
          key,
          productId: item.productId,
          productName: item.productName,
          variationLabel: item.variationLabel,
          qty: item.qty,
          revenue: item.lineTotal,
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
}

export type SalesBridgeKey =
  | "items"
  | "discount"
  | "tax"
  | "delivery"
  | "other"
  | "gross"
  | "refunds"
  | "net";

export type SalesBridgeRow = {
  key: SalesBridgeKey;
  value: number;
  sign?: "+" | "−";
  /** Subtotal row (gross / net). */
  total?: boolean;
};

/**
 * Why item sales ≠ total sale: items total − discount + tax + delivery =
 * gross sale; − refunds = net sale. Cancelled orders are in neither. Any
 * leftover (rounding, legacy data) gets its own "other" row so the steps
 * always add up exactly.
 */
export function computeSalesBridge(report: DayReport, itemRevenue: number): SalesBridgeRow[] {
  const rows: SalesBridgeRow[] = [{ key: "items", value: itemRevenue }];
  if (report.totalDiscounts > 0) rows.push({ key: "discount", value: report.totalDiscounts, sign: "−" });
  if (report.totalTax > 0) rows.push({ key: "tax", value: report.totalTax, sign: "+" });
  if (report.totalDelivery > 0) rows.push({ key: "delivery", value: report.totalDelivery, sign: "+" });
  const expected =
    itemRevenue - report.totalDiscounts + report.totalTax + report.totalDelivery;
  const residual = money(report.totalSales - expected);
  if (Math.abs(residual) >= 1) {
    rows.push({ key: "other", value: Math.abs(residual), sign: residual > 0 ? "+" : "−" });
  }
  rows.push({ key: "gross", value: report.totalSales, total: true });
  if (report.totalRefunds > 0) rows.push({ key: "refunds", value: report.totalRefunds, sign: "−" });
  rows.push({ key: "net", value: report.totalSales - report.totalRefunds, total: true });
  return rows;
}
