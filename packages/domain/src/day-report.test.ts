import { describe, expect, it } from "vitest";
import { computeDayReport, paymentBucket } from "./day-report";
import type { Order } from "./types";

const FROM = new Date("2026-11-25T10:00:00.000Z");
const TO = new Date("2026-11-26T05:00:00.000Z");
const TODAY = "2026-11-25T12:00:00.000Z";
const LATER = "2026-11-25T15:00:00.000Z";
const AFTER_WINDOW = "2026-11-27T12:00:00.000Z";
const YESTERDAY = "2026-11-24T12:00:00.000Z";

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

function report(orders: Order[], collectedOrders?: Order[], staffFilter?: string) {
  return computeDayReport({
    orders,
    expenses: [],
    from: FROM,
    to: TO,
    fromKey: "2026-11-25",
    toKey: "2026-11-25",
    collectedOrders,
    staffFilter,
  });
}

const netSales = (r: ReturnType<typeof report>) => r.totalSales - r.totalRefunds;
const bucketSum = (r: ReturnType<typeof report>) => r.cashSales + r.cardSales + r.digitalSales + r.pendingSales;

describe("computeDayReport — legacy orders (no payment fields)", () => {
  const legacy = [
    order({ total: 1000 }),
    order({ total: 500, paymentMethod: "card", refundAmount: 100 }),
    order({ total: 300, paymentMethod: "digital" }),
    order({ total: 400, status: "cancelled" }),
    order({ total: 999, createdAt: YESTERDAY }),
  ];

  it("keeps the old totals and buckets", () => {
    const r = report(legacy);
    expect(r.totalSales).toBe(1800);
    expect(r.totalRefunds).toBe(100);
    expect(r.cashSales).toBe(1000);
    expect(r.cardSales).toBe(400);
    expect(r.digitalSales).toBe(300);
    expect(r.pendingSales).toBe(0);
    expect(r.pendingOrders).toBe(0);
    expect(r.cancelledAmount).toBe(400);
    expect(r.totalOrders).toBe(3);
    expect(r.netProfit).toBe(1700);
    expect(r.collected.total).toBe(0);
    expect(r.collected.orders).toEqual([]);
    expect(r.staffBreakdown[0]).toMatchObject({ cash: 1000, card: 400, digital: 300, pending: 0 });
    expect(bucketSum(r)).toBe(netSales(r));
  });
});

describe("computeDayReport — payment status", () => {
  it("a sale still unpaid at the window end is in the pending bucket, and the buckets add up to net sales", () => {
    const r = report([
      order({ total: 1000 }),
      order({ total: 700, paymentStatus: "pending" }),
      order({ total: 200, paymentMethod: "card" }),
    ]);
    expect(r.totalSales).toBe(1900);
    expect(r.cashSales).toBe(1000);
    expect(r.cardSales).toBe(200);
    expect(r.pendingSales).toBe(700);
    expect(r.pendingOrders).toBe(1);
    expect(bucketSum(r)).toBe(netSales(r));
    expect(r.staffBreakdown[0]).toMatchObject({ cash: 1000, card: 200, pending: 700, total: 1900 });
  });

  it("sold pending and paid later in the same window counts under its paid method", () => {
    const r = report([order({ total: 700, paymentMethod: "card", paidAt: LATER })]);
    expect(r.cardSales).toBe(700);
    expect(r.pendingSales).toBe(0);
    expect(r.collected.total).toBe(0);
  });

  it("paid only after the window end: still pending in this window", () => {
    const r = report([order({ total: 700, paidAt: AFTER_WINDOW })]);
    expect(r.cashSales).toBe(0);
    expect(r.pendingSales).toBe(700);
    expect(bucketSum(r)).toBe(netSales(r));
  });

  it("a cancelled pending order is in neither sales nor pending", () => {
    const r = report([order({ total: 700, paymentStatus: "pending", status: "cancelled" })]);
    expect(r.pendingSales).toBe(0);
    expect(r.totalSales).toBe(0);
    expect(r.cancelledAmount).toBe(700);
  });

  it("an earlier day's credit sale paid today is an old bill collected, not a sale", () => {
    const old = order({ total: 900, createdAt: YESTERDAY, paidAt: LATER, paymentMethod: "digital", paidBy: "staff2" });
    const r = report([order({ total: 1000 })], [old]);
    expect(r.totalSales).toBe(1000);
    expect(r.digitalSales).toBe(0);
    expect(r.collected).toMatchObject({ cash: 0, card: 0, digital: 900, total: 900 });
    expect(r.collected.orders.map((o) => o.id)).toEqual([old.id]);
    // The staff filter goes by who collected it.
    expect(report([], [old], "staff2").collected.total).toBe(900);
    expect(report([], [old], "staff1").collected.total).toBe(0);
  });

  it("old bills found in both lists count once; the screen's list (with local changes) wins", () => {
    const cloud = order({ id: "x1", total: 500, createdAt: YESTERDAY, paidAt: LATER });
    expect(report([cloud], [cloud]).collected.total).toBe(500);
    // Set back to pending on this PC, not synced yet: no longer collected.
    const local: Order = { ...cloud, paymentStatus: "pending", paidAt: undefined };
    expect(report([local], [cloud]).collected.total).toBe(0);
  });

  it("an old bill paid outside the window or cancelled is not collected", () => {
    const r = report(
      [],
      [
        order({ total: 500, createdAt: YESTERDAY, paidAt: AFTER_WINDOW }),
        order({ total: 500, createdAt: YESTERDAY, paidAt: LATER, status: "cancelled" }),
      ],
    );
    expect(r.collected.total).toBe(0);
  });

  it("paymentBucket", () => {
    expect(paymentBucket(order({ paymentMethod: "card" }), TO.toISOString())).toBe("card");
    expect(paymentBucket(order({ paymentStatus: "pending" }), TO.toISOString())).toBe("pending");
    expect(paymentBucket(order({ paidAt: AFTER_WINDOW }), TO.toISOString())).toBe("pending");
  });
});
