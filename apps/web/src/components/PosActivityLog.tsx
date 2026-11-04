"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ActivityLog, AppUser, ShopSettings } from "@bravobites/domain";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  shiftBusinessDateKey,
  startOfBusinessDay,
  startOfBusinessMonthKey,
} from "@bravobites/domain";
import { ActivityLogList } from "@/components/ActivityLogPanel";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { mergeActivityLogs } from "@/lib/activity-merge";
import { onActivityLogsSnapshot } from "@/lib/firestore";
import { isRefundLog } from "@/lib/activity-change";
import { openDatePicker } from "@/lib/open-date-picker";
import { listLocalActivityLogs, subscribeQueue } from "@/lib/pos-queue";
import { shopNow } from "@/lib/shop-clock";

/** Entities the POS logs (same as the admin Activity page for these). */
export type PosLogEntity = "order" | "expense" | "inventory";

type Preset = "today" | "yesterday" | "last7" | "month" | "all" | "custom";
type ActionFilter = "all" | "create" | "update" | "cancel" | "refund" | "delete";

/** Newest cloud logs per query — the date filter narrows the query itself. */
const CLOUD_LIMIT = 100;

const NUM: CSSProperties = { fontFamily: "var(--font-en), system-ui, sans-serif" };

/** Small "See activity log" row placed under a POS list; opens the popup. */
export function PosLogsLink({
  entityType,
  onClick,
  className = "",
}: {
  entityType: PosLogEntity;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white px-3.5 py-2.5 text-start transition hover:border-[var(--gold)]/40 hover:bg-[#faf8f5] ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[var(--ink)]">
          {t("seeActivityLog")}
          <span className="font-medium text-stone-600">
            {" · "}
            {entityType === "order" ? t("orders") : entityType === "inventory" ? t("inventory") : t("expenses")}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-stone-600">
          {entityType === "order" ? t("posLogsHintOrder") : entityType === "inventory" ? t("posLogsHintInventory") : t("posLogsHintExpense")}
        </span>
      </span>
      <span
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f3eee6] text-[var(--gold-deep)] ring-1 ring-[rgba(184,134,11,0.2)]"
        aria-hidden
      >
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5h11M9 12h11M9 19h11" />
          <path d="M4 5h.01M4 12h.01M4 19h.01" />
        </svg>
      </span>
    </button>
  );
}

/**
 * Activity log popup for one POS area (orders or expenses) — works offline:
 * cloud logs (Firestore cache) + this PC's own copy of every action, with the
 * admin Activity page's filters (date, action, staff, search).
 */
export function PosActivityLog({
  entityType,
  branchId,
  branchName,
  user,
  settings,
  onClose,
}: {
  entityType: PosLogEntity;
  branchId: string;
  branchName?: string;
  user: AppUser;
  settings: ShopSettings | null;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const isOwner = user.role === "owner";
  // Staff may only read their own log rows (Firestore rules) — same locally.
  const scopeCreatedBy = isOwner ? undefined : user.uid;

  const [preset, setPreset] = useState<Preset>("today");
  const [customKey, setCustomKey] = useState("");
  const [action, setAction] = useState<ActionFilter>("all");
  const [staff, setStaff] = useState("all");
  const [query, setQuery] = useState("");
  const [cloud, setCloud] = useState<ActivityLog[]>([]);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [local, setLocal] = useState<ActivityLog[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const dayHours = useMemo(() => businessDayHoursFromSettings(settings), [settings]);
  const todayKey = businessDateKey(shopNow(), dayHours);

  /** Business-day keys for the chosen preset; null = all time. */
  const range = useMemo((): { fromKey: string; toKey: string } | null => {
    switch (preset) {
      case "today":
        return { fromKey: todayKey, toKey: todayKey };
      case "yesterday": {
        const y = shiftBusinessDateKey(todayKey, -1);
        return { fromKey: y, toKey: y };
      }
      case "last7":
        return { fromKey: shiftBusinessDateKey(todayKey, -6), toKey: todayKey };
      case "month":
        return { fromKey: startOfBusinessMonthKey(todayKey), toKey: todayKey };
      case "custom":
        return /^\d{4}-\d{2}-\d{2}$/.test(customKey)
          ? { fromKey: customKey, toKey: customKey }
          : { fromKey: todayKey, toKey: todayKey };
      default:
        return null;
    }
  }, [preset, customKey, todayKey]);

  const sinceIso = range ? startOfBusinessDay(range.fromKey, dayHours).toISOString() : undefined;

  // Cloud logs (served from the Firestore cache when offline).
  useEffect(() => {
    setCloudError(null);
    return onActivityLogsSnapshot(
      { branchId, entityType, createdBy: scopeCreatedBy, limitCount: CLOUD_LIMIT, sinceIso },
      setCloud,
      (err) => setCloudError(mapFirebaseError(err, locale)),
    );
  }, [branchId, entityType, scopeCreatedBy, sinceIso, locale]);

  // This PC's own copy — refresh whenever the queue changes.
  useEffect(() => {
    let alive = true;
    const unsub = subscribeQueue(() => {
      void listLocalActivityLogs(entityType).then(({ logs, pendingIds: ids }) => {
        if (!alive) return;
        setLocal(logs);
        setPendingIds(ids);
      });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [entityType]);

  const merged = useMemo(
    () => mergeActivityLogs({ cloud, local, pendingIds, branchId, createdBy: scopeCreatedBy }),
    [cloud, local, pendingIds, branchId, scopeCreatedBy],
  );

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of merged) map.set(l.createdBy, l.createdByName || l.createdBy);
    return [...map.entries()].map(([uid, name]) => ({ uid, name }));
  }, [merged]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((log) => {
      if (range) {
        const day = businessDateKey(new Date(log.createdAt), dayHours);
        if (day < range.fromKey || day > range.toKey) return false;
      }
      const isRefund = isRefundLog(log);
      if (action === "refund") {
        if (!isRefund) return false;
      } else if (action !== "all") {
        if (log.action !== action) return false;
        if (action === "update" && isRefund) return false;
      }
      if (staff !== "all" && log.createdBy !== staff) return false;
      if (q) {
        const hay = `${log.summary} ${log.detail ?? ""} ${log.createdByName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [merged, range, dayHours, action, staff, query]);

  const filtersActive =
    preset !== "today" || action !== "all" || staff !== "all" || Boolean(query.trim());
  const pendingShown = filtered.filter((l) => pendingIds.has(l.id)).length;

  const presets: { id: Preset; label: string }[] = [
    { id: "today", label: t("dateToday") },
    { id: "yesterday", label: t("dateYesterday") },
    { id: "last7", label: t("dateLast7") },
    { id: "month", label: t("dateThisMonth") },
    { id: "all", label: t("dateAll") },
  ];

  const selectClass =
    "h-9 rounded-xl border border-[var(--border)] bg-white px-3 text-xs font-semibold text-stone-700 outline-none transition focus:border-[var(--gold)]";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col sm:items-center sm:justify-center sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-label={entityType === "order" ? t("posLogsTitleOrder") : entityType === "inventory" ? t("posLogsTitleInventory") : t("posLogsTitleExpense")}
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-950/55 backdrop-blur-[2px]"
        aria-label={t("close")}
        onClick={onClose}
      />
      <div
        className="relative z-10 flex h-full w-full max-w-[1280px] flex-col overflow-hidden bg-[#f4f0e8] shadow-2xl sm:h-[calc(100dvh-1.5rem)] sm:rounded-3xl"
        style={locale === "ur" ? undefined : NUM}
      >
        <header className="shrink-0">
          <div className="relative overflow-hidden bg-gradient-to-br from-[#1c1714] via-[#241c16] to-[#2e2318] px-5 pb-5 pt-5 text-white sm:px-8">
            <div
              className="pointer-events-none absolute -end-20 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(212,168,67,0.25),transparent_65%)]"
              aria-hidden
            />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d4a843]">
                  {t("activityLog")}
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">
                  {entityType === "order" ? t("posLogsTitleOrder") : entityType === "inventory" ? t("posLogsTitleInventory") : t("posLogsTitleExpense")}
                </h2>
                <p className="mt-1 truncate text-xs text-white/60">
                  {branchName ? `${branchName} · ` : ""}
                  {entityType === "order" ? t("activityLogHintOrders") : entityType === "inventory" ? t("posLogsHintInventory") : t("activityLogHintExpenses")}
                </p>
              </div>
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/10 transition hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a843]"
                onClick={onClose}
                aria-label={t("close")}
                title={t("close")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>
          <div className="border-b border-[#e8dfcf] bg-white px-5 pb-3 pt-1 sm:px-8">

          {/* Date */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                aria-pressed={preset === p.id}
                className={`h-8 rounded-full border px-3 text-xs font-semibold transition ${
                  preset === p.id
                    ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                    : "border-[var(--border)] bg-white text-stone-600 hover:border-stone-300 hover:text-[var(--ink)]"
                }`}
              >
                {p.label}
              </button>
            ))}
            <input
              type="date"
              value={preset === "custom" ? customKey : ""}
              max={todayKey}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                  setCustomKey(v);
                  setPreset("custom");
                }
              }}
              onClick={(e) => openDatePicker(e.currentTarget)}
              className={`h-8 rounded-full border bg-white px-3 text-xs font-semibold outline-none transition focus:border-[var(--gold)] ${
                preset === "custom" ? "border-[var(--ink)] text-[var(--ink)]" : "border-[var(--border)] text-stone-600"
              }`}
              style={NUM}
              dir="ltr"
              aria-label={t("dateCustom")}
            />
          </div>

          {/* Action / staff / search */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className={selectClass}
              value={action}
              onChange={(e) => setAction(e.target.value as ActionFilter)}
              aria-label={t("orderStatusFilter")}
            >
              <option value="all">{t("all")}</option>
              <option value="create">{t("activityCreate")}</option>
              <option value="update">{t("activityUpdate")}</option>
              {entityType === "order" ? (
                <>
                  <option value="cancel">{t("activityCancel")}</option>
                  <option value="refund">{t("activityRefund")}</option>
                </>
              ) : null}
              <option value="delete">{t("activityDelete")}</option>
            </select>
            {isOwner && staffOptions.length > 1 ? (
              <select
                className={`${selectClass} max-w-[12rem] capitalize`}
                value={staff}
                onChange={(e) => setStaff(e.target.value)}
                aria-label={t("staff")}
              >
                <option value="all">{t("createdByAll")}</option>
                {staffOptions.map((s) => (
                  <option key={s.uid} value={s.uid}>{s.name}</option>
                ))}
              </select>
            ) : null}
            <label className="relative min-w-[12rem] flex-1">
              <svg className="pointer-events-none absolute inset-y-0 start-3 my-auto text-stone-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchActivity")}
                className="h-9 w-full rounded-xl border border-[var(--border)] bg-white ps-8 pe-3 text-xs text-[var(--ink)] outline-none transition placeholder:text-stone-400 focus:border-[var(--gold)]"
                autoComplete="off"
              />
            </label>
          </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-stone-600">
            <span className="inline-flex items-center gap-2">
              <span style={NUM}>{t("activityShowingCount").replace("{count}", String(filtered.length))}</span>
              {pendingShown > 0 ? (
                <span className="inline-flex items-center gap-1 text-amber-800">
                  <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
                  <span style={NUM}>{pendingShown}</span> {t("recentPendingLocal")}
                </span>
              ) : null}
            </span>
            {filtersActive ? (
              <button
                type="button"
                className="font-semibold text-[var(--gold-deep)] hover:underline"
                onClick={() => {
                  setPreset("today");
                  setAction("all");
                  setStaff("all");
                  setQuery("");
                }}
              >
                {t("resetFilters")}
              </button>
            ) : null}
          </div>

          {!online ? (
            <p className="mb-3 rounded-xl bg-stone-100 px-3 py-2 text-xs font-medium text-stone-700 ring-1 ring-stone-200">
              {t("posLogsOffline")}
            </p>
          ) : null}
          {cloudError && online ? (
            <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-200">
              {cloudError}
            </p>
          ) : null}
          {cloud.length >= CLOUD_LIMIT ? (
            <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              {t("posLogsLimit").replace("{n}", String(CLOUD_LIMIT))}
            </p>
          ) : null}

          <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
            <ActivityLogList logs={filtered} entityType={entityType} pendingIds={pendingIds} />
          </section>
        </div>
      </div>
    </div>
  );
}
