import type { Order } from "@bravobites/domain";
import { formatOrderNumber } from "@bravobites/domain";

/** Shared by admin Orders and the POS day report so both filter the same way. */
export type OrderStatusFilter =
  | "all"
  | "original"
  | "edited"
  | "cancelled"
  | "refunded"
  | "discounted";

/** Order #, cashier name/email, or item name. */
export function matchesOrderSearch(order: Order, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;

  const digits = q.replace(/[^0-9]/g, "");
  const numStr = String(order.orderNumber);
  const padded = formatOrderNumber(order.orderNumber).toLowerCase();
  if (digits && (numStr.includes(digits) || padded.includes(digits))) return true;
  if (padded.includes(q) || `#${padded}`.includes(q) || numStr.includes(q)) {
    return true;
  }
  // Number printed on the receipt, when sync had to renumber the sale.
  if (order.printedOrderNumber != null) {
    const printed = String(order.printedOrderNumber);
    const printedPadded = formatOrderNumber(order.printedOrderNumber).toLowerCase();
    if (digits && (printed.includes(digits) || printedPadded.includes(digits))) return true;
  }

  const cashier = `${order.createdByName || ""} ${order.createdByEmail || ""}`.toLowerCase();
  if (cashier.includes(q)) return true;

  const customer = `${order.customerName || ""} ${order.customerPhone || ""} ${order.tableNumber || ""}`.toLowerCase();
  if (customer.includes(q)) return true;

  return order.items.some((item) => {
    const hay = `${item.productName} ${item.variationLabel || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export function matchesOrderStatus(o: Order, filter: OrderStatusFilter): boolean {
  const refunded = Boolean(o.refundAmount && o.refundAmount > 0);
  switch (filter) {
    case "all":
      return true;
    case "cancelled":
      return o.status === "cancelled";
    case "edited":
      return Boolean(o.updatedAt) && o.status !== "cancelled";
    case "refunded":
      return refunded;
    case "discounted":
      return Boolean(o.discountAmount && o.discountAmount > 0) && o.status !== "cancelled";
    case "original":
      return !o.updatedAt && o.status !== "cancelled" && !refunded;
  }
}
