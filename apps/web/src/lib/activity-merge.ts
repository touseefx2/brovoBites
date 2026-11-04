import type { ActivityLog } from "@bravobites/domain";

/**
 * Cloud activity logs + this PC's local ones (pending and synced copies).
 * Same id = same action: a pending local row wins (yellow dot), otherwise the
 * cloud copy wins. Local rows get the same branch / staff scope as the query.
 * Shared by the admin Activity page and the POS activity popup.
 */
export function mergeActivityLogs(params: {
  cloud: ActivityLog[];
  local: ActivityLog[];
  pendingIds: Set<string>;
  /** Branch id, or "all". */
  branchId: string;
  /** Only this user's rows (staff), or undefined for everyone. */
  createdBy?: string;
}): ActivityLog[] {
  const local = params.local.filter((l) => {
    if (params.branchId !== "all" && l.branchId !== params.branchId) return false;
    if (params.createdBy && l.createdBy !== params.createdBy) return false;
    return true;
  });
  const byId = new Map<string, ActivityLog>();
  for (const l of local) byId.set(l.id, l);
  for (const c of params.cloud) {
    if (params.pendingIds.has(c.id) && byId.has(c.id)) continue;
    byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
