import { describe, expect, it } from "vitest";
import { drawerCash, drawerWindow, refundsInWindow, type DrawerWindow } from "./drawer-cash";
import { money } from "./money";
import type { CashDrawerSession, Expense, Order } from "./types";

// Business day 2026-11-25: 10:00Z → next day 05:00Z (a plain window is enough here).
const DAY = "2026-11-25";
const FROM = Date.parse("2026-11-25T10:00:00.000Z");
const TO = Date.parse("2026-11-26T05:00:00.000Z");
const WIN: DrawerWindow = { fromMs: FROM, toMs: TO, reopened: false };
const TODAY = "2026-11-25T12:00:00.000Z";
const LATER = "2026-11-25T15:00:00.000Z";
const YESTERDAY = "2026-11-24T12:00:00.000Z";
const OWNER = "owner1";

let n = 0;
function order(over: Partial<Order>): Order {
  n += 1;
  return {
    id: `o${n}`,
    branchId: "b1",
    orderNumber: n,
    items: [],
    subtotal: over.total ?? 1000,
    total: 1000,
    paymentMethod: "cash",
    status: "completed",
    createdBy: "staff1",
    createdByName: "Ali",
    createdAt: TODAY,
    ...over,
  };
}

function expense(over: Partial<Expense>): Expense {
  return {
    id: `e${n++}`,
    branchId: "b1",
    category: "other",
    description: "",
    amount: 200,
    date: DAY,
    createdBy: "staff1",
    createdByName: "Ali",
    createdAt: TODAY,
    ...over,
  };
}

function run(orders: Order[], expenses: Expense[] = [], opening = 0) {
  return drawerCash({
    dateKey: DAY,
    window: WIN,
    dayStartMs: FROM,
    ownerUids: new Set([OWNER]),
    orders,
    expenses,
    openingBalance: opening,
  });
}

/** The drawer formula from before payment status existed — legacy orders must match it exactly. */
function legacyExpected(orders: Order[], expenses: Expense[], opening: number): number {
  const inWindow = (iso: string | undefined) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return t >= FROM && t <= TO;
  };
  const cash = orders.filter((o) => o.paymentMethod === "cash");
  const sold = cash.filter((o) => inWindow(o.createdAt)).reduce((s, o) => s + o.total, 0);
  const earlier = (o: Order) => new Date(o.createdAt).getTime() < FROM;
  const cancelled = cash
    .filter(
      (o) =>
        o.status === "cancelled" &&
        inWindow(o.updatedAt ?? o.createdAt) &&
        (!earlier(o) || (!!o.updatedBy && o.updatedBy === OWNER)),
    )
    .reduce((s, o) => s + Math.max(0, o.total - (o.refundAmount ?? 0)), 0);
  const refunds = cash.reduce((s, o) => s + refundsInWindow(o, inWindow), 0);
  const exp = expenses.filter((e) => e.date === DAY).reduce((s, e) => s + e.amount, 0);
  return money(opening + sold - cancelled - exp - refunds);
}

describe("drawerCash — legacy orders (no payment fields)", () => {
  const legacy = [
    order({ total: 1000 }),
    order({ total: 500, paymentMethod: "card" }),
    order({ total: 300, status: "cancelled", updatedAt: LATER, updatedBy: "staff1" }),
    order({ total: 800, refundAmount: 100, refunds: [{ amount: 100, at: LATER }] }),
    // Earlier day's sale cancelled today: by staff ignored, by owner counted.
    order({ total: 400, createdAt: YESTERDAY, status: "cancelled", updatedAt: LATER, updatedBy: "staff1" }),
    order({ total: 250, createdAt: YESTERDAY, status: "cancelled", updatedAt: LATER, updatedBy: OWNER }),
    // Earlier day's sale refunded today.
    order({ total: 600, createdAt: YESTERDAY, refundAmount: 50, refunds: [{ amount: 50, at: LATER }] }),
  ];
  const expenses = [expense({ amount: 200 }), expense({ amount: 999, date: "2026-11-24" })];

  it("matches the old formula exactly", () => {
    const r = run(legacy, expenses, 5000);
    expect(r.expected).toBe(legacyExpected(legacy, expenses, 5000));
    // 5000 + (1000 + 300 + 800 − 300 − 250) − 200 − (100 + 50)
    expect(r.expected).toBe(6200);
    expect(r.collected).toBe(0);
    expect(r.unpaid).toBe(0);
    expect(r.unpaidOrders).toBe(0);
  });
});

describe("drawerCash — payment pending / paid later", () => {
  it("a cash sale still payment pending is not in the drawer", () => {
    const pending = order({ total: 700, paymentStatus: "pending", customerName: "Bilal" });
    const r = run([order({ total: 1000 }), pending]);
    expect(r.expected).toBe(1000);
    expect(r.cashSales).toBe(1000);
    expect(r.unpaid).toBe(700);
    expect(r.unpaidOrders).toBe(1);
  });

  it("sold pending and paid in cash the same day counts once (as collected)", () => {
    const o = order({ total: 700, createdAt: TODAY, paidAt: LATER, paidBy: "staff2" });
    const r = run([o]);
    expect(r.cashSales).toBe(0);
    expect(r.collected).toBe(700);
    expect(r.expected).toBe(700);
    expect(r.unpaid).toBe(0);
  });

  it("an earlier day's credit sale paid today in cash counts today, not on its sale day", () => {
    const o = order({ total: 900, createdAt: YESTERDAY, paidAt: LATER });
    expect(run([o]).expected).toBe(900);
    expect(run([o]).collectedOrders).toBe(1);
    // Yesterday's drawer: neither sold (credit) nor collected there.
    const y = drawerCash({
      dateKey: "2026-11-24",
      window: { fromMs: Date.parse("2026-11-24T10:00:00.000Z"), toMs: Date.parse("2026-11-25T05:00:00.000Z"), reopened: false },
      dayStartMs: Date.parse("2026-11-24T10:00:00.000Z"),
      ownerUids: new Set(),
      orders: [o],
      expenses: [],
      openingBalance: 0,
    });
    expect(y.expected).toBe(0);
  });

  it("paid later by card never reaches the cash drawer", () => {
    const o = order({ total: 900, createdAt: YESTERDAY, paidAt: LATER, paymentMethod: "card" });
    expect(run([o]).expected).toBe(0);
  });

  it("a cancelled pending order hands no cash back", () => {
    const o = order({ total: 500, paymentStatus: "pending", status: "cancelled", updatedAt: LATER, updatedBy: "staff1" });
    const r = run([order({ total: 1000 }), o]);
    expect(r.expected).toBe(1000);
    expect(r.unpaid).toBe(0);
  });

  it("an old credit sale paid today and cancelled today by staff nets to nothing", () => {
    const o = order({
      total: 500,
      createdAt: "2026-11-22T12:00:00.000Z",
      paidAt: TODAY,
      status: "cancelled",
      updatedAt: LATER,
      updatedBy: "staff1",
    });
    const r = run([o]);
    expect(r.collected).toBe(500);
    expect(r.expected).toBe(0);
  });

  it("a credit sale paid on an earlier day and cancelled today by staff is ignored (like an earlier sale)", () => {
    const o = order({
      total: 500,
      createdAt: "2026-11-22T12:00:00.000Z",
      paidAt: YESTERDAY,
      status: "cancelled",
      updatedAt: LATER,
      updatedBy: "staff1",
    });
    expect(run([o]).expected).toBe(0);
    // …but counted when an owner cancelled it.
    expect(run([{ ...o, updatedBy: OWNER }]).expected).toBe(-500);
  });

  it("an order paid at checkout then set back to pending by the owner leaves the drawer", () => {
    const o = order({ total: 600, paymentStatus: "pending" });
    expect(run([o]).expected).toBe(0);
  });

  it("refunds after a later payment leave at their own time", () => {
    const o = order({
      total: 1000,
      createdAt: YESTERDAY,
      paidAt: TODAY,
      refundAmount: 200,
      refunds: [{ amount: 200, at: LATER }],
    });
    expect(run([o]).expected).toBe(800);
  });
});

describe("drawerWindow", () => {
  const hours = { start: "15:00", end: "10:00" } as const;
  const session = (over: Partial<CashDrawerSession>): CashDrawerSession => ({
    id: "s1",
    branchId: "b1",
    date: DAY,
    openingBalance: 0,
    closingCount: null,
    expectedCash: null,
    difference: null,
    status: "open",
    openedBy: "u",
    openedByName: "U",
    openedAt: TODAY,
    ...over,
  });
  it("starts at the day start, or at an earlier close the same day", () => {
    const open = session({ openedAt: LATER });
    const w = drawerWindow(open, [open], hours);
    expect(w.reopened).toBe(false);
    const closed = session({ id: "s0", status: "closed", closedAt: "2026-11-25T14:00:00.000Z" });
    const w2 = drawerWindow(open, [open, closed], hours);
    expect(w2.reopened).toBe(true);
    expect(w2.fromMs).toBe(Date.parse("2026-11-25T14:00:00.000Z"));
    expect(w2.toMs).toBe(w.toMs);
  });
});
