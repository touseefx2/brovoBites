import { describe, expect, it } from "vitest";
import { isCreditSale, isOrderUnpaid, isPaymentMethod, paidInWindow, unpaidAtTime } from "./payment";
import { canMarkOrderPaid, canMarkOrderUnpaid } from "./access";
import type { AppUser, Order } from "./types";

const legacy: Pick<Order, "status" | "paymentStatus" | "paidAt"> = { status: "completed" };
const pending = { status: "completed" as const, paymentStatus: "pending" as const };
const paidLater = { status: "completed" as const, paidAt: "2026-11-20T10:00:00.000Z" };

describe("isOrderUnpaid", () => {
  it("legacy orders (no field) are paid", () => {
    expect(isOrderUnpaid(legacy)).toBe(false);
  });
  it("pending orders are unpaid", () => {
    expect(isOrderUnpaid(pending)).toBe(true);
  });
  it("a cancelled pending order owes nothing", () => {
    expect(isOrderUnpaid({ ...pending, status: "cancelled" })).toBe(false);
  });
  it("paid-later orders are paid", () => {
    expect(isOrderUnpaid(paidLater)).toBe(false);
  });
});

describe("isCreditSale", () => {
  it("is false for legacy / paid-at-checkout orders", () => {
    expect(isCreditSale(legacy)).toBe(false);
  });
  it("is true for pending and paid-later orders", () => {
    expect(isCreditSale(pending)).toBe(true);
    expect(isCreditSale(paidLater)).toBe(true);
  });
});

describe("unpaidAtTime", () => {
  it("pending is unpaid at any time", () => {
    expect(unpaidAtTime(pending, "2020-01-01T00:00:00.000Z")).toBe(true);
  });
  it("legacy orders are never unpaid", () => {
    expect(unpaidAtTime(legacy, "2026-11-25T00:00:00.000Z")).toBe(false);
  });
  it("paid later: unpaid before paidAt, paid at and after it", () => {
    expect(unpaidAtTime(paidLater, "2026-11-19T23:00:00.000Z")).toBe(true);
    expect(unpaidAtTime(paidLater, "2026-11-20T10:00:00.000Z")).toBe(false);
    expect(unpaidAtTime(paidLater, "2026-11-21T00:00:00.000Z")).toBe(false);
  });
  it("compares instants, not strings (offset ISO)", () => {
    // 15:00 +05:00 == 10:00Z
    expect(unpaidAtTime({ paidAt: "2026-11-20T15:00:00+05:00" }, "2026-11-20T09:59:00.000Z")).toBe(true);
    expect(unpaidAtTime({ paidAt: "2026-11-20T15:00:00+05:00" }, "2026-11-20T10:01:00.000Z")).toBe(false);
  });
});

describe("paidInWindow", () => {
  const nov20 = (iso: string) => iso.startsWith("2026-11-20");
  it("counts a paid-later order in its paid window only", () => {
    expect(paidInWindow(paidLater, nov20)).toBe(true);
    expect(paidInWindow(paidLater, (iso) => iso.startsWith("2026-11-21"))).toBe(false);
  });
  it("never counts pending or legacy orders", () => {
    expect(paidInWindow(pending, () => true)).toBe(false);
    expect(paidInWindow(legacy, () => true)).toBe(false);
  });
  it("ignores a stale paidAt on an order set back to pending", () => {
    expect(paidInWindow({ ...paidLater, paymentStatus: "pending" }, nov20)).toBe(false);
  });
});

describe("isPaymentMethod", () => {
  it("accepts only cash/card/digital", () => {
    expect(isPaymentMethod("cash")).toBe(true);
    expect(isPaymentMethod("card")).toBe(true);
    expect(isPaymentMethod("digital")).toBe(true);
    expect(isPaymentMethod("pending")).toBe(false);
    expect(isPaymentMethod(undefined)).toBe(false);
  });
});

function user(over: Partial<AppUser>): AppUser {
  return {
    uid: "u1",
    email: "a@b.c",
    displayName: "A",
    role: "staff",
    branchIds: ["b1"],
    isActive: true,
    ...over,
  } as AppUser;
}

describe("canMarkOrderPaid / canMarkOrderUnpaid", () => {
  const order = { branchId: "b1", status: "completed" as const, paymentStatus: "pending" as const };
  it("any active staff of the branch may mark a pending order paid", () => {
    expect(canMarkOrderPaid(user({}), order)).toBe(true);
    expect(canMarkOrderPaid(user({ role: "owner", branchIds: [] }), order)).toBe(true);
  });
  it("not staff of another branch, inactive users, cancelled or paid orders", () => {
    expect(canMarkOrderPaid(user({ branchIds: ["b2"] }), order)).toBe(false);
    expect(canMarkOrderPaid(user({ isActive: false }), order)).toBe(false);
    expect(canMarkOrderPaid(user({}), { ...order, status: "cancelled" })).toBe(false);
    expect(canMarkOrderPaid(user({}), { branchId: "b1", status: "completed" })).toBe(false);
  });
  it("only the owner may set a paid order back to pending", () => {
    const paid = { branchId: "b1", status: "completed" as const };
    expect(canMarkOrderUnpaid(user({}), paid)).toBe(false);
    expect(canMarkOrderUnpaid(user({ role: "owner" }), paid)).toBe(true);
    expect(canMarkOrderUnpaid(user({ role: "owner" }), order)).toBe(false);
    expect(canMarkOrderUnpaid(user({ role: "owner" }), { ...paid, status: "cancelled" })).toBe(false);
  });
  it("never sets a refunded order back to pending (a pending order has no refunds)", () => {
    const paid = { branchId: "b1", status: "completed" as const };
    expect(canMarkOrderUnpaid(user({ role: "owner" }), { ...paid, refundAmount: 200 })).toBe(false);
    expect(canMarkOrderUnpaid(user({ role: "owner" }), { ...paid, refundAmount: 0 })).toBe(true);
  });
});
