import { money } from "./money";
import { isCreditSale, isOrderUnpaid, paidInWindow } from "./payment";
import { endOfBusinessDay, startOfBusinessDay, type BusinessDayHours } from "./time";
import type { CashDrawerSession, Expense, Order } from "./types";

/**
 * Cash drawer math (admin Cash drawer page, its auto close). Pure, so the
 * same numbers are tested here and shown / saved there.
 */

export interface DrawerWindow {
  fromMs: number;
  toMs: number;
  /** A drawer reopened after an earlier close the same day (counts from that close). */
  reopened: boolean;
}

/**
 * Where a drawer's count starts: its business day's start — or, when a drawer
 * was already closed earlier that day, that close (a reopened drawer must not
 * count the same sales and expenses again).
 */
export function drawerWindow(
  session: CashDrawerSession,
  sessions: CashDrawerSession[],
  hours: BusinessDayHours,
): DrawerWindow {
  let fromMs = startOfBusinessDay(session.date, hours).getTime();
  const toMs = endOfBusinessDay(session.date, hours).getTime();
  const openedMs = new Date(session.openedAt).getTime();
  let reopened = false;
  for (const s of sessions) {
    if (s.id === session.id || s.date !== session.date) continue;
    if (s.status !== "closed" || !s.closedAt) continue;
    const closedMs = new Date(s.closedAt).getTime();
    if (closedMs <= openedMs && closedMs > fromMs) {
      fromMs = closedMs;
      reopened = true;
    }
  }
  return { fromMs, toMs, reopened };
}

/**
 * Cash refunded on this order inside the window, by each refund's own time.
 * Refunds from before that log only have the latest refundedAt: the amount the
 * log doesn't cover counts at that time — or on the sale's day once a newer
 * refund has taken over refundedAt.
 */
export function refundsInWindow(o: Order, inWindow: (iso: string | undefined) => boolean): number {
  const refunded = o.refundAmount ?? 0;
  let logged = 0;
  let sum = 0;
  for (const r of o.refunds ?? []) {
    // Never more than the order's refund total, whatever the log says.
    const amount = Math.min(r.amount, Math.max(0, money(refunded - logged)));
    logged += amount;
    if (inWindow(r.at)) sum += amount;
  }
  const unlogged = money(refunded - logged);
  if (unlogged > 0 && inWindow(o.refunds?.length ? o.createdAt : (o.refundedAt ?? o.createdAt))) {
    sum += unlogged;
  }
  return sum;
}

export interface DrawerCash {
  /** Cash sales paid at checkout in the window − cash handed back by cancels in the window. */
  cashSales: number;
  /** Credit sales (payment pending at checkout) paid in cash in the window, whatever day they were sold. */
  collected: number;
  collectedOrders: number;
  cashRefunds: number;
  cashExpenses: number;
  /** Cash sales of the window still payment pending — not in the drawer. */
  unpaid: number;
  unpaidOrders: number;
  expected: number;
}

function ms(iso: string | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Cash that should be in the drawer:
 *   opening
 *   + cash sales paid at checkout in the window (a credit sale is not: its
 *     cash did not come in at the sale)
 *   + credit sales paid in cash in the window (at paidAt, any sale day)
 *   − cash handed back in the window (refunds and cancels, whatever day the
 *     sale was — the cash leaves the drawer then; a cancel only hands back
 *     cash that came in: never for a still-unpaid order)
 *   − that day's expenses.
 * A sale cancelled in the same drawer nets to nothing. Orders without the
 * payment fields (every order before them) count exactly as before.
 */
export function drawerCash(params: {
  dateKey: string;
  window: DrawerWindow;
  /** Start of the drawer's business day. */
  dayStartMs: number;
  /**
   * Owners: a sale of an earlier business day cancelled now leaves this drawer
   * only when an owner cancelled it — in the app staff can't cancel an earlier
   * day's sale, so a staff-made one is ignored here. For a credit sale the
   * "day" is the day its cash came in (paidAt).
   */
  ownerUids: Set<string>;
  orders: Order[];
  expenses: Expense[];
  openingBalance: number;
}): DrawerCash {
  const { fromMs, toMs, reopened } = params.window;
  const inWindow = (iso: string | undefined) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return t >= fromMs && t <= toMs;
  };
  const cashOrders = params.orders.filter((o) => o.paymentMethod === "cash");

  const soldHere = cashOrders
    .filter((o) => !isCreditSale(o) && inWindow(o.createdAt))
    .reduce((s, o) => s + o.total, 0);

  // Paid later in cash (also ones cancelled after: the cancel takes it out at its own time).
  const collectedList = cashOrders.filter((o) => paidInWindow(o, inWindow));
  const collected = collectedList.reduce((s, o) => s + o.total, 0);

  // A cancel hands back what is left after refunds; it was done at updatedAt.
  const cancelledHere = cashOrders
    .filter((o) => {
      if (o.status !== "cancelled") return false;
      // Never paid: no cash came in, none goes back.
      if (o.paymentStatus === "pending") return false;
      const cancelAt = o.updatedAt ?? o.createdAt;
      if (!inWindow(cancelAt)) return false;
      // The cash came in at checkout, or at paidAt for a credit sale.
      const cashInAt = o.paidAt ?? o.createdAt;
      if (o.paidAt && ms(o.paidAt) > ms(cancelAt)) return false;
      const earlierDay = ms(cashInAt) < params.dayStartMs;
      return !earlierDay || (!!o.updatedBy && params.ownerUids.has(o.updatedBy));
    })
    .reduce((s, o) => s + Math.max(0, o.total - (o.refundAmount ?? 0)), 0);
  const cashSales = soldHere - cancelledHere;

  const cashRefunds = cashOrders.reduce((s, o) => s + refundsInWindow(o, inWindow), 0);

  const cashExpenses = params.expenses
    .filter(
      (e) =>
        (e.date || e.createdAt || "").slice(0, 10) === params.dateKey &&
        (!reopened || inWindow(e.createdAt)),
    )
    .reduce((s, e) => s + e.amount, 0);

  const unpaidList = cashOrders.filter((o) => isOrderUnpaid(o) && inWindow(o.createdAt));
  const unpaid = unpaidList.reduce((s, o) => s + Math.max(0, o.total - (o.refundAmount ?? 0)), 0);

  const expected = money(params.openingBalance + cashSales + collected - cashExpenses - cashRefunds);
  return {
    cashSales,
    collected: money(collected),
    collectedOrders: collectedList.length,
    cashRefunds,
    cashExpenses,
    unpaid: money(unpaid),
    unpaidOrders: unpaidList.length,
    expected,
  };
}
