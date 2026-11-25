import type { Order } from "@bravobites/domain";
import type { Firestore } from "firebase-admin/firestore";
import { asOrder } from "@/lib/firestore-parse";

/**
 * Server (Admin SDK) twins of the payment queries in lib/firestore.ts, for the
 * daily owner-report email. Same filters, same parsing.
 */

/**
 * Orders of a branch marked paid in [sinceIso, untilIso] — the report's
 * "Old bills collected" (credit sales paid later; the caller leaves out the
 * ones sold in the same window). Needs the (branchId, paidAt) index; throws
 * when it is missing, like every other email query.
 */
export async function fetchPaidInRangeAdmin(
  db: Firestore,
  branchId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Order[]> {
  const snap = await db
    .collection("orders")
    .where("branchId", "==", branchId)
    .where("paidAt", ">=", sinceIso)
    .where("paidAt", "<=", untilIso)
    .get();
  return snap.docs
    .map((d) => asOrder(d.id, d.data()))
    .filter((o) => o.paymentStatus !== "pending" && !!o.paidAt);
}

/** Every payment-pending order of a branch, any date (cancelled left out), newest first. */
export async function fetchUnpaidOrdersAdmin(db: Firestore, branchId: string): Promise<Order[]> {
  const snap = await db
    .collection("orders")
    .where("branchId", "==", branchId)
    .where("paymentStatus", "==", "pending")
    .get();
  return snap.docs
    .map((d) => asOrder(d.id, d.data()))
    .filter((o) => o.paymentStatus === "pending" && o.status !== "cancelled")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
