import { describe, expect, it } from "vitest";
import {
  amendOrderTotals,
  computeOrderTotals,
  isFullyRefunded,
  orderRefundableAmount,
  orderTaxPercent,
  resolveDiscountAmount,
} from "./totals";

describe("computeOrderTotals", () => {
  it("taxes the full subtotal, adds delivery, then subtracts discount", () => {
    const t = computeOrderTotals({
      subtotal: 1000,
      taxPercent: 10,
      deliveryCharges: 50,
      discountType: "percent",
      discountValue: 10,
    });
    expect(t.taxAmount).toBe(100);
    expect(t.discountAmount).toBe(100);
    expect(t.total).toBe(1050);
  });

  it("does not drop the discount when amending items", () => {
    const next = amendOrderTotals(
      {
        taxPercent: 10,
        deliveryCharges: 0,
        discountType: "percent",
        discountValue: 10,
        discountAmount: 100,
      },
      2000,
    );
    expect(next.taxAmount).toBe(200);
    expect(next.discountAmount).toBe(200);
    expect(next.total).toBe(2000);
  });

  it("derives tax % from a legacy absolute so edits stay consistent", () => {
    expect(orderTaxPercent({ taxAmount: 100, subtotal: 1000 })).toBe(10);
    expect(resolveDiscountAmount(500, { discountType: "fixed", discountValue: 800 })).toBe(500);
  });
});

describe("refund remaining", () => {
  it("caps remaining and treats a full refund as done", () => {
    expect(orderRefundableAmount({ total: 1000, refundAmount: 400 })).toBe(600);
    expect(isFullyRefunded({ total: 1000, refundAmount: 1000 })).toBe(true);
    expect(isFullyRefunded({ total: 1000, refundAmount: 200 })).toBe(false);
  });
});
