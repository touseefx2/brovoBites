"use client";

import { useEffect, useMemo, useState } from "react";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  customerKpis,
  formatPhone,
  formatPkr,
  searchCustomers,
  startOfBusinessDay,
  startOfBusinessMonthKey,
  type Customer,
  type ShopSettings,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { mapFirebaseError } from "@/lib/errors";
import { shopNow } from "@/lib/shop-clock";
import { LoadError, PageSpinner } from "@/components/Loading";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CustomerDetailSheet, shopDate } from "@/components/CustomerDetailSheet";
import { manageCustomer, onCustomersSnapshot } from "@/lib/customers";
import { onSettingsSnapshot } from "@/lib/firestore";

type Segment = "all" | "repeat" | "once" | "new";
type Sort = "last" | "orders" | "spent" | "name";
const PAGE = 100;

/**
 * Customers: everyone who ordered with a phone number — how many came back,
 * who orders most, their note, addresses and orders. Owner/staff both see it
 * (full numbers, as the shop decided); only the owner renames / merges / recounts.
 */
export default function CustomersPage() {
  const { t, locale } = useLocale();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [sort, setSort] = useState<Sort>("last");
  const [shown, setShown] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recountOpen, setRecountOpen] = useState(false);
  const [recountBusy, setRecountBusy] = useState(false);
  const [recountMsg, setRecountMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    return onCustomersSnapshot(
      (list) => {
        setCustomers(list);
        setLoadError(null);
      },
      (e) => setLoadError(mapFirebaseError(e)),
    );
  }, [profile]);

  useEffect(() => onSettingsSnapshot(setSettings, () => {}), []);

  /** Start of this business month (shop hours), for "new this month". */
  const monthStartIso = useMemo(() => {
    const hours = businessDayHoursFromSettings(settings);
    return startOfBusinessDay(startOfBusinessMonthKey(businessDateKey(shopNow(), hours)), hours).toISOString();
  }, [settings]);

  const all = useMemo(() => customers ?? [], [customers]);
  const kpis = useMemo(() => customerKpis(all, monthStartIso), [all, monthStartIso]);

  const list = useMemo(() => {
    let rows = query.trim() ? searchCustomers(all, query, 1000) : all.filter((c) => c.orderCount > 0 || c.note);
    rows = rows.filter((c) =>
      segment === "repeat"
        ? c.orderCount >= 2
        : segment === "once"
          ? c.orderCount === 1
          : segment === "new"
            ? c.orderCount > 0 && c.firstOrderAt >= monthStartIso
            : true,
    );
    if (!query.trim()) {
      rows = [...rows].sort((a, b) =>
        sort === "orders"
          ? b.orderCount - a.orderCount || b.lastOrderAt.localeCompare(a.lastOrderAt)
          : sort === "spent"
            ? b.totalSpent - a.totalSpent
            : sort === "name"
              ? a.name.localeCompare(b.name)
              : b.lastOrderAt.localeCompare(a.lastOrderAt),
      );
    }
    return rows;
  }, [all, query, segment, sort, monthStartIso]);

  useEffect(() => setShown(PAGE), [query, segment, sort]);

  const selected = selectedId ? all.find((c) => c.id === selectedId) ?? null : null;

  async function recount() {
    setRecountBusy(true);
    setRecountMsg(null);
    try {
      const res = (await manageCustomer({ action: "rebuild" })) as { customers?: number } | undefined;
      setRecountMsg(t("customersRecountDone").replace("{n}", String(res?.customers ?? 0)));
    } catch (e) {
      setRecountMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRecountBusy(false);
      setRecountOpen(false);
    }
  }

  const kpi = (label: string, value: string, hint?: string) => (
    <div className="admin-filter-chip flex min-h-0 flex-col items-start rounded-xl px-3 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</span>
      <span className="text-xl font-bold tabular-nums" dir="ltr">
        {value}
      </span>
      {hint ? <span className="text-[11px] text-[var(--muted)]">{hint}</span> : null}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5">
        <div className="min-w-0">
          <p className="admin-page-eyebrow">{t("navGroupSales")}</p>
          <h1 className="admin-page-title">{t("customers")}</h1>
          <p className="admin-page-sub">{t("customersHint")}</p>
        </div>
        {isOwner ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRecountOpen(true)} disabled={recountBusy}>
            {t("customersRecount")}
          </button>
        ) : null}
      </div>
      {recountMsg ? <p className="mb-3 rounded-xl bg-white px-3 py-2 text-sm text-stone-700 ring-1 ring-stone-200">{recountMsg}</p> : null}

      <div className="admin-filter-panel mb-4">
        <div className="admin-filter-divider grid grid-cols-3 gap-2 border-b p-3 sm:p-4">
          {kpi(t("customersTotal"), String(kpis.total))}
          {kpi(t("customersRepeat"), `${kpis.repeat}`, `${kpis.repeatPct}%`)}
          {kpi(t("customersNewMonth"), String(kpis.newSince))}
        </div>
        <div className="space-y-2 p-3 sm:p-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("customersSearch")}
            autoComplete="off"
            enterKeyHint="search"
            className="input w-full text-base sm:text-sm"
            disabled={customers === null}
          />
          <div className="grid grid-cols-2 gap-2">
            <select className="input w-full text-sm" value={segment} onChange={(e) => setSegment(e.target.value as Segment)}>
              <option value="all">{t("customersSegAll")}</option>
              <option value="repeat">{t("customersSegRepeat")}</option>
              <option value="once">{t("customersSegOnce")}</option>
              <option value="new">{t("customersSegNew")}</option>
            </select>
            <select
              className="input w-full text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              disabled={Boolean(query.trim())}
            >
              <option value="last">{t("customersSortLast")}</option>
              <option value="orders">{t("customersSortOrders")}</option>
              <option value="spent">{t("customersSortSpent")}</option>
              <option value="name">{t("customersSortName")}</option>
            </select>
          </div>
        </div>
      </div>

      {loadError ? (
        <LoadError message={loadError} onRetry={() => window.location.reload()} retryLabel={t("retry")} />
      ) : customers === null ? (
        <PageSpinner label={t("loading")} />
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] bg-white/70 px-4 py-10 text-center text-sm text-[var(--muted)]">
          {all.length === 0 ? t("noCustomers") : t("noResults")}
        </p>
      ) : (
        <ul className="admin-section-card divide-y divide-[var(--border)]" data-testid="customer-list">
          {list.slice(0, shown).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-[#fff6ea]"
                onClick={() => setSelectedId(c.id)}
                data-customer={c.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <bdi className="truncate font-semibold text-[var(--ink)]">{c.name || t("customerNoName")}</bdi>
                    {c.orderCount >= 3 ? (
                      <span className="shrink-0 rounded-full bg-[#fdeccb] px-2 text-[10px] font-bold uppercase text-[var(--gold-deep)]">
                        {t("customerRegular")}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm tabular-nums text-stone-600" dir="ltr">
                    {formatPhone(c.id)}
                  </p>
                  {c.note ? <p className="truncate text-xs font-semibold text-[var(--gold-deep)]">✎ {c.note}</p> : null}
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-sm font-bold text-[var(--ink)]">
                    {t(c.orderCount === 1 ? "customerOrdersOne" : "customerOrders").replace("{n}", String(c.orderCount))}
                  </p>
                  <p className="text-xs tabular-nums text-stone-600" dir="ltr">
                    {formatPkr(c.totalSpent)}
                  </p>
                  <p className="text-[11px] text-stone-500">{shopDate(c.lastOrderAt, locale)}</p>
                </div>
              </button>
            </li>
          ))}
          {list.length > shown ? (
            <li className="p-3 text-center">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShown((n) => n + PAGE)}>
                {t("orLoadMore").replace("{n}", String(list.length - shown))}
              </button>
            </li>
          ) : null}
        </ul>
      )}

      {selected && profile ? (
        <CustomerDetailSheet
          key={selected.id}
          customer={selected}
          all={all}
          user={profile}
          settings={settings}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      <ConfirmDialog
        open={recountOpen}
        title={t("customersRecount")}
        message={t("customersRecountConfirm")}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={recountBusy}
        onCancel={() => setRecountOpen(false)}
        onConfirm={() => void recount()}
      />
    </div>
  );
}
