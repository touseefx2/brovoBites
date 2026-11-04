import type { ActivityEntityType, ActivityLog } from "@bravobites/domain";
import { formatPkr } from "@bravobites/domain";
import { expenseLogSnapshot, expenseSnapshotLabel, orderLogSnapshot } from "@/lib/firestore";
import { listAllQueuedExpenses, listAllQueuedMutations } from "./db";
import {
  expenseOpKind,
  expenseOpTarget,
  isExpenseActive,
  isMutationActive,
} from "./types";

/**
 * Activity rows for every action kept on this PC (pending and synced) — the
 * offline copy of the activity log. Ids match the log the sync writes
 * (`act_<opId>`), so a cloud copy and the local one never show twice.
 * `pendingIds` = not on the cloud yet (yellow dot).
 */
export async function listLocalActivityLogs(
  entityType: ActivityEntityType,
): Promise<{ logs: ActivityLog[]; pendingIds: Set<string> }> {
  const pendingIds = new Set<string>();
  if (entityType === "order") {
    // "dropped" = owner deleted/cancelled first; the edit never happened.
    const muts = (await listAllQueuedMutations()).filter((m) => m.outcome !== "dropped");
    for (const m of muts) if (isMutationActive(m)) pendingIds.add(`act_${m.mutationId}`);
    const logs = muts.map((m): ActivityLog => {
      const o = m.orderBefore;
      const by = m.user.displayName || m.user.email;
      const num = `#${o.orderNumber}`;
      const summary =
        m.kind === "edit"
          ? `Edited order ${num} · ${formatPkr(o.total)} → ${formatPkr(m.orderAfter.total)} · by ${by}`
          : m.kind === "cancel"
            ? `Cancelled order ${num} · ${formatPkr(o.total)} · by ${by}`
            : m.kind === "delete"
              ? `Deleted order ${num} · ${formatPkr(o.total)} · by ${by}`
              : `Refunded order ${num} · ${formatPkr(m.refundAmount ?? 0)} · by ${by}`;
      return {
        id: `act_${m.mutationId}`,
        branchId: o.branchId,
        entityType: "order",
        entityId: m.orderId,
        action:
          m.kind === "edit" || m.kind === "refund"
            ? "update"
            : m.kind === "cancel"
              ? "cancel"
              : "delete",
        summary,
        ...(m.kind === "refund" && m.refundReason ? { detail: m.refundReason } : {}),
        change: {
          kind: "order",
          before: orderLogSnapshot(o),
          ...(m.kind === "edit" ? { after: orderLogSnapshot(m.orderAfter) } : {}),
          ...(m.kind === "refund"
            ? {
                refund: {
                  amount: m.refundAmount ?? 0,
                  ...(m.refundReason ? { reason: m.refundReason } : {}),
                  totalRefunded: (o.refundAmount ?? 0) + (m.refundAmount ?? 0),
                },
              }
            : {}),
        },
        createdBy: m.user.uid,
        createdByName: by,
        createdAt: m.occurredAt ?? new Date(m.enqueuedAt).toISOString(),
      };
    });
    return { logs, pendingIds };
  }

  if (entityType === "expense") {
    const ops = await listAllQueuedExpenses();
    for (const e of ops) if (isExpenseActive(e)) pendingIds.add(`act_${e.clientId}`);
    const logs = ops.map((e): ActivityLog => {
      const kind = expenseOpKind(e);
      const actorUid = e.actor?.uid ?? e.createdBy;
      const actorName = e.actor
        ? e.actor.displayName || e.actor.email
        : e.createdByName;
      const label = expenseSnapshotLabel(e);
      return {
        id: `act_${e.clientId}`,
        branchId: e.branchId,
        entityType: "expense",
        entityId: expenseOpTarget(e),
        action: kind,
        summary:
          kind === "create"
            ? `Added expense · ${formatPkr(e.amount)}`
            : kind === "update"
              ? `Edited expense → ${formatPkr(e.amount)}`
              : `Deleted expense ${label}`,
        ...(kind === "create"
          ? { detail: label }
          : kind === "update" && e.previous
            ? { detail: `Before: ${expenseSnapshotLabel(e.previous)} → After: ${label}` }
            : {}),
        change: {
          kind: "expense",
          ...(kind === "create" ? { after: expenseLogSnapshot(e) } : {}),
          ...(kind === "update"
            ? { ...(e.previous ? { before: expenseLogSnapshot(e.previous) } : {}), after: expenseLogSnapshot(e) }
            : {}),
          ...(kind === "delete" ? { before: expenseLogSnapshot(e) } : {}),
        },
        createdBy: actorUid,
        createdByName: actorName,
        createdAt: e.occurredAt ?? e.createdAt,
      };
    });
    return { logs, pendingIds };
  }

  return { logs: [], pendingIds };
}
