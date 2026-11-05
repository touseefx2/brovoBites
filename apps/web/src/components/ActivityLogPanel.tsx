"use client";

import type { ActivityEntityType, ActivityLog } from "@bravobites/domain";
import { formatOrderDateTime } from "@bravobites/domain";
import { ActivityChangeView } from "@/components/ActivityChangeView";
import { useLocale } from "@/i18n/locale-context";
import { buildLogView, isRefundLog } from "@/lib/activity-change";

type Tone = "create" | "update" | "delete" | "cancel" | "refund";

function toneFor(log: ActivityLog, isRefund: boolean): Tone {
  if (isRefund) return "refund";
  if (log.action === "delete") return "delete";
  if (log.action === "cancel") return "cancel";
  if (log.action === "update") return "update";
  return "create";
}

const TONE: Record<Tone, { bar: string; label: string; dot: string }> = {
  create: {
    bar: "bg-emerald-600",
    label: "text-emerald-700",
    dot: "bg-emerald-600",
  },
  update: {
    bar: "bg-amber-500",
    label: "text-amber-700",
    dot: "bg-amber-500",
  },
  refund: {
    bar: "bg-orange-500",
    label: "text-orange-700",
    dot: "bg-orange-500",
  },
  cancel: {
    bar: "bg-rose-500",
    label: "text-rose-700",
    dot: "bg-rose-500",
  },
  delete: {
    bar: "bg-red-600",
    label: "text-red-700",
    dot: "bg-red-600",
  },
};

export function ActivityLogList({
  logs,
  branchNameFor,
  emptyLabel,
  pendingIds,
}: {
  logs: ActivityLog[];
  /** Kept for callers; every log shows by its own type. */
  entityType?: ActivityEntityType;
  branchNameFor?: (branchId: string) => string | undefined;
  emptyLabel?: string;
  /** Logs still waiting in this PC's offline queue (yellow dot). */
  pendingIds?: Set<string>;
}) {
  const { t } = useLocale();

  const actionLabel = (log: ActivityLog, isRefund: boolean) => {
    if (isRefund) return t("activityRefund");
    if (log.action === "create") return t("activityCreate");
    if (log.action === "update") return t("activityUpdate");
    if (log.action === "delete") return t("activityDelete");
    return t("activityCancel");
  };

  if (logs.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--muted)] sm:px-5">
        {emptyLabel ?? t("noActivityYet")}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-stone-200/80">
      {logs.map((log) => {
        const isRefund = isRefundLog(log);
        const tone = toneFor(log, isRefund);
        const style = TONE[tone];
        const branchName = branchNameFor?.(log.branchId);
        const who = (log.createdByName || "—").trim() || "—";
        const view = buildLogView(log);
        const title =
          log.entityType === "order"
            ? view.orderNumber
              ? t("lgOrderNo").replace("{num}", String(view.orderNumber))
              : log.summary.replace(/\s·\s*by\s+.+$/i, "").split(/\s·\s/)[0]
            : t("lgExpense");

        return (
          <li
            key={log.id}
            className="relative px-3.5 py-2.5 transition hover:bg-[#fff7ee]/80 sm:px-4 sm:py-3"
          >
            <span
              className={`absolute inset-y-2 start-0 w-[3px] rounded-full ${style.bar}`}
              aria-hidden
            />

            <div className="min-w-0 space-y-1.5 ps-2.5">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${style.label}`}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${style.dot}`}
                      aria-hidden
                    />
                    {actionLabel(log, isRefund)}
                  </span>
                  <span className="text-stone-300" aria-hidden>
                    |
                  </span>
                  <time
                    className="text-[11px] font-medium tabular-nums text-[var(--ink)]/65 sm:text-xs"
                    dateTime={log.createdAt}
                    dir="ltr"
                  >
                    {formatOrderDateTime(log.createdAt)}
                  </time>
                  {pendingIds?.has(log.id) ? (
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-amber-400"
                      title={t("recentPendingLocal")}
                      aria-label={t("recentPendingLocal")}
                    />
                  ) : null}
                </div>
                <p className="text-[11px] font-semibold capitalize text-[var(--ink)]/80 sm:text-xs">
                  {who}
                  {branchName ? (
                    <span className="font-medium text-[var(--muted)]">
                      {" "}
                      · {branchName}
                    </span>
                  ) : null}
                </p>
              </div>

              {view.kind !== "other" ? (
                <>
                  <p className="text-[13px] font-bold leading-snug text-[var(--ink)] sm:text-sm">{title}</p>
                  <ActivityChangeView log={log} view={view} />
                </>
              ) : (
                <>
                  <p className="text-[13px] font-semibold leading-snug text-[var(--ink)] sm:text-sm">
                    {log.summary.replace(/\s·\s*by\s+.+$/i, "").trim()}
                  </p>
                  {log.detail ? (
                    <p className="text-[12px] font-medium leading-snug text-[var(--ink)]/75">
                      {log.detail}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
