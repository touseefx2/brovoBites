"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Branch, Expense, Order, ShopSettings } from "@bravobites/domain";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  endOfBusinessDay,
  formatPkr,
  shiftBusinessDateKey,
  startOfBusinessDay,
  startOfBusinessMonthKey,
} from "@bravobites/domain";

type DatePreset = "today" | "yesterday" | "last7" | "month" | "all" | "custom";
import { useAuth } from "@/lib/auth-context";
import { PaymentMethodIcon, PaymentTile } from "@/components/PaymentMethodIcon";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { shopNow } from "@/lib/shop-clock";
import { LoadError, PageSpinner } from "@/components/Loading";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import {
  fetchBranches,
  fetchUsers,
  onExpensesSnapshot,
  onOrdersSnapshot,
  onSettingsSnapshot,
} from "@/lib/firestore";
import { openDatePicker } from "@/lib/open-date-picker";
import { computeDayReport } from "@/lib/day-report";
import { OrderRangeGuardNotice, useOrderRangeGuard } from "@/lib/use-order-range-guard";
import type { Unsubscribe } from "firebase/firestore";

function toInputDate(d: Date, hours?: Parameters<typeof businessDateKey>[1]) {
  return businessDateKey(d, hours);
}


export default function DayReportPage() {
  const { t, locale } = useLocale();
  const { profile, activeBranchId } = useAuth();
  const isOwner = profile?.role === "owner";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [staffFilter, setStaffFilter] = useState("all");
  const [staffUsers, setStaffUsers] = useState<
    { uid: string; name: string; email: string }[]
  >([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Empty until shop hours load — avoids calendar-day mismatch (e.g. 9am showing Oct 1 empty vs Sept 30)
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const datesSyncedRef = useRef(false);
  /** Opens on Today (the shop's business day from Landing settings). */
  const [datePreset, setDatePreset] = useState<DatePreset>("today");

  const dayHours = useMemo(
    () => businessDayHoursFromSettings(settings),
    [settings],
  );

  const todayKey = useMemo(
    () => toInputDate(shopNow(), dayHours),
    [dayHours],
  );

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) map.set(b.id, b.name);
    return map;
  }, [branches]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [b, users] = await Promise.all([
        fetchBranches(),
        isOwner ? fetchUsers() : Promise.resolve([]),
      ]);
      if (isOwner) {
        setStaffUsers(
          users.map((u) => ({
            uid: u.uid,
            name: u.displayName || u.email,
            email: u.email,
          })),
        );
      }
      const allowed = isOwner
        ? b.filter((x) => x.isActive)
        : b.filter((x) => x.isActive && (profile?.branchIds ?? []).includes(x.id));
      setBranches(allowed);
      const nextBranch =
        branchId && (branchId === "all" || allowed.some((x) => x.id === branchId))
          ? branchId
          : isOwner
            ? "all"
            : activeBranchId && allowed.some((x) => x.id === activeBranchId)
              ? activeBranchId
              : allowed[0]?.id ?? "";
      setBranchId(nextBranch);
    } catch (e) {
      setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [locale, t, isOwner, profile?.branchIds, branchId, activeBranchId]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return onSettingsSnapshot((s) => {
      setSettings(s);
      const hours = businessDayHoursFromSettings(s);
      const today = toInputDate(shopNow(), hours);
      // First load: lock From/To to shop "today". Don't clobber if user already picked a range.
      if (!datesSyncedRef.current) {
        setDateFrom(today);
        setDateTo(today);
        datesSyncedRef.current = true;
      }
    });
  }, []);

  // Business days the report covers; "all" has no start (whole history, only when picked).
  const customFrom = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : todayKey;
  const customTo = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo : todayKey;
  const [rangeFrom, rangeTo] = ((): [string | null, string] => {
    switch (datePreset) {
      case "today":
        return [todayKey, todayKey];
      case "yesterday": {
        const y = shiftBusinessDateKey(todayKey, -1);
        return [y, y];
      }
      case "last7":
        return [shiftBusinessDateKey(todayKey, -6), todayKey];
      case "month":
        return [startOfBusinessMonthKey(todayKey), todayKey];
      case "all":
        return [null, todayKey];
      case "custom":
        return customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    }
  })();
  const isTodayOnly = rangeFrom === todayKey && rangeTo === todayKey;
  const sinceIso = rangeFrom ? startOfBusinessDay(rangeFrom, dayHours).toISOString() : undefined;
  const untilIso = endOfBusinessDay(rangeTo, dayHours).toISOString();

  // A long period is counted first (cost), like the owner report.
  const guardBranchIds = useMemo(
    () => (branchId === "all" ? branches.map((b) => b.id) : branchId ? [branchId] : []),
    [branchId, branches],
  );
  const guard = useOrderRangeGuard({
    branchIds: guardBranchIds,
    sinceIso,
    untilIso,
    small: datePreset === "today" || datePreset === "yesterday",
  });

  // Only the picked business days — orders by time, expenses by their date.
  useEffect(() => {
    if (!branchId || branches.length === 0 || !guard.approved) {
      setOrders([]);
      setExpenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ids = branchId === "all" ? branches.map((b) => b.id) : [branchId];
    const ordersByBranch = new Map<string, Order[]>();
    const expensesByBranch = new Map<string, Expense[]>();
    const ready = new Set<string>();
    const merge = () => setOrders(Array.from(ordersByBranch.values()).flat());
    const mergeExpenses = () => setExpenses(Array.from(expensesByBranch.values()).flat());
    const unsubs: Unsubscribe[] = [];

    for (const bid of ids) {
      unsubs.push(
        onOrdersSnapshot(bid, (o) => { ordersByBranch.set(bid, o); ready.add(bid); merge(); if (ready.size >= ids.length) setLoading(false); },
          (err) => { setLoadError(mapFirebaseError(err, locale)); ready.add(bid); if (ready.size >= ids.length) setLoading(false); },
          sinceIso ? { sinceIso, untilIso } : undefined),
      );
      // Per branch, also for "all" — never the whole expenses collection.
      unsubs.push(
        onExpensesSnapshot(bid, (e) => { expensesByBranch.set(bid, e); mergeExpenses(); },
          (err) => setLoadError(mapFirebaseError(err, locale)),
          rangeFrom ? { fromKey: rangeFrom, toKey: rangeTo } : undefined),
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [branchId, branches, locale, t, sinceIso, untilIso, rangeFrom, rangeTo, guard.approved]);

  useRetryOnReconnect(Boolean(loadError) && !loading, () => void load());

  const report = useMemo(
    () =>
      computeDayReport({
        orders,
        expenses,
        from: rangeFrom ? startOfBusinessDay(rangeFrom, dayHours) : new Date(0),
        to: endOfBusinessDay(rangeTo, dayHours),
        fromKey: rangeFrom ?? "0000-00-00",
        toKey: rangeTo,
        staffFilter,
        branchNameFor: (id) => branchNameById.get(id),
      }),
    [orders, expenses, rangeFrom, rangeTo, dayHours, staffFilter, branchNameById],
  );

  const datePresets: { id: DatePreset; label: string }[] = [
    { id: "today", label: t("dateToday") },
    { id: "yesterday", label: t("dateYesterday") },
    { id: "last7", label: t("dateLast7") },
    { id: "month", label: t("dateThisMonth") },
    { id: "all", label: t("dateAll") },
    { id: "custom", label: t("dateCustom") },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-4 sm:mb-5">
        <h1 className="text-xl font-bold sm:text-2xl">{t("dayEndReport")}</h1>
        <p className="text-sm text-[var(--muted)]">{t("dayEndReportHint")}</p>
      </div>

      {/* Controls */}
      <div className="admin-filter-panel mb-5 p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {datePresets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`admin-filter-chip text-xs sm:text-sm ${datePreset === p.id ? "is-active" : ""}`}
                onClick={() => setDatePreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {datePreset === "custom" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
            <label className="block min-w-0">
              <span className="admin-filter-muted mb-1 block text-[11px] font-semibold uppercase tracking-wide">
                {t("dateFrom")}
              </span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || todayKey}
                onChange={(e) => setDateFrom(e.target.value)}
                onClick={(e) => openDatePicker(e.currentTarget)}
                className="input w-full min-w-0 text-sm"
                dir="ltr"
                aria-label={t("dateFrom")}
              />
            </label>
            <label className="block min-w-0">
              <span className="admin-filter-muted mb-1 block text-[11px] font-semibold uppercase tracking-wide">
                {t("dateTo")}
              </span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                max={todayKey}
                onChange={(e) => setDateTo(e.target.value)}
                onClick={(e) => openDatePicker(e.currentTarget)}
                className="input w-full min-w-0 text-sm"
                dir="ltr"
                aria-label={t("dateTo")}
              />
            </label>
          </div>
          ) : null}
          {(isOwner && (branches.length > 0 || staffUsers.length > 0)) ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
              {isOwner && branches.length > 0 ? (
                <select
                  className="input w-full min-w-0 text-sm"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  dir="ltr"
                >
                  <option value="all">{t("allBranches")}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              ) : null}
              {isOwner && staffUsers.length > 0 ? (
                <select
                  className="input w-full min-w-0 text-sm"
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                >
                  <option value="all">
                    {t("createdByFilter")}: {t("createdByAll")}
                  </option>
                  {staffUsers.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <OrderRangeGuardNotice guard={guard} />
      {guard.approved && loading ? <PageSpinner label={t("loading")} /> : null}
      {guard.approved && !loading && loadError ? <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} /> : null}

      {guard.approved && !loading && !loadError && (
        <CollapsibleSection
          title={t("dayEndReport")}
          count={report.totalOrders}
        >
          <div className="space-y-4 p-3 sm:p-4">
          {/* Sales Summary */}
          <section className="rounded-xl border border-[var(--border)] bg-white shadow-sm">
            <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
              <h2 className="font-bold text-[var(--ink)]">
                {isTodayOnly ? t("todaySales") : t("totalSales")}
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-3">
              <div className="bg-white p-4">
                <p className="text-xs font-medium text-[var(--muted)]">{t("totalSales")}</p>
                <p className="mt-1 text-xl font-bold text-[var(--gold-deep)]" dir="ltr">{formatPkr(report.totalSales)}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{report.totalOrders} {t("orders").toLowerCase()}</p>
              </div>
              <div className="bg-white p-4">
                <p className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
                  <PaymentTile method="cash" size={26} />
                  {t("totalCashSales")}
                </p>
                <p className="mt-1.5 text-lg font-bold text-[var(--ink)]" dir="ltr">{formatPkr(report.cashSales)}</p>
              </div>
              <div className="bg-white p-4">
                <p className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
                  <PaymentTile method="card" size={26} />
                  {t("totalCardSales")}
                </p>
                <p className="mt-1.5 text-lg font-bold text-[var(--ink)]" dir="ltr">{formatPkr(report.cardSales)}</p>
              </div>
              <div className="bg-white p-4">
                <p className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
                  <PaymentTile method="digital" size={26} />
                  {t("totalDigitalSales")}
                </p>
                <p className="mt-1.5 text-lg font-bold text-[var(--ink)]" dir="ltr">{formatPkr(report.digitalSales)}</p>
              </div>
              <div className="bg-white p-4">
                <p className="text-xs font-medium text-[var(--muted)]">{t("totalRefunds")}</p>
                <p className="mt-1 text-lg font-bold text-orange-600" dir="ltr">{formatPkr(report.totalRefunds)}</p>
              </div>
              <div className="bg-white p-4">
                <p className="text-xs font-medium text-[var(--muted)]">{t("cancelledAmount")}</p>
                <p className="mt-1 text-lg font-bold text-stone-600" dir="ltr">{formatPkr(report.cancelledAmount)}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {report.cancelledOrders} {t("cancelledOrders").toLowerCase()}
                </p>
              </div>
            </div>
          </section>

          {/* Expenses + Net (branch-wide for owner and staff) */}
          <section className="rounded-xl border border-[var(--border)] bg-white shadow-sm">
            <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-3">
              <div className="bg-white p-4">
                <p className="text-xs font-medium text-[var(--muted)]">{t("totalExpenses")}</p>
                <p className="mt-1 text-lg font-bold text-red-600" dir="ltr">{formatPkr(report.totalExpenses)}</p>
              </div>
              {report.totalDiscounts > 0 && (
                <div className="bg-white p-4">
                  <p className="text-xs font-medium text-[var(--muted)]">{t("discount")}</p>
                  <p className="mt-1 text-lg font-bold text-emerald-700" dir="ltr">
                    −{formatPkr(report.totalDiscounts)}
                  </p>
                </div>
              )}
              {report.totalTax > 0 && (
                <div className="bg-white p-4">
                  <p className="text-xs font-medium text-[var(--muted)]">{t("tax")}</p>
                  <p className="mt-1 text-lg font-bold text-[var(--ink)]" dir="ltr">
                    {formatPkr(report.totalTax)}
                  </p>
                </div>
              )}
              {report.totalDelivery > 0 && (
                <div className="bg-white p-4">
                  <p className="text-xs font-medium text-[var(--muted)]">{t("deliveryCharges")}</p>
                  <p className="mt-1 text-lg font-bold text-[var(--ink)]" dir="ltr">
                    {formatPkr(report.totalDelivery)}
                  </p>
                </div>
              )}
              <div className="bg-white p-4">
                <p className="text-xs font-medium text-[var(--muted)]">{t("netProfit")}</p>
                <p className={`mt-1 text-xl font-bold ${report.netProfit >= 0 ? "text-green-600" : "text-red-600"}`} dir="ltr">
                  {report.netProfit >= 0 ? "" : "−"}{formatPkr(Math.abs(report.netProfit))}
                </p>
              </div>
            </div>
          </section>

          {/* Staff breakdown (Owner only) */}
          {isOwner && report.staffBreakdown.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-[rgba(184,134,11,0.18)] bg-white shadow-[0_10px_28px_rgba(28,25,23,0.05)]">
              <div className="border-b border-[rgba(184,134,11,0.12)] bg-gradient-to-r from-[#faf7f2] to-white px-4 py-3.5 sm:px-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--gold-deep)]">
                  {t("staff")}
                </p>
                <h2 className="text-base font-bold text-[var(--ink)]">{t("staffSales")}</h2>
              </div>
              <ul className="divide-y divide-[rgba(184,134,11,0.1)]">
                {report.staffBreakdown.map((s) => {
                  const initial = (s.name.trim().charAt(0) || "?").toUpperCase();
                  return (
                    <li key={s.key} className="px-3 py-3.5 sm:px-5 sm:py-4">
                      <div className="flex items-start gap-3">
                        <span
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(184,134,11,0.12)] text-sm font-bold text-[var(--gold-deep)] ring-1 ring-[rgba(184,134,11,0.22)]"
                          aria-hidden
                        >
                          {initial}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-[var(--ink)] sm:text-[15px]">
                                {s.name}
                              </p>
                              {s.email ? (
                                <p
                                  className="mt-0.5 truncate text-[11px] text-[var(--muted)] sm:text-xs"
                                  dir="ltr"
                                >
                                  {s.email}
                                </p>
                              ) : null}
                            </div>
                            <div className="shrink-0 text-end">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                                {t("totalSales")}
                              </p>
                              <p
                                className="text-base font-bold tabular-nums text-[var(--gold-deep)] sm:text-lg"
                                dir="ltr"
                              >
                                {formatPkr(s.total)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <span className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[rgba(184,134,11,0.16)] bg-[#faf7f2]/90 px-2 py-1 text-[11px] font-medium text-[var(--ink)]">
                              <span className="shrink-0 text-[var(--muted)]">{t("branch")}</span>
                              <span className="truncate">{s.branchName}</span>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-lg border border-stone-200/80 bg-stone-50/90 px-2 py-1 text-[11px] font-medium text-[var(--ink)]">
                              <span className="text-[var(--muted)]">{t("orders")}</span>
                              <span className="tabular-nums font-semibold">{s.orders}</span>
                            </span>
                            {s.cancelledOrders > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-100/80 px-2 py-1 text-[11px] font-medium text-stone-600">
                                <span>{t("cancelled")}</span>
                                <span className="tabular-nums font-semibold">{s.cancelledOrders}</span>
                              </span>
                            ) : null}
                          </div>

                          {(s.cash > 0 || s.card > 0 || s.digital > 0 || s.refunds > 0 || s.cancelledAmount > 0) && (
                            <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                              {s.cash > 0 ? (
                                <div className="rounded-lg border border-[var(--border)] bg-[#fcfbf9] px-2.5 py-1.5">
                                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                                    <PaymentMethodIcon method="cash" size={12} />
                                    {t("cash")}
                                  </p>
                                  <p className="mt-0.5 text-xs font-bold tabular-nums text-[var(--ink)]" dir="ltr">
                                    {formatPkr(s.cash)}
                                  </p>
                                </div>
                              ) : null}
                              {s.card > 0 ? (
                                <div className="rounded-lg border border-[var(--border)] bg-[#fcfbf9] px-2.5 py-1.5">
                                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                                    <PaymentMethodIcon method="card" size={12} />
                                    {t("card")}
                                  </p>
                                  <p className="mt-0.5 text-xs font-bold tabular-nums text-[var(--ink)]" dir="ltr">
                                    {formatPkr(s.card)}
                                  </p>
                                </div>
                              ) : null}
                              {s.digital > 0 ? (
                                <div className="rounded-lg border border-[var(--border)] bg-[#fcfbf9] px-2.5 py-1.5">
                                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                                    <PaymentMethodIcon method="digital" size={12} />
                                    {t("digital")}
                                  </p>
                                  <p className="mt-0.5 text-xs font-bold tabular-nums text-[var(--ink)]" dir="ltr">
                                    {formatPkr(s.digital)}
                                  </p>
                                </div>
                              ) : null}
                              {s.refunds > 0 ? (
                                <div className="rounded-lg border border-orange-200/70 bg-orange-50/50 px-2.5 py-1.5">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-700/80">
                                    {t("totalRefunds")}
                                  </p>
                                  <p className="mt-0.5 text-xs font-bold tabular-nums text-orange-600" dir="ltr">
                                    {formatPkr(s.refunds)}
                                  </p>
                                </div>
                              ) : null}
                              {s.cancelledAmount > 0 ? (
                                <div className="rounded-lg border border-stone-200 bg-stone-50/80 px-2.5 py-1.5">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                                    {t("cancelledAmount")}
                                  </p>
                                  <p className="mt-0.5 text-xs font-bold tabular-nums text-stone-600" dir="ltr">
                                    {formatPkr(s.cancelledAmount)}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {report.totalOrders === 0 && report.totalExpenses === 0 && (
            <p className="rounded-xl border border-dashed border-[var(--border)] bg-white/70 px-4 py-8 text-center text-sm text-[var(--muted)]">
              {t("noReportData")}
            </p>
          )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
