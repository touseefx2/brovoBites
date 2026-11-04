"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Branch, Order } from "@bravobites/domain";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  endOfBusinessDay,
  formatPkr,
  shiftBusinessDateKey,
  startOfBusinessDay,
  startOfBusinessMonthKey,
  type BusinessDayHours,
} from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { shopNow } from "@/lib/shop-clock";
import { LoadError, PageSpinner } from "@/components/Loading";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import { fetchBranches, onOrdersSnapshot, onSettingsSnapshot } from "@/lib/firestore";
import { openDatePicker } from "@/lib/open-date-picker";
import { computeItemSales } from "@/lib/day-report";
import { OrderRangeGuardNotice, useOrderRangeGuard } from "@/lib/use-order-range-guard";
import type { Unsubscribe } from "firebase/firestore";
import type { ShopSettings } from "@bravobites/domain";

type DatePreset = "today" | "yesterday" | "last7" | "month" | "all" | "custom";
type SortBy = "qty" | "revenue";


function toInputDate(d: Date, hours?: BusinessDayHours) {
  return businessDateKey(d, hours);
}

function parseInputDate(value: string, end = false, hours?: BusinessDayHours): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = end ? endOfBusinessDay(value, hours) : startOfBusinessDay(value, hours);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function rangeForPreset(
  preset: DatePreset,
  hours?: BusinessDayHours,
): { from: Date | null; to: Date | null } {
  const todayKey = businessDateKey(shopNow(), hours);
  if (preset === "all" || preset === "custom") return { from: null, to: null };
  if (preset === "today") {
    return { from: startOfBusinessDay(todayKey, hours), to: endOfBusinessDay(todayKey, hours) };
  }
  if (preset === "yesterday") {
    const y = shiftBusinessDateKey(todayKey, -1);
    return { from: startOfBusinessDay(y, hours), to: endOfBusinessDay(y, hours) };
  }
  if (preset === "last7") {
    const fromKey = shiftBusinessDateKey(todayKey, -6);
    return { from: startOfBusinessDay(fromKey, hours), to: endOfBusinessDay(todayKey, hours) };
  }
  const fromKey = startOfBusinessMonthKey(todayKey);
  return { from: startOfBusinessDay(fromKey, hours), to: endOfBusinessDay(todayKey, hours) };
}

export default function ItemSalesPage() {
  const { t, locale } = useLocale();
  const { profile, activeBranchId } = useAuth();
  const isOwner = profile?.role === "owner";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("qty");
  const [searchQuery, setSearchQuery] = useState("");

  const dayHours = useMemo(
    () => businessDayHoursFromSettings(settings),
    [settings],
  );

  const dateRange = useMemo(() => {
    if (datePreset === "all") return { from: null, to: null };
    if (datePreset === "custom") {
      return {
        from: parseInputDate(dateFrom, false, dayHours),
        to: parseInputDate(dateTo, true, dayHours),
      };
    }
    return rangeForPreset(datePreset, dayHours);
  }, [datePreset, dateFrom, dateTo, dayHours]);
  const sinceIso = dateRange.from?.toISOString();
  const untilIso = dateRange.to?.toISOString();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const b = await fetchBranches();
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
    return onSettingsSnapshot((s) => setSettings(s));
  }, []);

  // A long period ("All" = every order) is counted first (cost), like the owner report.
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

  // Only the selected dates' orders.
  useEffect(() => {
    if (!branchId || branches.length === 0 || !guard.approved) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoading(true);
    setOrders([]);
    const ids = branchId === "all" ? branches.map((b) => b.id) : [branchId];
    const ordersByBranch = new Map<string, Order[]>();
    const ready = new Set<string>();
    const merge = () => {
      setOrders(Array.from(ordersByBranch.values()).flat());
    };
    const unsubs: Unsubscribe[] = ids.map((bid) =>
      onOrdersSnapshot(
        bid,
        (o) => { ordersByBranch.set(bid, o); ready.add(bid); merge(); if (ready.size >= ids.length) setLoading(false); },
        (err) => { setLoadError(mapFirebaseError(err, locale)); ready.add(bid); if (ready.size >= ids.length) setLoading(false); },
        { sinceIso, untilIso },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [branchId, branches, locale, t, sinceIso, untilIso, guard.approved]);

  useRetryOnReconnect(Boolean(loadError) && !loading, () => void load());

  useEffect(() => {
    if (!settings) return;
    if (datePreset === "custom" || datePreset === "all") return;
    const hours = businessDayHoursFromSettings(settings);
    const { from, to } = rangeForPreset(datePreset, hours);
    setDateFrom(from ? toInputDate(from, hours) : "");
    setDateTo(to ? toInputDate(to, hours) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  function applyPreset(preset: DatePreset) {
    setDatePreset(preset);
    if (preset === "custom") return;
    const { from, to } = rangeForPreset(preset, dayHours);
    setDateFrom(from ? toInputDate(from, dayHours) : "");
    setDateTo(to ? toInputDate(to, dayHours) : "");
  }

  const itemStats = useMemo(() => {
    const result = computeItemSales(orders, dateRange.from, dateRange.to);
    if (sortBy === "revenue") result.sort((a, b) => b.revenue - a.revenue);
    return result;
  }, [orders, dateRange, sortBy]);

  const periodMoney = useMemo(() => {
    const { from, to } = dateRange;
    const activeOrders = orders.filter((o) => {
      if (o.status === "cancelled") return false;
      const created = new Date(o.createdAt).getTime();
      if (from && created < from.getTime()) return false;
      if (to && created > to.getTime()) return false;
      return true;
    });

    let itemRevenue = 0;
    let discounts = 0;
    let tax = 0;
    let delivery = 0;
    let orderSales = 0;
    for (const order of activeOrders) {
      itemRevenue += order.items.reduce((s, i) => s + i.lineTotal, 0);
      discounts += order.discountAmount ?? 0;
      tax += order.taxAmount ?? 0;
      delivery += order.deliveryCharges ?? 0;
      orderSales += order.total;
    }
    return {
      orderCount: activeOrders.length,
      itemRevenue,
      discounts,
      tax,
      delivery,
      orderSales,
      hasBridge: discounts > 0 || tax > 0 || delivery > 0,
    };
  }, [orders, dateRange]);

  const filteredStats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return itemStats;
    return itemStats.filter((s) => {
      const hay = `${s.productName} ${s.variationLabel || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [itemStats, searchQuery]);

  const totalQty = filteredStats.reduce((s, i) => s + i.qty, 0);
  const totalRevenue = filteredStats.reduce((s, i) => s + i.revenue, 0);
  const searchActive = Boolean(searchQuery.trim());
  const maxBar = Math.max(
    1,
    ...filteredStats.map((s) => (sortBy === "qty" ? s.qty : s.revenue)),
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
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-4 sm:mb-5">
        <h1 className="text-xl font-bold tracking-tight text-[var(--ink)] sm:text-2xl">
          {t("itemSales")}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("itemSalesHint")}</p>
        <p className="mt-1 text-xs leading-snug text-[var(--muted)]">
          {t("itemSalesVsOrdersHint")}
        </p>
      </div>

      <div className="admin-filter-panel mb-4">
        <div className="admin-filter-divider border-b p-3 sm:p-4">
          {isOwner && branches.length > 0 ? (
            <select
              className="input mb-3 w-full min-w-0 text-sm"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              dir="ltr"
              disabled={loading || Boolean(loadError)}
            >
              <option value="all">{t("allBranches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : null}

          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {datePresets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`admin-filter-chip text-xs sm:text-sm ${
                  datePreset === p.id ? "is-active" : ""
                }`}
                onClick={() => applyPreset(p.id)}
                disabled={loading || Boolean(loadError)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {datePreset === "custom" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                onClick={(e) => openDatePicker(e.currentTarget)}
                disabled={loading || Boolean(loadError)}
                className="input w-full text-sm"
                dir="ltr"
                aria-label={t("dateFrom")}
              />
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                onClick={(e) => openDatePicker(e.currentTarget)}
                disabled={loading || Boolean(loadError)}
                className="input w-full text-sm"
                dir="ltr"
                aria-label={t("dateTo")}
              />
            </div>
          ) : null}

          <span className="relative mt-3 block">
            <svg
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[#e4c15a]/80"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3-3" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchMenu")}
              className="input input-with-icon w-full text-base sm:text-sm"
              disabled={loading || Boolean(loadError)}
            />
          </span>
        </div>

        {/* While a big period waits for "Load" the numbers aren't known yet — no zeros. */}
        {guard.approved ? (
        <div className="grid grid-cols-3 gap-2 p-3 sm:gap-3 sm:p-4">
          <div className="admin-filter-stat">
            <p className="admin-filter-muted text-[10px] font-bold uppercase tracking-[0.12em]">
              {t("itemsCount")}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-[#f5efe6] sm:text-2xl">
              {filteredStats.length}
            </p>
          </div>
          <div className="admin-filter-stat is-accent">
            <p className="admin-filter-gold text-[10px] font-bold uppercase tracking-[0.12em]">
              {t("itemRevenue")}
            </p>
            <p
              className="admin-filter-gold mt-1 text-base font-bold tabular-nums sm:text-xl"
              dir="ltr"
            >
              {formatPkr(totalRevenue)}
            </p>
          </div>
          <div className="admin-filter-stat">
            <p className="admin-filter-muted text-[10px] font-bold uppercase tracking-[0.12em]">
              {t("qtySold")}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-[#f5efe6] sm:text-2xl">
              {totalQty}
            </p>
          </div>
        </div>
        ) : null}

        {guard.approved && periodMoney.orderCount > 0 && periodMoney.hasBridge && !searchActive ? (
          <div className="admin-filter-divider border-t px-3 py-3 sm:px-4">
            <p className="admin-filter-muted text-[10px] font-bold uppercase tracking-[0.12em]">
              {t("salesBridgeTitle")}
            </p>
            <div
              className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-[#e8e0d4] sm:text-sm"
              dir="ltr"
            >
              <span className="text-[var(--muted)]">{t("itemRevenue")}</span>
              <span className="font-bold tabular-nums text-[#f5efe6]">
                {formatPkr(periodMoney.itemRevenue)}
              </span>
              {periodMoney.discounts > 0 ? (
                <>
                  <span className="text-white/25">−</span>
                  <span className="text-[var(--muted)]">{t("discount")}</span>
                  <span className="font-bold tabular-nums text-emerald-300">
                    {formatPkr(periodMoney.discounts)}
                  </span>
                </>
              ) : null}
              {periodMoney.tax > 0 ? (
                <>
                  <span className="text-white/25">+</span>
                  <span className="text-[var(--muted)]">{t("tax")}</span>
                  <span className="font-bold tabular-nums text-[#f5efe6]">
                    {formatPkr(periodMoney.tax)}
                  </span>
                </>
              ) : null}
              {periodMoney.delivery > 0 ? (
                <>
                  <span className="text-white/25">+</span>
                  <span className="text-[var(--muted)]">{t("deliveryCharges")}</span>
                  <span className="font-bold tabular-nums text-[#f5efe6]">
                    {formatPkr(periodMoney.delivery)}
                  </span>
                </>
              ) : null}
              <span className="text-white/25">=</span>
              <span className="text-[var(--muted)]">{t("orderSales")}</span>
              <span className="font-bold tabular-nums text-[#e4c15a]">
                {formatPkr(periodMoney.orderSales)}
              </span>
            </div>
            <p className="admin-filter-muted mt-1.5 text-[11px] leading-snug">
              {t("salesBridgeHint")}
            </p>
          </div>
        ) : null}

        <div className="admin-filter-divider flex items-center justify-end gap-1 border-t px-3 py-2.5 sm:px-4">
          <button
            type="button"
            className={`admin-filter-chip min-h-9 py-1.5 text-xs ${
              sortBy === "qty" ? "is-active" : ""
            }`}
            onClick={() => setSortBy("qty")}
          >
            {t("sortByQty")}
          </button>
          <button
            type="button"
            className={`admin-filter-chip min-h-9 py-1.5 text-xs ${
              sortBy === "revenue" ? "is-active" : ""
            }`}
            onClick={() => setSortBy("revenue")}
          >
            {t("sortByRevenue")}
          </button>
        </div>
      </div>

      <OrderRangeGuardNotice guard={guard} />
      {guard.approved && loading ? <PageSpinner label={t("loading")} /> : null}
      {guard.approved && !loading && loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} />
      ) : null}

      {guard.approved && !loading && !loadError ? (
        <CollapsibleSection
          title={t("itemSales")}
          count={filteredStats.length}
        >
          {filteredStats.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
              {t("noItemSales")}
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              <div className="hidden items-center gap-3 bg-[#faf7f2] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)] sm:flex">
                <span className="w-8 text-center">#</span>
                <span className="flex-1">{t("itemName")}</span>
                <span className="w-20 text-end">{t("qtySold")}</span>
                <span className="w-28 text-end">{t("revenue")}</span>
              </div>
              {filteredStats.map((stat, i) => {
                const value = sortBy === "qty" ? stat.qty : stat.revenue;
                const pct = Math.max(4, (value / maxBar) * 100);
                const top = i < 3;
                return (
                  <div
                    key={stat.key}
                    className="relative flex items-center gap-2.5 px-3 py-3.5 sm:gap-3 sm:px-4"
                  >
                    <div
                      className="absolute inset-y-0 start-0 bg-[var(--gold)]/15"
                      style={{ width: `${pct}%` }}
                      aria-hidden
                    />
                    <span
                      className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${
                        top
                          ? "bg-[var(--gold-deep)] text-white"
                          : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="relative z-10 min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug text-[var(--ink)] sm:text-[15px]">
                        {stat.productName}
                        {stat.variationLabel ? (
                          <span className="font-normal text-[var(--muted)]">
                            {" "}
                            ({stat.variationLabel})
                          </span>
                        ) : null}
                      </p>
                      <div className="mt-1 flex gap-3 text-xs sm:hidden">
                        <span className="font-bold tabular-nums text-[var(--ink)]">
                          {stat.qty} {t("qtySold").toLowerCase()}
                        </span>
                        <span
                          className="font-bold tabular-nums text-[var(--gold-deep)]"
                          dir="ltr"
                        >
                          {formatPkr(stat.revenue)}
                        </span>
                      </div>
                    </div>
                    <span className="relative z-10 hidden w-20 text-end text-sm font-bold tabular-nums text-[var(--ink)] sm:block">
                      {stat.qty}
                    </span>
                    <span
                      className="relative z-10 hidden w-28 text-end text-sm font-bold tabular-nums text-[var(--gold-deep)] sm:block"
                      dir="ltr"
                    >
                      {formatPkr(stat.revenue)}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2.5 bg-[#faf7f2] px-3 py-3.5 sm:gap-3 sm:px-4">
                <span className="w-8 shrink-0" />
                <span className="min-w-0 flex-1 text-sm font-bold text-[var(--ink)]">
                  {t("total")}
                </span>
                <span className="hidden w-20 text-end text-sm font-bold tabular-nums text-[var(--ink)] sm:block">
                  {totalQty}
                </span>
                <span
                  className="text-end text-sm font-bold tabular-nums text-[var(--gold-deep)] sm:w-28"
                  dir="ltr"
                >
                  {formatPkr(totalRevenue)}
                </span>
              </div>
            </div>
          )}
        </CollapsibleSection>
      ) : null}
    </div>
  );
}
