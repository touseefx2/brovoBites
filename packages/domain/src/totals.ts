import type { DiscountType } from "./types";
import { money } from "./money";

/**
 * Single source of truth for order money math.
 *
 * Checkout and post-sale amendments must agree, otherwise editing a discounted
 * order silently changes what the customer was charged.
 *
 * Order of operations: tax is charged on the full subtotal, delivery is added
 * untaxed, and the discount comes off last.
 */
export interface OrderTotalsInput {
  subtotal: number;
  /** Preferred: tax is re-derived from this whenever the subtotal changes. */
  taxPercent?: number | null;
  /** Fallback for orders saved before taxPercent was stored. */
  taxAmount?: number | null;
  deliveryCharges?: number | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
  /** Fallback for orders saved without discountType/discountValue. */
  discountAmount?: number | null;
}

export interface OrderTotals {
  subtotal: number;
  taxAmount: number;
  deliveryCharges: number;
  discountAmount: number;
  total: number;
}

function positive(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** Discount in rupees, never more than the subtotal. */
export function resolveDiscountAmount(
  subtotal: number,
  input: Pick<OrderTotalsInput, "discountType" | "discountValue" | "discountAmount">,
): number {
  const base = positive(subtotal);
  const value = positive(input.discountValue);

  if (input.discountType && value > 0) {
    if (input.discountType === "percent") {
      return money((base * Math.min(100, value)) / 100);
    }
    return money(Math.min(value, base));
  }

  const legacy = positive(input.discountAmount);
  return legacy > 0 ? money(Math.min(legacy, base)) : 0;
}

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const subtotal = money(positive(input.subtotal));
  const deliveryCharges = money(positive(input.deliveryCharges));

  const taxPercent = positive(input.taxPercent);
  const taxAmount =
    taxPercent > 0
      ? money((subtotal * taxPercent) / 100)
      : money(positive(input.taxAmount));

  const discountAmount = resolveDiscountAmount(subtotal, input);
  const total = Math.max(
    0,
    money(subtotal + taxAmount + deliveryCharges - discountAmount),
  );

  return { subtotal, taxAmount, deliveryCharges, discountAmount, total };
}

/**
 * Tax % for an order. Orders created before taxPercent was stored only kept the
 * rupee amount, so derive the rate from the original subtotal instead of
 * carrying a stale absolute through an edit.
 */
export function orderTaxPercent(order: {
  taxPercent?: number | null;
  taxAmount?: number | null;
  subtotal?: number | null;
}): number {
  const stored = positive(order.taxPercent);
  if (stored > 0) return stored;

  const amount = positive(order.taxAmount);
  const subtotal = positive(order.subtotal);
  if (amount > 0 && subtotal > 0) return (amount / subtotal) * 100;
  return 0;
}

export interface AmendableOrder {
  subtotal?: number | null;
  taxPercent?: number | null;
  taxAmount?: number | null;
  deliveryCharges?: number | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
  discountAmount?: number | null;
}

/**
 * Recompute an existing order's totals against a new subtotal.
 *
 * Used when items are added or removed after checkout so the discount is
 * re-applied and the tax follows the new subtotal instead of staying frozen.
 */
export function amendOrderTotals(
  order: AmendableOrder,
  nextSubtotal: number,
): OrderTotals {
  return computeOrderTotals({
    subtotal: nextSubtotal,
    taxPercent: orderTaxPercent(order),
    deliveryCharges: order.deliveryCharges,
    discountType: order.discountType,
    discountValue: order.discountValue,
    discountAmount: order.discountAmount,
  });
}

/** Total already refunded on an order. */
export function orderRefundedAmount(order: { refundAmount?: number | null }): number {
  return money(positive(order.refundAmount));
}

/** How much of an order can still be refunded. */
export function orderRefundableAmount(order: {
  total: number;
  refundAmount?: number | null;
}): number {
  return Math.max(0, money(positive(order.total) - orderRefundedAmount(order)));
}

export function isFullyRefunded(order: {
  total: number;
  refundAmount?: number | null;
}): boolean {
  return orderRefundableAmount(order) <= 0;
}
