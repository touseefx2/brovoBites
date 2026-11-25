import type { Order, PaymentMethod } from "./types";

/**
 * Payment status on orders (Paid / Payment pending).
 *
 * `paymentStatus: "pending"` = the customer pays later (credit sale). Absent
 * means paid — every order from before this field existed reads as paid.
 * `paidAt` is set only when a pending order is marked paid, so
 * "paidAt present and not pending" = a credit sale that was paid later.
 *
 * Code names say "unpaid" on purpose: "pending" already means "not synced yet"
 * all over the app.
 */

type PaymentFields = Pick<Order, "paymentStatus" | "paidAt">;

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "card", "digital"];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === "cash" || value === "card" || value === "digital";
}

/** The customer still owes this order (a cancelled order owes nothing). */
export function isOrderUnpaid(o: PaymentFields & Pick<Order, "status">): boolean {
  return o.paymentStatus === "pending" && o.status !== "cancelled";
}

/**
 * Sold on credit — pending now, or paid later. The money for these did NOT
 * come in at createdAt (it comes in at paidAt, if ever).
 */
export function isCreditSale(o: PaymentFields): boolean {
  return o.paymentStatus === "pending" || !!o.paidAt;
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Was the order still unpaid at `iso` (e.g. the end of a report window)?
 * Pending now, or paid only after that moment.
 */
export function unpaidAtTime(o: PaymentFields, iso: string): boolean {
  if (o.paymentStatus === "pending") return true;
  if (!o.paidAt) return false;
  const paid = ms(o.paidAt);
  const at = ms(iso);
  if (Number.isNaN(paid) || Number.isNaN(at)) return o.paidAt > iso;
  return paid > at;
}

/** A credit sale whose payment came in inside the window (`inWindow(paidAt)`). */
export function paidInWindow(o: PaymentFields, inWindow: (iso: string) => boolean): boolean {
  return o.paymentStatus !== "pending" && !!o.paidAt && inWindow(o.paidAt);
}
