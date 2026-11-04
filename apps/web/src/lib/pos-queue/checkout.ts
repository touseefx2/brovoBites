import {
  computeOrderTotals,
  toOrderItems,
  type Order,
} from "@bravobites/domain";
import { orderItemsTotal } from "@/lib/firestore";
import { assertPcClockUsable, takeClockStamp } from "@/lib/shop-clock";
import { allocateAndEnqueueOrder } from "./db";
import type { EnqueueCheckoutInput, QueuedOrder } from "./types";
import { queuedToOrder } from "./types";

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Persist sale locally and return the Order used for print / UI.
 * Does not touch Firestore — caller must kickSync afterwards.
 * Intentionally does not await the network (instant checkout / print).
 */
export async function enqueueCheckout(
  input: EnqueueCheckoutInput,
): Promise<Order> {
  assertPcClockUsable();
  const items = toOrderItems(input.lines);
  const taxPercent = input.taxPercent ?? 0;
  const totals = computeOrderTotals({
    subtotal: orderItemsTotal(items),
    taxPercent,
    taxAmount: input.taxAmount,
    deliveryCharges: input.deliveryCharges,
    discountType: input.discountType,
    discountValue: input.discountValue,
    discountAmount: input.discountAmount,
  });

  const customerName = (input.customerName || "").trim();
  const customerPhone = (input.customerPhone || "").trim();
  const deliveryAddress =
    input.orderType === "delivery"
      ? (input.deliveryAddress || "").trim()
      : "";
  const tableNumber =
    input.orderType === "dine-in" ? (input.tableNumber || "").trim() : "";
  const branchLabel = (input.branchName || "").trim();

  const clientId = newClientId();
  const { at, stamp } = takeClockStamp();
  const now = at.getTime();
  const createdAt = at.toISOString();

  // Number + enqueue are one atomic step — see allocateAndEnqueueOrder.
  const queued = await allocateAndEnqueueOrder((orderNumber): QueuedOrder => ({
    clientId,
    orderNumber,
    branchId: input.branchId,
    ...(branchLabel ? { branchName: branchLabel } : {}),
    orderType: input.orderType,
    ...(customerName ? { customerName } : {}),
    ...(customerPhone ? { customerPhone } : {}),
    ...(deliveryAddress ? { deliveryAddress } : {}),
    ...(tableNumber ? { tableNumber } : {}),
    items,
    subtotal: totals.subtotal,
    ...(totals.taxAmount > 0 ? { taxAmount: totals.taxAmount } : {}),
    ...(taxPercent > 0 ? { taxPercent } : {}),
    ...(totals.deliveryCharges > 0
      ? { deliveryCharges: totals.deliveryCharges }
      : {}),
    ...(totals.discountAmount > 0
      ? {
          discountType: input.discountType,
          discountValue: input.discountValue,
          discountAmount: totals.discountAmount,
        }
      : {}),
    total: totals.total,
    paymentMethod: input.paymentMethod,
    createdBy: input.user.uid,
    createdByName: input.user.displayName || input.user.email,
    createdByEmail: input.user.email || "",
    createdAt,
    clock: stamp,
    status: "pending",
    stockStatus: "pending",
    enqueuedAt: now,
    updatedAt: now,
  }));

  return queuedToOrder(queued);
}
