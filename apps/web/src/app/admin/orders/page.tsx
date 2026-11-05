"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Branch,
  Order,
  OrderType,
  PaymentMethod,
  ShopSettings,
} from "@bravobites/domain";
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
import { useLocale } from "@/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { mapFirebaseError } from "@/lib/errors";
import { shopNow } from "@/lib/shop-clock";
import { LoadError, PageSpinner } from "@/components/Loading";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { OrderDetailSheet } from "@/components/OrderDetailSheet";
import { OrderListCard } from "@/components/OrderListCard";
import { SeeActivityLogLink } from "@/components/SeeActivityLogLink";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import { fetchBranches, fetchUsers, onOrdersSnapshot, onSettingsSnapshot } from "@/lib/firestore";
import { openDatePicker } from "@/lib/open-date-picker";
import {
  matchesOrderSearch,
  matchesOrderStatus,
  type OrderStatusFilter,
} from "@/lib/order-filters";
import type { Unsubscribe } from "firebase/firestore";

type DatePreset = "today" | "yesterday" | "last7" | "month" | "all" | "custom";
type StatusFilter = OrderStatusFilter;
type OrderTypeFilter = "all" | OrderType;
type PaymentFilter = "all" | PaymentMethod;
type CreatedByFilter = string; // "all" or a user uid

/** No start date ("All") → load this many newest orders per branch, more on demand. */
const ALL_ORDERS_PAGE = 300;

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
  if (preset === "all") return { from: null, to: null };
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
  if (preset === "month") {
    const fromKey = startOfBusinessMonthKey(todayKey);
    return { from: startOfBusinessDay(fromKey, hours), to: endOfBusinessDay(todayKey, hours) };
  }
  return { from: null, to: null };
}

export default function OrdersPage() {
  const { t, locale } = useLocale();
  const { profile, activeBranchId } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState<OrderTypeFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [createdByFilter, setCreatedByFilter] = useState<CreatedByFilter>("all");
  const [staffUsers, setStaffUsers] = useState<{ uid: string; name: string; email: string; role: string }[]>([]);
  const [allLimit, setAllLimit] = useState(ALL_ORDERS_PAGE);
  /** Some branch filled its page — older orders exist that aren't loaded. */
  const [hasMore, setHasMore] = useState(false);
  const isOwner = profile?.role === "owner";
  const dayHours = useMemo(
    () => businessDayHoursFromSettings(settings),
    [settings],
  );

  const dateRange = useMemo(() => {
    const from =
      datePreset === "all"
        ? null
        : parseInputDate(dateFrom, false, dayHours) ??
          (datePreset !== "custom" ? rangeForPreset(datePreset, dayHours).from : null);
    const to =
      datePreset === "all"
        ? null
        : parseInputDate(dateTo, true, dayHours) ??
          (datePreset !== "custom" ? rangeForPreset(datePreset, dayHours).to : null);
    return { from, to };
  }, [datePreset, dateFrom, dateTo, dayHours]);
  const sinceIso = dateRange.from?.toISOString();
  const untilIso = dateRange.to?.toISOString();
  const pageLimit = dateRange.from ? undefined : allLimit;
  // New branch / dates → spinner; "Load more" keeps the list until the longer one is in.
  const listKey = `${branchId}|${sinceIso ?? ""}|${untilIso ?? ""}`;
  const shownListKey = useRef("");

  const load = useCallback(async () => {
    setPageLoading(true);
    setLoadError(null);
    try {
      const fetches: [Promise<Branch[]>, Promise<import("@bravobites/domain").AppUser[]>] = [
        fetchBranches(),
        profile?.role === "owner" ? fetchUsers() : Promise.resolve([]),
      ];
      const [b, users] = await Promise.all(fetches);
      if (profile?.role === "owner") {
        setStaffUsers(
          users.map((u) => ({ uid: u.uid, name: u.displayName || u.email, email: u.email, role: u.role })),
        );
      }
      const allowed =
        profile?.role === "owner"
          ? b.filter((x) => x.isActive)
          : b.filter((x) => x.isActive && (profile?.branchIds ?? []).includes(x.id));
      setBranches(allowed);
      const nextBranch =
        branchId && (branchId === "all" || allowed.some((x) => x.id === branchId))
          ? branchId
          : profile?.role === "owner"
            ? "all"
            : activeBranchId && allowed.some((x) => x.id === activeBranchId)
              ? activeBranchId
              : allowed[0]?.id ?? "";
      setBranchId(nextBranch);
    } catch (e) {
      setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
    } finally {
      setPageLoading(false);
    }
  }, [branchId, locale, profile?.branchIds, profile?.role, t, activeBranchId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return onSettingsSnapshot((s) => setSettings(s));
  }, []);

  // Real-time orders listener (single branch or all) — only the dates the
  // filter shows; no start date → newest orders only (pageLimit).
  useEffect(() => {
    if (!branchId || branches.length === 0) {
      setOrders([]);
      setPageLoading(false);
      return;
    }
    setLoadError(null);
    if (shownListKey.current !== listKey) {
      shownListKey.current = listKey;
      setPageLoading(true);
      setOrders([]);
      setHasMore(false);
    }

    const ids = branchId === "all" ? branches.map((b) => b.id) : [branchId];
    const ordersByBranch = new Map<string, Order[]>();
    const ready = new Set<string>();
    const merge = () => {
      // Every branch first — the list never shows one branch on its own.
      if (ordersByBranch.size < ids.length) return;
      let all = Array.from(ordersByBranch.values()).flat();
      let more = false;
      if (pageLimit) {
        // A branch that filled its page may have older orders not loaded yet —
        // stop the list where the newest such page ends, so no branch looks emptier.
        let cutoff = "";
        for (const list of ordersByBranch.values()) {
          if (list.length < pageLimit) continue;
          more = true;
          const oldest = list[list.length - 1]!.createdAt;
          if (oldest > cutoff) cutoff = oldest;
        }
        if (cutoff) all = all.filter((o) => o.createdAt >= cutoff);
      }
      setHasMore(more);
      setOrders(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    };
    const unsubs: Unsubscribe[] = ids.map((bid) =>
      onOrdersSnapshot(
        bid,
        (o) => {
          ordersByBranch.set(bid, o);
          ready.add(bid);
          merge();
          if (ready.size >= ids.length) setPageLoading(false);
        },
        (err) => {
          setLoadError(mapFirebaseError(err, locale) || t("loadFailed"));
          ready.add(bid);
          if (ready.size >= ids.length) setPageLoading(false);
        },
        { sinceIso, untilIso, limitCount: pageLimit },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [branchId, branches, locale, t, sinceIso, untilIso, pageLimit, listKey]);

  useRetryOnReconnect(Boolean(loadError) && !pageLoading, () => {
    void load();
  });

  // Recompute date inputs once shop hours are known (overnight windows).
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
    setAllLimit(ALL_ORDERS_PAGE);
    if (preset === "custom") return;
    const { from, to } = rangeForPreset(preset, dayHours);
    setDateFrom(from ? toInputDate(from, dayHours) : "");
    setDateTo(to ? toInputDate(to, dayHours) : "");
  }

  const filtered = useMemo(() => {
    const { from, to } = dateRange;

    return orders.filter((o) => {
      if (!matchesOrderSearch(o, query)) return false;

      if (!matchesOrderStatus(o, statusFilter)) return false;

      if (orderTypeFilter !== "all") {
        const type = o.orderType ?? "dine-in";
        if (type !== orderTypeFilter) return false;
      }
      if (paymentFilter !== "all" && o.paymentMethod !== paymentFilter) return false;

      // Owner (or staff): optional filter by cashier
      if (createdByFilter !== "all" && o.createdBy !== createdByFilter) return false;

      const created = new Date(o.createdAt).getTime();
      if (!Number.isFinite(created)) return false;
      if (from && created < from.getTime()) return false;
      if (to && created > to.getTime()) return false;
      return true;
    });
  }, [
    orders,
    query,
    dateRange,
    statusFilter,
    orderTypeFilter,
    paymentFilter,
    createdByFilter,
  ]);

  const filteredTotalAmount = useMemo(
    () =>
      filtered
        .filter((o) => o.status !== "cancelled")
        .reduce((s, o) => s + o.total, 0),
    [filtered],
  );

  const filteredRefunds = useMemo(
    () =>
      filtered
        .filter((o) => o.status !== "cancelled")
        .reduce((s, o) => s + (o.refundAmount ?? 0), 0),
    [filtered],
  );

  const filteredCancelled = useMemo(() => {
    const cancelled = filtered.filter((o) => o.status === "cancelled");
    return {
      count: cancelled.length,
      amount: cancelled.reduce((s, o) => s + o.total, 0),
    };
  }, [filtered]);

  const filtersActive =
    Boolean(query.trim()) ||
    datePreset !== "today" ||
    statusFilter !== "all" ||
    orderTypeFilter !== "all" ||
    paymentFilter !== "all" ||
    createdByFilter !== "all";

  function clearFilters() {
    setQuery("");
    setStatusFilter("all");
    setOrderTypeFilter("all");
    setPaymentFilter("all");
    setCreatedByFilter("all");
    applyPreset("today");
  }

  const datePresets: { id: DatePreset; label: string }[] = [
    { id: "today", label: t("dateToday") },
    { id: "yesterday", label: t("dateYesterday") },
    { id: "last7", label: t("dateLast7") },
    { id: "month", label: t("dateThisMonth") },
    { id: "all", label: t("dateAll") },
    { id: "custom", label: t("dateCustom") },
  ];

  const statusOptions: { id: StatusFilter; label: string }[] = [
    { id: "all", label: t("all") },
    { id: "original", label: t("statusOriginal") },
    { id: "edited", label: t("statusEdited") },
    { id: "discounted", label: t("statusDiscounted") },
    { id: "cancelled", label: t("cancelled") },
    { id: "refunded", label: t("refunded") },
  ];

  const orderTypeOptions: { id: OrderTypeFilter; label: string }[] = [
    { id: "all", label: t("all") },
    { id: "dine-in", label: t("dineIn") },
    { id: "takeaway", label: t("takeaway") },
    { id: "delivery", label: t("delivery") },
  ];

  const paymentOptions: { id: PaymentFilter; label: string }[] = [
    { id: "all", label: t("all") },
    { id: "cash", label: t("cash") },
    { id: "card", label: t("card") },
    { id: "digital", label: t("digital") },
  ];

  return (
    <div>
      <div className="mb-4 sm:mb-5">
        <p className="admin-page-eyebrow">
          {t("orders")}
        </p>
        <h1 className="admin-page-title">
          {t("ordersHistory")}
        </h1>
        <p className="admin-page-sub">
          {profile?.role === "owner" ? t("ordersHint") : t("ordersHintStaff")}
        </p>
      </div>

      <div className="admin-filter-panel mb-4">
        <div className="admin-filter-divider border-b px-3 py-3 sm:px-4">
          {/* Search */}
          <span className="relative block">
            <svg
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[#f0b028]/80"
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchOrders")}
              autoComplete="off"
              enterKeyHint="search"
              inputMode="search"
              className="input input-with-icon w-full text-base sm:text-sm"
              disabled={pageLoading || Boolean(loadError)}
            />
          </span>
          <p className="admin-filter-muted mt-2 text-[11px] leading-snug">
            {t("filtersApplyToList")}
          </p>
        </div>

        <div className="p-3 sm:p-4">
        {/* Filter grid — 2 cols on mobile, 3 on desktop */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <select
            className="input w-full min-w-0 text-sm"
            value={datePreset}
            onChange={(e) => applyPreset(e.target.value as DatePreset)}
            disabled={pageLoading || Boolean(loadError)}
          >
            {datePresets.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>

          <select
            className="input w-full min-w-0 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            disabled={pageLoading || Boolean(loadError)}
          >
            {statusOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === "all" ? `${t("orderStatusFilter")}: ${s.label}` : s.label}
              </option>
            ))}
          </select>

          <select
            className="input w-full min-w-0 text-sm"
            value={orderTypeFilter}
            onChange={(e) => setOrderTypeFilter(e.target.value as OrderTypeFilter)}
            disabled={pageLoading || Boolean(loadError)}
          >
            {orderTypeOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.id === "all" ? `${t("orderType")}: ${opt.label}` : opt.label}
              </option>
            ))}
          </select>

          <select
            className="input w-full min-w-0 text-sm"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
            disabled={pageLoading || Boolean(loadError)}
          >
            {paymentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.id === "all" ? `${t("paymentMethod")}: ${opt.label}` : opt.label}
              </option>
            ))}
          </select>

          {profile?.role === "owner" ? (
            <select
              className="input w-full min-w-0 text-sm"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={pageLoading || Boolean(loadError)}
              dir="ltr"
            >
              <option value="all">{t("allBranches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : (
            <div className="flex items-center">
              <span className="inline-flex items-center rounded-lg border border-[rgba(240,176,40,0.28)] bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[#fff4e8]">
                {branches.find((b) => b.id === branchId)?.name ?? t("branch")}
              </span>
            </div>
          )}

          {profile?.role === "owner" && staffUsers.length > 0 ? (
            <select
              className="input w-full min-w-0 text-sm"
              value={createdByFilter}
              onChange={(e) => setCreatedByFilter(e.target.value)}
              disabled={pageLoading || Boolean(loadError)}
            >
              <option value="all">{t("createdByFilter")}: {t("createdByAll")}</option>
              {staffUsers.map((u) => (
                <option key={u.uid} value={u.uid}>{u.name} ({u.email})</option>
              ))}
            </select>
          ) : null}
        </div>

        {/* Custom date range — only when "Custom" is selected */}
        {datePreset === "custom" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              onClick={(e) => openDatePicker(e.currentTarget)}
              disabled={pageLoading || Boolean(loadError)}
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
              disabled={pageLoading || Boolean(loadError)}
              className="input w-full text-sm"
              dir="ltr"
              aria-label={t("dateTo")}
            />
          </div>
        )}

        {/* Summary — typographic strip, not boxed buttons */}
        <div className="admin-filter-divider mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-t pt-3">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2 sm:gap-x-6">
            <div>
              <p className="admin-filter-muted text-[11px]">{t("totalOrders")}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums leading-none tracking-tight text-[#fff4e8]">
                {filtered.length}
              </p>
            </div>
            <div className="hidden h-8 w-px bg-[rgba(240,176,40,0.2)] sm:block" aria-hidden />
            <div>
              <p className="admin-filter-muted text-[11px]">{t("filteredTotal")}</p>
              <p
                className="admin-filter-gold mt-0.5 text-2xl font-bold tabular-nums leading-none tracking-tight"
                dir="ltr"
              >
                {formatPkr(filteredTotalAmount)}
              </p>
            </div>
            <div className="hidden h-8 w-px bg-[rgba(240,176,40,0.2)] sm:block" aria-hidden />
            <div>
              <p className="admin-filter-muted text-[11px]">{t("filteredRefunds")}</p>
              <p
                className="mt-0.5 text-xl font-bold tabular-nums leading-none tracking-tight text-orange-300 sm:text-2xl"
                dir="ltr"
              >
                {formatPkr(filteredRefunds)}
              </p>
            </div>
            <div className="hidden h-8 w-px bg-[rgba(240,176,40,0.2)] sm:block" aria-hidden />
            <div>
              <p className="admin-filter-muted text-[11px]">{t("filteredCancelled")}</p>
              <p
                className="mt-0.5 text-xl font-bold tabular-nums leading-none tracking-tight text-stone-300 sm:text-2xl"
                dir="ltr"
              >
                {formatPkr(filteredCancelled.amount)}
              </p>
              {filteredCancelled.count > 0 ? (
                <p className="admin-filter-muted mt-1 text-[10px]">
                  {filteredCancelled.count} {t("orders").toLowerCase()}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className={`admin-filter-chip min-h-9 py-1.5 text-xs ${
              filtersActive ? "is-active" : "opacity-60"
            }`}
            disabled={!filtersActive || pageLoading}
            onClick={clearFilters}
          >
            {t("resetFilters")}
          </button>
        </div>
        {hasMore ? (
          <p className="admin-filter-muted mt-2 text-[11px] leading-snug">
            {t("ordersNewestShown").replace("{n}", String(orders.length))}
          </p>
        ) : null}
        </div>
      </div>

      {pageLoading ? <PageSpinner label={t("loading")} /> : null}

      {!pageLoading && loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} />
      ) : null}

      {!pageLoading && !loadError ? (
        <CollapsibleSection
          title={t("ordersHistory")}
          count={filtered.length}
          className="mb-0"
        >
          <div className="space-y-2 p-3 sm:space-y-2.5 sm:p-4">
            {filtered.map((o) => (
              <OrderListCard
                key={o.id}
                order={o}
                showBranch={profile?.role === "owner"}
                onClick={() => setSelected(o)}
              />
            ))}
            {filtered.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border)] bg-white/70 px-4 py-10 text-center text-sm text-[var(--muted)]">
                {orders.length === 0
                  ? t("noOrders")
                  : filtersActive || query.trim()
                    ? t("noOrderMatches")
                    : t("noOrders")}
              </p>
            ) : null}
            {hasMore ? (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAllLimit((n) => n + ALL_ORDERS_PAGE)}
                >
                  {t("loadOlderOrders")}
                </button>
              </div>
            ) : null}
          </div>
        </CollapsibleSection>
      ) : null}

      {!pageLoading && !loadError ? (
        <div className="mt-4">
          <SeeActivityLogLink entityType="order" />
        </div>
      ) : null}

      {selected && profile ? (
        <OrderDetailSheet
          order={selected}
          user={profile}
          settings={settings}
          branchName={
            selected.branchName ||
            branches.find((b) => b.id === selected.branchId)?.name
          }
          onClose={() => setSelected(null)}
          onSaved={(o) => {
            setOrders((list) => list.map((x) => (x.id === o.id ? o : x)));
          }}
          onDeleted={(id) => {
            setOrders((list) => list.filter((x) => x.id !== id));
          }}
        />
      ) : null}
    </div>
  );
}
