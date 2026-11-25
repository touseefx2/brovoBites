import { money } from "./money";
import { unpaidAtTime } from "./payment";
import type { Expense, Order, PaymentMethod } from "./types";

/**
 * Day-end math shared by admin Day report, the dashboard, the owner report
 * and the POS report popup — one formula everywhere, so offline POS numbers
 * match the cloud ones.
 *
 * Sales are accrual: a sale counts on its createdAt day whether or not it was
 * paid. The payment buckets (cash / card / online) only hold money received
 * by the end of the window; a sale still unpaid then is in the "Payment
 * pending" bucket, so cash + card + online + pending = net sales. Credit
 * sales of earlier days paid inside the window are "Old bills collected":
 * money in, but not sales of this window.
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
  /** Their sales still payment pending at the window end (net of refunds). */
  pending: number;
};

/** Old bills collected in the window, by the method they were paid with. */
export type CollectedBills = {
  cash: number;
  card: number;
  digital: number;
  total: number;
  /** The orders (sold before the window, paid inside it), newest payment first. */
  orders: Order[];
};

export type DayReport = {
  /** Orders in range (incl. cancelled), newest first. */
  dayOrders: Order[];
  /** Expenses in range, newest first. */
  dayExpenses: Expense[];
  totalSales: number;
  /** Received by the window end, net of refunds. */
  cashSales: number;
  cardSales: number;
  digitalSales: number;
  /** Sales of the window still unpaid at its end (net of refunds) — cash + card + digital + this = net sales. */
  pendingSales: number;
  pendingOrders: number;
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
  /** Credit sales of earlier days paid in the window — NOT in the sales above. */
  collected: CollectedBills;
};

/** The bucket a sale's money is in at `windowEndIso`: its method, or "pending" when still unpaid then. */
export function paymentBucket(o: Order, windowEndIso: string): PaymentMethod | "pending" {
  return unpaidAtTime(o, windowEndIso) ? "pending" : o.paymentMethod;
}

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

/**
 * Credit sales sold before `from` and paid in [from, to] (not cancelled, not
 * set back to pending). `orders` come from the screen's own list and from a
 * "paid in range" query; the same id is counted once, the later list winning
 * (pass the list with this PC's queued changes applied last).
 */
export function collectedBills(lists: Order[][], from: Date, to: Date, staffFilter = "all"): CollectedBills {
  const byId = new Map<string, Order>();
  for (const list of lists) for (const o of list) byId.set(o.id, o);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const orders = [...byId.values()]
    .filter((o) => {
      if (o.status === "cancelled" || o.paymentStatus === "pending" || !o.paidAt) return false;
      const paid = new Date(o.paidAt).getTime();
      if (!(paid >= fromMs && paid <= toMs)) return false;
      if (!(new Date(o.createdAt).getTime() < fromMs)) return false;
      return staffFilter === "all" || o.paidBy === staffFilter;
    })
    .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));
  const out: CollectedBills = { cash: 0, card: 0, digital: 0, total: 0, orders };
  for (const o of orders) {
    const net = Math.max(0, o.total - (o.refundAmount ?? 0));
    if (o.paymentMethod === "cash" || o.paymentMethod === "card" || o.paymentMethod === "digital") {
      out[o.paymentMethod] += net;
    }
    out.total += net;
  }
  out.cash = money(out.cash);
  out.card = money(out.card);
  out.digital = money(out.digital);
  out.total = money(out.total);
  return out;
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
  /**
   * Orders paid in the window (a "paid in range" query) — for "Old bills
   * collected". Optional: without it only `orders` are looked at.
   */
  collectedOrders?: Order[];
}): DayReport {
  const staffFilter = params.staffFilter ?? "all";
  const endIso = params.to.toISOString();

  let dayOrders = ordersInRange(params.orders, params.from, params.to);
  if (staffFilter !== "all") {
    dayOrders = dayOrders.filter((o) => o.createdBy === staffFilter);
  }
  dayOrders = [...dayOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const activeOrders = dayOrders.filter((o) => o.status !== "cancelled");
  const cancelledOrders = dayOrders.filter((o) => o.status === "cancelled");

  const net = (o: Order) => o.total - (o.refundAmount ?? 0);
  const inBucket = (b: PaymentMethod | "pending") => activeOrders.filter((o) => paymentBucket(o, endIso) === b);
  const sumNet = (list: Order[]) => list.reduce((s, o) => s + net(o), 0);
  const totalSales = activeOrders.reduce((s, o) => s + o.total, 0);
  const cashSales = sumNet(inBucket("cash"));
  const cardSales = sumNet(inBucket("card"));
  const digitalSales = sumNet(inBucket("digital"));
  const pendingList = inBucket("pending");
  const pendingSales = sumNet(pendingList);

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
        pending: 0,
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
    const bucket = paymentBucket(o, endIso);
    if (bucket === "pending") row.pending += net(o);
    else if (bucket === "cash") row.cash += net(o);
    else if (bucket === "card") row.card += net(o);
    else if (bucket === "digital") row.digital += net(o);
  }

  return {
    dayOrders,
    dayExpenses,
    totalSales,
    cashSales,
    cardSales,
    digitalSales,
    pendingSales,
    pendingOrders: pendingList.length,
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
    collected: collectedBills([params.collectedOrders ?? [], params.orders], params.from, params.to, staffFilter),
  };
}
