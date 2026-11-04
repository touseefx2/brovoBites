"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Branch, Expense, Order, ShopSettings } from "@bravobites/domain";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  endOfBusinessDay,
  openingOfBusinessDay,
  shiftBusinessDateKey,
  startOfBusinessDay,
  startOfBusinessMonthKey,
} from "@bravobites/domain";
import type { Unsubscribe } from "firebase/firestore";
import { LoadError, PageSpinner } from "@/components/Loading";
import { OrderDetailSheet } from "@/components/OrderDetailSheet";
import { OwnerReportView, useOwnerReportExtras, useReportCatalog, useWithLocalPending } from "@/components/OwnerReport";
import { useLocale } from "@/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { mapFirebaseError } from "@/lib/errors";
import {
  countOrdersInRange,
  fetchBranches,
  fetchOwners,
  onExpensesSnapshot,
  onOrdersSnapshot,
  onSettingsSnapshot,
} from "@/lib/firestore";
import { openDatePicker } from "@/lib/open-date-picker";
import { computeOwnerReport } from "@/lib/owner-report";
import { periodText } from "@/lib/owner-report-text";
import { shopNow } from "@/lib/shop-clock";

type Preset = "today" | "yesterday" | "last7" | "month" | "custom" | "all";

/**
 * Up to this many orders a period loads by itself; above it the owner is
 * shown the size first (a long period costs reads every time it is opened).
 */
const AUTO_LOAD_ORDERS = 1500;

export default function OwnerReportPage() {
  const { t, locale } = useLocale();
  const { profile, activeBranchId } = useAuth();
  /** Staff only look: their own branches, no opening orders. */
  const isOwner = profile?.role === "owner";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [ownerUids, setOwnerUids] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const [preset, setPreset] = useState<Preset>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
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

  const boot = useCallback(async () => {
    setBooting(true);
    setLoadError(null);
    try {
      const [b, owners] = await Promise.all([fetchBranches(), fetchOwners()]);
      const active = b.filter(
        (x) => x.isActive && (isOwner || (profile?.branchIds ?? []).includes(x.id)),
      );
      setBranches(active);
      setOwnerUids(new Set(owners.map((u) => u.uid)));
      setBranchId((cur) =>
        cur && (cur === "all" || active.some((x) => x.id === cur))
          ? cur
          : activeBranchId && active.some((x) => x.id === activeBranchId)
            ? activeBranchId
            : active.length > 1
              ? "all"
              : active[0]?.id ?? "",
      );
    } catch (e) {
      setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
    } finally {
      setBooting(false);
    }
  }, [activeBranchId, locale, t, isOwner, profile?.branchIds]);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      onSettingsSnapshot((s) => {
        setSettings(s);
        setSettingsReady(true);
      }),
    [],
  );

  const dayHours = useMemo(() => businessDayHoursFromSettings(settings), [settings]);
  const todayKey = businessDateKey(shopNow(), dayHours);
  const datesSet = useRef(false);
  useEffect(() => {
    if (!settingsReady || datesSet.current) return;
    datesSet.current = true;
    setDateFrom(shiftBusinessDateKey(todayKey, -6));
    setDateTo(todayKey);
  }, [settingsReady, todayKey]);

  const validDay = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k);
  const range = useMemo((): { fromKey: string | null; toKey: string } | null => {
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
      case "all":
        return { fromKey: null, toKey: todayKey };
      case "custom": {
        if (!validDay(dateFrom) || !validDay(dateTo)) return null;
        const [a, b] = dateFrom <= dateTo ? [dateFrom, dateTo] : [dateTo, dateFrom];
        return { fromKey: a, toKey: b > todayKey ? todayKey : b };
      }
    }
  }, [preset, todayKey, dateFrom, dateTo]);

  const from = range?.fromKey ? startOfBusinessDay(range.fromKey, dayHours) : null;
  const to = range ? endOfBusinessDay(range.toKey, dayHours) : null;
  const sinceIso = from?.toISOString();
  const untilIso = to?.toISOString() ?? "";
  const multiDay = !range || range.fromKey !== range.toKey;
  const branchIds = useMemo(
    () => (branchId === "all" ? branches.map((b) => b.id) : branchId ? [branchId] : []),
    [branchId, branches],
  );
  const branchKey = branchIds.join(",");
  const periodKey = range && settingsReady ? `${branchKey}|${range.fromKey ?? "*"}|${range.toKey}` : "";

  // Today / yesterday load at once; a longer period is counted first (one
  // cheap server count per branch) and loads by itself only when small.
  const small = preset === "today" || preset === "yesterday";
  const [sized, setSized] = useState<{ key: string; n: number } | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [approvedKey, setApprovedKey] = useState("");
  /** Bumped by Retry — runs the count / listeners again. */
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setSizeError(null);
    if (!periodKey || small || !branchKey || !online) return;
    if (sized?.key === periodKey) return;
    let alive = true;
    void Promise.all(branchKey.split(",").map((b) => countOrdersInRange(b, sinceIso, untilIso)))
      .then((ns) => {
        if (!alive) return;
        const n = ns.reduce((s, x) => s + x, 0);
        setSized({ key: periodKey, n });
        if (n <= AUTO_LOAD_ORDERS) setApprovedKey(periodKey);
      })
      .catch((e) => {
        if (alive) setSizeError(mapFirebaseError(e, locale));
      });
    return () => {
      alive = false;
    };
  }, [periodKey, small, branchKey, sinceIso, untilIso, online, sized?.key, locale, reload]);

  const approved = !!periodKey && (small || approvedKey === periodKey);

  // The period's orders + expenses (per branch, never whole collections).
  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [dataKey, setDataKey] = useState("");
  const [dataError, setDataError] = useState<string | null>(null);
  useEffect(() => {
    setDataError(null);
    if (!approved || !range) return;
    const ids = branchKey.split(",");
    const ordersBy = new Map<string, Order[]>();
    const expensesBy = new Map<string, Expense[]>();
    const unsubs: Unsubscribe[] = [];
    const settle = () => {
      if (ordersBy.size === ids.length && expensesBy.size === ids.length) {
        setOrders([...ordersBy.values()].flat());
        setExpenses([...expensesBy.values()].flat());
        setDataKey(periodKey);
      }
    };
    for (const b of ids) {
      unsubs.push(
        onOrdersSnapshot(
          b,
          (o) => {
            ordersBy.set(b, o);
            settle();
          },
          (err) => setDataError(mapFirebaseError(err, locale)),
          { sinceIso, untilIso },
        ),
      );
      unsubs.push(
        onExpensesSnapshot(
          b,
          (e) => {
            expensesBy.set(b, e);
            settle();
          },
          (err) => setDataError(mapFirebaseError(err, locale)),
          range.fromKey ? { fromKey: range.fromKey, toKey: range.toKey } : { toKey: range.toKey },
        ),
      );
    }
    return () => unsubs.forEach((u) => u());
    // periodKey covers branch + range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, periodKey, locale, reload]);

  const extras = useOwnerReportExtras({
    branchIds,
    sinceIso,
    untilIso,
    fromKey: range?.fromKey ?? null,
    toKey: range?.toKey ?? todayKey,
    enabled: approved,
    withLocal: true,
  });
  // On the POS PC: its sales / changes / expenses not on the cloud yet count
  // too (like the POS Day End Report). Elsewhere the queue is empty.
  const local = useWithLocalPending({ branchIds, orders, expenses, enabled: approved });

  const catalog = useReportCatalog(approved);

  const report = useMemo(
    () =>
      approved && range && to && dataKey === periodKey
        ? computeOwnerReport({
            orders: local.orders,
            expenses: local.expenses,
            logs: extras.logs,
            pendingLogIds: extras.pendingIds,
            drawers: extras.drawers,
            stock: extras.stock,
            from,
            to,
            fromKey: range.fromKey,
            toKey: range.toKey,
            ownerUids,
            catalog,
          })
        : null,
    // from/to follow periodKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approved, dataKey, periodKey, local.orders, local.expenses, extras.logs, extras.pendingIds, extras.drawers, extras.stock, ownerUids, catalog],
  );

  const [selected, setSelected] = useState<Order | null>(null);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name;

  const presets: { id: Preset; label: string }[] = [
    { id: "today", label: t("dateToday") },
    { id: "yesterday", label: t("dateYesterday") },
    { id: "last7", label: t("dateLast7") },
    { id: "month", label: t("dateThisMonth") },
    { id: "custom", label: t("dateCustom") },
    { id: "all", label: t("dateAll") },
  ];

  const waitingForSize = !small && !!periodKey && !approved;
  const bigPeriod = waitingForSize && sized?.key === periodKey && sized.n > AUTO_LOAD_ORDERS;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 sm:mb-5">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{t("ownerReport")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("ownerReportHint")}</p>
        </div>
        {report ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            {t("orLiveNote")}
          </span>
        ) : null}
      </div>

      <div className="admin-filter-panel mb-5 p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5 sm:gap-2" role="group" aria-label={t("orPeriod")}>
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preset === p.id}
                className={`admin-filter-chip text-xs sm:text-sm ${preset === p.id ? "is-active" : ""}`}
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
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
          {branches.length > 1 ? (
            <select
              className="input w-full min-w-0 text-sm sm:max-w-xs"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              aria-label={t("branch")}
            >
              <option value="all">{t("allBranches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {booting || !settingsReady ? (
        <PageSpinner label={t("loading")} />
      ) : loadError ? (
        <LoadError message={loadError} onRetry={() => void boot()} retryLabel={t("retry")} />
      ) : !range ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">{t("orPickRange")}</p>
      ) : waitingForSize ? (
        !online ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">{t("orNeedOnline")}</p>
        ) : sizeError ? (
          <LoadError
            message={`${t("orCountFailed")} ${sizeError}`}
            onRetry={() => setReload((n) => n + 1)}
            retryLabel={t("retry")}
          />
        ) : bigPeriod ? (
          <section
            className="rounded-2xl border border-[#e8dfcf] bg-white p-5 shadow-sm"
            data-testid="owner-big-period"
          >
            <h2 className="text-lg font-bold text-[var(--ink)]">
              {t("orBigRangeTitle").replace("{n}", sized!.n.toLocaleString("en-PK"))}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              {t("orBigRangeHint").replace("{reads}", Math.ceil(sized!.n * 1.1).toLocaleString("en-PK"))}
            </p>
            <button
              type="button"
              className="btn mt-4 min-h-11"
              onClick={() => setApprovedKey(periodKey)}
            >
              {t("orLoadReport")}
            </button>
          </section>
        ) : (
          <PageSpinner label={t("orCounting")} />
        )
      ) : dataError ? (
        <LoadError message={dataError} onRetry={() => setReload((n) => n + 1)} retryLabel={t("retry")} />
      ) : !report || !extras.ready ? (
        <PageSpinner label={t("loading")} />
      ) : (
        <OwnerReportView
          report={report}
          multiDay={multiDay}
          multiBranch={branchIds.length > 1}
          branchNameFor={branchName}
          onOpenOrder={
            isOwner
              ? (id) => {
                  const o = orders.find((x) => x.id === id);
                  if (o) setSelected(o);
                }
              : undefined
          }
          canOpenOrder={(id) => orders.some((x) => x.id === id)}
          extrasError={extras.error}
          drawerFailed={extras.drawerError}
          print={{
            shopName: settings?.shopName || t("brand"),
            branchLabel: branchId === "all" ? t("allBranches") : branchName(branchId),
            periodLabel: periodText({
              from: range.fromKey ? openingOfBusinessDay(range.fromKey, dayHours) : null,
              to: to!,
              locale,
              t,
            }),
            paper: settings?.receiptPaper,
            paperWidthMm: settings?.receiptPrintWidthMm,
            fromKey: range.fromKey,
            toKey: range.toKey,
            periodFrom: range.fromKey ? openingOfBusinessDay(range.fromKey, dayHours) : null,
            periodTo: to!,
            allBranches: branchId === "all",
            isOwner,
          }}
        />
      )}

      {selected && profile && isOwner ? (
        <OrderDetailSheet
          order={selected}
          user={profile}
          settings={settings}
          branchName={selected.branchName || branchName(selected.branchId)}
          onClose={() => setSelected(null)}
          onSaved={(o) => setSelected(o)}
          onDeleted={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
