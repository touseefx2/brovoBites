"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ActivityEntityType, ActivityLog, AppUser, Branch, ShopSettings } from "@bravobites/domain";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  shiftBusinessDateKey,
  startOfBusinessMonthKey,
} from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { shopNow } from "@/lib/shop-clock";
import { LoadError, PageSpinner } from "@/components/Loading";
import { ActivityLogList } from "@/components/ActivityLogPanel";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import { listLocalActivityLogs, subscribeQueue } from "@/lib/pos-queue";
import { isRefundLog } from "@/lib/activity-change";
import { mergeActivityLogs } from "@/lib/activity-merge";
import {
  fetchBranches,
  fetchUsers,
  onActivityLogsSnapshot,
  onSettingsSnapshot,
} from "@/lib/firestore";

type DatePreset = "today" | "last7" | "month" | "all";
type ActionFilter = "all" | "create" | "update" | "cancel" | "delete" | "refund";

function parseEntityType(raw: string | null): ActivityEntityType {
  if (raw === "expense" || raw === "inventory" || raw === "order") return raw;
  return "order";
}

function toInputDate(d: Date, hours?: Parameters<typeof businessDateKey>[1]) {
  return businessDateKey(d, hours);
}

function staffLabel(
  u: { uid: string; displayName: string; email: string; role: string },
  meUid: string,
  meLabel: string,
) {
  if (u.uid === meUid) return meLabel;
  const name = (u.displayName || u.email || "—").trim();
  return u.role === "owner" ? `${name} (owner)` : name;
}

function ActivityPageInner() {
  const { t, locale } = useLocale();
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const isOwner = profile?.role === "owner";

  /** Locked to the screen that opened this tab (?type=order|expense|inventory). */
  const entityType = parseEntityType(searchParams.get("type"));

  const [branches, setBranches] = useState<Branch[]>([]);
  const [staffUsers, setStaffUsers] = useState<AppUser[]>([]);
  const [branchId, setBranchId] = useState<string>("all");
  /** Owner only: uid | "all". Default = owner (self) to keep reads focused. */
  const [createdByFilter, setCreatedByFilter] = useState<string>("");
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  /** This PC's own copy of its actions (pending ones get a yellow dot). */
  const [localLogs, setLocalLogs] = useState<ActivityLog[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [query, setQuery] = useState("");

  const dayHours = useMemo(
    () => businessDayHoursFromSettings(settings),
    [settings],
  );

  // Owner opens on everyone's changes (that's what they check); the date
  // filter keeps it to today, so it stays a small read.
  useEffect(() => {
    if (!isOwner || !profile?.uid) return;
    setCreatedByFilter((prev) => (prev ? prev : "all"));
  }, [isOwner, profile?.uid]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [b, users] = await Promise.all([
        fetchBranches(),
        isOwner ? fetchUsers() : Promise.resolve([] as AppUser[]),
      ]);
      const allowed = isOwner
        ? b.filter((x) => x.isActive)
        : b.filter((x) => x.isActive && (profile?.branchIds ?? []).includes(x.id));
      setBranches(allowed);
      if (isOwner) {
        setStaffUsers(
          users
            .filter((u) => u.isActive !== false)
            .sort((a, b) => {
              if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
              return (a.displayName || a.email).localeCompare(b.displayName || b.email);
            }),
        );
      }
      setBranchId((prev) => {
        if (prev === "all" && isOwner) return "all";
        if (prev !== "all" && allowed.some((x) => x.id === prev)) return prev;
        if (isOwner) return "all";
        return allowed[0]?.id ?? "";
      });
    } catch (e) {
      setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [isOwner, profile?.branchIds, locale, t]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return onSettingsSnapshot((s) => setSettings(s));
  }, []);

  const queryCreatedBy = useMemo(() => {
    if (!isOwner) return profile?.uid;
    if (!createdByFilter || createdByFilter === "all") return undefined;
    return createdByFilter;
  }, [isOwner, createdByFilter, profile?.uid]);

  useEffect(() => {
    if (!profile?.uid) {
      setLogs([]);
      return;
    }
    // Wait until owner default createdBy is set (avoids a brief "all" query)
    if (isOwner && !createdByFilter) {
      return;
    }
    if (!isOwner && branchId === "all" && branches.length === 0) {
      setLogs([]);
      return;
    }

    const listenBranch =
      !isOwner && branchId === "all"
        ? branches[0]?.id ?? ""
        : branchId;

    if (!isOwner && !listenBranch) {
      setLogs([]);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const unsub = onActivityLogsSnapshot(
      {
        branchId: isOwner ? branchId : listenBranch,
        entityType,
        createdBy: queryCreatedBy,
        limitCount: 80,
      },
      (items) => {
        setLogs(items);
        setLoading(false);
      },
      (err) => {
        setLoadError(mapFirebaseError(err, locale) || t("loadFailed"));
        setLoading(false);
      },
    );
    return () => unsub();
  }, [
    branchId,
    branches,
    entityType,
    isOwner,
    profile?.uid,
    createdByFilter,
    queryCreatedBy,
    locale,
    t,
  ]);

  useRetryOnReconnect(Boolean(loadError) && !loading, () => void load());

  useEffect(() => {
    if (!profile?.uid) return;
    let alive = true;
    const refresh = () => {
      void listLocalActivityLogs(entityType)
        .then(({ logs: rows, pendingIds: ids }) => {
          if (!alive) return;
          setLocalLogs(rows);
          setPendingIds(ids);
        })
        .catch(() => {
          if (!alive) return;
          setLocalLogs([]);
          setPendingIds(new Set());
        });
    };
    const unsub = subscribeQueue(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, [entityType, profile?.uid]);

  /** Cloud logs + this PC's local copy (same scope as the query), newest first. */
  const mergedLogs = useMemo(
    () =>
      mergeActivityLogs({
        cloud: logs,
        local: localLogs,
        pendingIds,
        branchId: !isOwner && branchId === "all" ? branches[0]?.id ?? "" : branchId,
        createdBy: queryCreatedBy,
      }),
    [logs, localLogs, pendingIds, isOwner, branchId, branches, queryCreatedBy],
  );

  const filtered = useMemo(() => {
    const todayKey = toInputDate(shopNow(), dayHours);
    let fromKey: string | null = null;
    let toKey: string | null = null;
    if (datePreset === "today") {
      fromKey = todayKey;
      toKey = todayKey;
    } else if (datePreset === "last7") {
      fromKey = shiftBusinessDateKey(todayKey, -6);
      toKey = todayKey;
    } else if (datePreset === "month") {
      fromKey = startOfBusinessMonthKey(todayKey);
      toKey = todayKey;
    }

    const q = query.trim().toLowerCase();

    return mergedLogs.filter((log) => {
      const day = businessDateKey(new Date(log.createdAt), dayHours);
      if (fromKey && day < fromKey) return false;
      if (toKey && day > toKey) return false;

      if (actionFilter === "refund") {
        if (!isRefundLog(log)) return false;
      } else if (actionFilter !== "all") {
        if (log.action !== actionFilter) return false;
        if (actionFilter === "update" && isRefundLog(log)) return false;
      }

      if (q) {
        const hay = `${log.summary} ${log.detail ?? ""} ${log.createdByName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [mergedLogs, datePreset, actionFilter, query, dayHours]);

  const entityLabel =
    entityType === "order"
      ? t("orders")
      : entityType === "expense"
        ? t("expenses")
        : t("inventory");

  const pageHint =
    entityType === "order"
      ? t("activityLogHintOrders")
      : entityType === "expense"
        ? t("activityLogHintExpenses")
        : t("activityLogHintInventory");

  return (
    <div>
      <div className="mb-4 sm:mb-5">
        <h1 className="text-xl font-bold text-[var(--ink)] sm:text-2xl">
          {entityLabel}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{pageHint}</p>
        {!isOwner ? (
          <p className="mt-1 text-xs text-[var(--muted)]">{t("activityLogHintMine")}</p>
        ) : null}
      </div>

      <div className="admin-filter-panel mb-4 p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <select
            className="input w-full min-w-0 text-sm"
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            aria-label={t("dateRange")}
          >
            <option value="today">{t("dateToday")}</option>
            <option value="last7">{t("dateLast7")}</option>
            <option value="month">{t("dateThisMonth")}</option>
            <option value="all">{t("dateAll")}</option>
          </select>

          <select
            className="input w-full min-w-0 text-sm"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
            aria-label={t("orderStatusFilter")}
          >
            <option value="all">{t("all")}</option>
            <option value="create">{t("activityCreate")}</option>
            <option value="update">{t("activityUpdate")}</option>
            <option value="cancel">{t("activityCancel")}</option>
            <option value="refund">{t("activityRefund")}</option>
            <option value="delete">{t("activityDelete")}</option>
          </select>

          {(isOwner || branches.length > 1) && branches.length > 0 ? (
            <select
              className="input w-full min-w-0 text-sm"
              value={branchId === "all" && !isOwner ? branches[0]?.id ?? "" : branchId}
              onChange={(e) => setBranchId(e.target.value)}
              dir="ltr"
              aria-label={t("branch")}
            >
              {isOwner ? <option value="all">{t("allBranches")}</option> : null}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : null}

          {isOwner && profile?.uid ? (
            <select
              className="input w-full min-w-0 text-sm"
              value={createdByFilter || "all"}
              onChange={(e) => setCreatedByFilter(e.target.value)}
              dir="ltr"
              aria-label={t("createdByFilter")}
            >
              <option value={profile.uid}>{t("createdByMe")}</option>
              <option value="all">{t("createdByAll")}</option>
              {staffUsers
                .filter((u) => u.uid !== profile.uid)
                .map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {staffLabel(u, profile.uid, t("createdByMe"))}
                  </option>
                ))}
            </select>
          ) : null}

          <span className="relative col-span-2 sm:col-span-1 lg:col-span-1">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchActivity")}
              className="input w-full text-sm"
              autoComplete="off"
            />
          </span>
        </div>
      </div>

      {loading ? <PageSpinner label={t("loading")} /> : null}
      {!loading && loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} />
      ) : null}

      {!loading && !loadError ? (
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[#faf8f5] px-3.5 py-3 sm:px-4">
            <div>
              <h2 className="text-sm font-bold text-[var(--ink)]">{t("activityLog")}</h2>
              <p className="text-[11px] text-[var(--muted)]">
                {t("activityShowingCount").replace("{count}", String(filtered.length))}
              </p>
            </div>
            {filtered.length > 0 ? (
              <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--gold-deep)] ring-1 ring-[var(--border)]">
                {filtered.length}
              </span>
            ) : null}
          </div>
          <ActivityLogList
            logs={filtered}
            entityType={entityType}
            pendingIds={pendingIds}
            branchNameFor={
              branchId === "all"
                ? (id) => branches.find((b) => b.id === id)?.name
                : undefined
            }
          />
        </section>
      ) : null}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ActivityPageInner />
    </Suspense>
  );
}
