import type {
  AppUser,
  DiscountType,
  Order,
  OrderItem,
  OrderType,
  PaymentMethod,
} from "@bravobites/domain";
import {
  amendOrderTotals,
  money,
  orderRefundableAmount,
  orderRefundedAmount,
} from "@bravobites/domain";
import { orderItemsTotal, sanitizeOrderItems } from "@/lib/firestore";
import { shopNow } from "@/lib/shop-clock";
import { getQueuedOrder, listActiveQueuedMutations, putQueuedMutation } from "./db";
import type { QueuedMutation } from "./types";

function newMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mut_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function enqueueMutation(
  m: Omit<
    QueuedMutation,
    "mutationId" | "occurredAt" | "enqueuedAt" | "updatedAt" | "status"
  > & {
    status?: QueuedMutation["status"];
    occurredAt?: string;
  },
): Promise<QueuedMutation> {
  const now = Date.now();
  const row: QueuedMutation = {
    ...m,
    mutationId: newMutationId(),
    occurredAt: m.occurredAt ?? shopNow().toISOString(),
    status: m.status ?? "pending",
    enqueuedAt: now,
    updatedAt: now,
  };
  await putQueuedMutation(row);
  return row;
}

/**
 * The order as this PC will leave it: the result of its latest change still in
 * the queue, else the order passed in. Screens can show an older copy (admin
 * lists don't merge the queue) — a new change must build on what is already
 * queued: a second refund of the same money, or a cancel that misses an edit's
 * items, must not slip through.
 */
async function latestQueuedOrder(order: Order): Promise<Order> {
  const pending = (await listActiveQueuedMutations())
    .filter((m) => m.orderId === order.id)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  const last = pending[pending.length - 1];
  if (!last) return order;
  if (last.kind === "delete") throw new Error("This order is already deleted on this PC.");
  return last.orderAfter;
}

/** True while checkout create is still waiting for Firestore/stock. */
export async function isOrderCreatePending(orderId: string): Promise<boolean> {
  const q = await getQueuedOrder(orderId);
  if (!q) return false;
  return q.status !== "synced" || q.stockStatus !== "synced";
}

export type LocalEditInput = {
  order: Order;
  items: OrderItem[];
  user: AppUser;
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  tableNumber: string;
  deliveryFee: number;
  discountType?: DiscountType | null;
  discountValue?: number | null;
};

function buildEditedOrder(input: LocalEditInput): Order {
  const items = sanitizeOrderItems(input.items);
  const orderType = input.orderType;
  const deliveryCharges =
    orderType === "delivery" ? money(input.deliveryFee) : 0;
  const discountProvided = input.discountType !== undefined;
  const nextDiscountType = discountProvided
    ? input.discountType
    : input.order.discountType;
  const nextDiscountValue = discountProvided
    ? money(input.discountValue ?? 0)
    : money(input.order.discountValue ?? 0);
  const hasDiscount = Boolean(nextDiscountType) && nextDiscountValue > 0;
  const totals = amendOrderTotals(
    {
      ...input.order,
      deliveryCharges,
      discountType: hasDiscount ? nextDiscountType : null,
      discountValue: hasDiscount ? nextDiscountValue : 0,
      discountAmount: hasDiscount ? input.order.discountAmount : 0,
    },
    orderItemsTotal(items),
  );
  const updatedAt = new Date().toISOString();
  return {
    ...input.order,
    items,
    orderType,
    paymentMethod: input.paymentMethod,
    customerName: input.customerName.trim() || undefined,
    customerPhone: input.customerPhone.trim() || undefined,
    deliveryAddress:
      orderType === "delivery"
        ? input.deliveryAddress.trim() || undefined
        : undefined,
    tableNumber:
      orderType === "dine-in"
        ? input.tableNumber.trim() || undefined
        : undefined,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount > 0 ? totals.taxAmount : undefined,
    deliveryCharges: deliveryCharges > 0 ? deliveryCharges : undefined,
    ...(hasDiscount
      ? {
          discountType: nextDiscountType as DiscountType,
          discountValue: nextDiscountValue,
          discountAmount: totals.discountAmount,
        }
      : {
          discountType: undefined,
          discountValue: undefined,
          discountAmount: undefined,
        }),
    total: totals.total,
    updatedAt,
    updatedBy: input.user.uid,
    updatedByName: input.user.displayName || input.user.email,
  };
}

/**
 * Offline-safe edit / cancel / delete — design rules:
 * - The queued sale itself is never patched or dropped locally. It always
 *   reaches the cloud, then the change follows as its own mutation, so the
 *   cloud keeps the order, the cancel and the activity log (same as online —
 *   an offline sale can't vanish by cancelling it before sync).
 * - sync.ts runs a mutation only after its order is fully synced (order +
 *   stock), so a cancel/delete always restores stock that was really deducted.
 */

/** Queue an edit. Returns orderAfter for UI. Caller should kickSync(). */
export async function enqueueOrderEdit(input: LocalEditInput): Promise<Order> {
  const order = await latestQueuedOrder(input.order);
  if (order.status === "cancelled") throw new Error("This order is already cancelled.");
  if (orderRefundedAmount(order) > 0) {
    throw new Error("Refunded orders cannot be edited");
  }
  const orderAfter = buildEditedOrder({ ...input, order });
  await enqueueMutation({
    kind: "edit",
    orderId: order.id,
    orderBefore: order,
    orderAfter,
    user: input.user,
  });
  return orderAfter;
}

export async function enqueueOrderCancel(params: {
  order: Order;
  user: AppUser;
}): Promise<Order> {
  const order = await latestQueuedOrder(params.order);
  if (order.status === "cancelled") throw new Error("This order is already cancelled.");
  const orderAfter: Order = {
    ...order,
    status: "cancelled",
    updatedAt: shopNow().toISOString(),
    updatedBy: params.user.uid,
    updatedByName: params.user.displayName || params.user.email,
  };
  await enqueueMutation({
    kind: "cancel",
    orderId: order.id,
    orderBefore: order,
    orderAfter,
    user: params.user,
  });
  return orderAfter;
}

export async function enqueueOrderDelete(params: {
  order: Order;
  user: AppUser;
}): Promise<void> {
  const order = await latestQueuedOrder(params.order);
  await enqueueMutation({
    kind: "delete",
    orderId: order.id,
    orderBefore: order,
    orderAfter: order,
    user: params.user,
  });
}

export async function enqueueOrderRefund(params: {
  order: Order;
  user: AppUser;
  refundAmount: number;
  refundReason: string;
}): Promise<Order> {
  if (await isOrderCreatePending(params.order.id)) {
    throw new Error(
      "Wait until this sale finishes syncing before refunding.",
    );
  }
  const order = await latestQueuedOrder(params.order);
  if (order.status === "cancelled") throw new Error("Cancelled orders cannot be refunded");
  const amount = money(params.refundAmount);
  // Checked against what this PC already refunded — sync would drop the extra
  // silently, after the cash was handed over.
  if (amount > orderRefundableAmount(order)) {
    throw new Error("Refund amount is more than the remaining balance");
  }
  const lifetime = money((order.refundAmount ?? 0) + amount);
  const refundedAt = shopNow().toISOString();
  const orderAfter: Order = {
    ...order,
    refundAmount: lifetime,
    refundReason: params.refundReason.trim(),
    refundedAt,
    // Same entry sync writes (refundOrder) — the drawer counts it by its time.
    refunds: [...(order.refunds ?? []), { amount, at: refundedAt }],
    refundedBy: params.user.uid,
    refundedByName: params.user.displayName || params.user.email,
    refundCount: (order.refundCount ?? 0) + 1,
  };
  await enqueueMutation({
    kind: "refund",
    orderId: order.id,
    orderBefore: order,
    orderAfter,
    refundAmount: amount,
    refundReason: params.refundReason.trim(),
    user: params.user,
    // One time for the local entry and the uploaded one (refundOrder's occurredAt).
    occurredAt: refundedAt,
  });
  return orderAfter;
}
