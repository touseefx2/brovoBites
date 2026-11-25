import type { AppUser } from "@bravobites/domain";
import {
  listActiveQueuedExpenses,
  listActiveQueuedMutations,
  listActiveQueuedOrders,
  listAllQueuedMutations,
} from "./db";
import { expenseOpKind, expenseOpTarget, type QueuedMutation } from "./types";

/** How long a dropped payment change / refund stays in the sheet. */
export const DROPPED_VISIBLE_MS = 3 * 24 * 60 * 60 * 1000;

/** A change the cloud refused that the cashier must know about (cash may be in the drawer). */
export function visibleDropReason(m: QueuedMutation): SyncIssueReason | null {
  if (m.outcome !== "dropped") return null;
  if (m.kind === "payment") return "paymentDropped";
  if (m.kind === "refund" && m.droppedReason === "unpaid") return "refundUnpaid";
  return null;
}

/** Dropped change still shown in the sync-status sheet (last few days). */
export function isDropVisible(m: QueuedMutation, now = Date.now()): boolean {
  return visibleDropReason(m) != null && (m.syncedAt ?? m.updatedAt) >= now - DROPPED_VISIBLE_MS;
}

/** Shown and not yet acknowledged ("Got it") — keeps the sync pill red. */
export function isDropUnseen(m: QueuedMutation, now = Date.now()): boolean {
  return isDropVisible(m, now) && m.droppedSeenAt == null;
}

export type SyncIssueReason =
  /** No internet right now. */
  | "offline"
  /** Fine — just in line, uploads by itself. */
  | "queued"
  /** An order change waits for its sale to reach the cloud first. */
  | "afterSale"
  /** Delete, or no longer allowed for the person who did it: only an owner login can upload it. */
  | "ownerOnly"
  /** Someone else's work: uploads when that person or an owner signs in here. */
  | "otherUser"
  /** Staff time limit passed on the server: the owner must log in here. */
  | "timeLimit"
  /** Waits behind an earlier failed change to the same item. */
  | "afterEarlier"
  /** Upload failed for another reason — retried every minute. */
  | "retry"
  /** The server never answered (line dead while the PC says online) — retried every minute. */
  | "noAnswer"
  /**
   * Payment change NOT saved: the order was already paid / set pending on
   * another device, cancelled or deleted (i18n: paymentChangeDropped). Check the drawer.
   */
  | "paymentDropped"
  /** Refund NOT saved: the order's payment is pending (i18n: refundUnpaidDropped). */
  | "refundUnpaid";

export type SyncIssue = {
  id: string;
  kind: "sale" | "change" | "expense";
  /** Mutation / expense action. */
  action?: "edit" | "cancel" | "delete" | "refund" | "payment" | "create" | "update";
  /** action "payment": mark paid, or set back to payment pending. */
  paymentTo?: "paid" | "pending";
  /** Dropped by the cloud (never applied) — state is "failed" (needs attention). */
  dropped?: boolean;
  /** Dropped and already acknowledged ("Got it") — no longer turns the pill red. */
  seen?: boolean;
  orderNumber?: number;
  amount?: number;
  /** When it happened (ISO). */
  at: string;
  by: string;
  state: "waiting" | "uploading" | "failed";
  reason: SyncIssueReason;
  /** Raw error text for "retry". */
  error?: string;
};

const isPermission = (code?: string) =>
  code === "permission-denied" || code === "firestore/permission-denied";
/** Upload failed: the server never answered (timeout), or it said no. */
const failReason = (code?: string): SyncIssueReason =>
  code === "deadline-exceeded" ? "noAnswer" : "retry";

/**
 * Everything on this PC still waiting for the cloud, with a plain reason and
 * what to do — read by the sync-status popup in the POS report.
 */
export async function listSyncIssues(
  signedIn: AppUser | null,
  online: boolean,
): Promise<SyncIssue[]> {
  const [orders, muts, exps, allMuts] = await Promise.all([
    listActiveQueuedOrders(),
    listActiveQueuedMutations(),
    listActiveQueuedExpenses(),
    listAllQueuedMutations(),
  ]);
  const isOwner = signedIn?.role === "owner";
  const issues: SyncIssue[] = [];
  // Whoever is signed in uploads everyone's saved work, under the name of the
  // person who made it (uploadedBy stamp). Rows the rules refuse (maker
  // inactive, permission off, 72h passed) wait for an owner login.

  for (const q of orders) {
    const failed = q.status === "failed" || q.stockStatus === "failed";
    const uploading = q.status === "syncing" || q.stockStatus === "syncing";
    let reason: SyncIssueReason = online ? "queued" : "offline";
    if (failed) {
      if (isPermission(q.lastErrorCode) && !isOwner) reason = "ownerOnly";
      else reason = online ? failReason(q.lastErrorCode) : "offline";
    }
    issues.push({
      id: q.clientId,
      kind: "sale",
      orderNumber: q.orderNumber,
      amount: q.total,
      at: q.createdAt,
      by: q.createdByName,
      state: failed ? "failed" : uploading ? "uploading" : "waiting",
      reason,
      error: q.lastError,
    });
  }

  const pendingSales = new Set(orders.map((q) => q.clientId));
  // A payment change waits only for the sale doc, not its stock (sync.ts).
  const saleDocWaiting = new Set(
    orders.filter((q) => q.status !== "synced").map((q) => q.clientId),
  );
  const failedOrders = new Set<string>();
  for (const m of muts) {
    const actorName = m.user.displayName || m.user.email;
    let reason: SyncIssueReason = online ? "queued" : "offline";
    if (m.status === "failed") {
      if (isPermission(m.lastErrorCode) && !isOwner) {
        reason = m.user.role === "owner" ? "ownerOnly" : "timeLimit";
      }
      else reason = online ? failReason(m.lastErrorCode) : "offline";
      failedOrders.add(m.orderId);
    } else if (
      (m.kind === "delete" || (m.kind === "payment" && m.paymentTo === "pending")) &&
      !isOwner
    ) {
      reason = "ownerOnly";
    } else if ((m.kind === "payment" ? saleDocWaiting : pendingSales).has(m.orderId)) {
      reason = "afterSale";
    } else if (failedOrders.has(m.orderId)) {
      reason = "afterEarlier";
    }
    issues.push({
      id: m.mutationId,
      kind: "change",
      action: m.kind,
      ...(m.kind === "payment" && m.paymentTo ? { paymentTo: m.paymentTo } : {}),
      orderNumber: m.orderBefore.orderNumber,
      amount: m.kind === "refund" ? m.refundAmount : m.orderAfter.total,
      at: m.occurredAt ?? new Date(m.enqueuedAt).toISOString(),
      by: actorName,
      state: m.status === "failed" ? "failed" : m.status === "syncing" ? "uploading" : "waiting",
      reason,
      error: m.lastError,
    });
  }

  // Never dropped silently: a payment change (or a refund of an unpaid order)
  // the cloud refused stays here a few days — the cash may be in the drawer.
  const now = Date.now();
  for (const m of allMuts) {
    const reason = visibleDropReason(m);
    if (!reason || !isDropVisible(m, now)) continue;
    issues.push({
      id: m.mutationId,
      kind: "change",
      action: m.kind,
      ...(m.kind === "payment" && m.paymentTo ? { paymentTo: m.paymentTo } : {}),
      dropped: true,
      ...(m.droppedSeenAt != null ? { seen: true } : {}),
      orderNumber: m.orderBefore.orderNumber,
      amount: m.kind === "refund" ? m.refundAmount : m.orderAfter.total,
      at: m.occurredAt ?? new Date(m.enqueuedAt).toISOString(),
      by: m.user.displayName || m.user.email,
      state: "failed",
      reason,
    });
  }

  const failedExpenses = new Set<string>();
  for (const e of exps) {
    const kind = expenseOpKind(e);
    const target = expenseOpTarget(e);
    const actorName = e.actor ? e.actor.displayName || e.actor.email : e.createdByName;
    let reason: SyncIssueReason = online ? "queued" : "offline";
    if (e.status === "failed") {
      if (isPermission(e.lastErrorCode) && !isOwner) reason = "ownerOnly";
      else reason = online ? failReason(e.lastErrorCode) : "offline";
      failedExpenses.add(target);
    } else if (failedExpenses.has(target)) {
      reason = "afterEarlier";
    }
    issues.push({
      id: e.clientId,
      kind: "expense",
      action: kind,
      amount: e.amount,
      at: e.occurredAt ?? e.createdAt,
      by: actorName,
      state: e.status === "failed" ? "failed" : e.status === "syncing" ? "uploading" : "waiting",
      reason,
      error: e.lastError,
    });
  }

  // Problems first, then oldest first.
  return issues.sort((a, b) =>
    a.state === b.state
      ? a.at.localeCompare(b.at)
      : a.state === "failed"
        ? -1
        : b.state === "failed"
          ? 1
          : 0,
  );
}
