"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Branch,
  BusinessDayHours,
  CashDrawerSession,
  Expense,
  Order,
  ShopSettings,
} from "@bravobites/domain";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  endOfBusinessDay,
  formatPkr,
  money,
  startOfBusinessDay,
} from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { shopNow } from "@/lib/shop-clock";
import {
  applyPendingExpenseOps,
  applyPendingOrderOps,
  listActiveQueuedExpenses,
  listActiveQueuedMutations,
  listActiveQueuedOrders,
  subscribeQueue,
  type QueuedExpense,
  type QueuedMutation,
  type QueuedOrder,
} from "@/lib/pos-queue";
import { PageSpinner, LoadError } from "@/components/Loading";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import {
  closeCashDrawer,
  fetchBranches,
  fetchDayFromServer,
  fetchCashBackFromServer,
  fetchOwners,
  onCashDrawersSnapshot,
  onExpensesSnapshot,
  onOrdersSnapshot,
  onCashBackOrdersSnapshot,
  onSettingsSnapshot,
  openCashDrawer,
} from "@/lib/firestore";
import type { Unsubscribe } from "firebase/firestore";

function formatHm12(hm: string): string {
  const [hs, ms] = hm.split(":").map(Number);
  const h = hs ?? 0;
  const m = ms ?? 0;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Where a drawer's count starts: its business day's start — or, when a drawer
 * was already closed earlier that day, that close (a reopened drawer must not
 * count the same sales and expenses again).
 */
function drawerWindow(
  session: CashDrawerSession,
  sessions: CashDrawerSession[],
  hours: BusinessDayHours,
): { fromMs: number; toMs: number; reopened: boolean } {
  let fromMs = startOfBusinessDay(session.date, hours).getTime();
  const toMs = endOfBusinessDay(session.date, hours).getTime();
  const openedMs = new Date(session.openedAt).getTime();
  let reopened = false;
  for (const s of sessions) {
    if (s.id === session.id || s.date !== session.date) continue;
    if (s.status !== "closed" || !s.closedAt) continue;
    const closedMs = new Date(s.closedAt).getTime();
    if (closedMs <= openedMs && closedMs > fromMs) {
      fromMs = closedMs;
      reopened = true;
    }
  }
  return { fromMs, toMs, reopened };
}

/**
 * Cash that should be in the drawer: opening + cash sales made in the window −
 * cash handed back in the window (refunds and cancels, whatever day the sale
 * was — the cash leaves the drawer then) − that day's expenses. A sale
 * cancelled in the same drawer nets to nothing.
 */
function drawerCash(params: {
  dateKey: string;
  window: { fromMs: number; toMs: number; reopened: boolean };
  /** Start of the drawer's business day. */
  dayStartMs: number;
  /**
   * Owners: a sale of an earlier business day cancelled now leaves this drawer
   * only when an owner cancelled it — in the app staff can't cancel an earlier
   * day's sale, so a staff-made one is ignored here.
   */
  ownerUids: Set<string>;
  orders: Order[];
  expenses: Expense[];
  openingBalance: number;
}) {
  const { fromMs, toMs, reopened } = params.window;
  const inWindow = (iso: string | undefined) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return t >= fromMs && t <= toMs;
  };
  const cashOrders = params.orders.filter((o) => o.paymentMethod === "cash");

  const soldHere = cashOrders
    .filter((o) => inWindow(o.createdAt))
    .reduce((s, o) => s + o.total, 0);
  // A cancel hands back what is left after refunds; it was done at updatedAt.
  const soldEarlierDay = (o: Order) => new Date(o.createdAt).getTime() < params.dayStartMs;
  const cancelledHere = cashOrders
    .filter(
      (o) =>
        o.status === "cancelled" &&
        inWindow(o.updatedAt ?? o.createdAt) &&
        (!soldEarlierDay(o) || (!!o.updatedBy && params.ownerUids.has(o.updatedBy))),
    )
    .reduce((s, o) => s + Math.max(0, o.total - (o.refundAmount ?? 0)), 0);
  const cashSales = soldHere - cancelledHere;

  const cashRefunds = cashOrders.reduce((s, o) => s + refundsInWindow(o, inWindow), 0);

  const cashExpenses = params.expenses
    .filter(
      (e) =>
        (e.date || e.createdAt || "").slice(0, 10) === params.dateKey &&
        (!reopened || inWindow(e.createdAt)),
    )
    .reduce((s, e) => s + e.amount, 0);

  const expected = money(params.openingBalance + cashSales - cashExpenses - cashRefunds);
  return { cashSales, cashRefunds, cashExpenses, expected };
}

/**
 * Cash refunded on this order inside the window, by each refund's own time.
 * Refunds from before that log only have the latest refundedAt: the amount the
 * log doesn't cover counts at that time — or on the sale's day once a newer
 * refund has taken over refundedAt.
 */
function refundsInWindow(o: Order, inWindow: (iso: string | undefined) => boolean): number {
  const refunded = o.refundAmount ?? 0;
  let logged = 0;
  let sum = 0;
  for (const r of o.refunds ?? []) {
    // Never more than the order's refund total, whatever the log says.
    const amount = Math.min(r.amount, Math.max(0, money(refunded - logged)));
    logged += amount;
    if (inWindow(r.at)) sum += amount;
  }
  const unlogged = money(refunded - logged);
  if (unlogged > 0 && inWindow(o.refunds?.length ? o.createdAt : (o.refundedAt ?? o.createdAt))) {
    sum += unlogged;
  }
  return sum;
}

/** Same id ⇒ counted once (an order sold and refunded in the window is in both lists). */
function mergeOrders(...lists: Order[][]): Order[] {
  const byId = new Map<string, Order>();
  for (const list of lists) for (const o of list) byId.set(o.id, o);
  return [...byId.values()];
}

export default function CashDrawerPage() {
  const { t, locale } = useLocale();
  const { profile, activeBranchId } = useAuth();
  const isOwner = profile?.role === "owner";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [sessions, setSessions] = useState<CashDrawerSession[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [refundedOrders, setRefundedOrders] = useState<Order[]>([]);
  /** Who the owners are (an earlier day's sale cancelled today counts only when they did it). */
  const [ownerUids, setOwnerUids] = useState<Set<string>>(new Set());
  /** False until the owner list loads: auto-close saves expected cash for good, so it waits. */
  const [ownersReady, setOwnersReady] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  // This PC's queue: sales / changes / expenses not on Firestore yet.
  const [queued, setQueued] = useState<QueuedOrder[]>([]);
  const [mutations, setMutations] = useState<QueuedMutation[]>([]);
  const [expenseOps, setExpenseOps] = useState<QueuedExpense[]>([]);
  const [queueReady, setQueueReady] = useState(false);
  const [ordersReady, setOrdersReady] = useState(false);
  const [refundsReady, setRefundsReady] = useState(false);
  const [expensesReady, setExpensesReady] = useState(false);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoCloseNote, setAutoCloseNote] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => shopNow().getTime());
  useEffect(() => {
    if (ownersReady) return;
    let alive = true;
    // A failed lookup tries again on the next tick.
    fetchOwners()
      .then((owners) => {
        if (!alive) return;
        setOwnerUids(new Set(owners.map((o) => o.uid)));
        setOwnersReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ownersReady, nowTick]);

  const [openFormVisible, setOpenFormVisible] = useState(false);
  const [openingBalance, setOpeningBalance] = useState(0);

  const [closeFormVisible, setCloseFormVisible] = useState(false);
  const [confirmCloseDrawer, setConfirmCloseDrawer] = useState(false);
  const [closingCount, setClosingCount] = useState(0);

  const autoClosingRef = useRef(false);

  const dayHours = useMemo(
    () => businessDayHoursFromSettings(settings),
    [settings],
  );
  const now = useMemo(() => new Date(nowTick), [nowTick]);
  const today = businessDateKey(now, dayHours);
  const dayStart = startOfBusinessDay(today, dayHours);
  const dayEnd = endOfBusinessDay(today, dayHours);
  const withinBusinessDay = now >= dayStart && now <= dayEnd;
  const dayEnded = now > dayEnd;
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = dayEnd.toISOString();

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
        branchId && allowed.some((x) => x.id === branchId)
          ? branchId
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

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(shopNow().getTime()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    const unsubs: Unsubscribe[] = [];

    unsubs.push(
      onCashDrawersSnapshot(
        branchId,
        (s) => {
          setSessions(s);
          setLoading(false);
        },
        (err) => {
          setLoadError(mapFirebaseError(err, locale));
          setLoading(false);
        },
      ),
    );

    return () => unsubs.forEach((u) => u());
  }, [branchId, locale]);

  // Only today's business day — not the branch's whole order / expense
  // history. Waits for settings so it doesn't first load a calendar day and
  // then reload.
  const settingsReady = settings != null;
  useEffect(() => {
    if (!branchId || !settingsReady) return;
    setOrdersReady(false);
    setRefundsReady(false);
    setExpensesReady(false);
    const unsubs: Unsubscribe[] = [
      onOrdersSnapshot(
        branchId,
        (o) => {
          setOrders(o);
          setOrdersReady(true);
        },
        (err) => {
          setLoadError(mapFirebaseError(err, locale));
          setOrdersReady(true);
        },
        { sinceIso: dayStartIso, untilIso: dayEndIso },
      ),
      // Refunded or cancelled during this drawer — also sales of earlier days.
      onCashBackOrdersSnapshot(branchId, dayStartIso, (o) => {
        setRefundedOrders(o);
        setRefundsReady(true);
      }),
      onExpensesSnapshot(
        branchId,
        (e) => {
          setExpenses(e);
          setExpensesReady(true);
        },
        (err) => {
          setLoadError(mapFirebaseError(err, locale));
          setExpensesReady(true);
        },
        { fromKey: today, toKey: today },
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [branchId, locale, settingsReady, dayStartIso, dayEndIso, today]);

  // This PC's queue — re-read whenever it changes (new sale, synced, failed…).
  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    setQueueReady(false);
    const unsub = subscribeQueue(() => {
      void Promise.all([
        listActiveQueuedOrders(),
        listActiveQueuedMutations(),
        listActiveQueuedExpenses(),
      ]).then(([q, m, e]) => {
        if (!alive) return;
        setQueued(q.filter((x) => x.branchId === branchId));
        setMutations(m.filter((x) => x.orderBefore.branchId === branchId));
        setExpenseOps(e.filter((x) => x.branchId === branchId));
        setQueueReady(true);
      });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [branchId]);

  useRetryOnReconnect(Boolean(loadError) && !loading, () => void load());

  // Auto-close any open drawer whose business day has ended.
  useEffect(() => {
    if (
      !profile ||
      !settings ||
      loading ||
      !ordersReady ||
      !expensesReady ||
      !queueReady ||
      !ownersReady ||
      autoClosingRef.current
    ) {
      return;
    }

    const hours = businessDayHoursFromSettings(settings);
    const current = shopNow();
    const expired = sessions.filter(
      (s) => s.status === "open" && current > endOfBusinessDay(s.date, hours),
    );
    if (expired.length === 0) return;

    autoClosingRef.current = true;
    void (async () => {
      try {
        // Expected cash is saved for good — from fresh server data plus what
        // this PC still has to upload (a failed row may wait days for the
        // right login), so the drawer never stays open because of it.
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        for (const session of expired) {
          // Sessions of the branch just switched away from: its own page closes them.
          if (session.branchId !== branchId) continue;
          const range = {
            branchId: session.branchId,
            sinceIso: startOfBusinessDay(session.date, hours).toISOString(),
            untilIso: endOfBusinessDay(session.date, hours).toISOString(),
          };
          let day;
          let refunded;
          try {
            [day, refunded] = await Promise.all([
              fetchDayFromServer(range),
              fetchCashBackFromServer(range),
            ]);
          } catch {
            return; // offline / cache only — next tick tries again
          }
          const { expected } = drawerCash({
            dateKey: session.date,
            window: drawerWindow(session, sessions, hours),
            dayStartMs: new Date(range.sinceIso).getTime(),
            ownerUids,
            orders: applyPendingOrderOps(mergeOrders(refunded, day.orders), queued, mutations).list,
            expenses: applyPendingExpenseOps(day.expenses, expenseOps).list,
            openingBalance: session.openingBalance,
          });
          await closeCashDrawer({
            sessionId: session.id,
            closingCount: expected,
            expectedCash: expected,
            user: profile,
            auto: true,
          });
        }
        setAutoCloseNote(t("drawerAutoClosedNote"));
        setCloseFormVisible(false);
        setConfirmCloseDrawer(false);
      } catch (e) {
        setError(mapFirebaseError(e, locale));
      } finally {
        autoClosingRef.current = false;
      }
    })();
  }, [
    sessions,
    orders,
    expenses,
    settings,
    profile,
    loading,
    ordersReady,
    expensesReady,
    queued,
    mutations,
    expenseOps,
    queueReady,
    locale,
    t,
    nowTick,
    branchId,
    ownerUids,
    ownersReady,
  ]);

  const todayOpenSession = useMemo(
    () => sessions.find((s) => s.date === today && s.status === "open"),
    [sessions, today],
  );

  // Cloud + this PC's unsynced sales / changes / expenses: the cash taken for
  // a sale still waiting to upload is already in the drawer.
  const todayStats = useMemo(() => {
    const span = todayOpenSession
      ? drawerWindow(todayOpenSession, sessions, dayHours)
      : {
          fromMs: new Date(dayStartIso).getTime(),
          toMs: new Date(dayEndIso).getTime(),
          reopened: false,
        };
    // Today's rows on this PC that are not on the cloud yet (shown as a note).
    const inDay = (iso: string | undefined) => !!iso && iso >= dayStartIso && iso <= dayEndIso;
    const pendingToday =
      queued.filter((q) => inDay(q.createdAt)).length +
      mutations.filter((m) => inDay(m.orderAfter.createdAt) || inDay(m.occurredAt)).length +
      expenseOps.filter((e) => e.date === today).length;
    return {
      ...drawerCash({
        dateKey: today,
        window: span,
        dayStartMs: new Date(dayStartIso).getTime(),
        ownerUids,
        orders: applyPendingOrderOps(mergeOrders(refundedOrders, orders), queued, mutations).list,
        expenses: applyPendingExpenseOps(expenses, expenseOps).list,
        openingBalance: todayOpenSession?.openingBalance ?? 0,
      }),
      pendingToday,
    };
  }, [
    orders,
    refundedOrders,
    expenses,
    queued,
    mutations,
    expenseOps,
    today,
    todayOpenSession,
    sessions,
    dayHours,
    dayStartIso,
    dayEndIso,
    ownerUids,
  ]);

  const statsReady = ordersReady && refundsReady && expensesReady && queueReady;

  const pastSessions = useMemo(
    () => sessions.filter((s) => s.status === "closed").slice(0, 30),
    [sessions],
  );

  // An earlier day's drawer still open: it auto-closes once this device is online.
  const staleOpenSessions = sessions.filter(
    (s) => s.status === "open" && s.date !== today && now > endOfBusinessDay(s.date, dayHours),
  );

  const startLabel = formatHm12(dayHours.start);
  const endLabel = formatHm12(dayHours.end);

  async function handleOpenDrawer() {
    if (!profile || !branchId) return;
    if (!withinBusinessDay) {
      setError(t("drawerOpenOnlyDuringDay"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { session, alreadyOpen } = await openCashDrawer({
        branchId,
        openingBalance,
        user: profile,
      });
      setOpenFormVisible(false);
      setOpeningBalance(0);
      if (alreadyOpen) {
        setError(t("drawerAlreadyOpen").replace("{name}", session.openedByName));
      }
    } catch (e) {
      setError(mapFirebaseError(e, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseDrawer() {
    if (!profile || !todayOpenSession) return;
    setBusy(true);
    setError(null);
    try {
      await closeCashDrawer({
        sessionId: todayOpenSession.id,
        closingCount,
        expectedCash: todayStats.expected,
        user: profile,
      });
      setConfirmCloseDrawer(false);
      setCloseFormVisible(false);
      setClosingCount(0);
    } catch (e) {
      setError(mapFirebaseError(e, locale));
      setConfirmCloseDrawer(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 sm:mb-5">
        <h1 className="admin-page-title">{t("cashDrawer")}</h1>
        <p className="admin-page-sub">{t("cashDrawerHint")}</p>
      </div>

      {/* Simple guide */}
      <section className="mb-4 rounded-2xl border border-[rgba(197,138,14,0.22)] bg-[#fff4e8] p-4 sm:p-5">
        <h2 className="text-sm font-bold text-[var(--ink)]">{t("cashDrawerGuideTitle")}</h2>
        <p className="mt-1.5 text-sm text-[var(--muted)] leading-relaxed">
          {t("cashDrawerGuideWhat")}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">
          {t("cashDrawerGuideHow")
            .replaceAll("{start}", startLabel)
            .replaceAll("{end}", endLabel)}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">
          {t("cashDrawerGuideExample")
            .replaceAll("{start}", startLabel)
            .replaceAll("{end}", endLabel)}
        </p>
        <p className="mt-2 text-xs font-semibold text-[var(--gold-deep)] leading-relaxed">
          {t("cashDrawerGuideAuto")
            .replaceAll("{end}", endLabel)}
        </p>
      </section>

      {isOwner && branches.length > 1 && (
        <div className="mb-5">
          <select
            className="input min-w-0 text-sm"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            dir="ltr"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <div className="toast-error mb-4">{error}</div>}
      {autoCloseNote && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {autoCloseNote}
        </div>
      )}
      {staleOpenSessions.map((s) => (
        <div
          key={s.id}
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {t("drawerStaleOpen").replace("{date}", s.date)}
        </div>
      ))}

      {loading ? <PageSpinner label={t("loading")} /> : null}
      {!loading && loadError ? <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} /> : null}

      {!loading && !loadError && (
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]" dir="ltr">
            {t("businessDaySection")}: {today} · {startLabel} → {endLabel}
            {dayEnded ? ` · ${t("drawerDayEnded")}` : withinBusinessDay ? ` · ${t("drawerDayActive")}` : ""}
          </p>

          {todayOpenSession ? (
            <section className="rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 sm:px-5">
                <div>
                  <h2 className="font-bold text-[var(--ink)]">{t("drawerOpen")}</h2>
                  <p className="text-xs text-[var(--muted)]">
                    {todayOpenSession.openedByName}
                  </p>
                </div>
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                  {t("drawerOpen")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
                <div className="bg-white p-4">
                  <p className="text-xs font-medium text-[var(--muted)]">{t("openingBalance")}</p>
                  <p className="mt-1 text-lg font-bold text-[var(--ink)]" dir="ltr">{formatPkr(todayOpenSession.openingBalance)}</p>
                </div>
                <div className="bg-white p-4">
                  <p className="text-xs font-medium text-[var(--muted)]">{t("cash")}</p>
                  <p className="mt-1 text-lg font-bold text-green-600" dir="ltr">
                    {todayStats.cashSales < 0 ? "−" : "+"}
                    {formatPkr(Math.abs(todayStats.cashSales))}
                  </p>
                </div>
                <div className="bg-white p-4">
                  <p className="text-xs font-medium text-[var(--muted)]">{t("expenses")}</p>
                  <p className="mt-1 text-lg font-bold text-red-600" dir="ltr">-{formatPkr(todayStats.cashExpenses)}</p>
                </div>
                <div className="bg-white p-4">
                  <p className="text-xs font-medium text-[var(--muted)]">{t("expectedCash")}</p>
                  <p className="mt-1 text-xl font-bold text-[var(--gold-deep)]" dir="ltr">{formatPkr(todayStats.expected)}</p>
                </div>
              </div>
              {todayStats.cashRefunds > 0 && (
                <div className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
                  {t("totalRefunds")}: <span className="font-semibold text-orange-600" dir="ltr">{formatPkr(todayStats.cashRefunds)}</span>
                </div>
              )}
              {todayStats.pendingToday > 0 && (
                <div className="border-t border-[var(--border)] px-4 py-2 text-xs font-medium text-amber-800">
                  {t("drawerPendingIncluded").replace("{count}", String(todayStats.pendingToday))}
                </div>
              )}
              <div className="border-t border-[var(--border)] p-4">
                {!closeFormVisible ? (
                  <button
                    type="button"
                    className="btn w-full min-h-11 py-3"
                    // Expected cash must include today's orders and refunds first.
                    disabled={busy || !statsReady}
                    onClick={() => {
                      setClosingCount(0);
                      setCloseFormVisible(true);
                    }}
                  >
                    {t("closeDrawer")}
                  </button>
                ) : (
                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-[var(--ink)]">{t("closingCount")}</label>
                    <input
                      type="number"
                      min={0}
                      value={closingCount || ""}
                      onChange={(e) => setClosingCount(Math.max(0, Number(e.target.value) || 0))}
                      className="input w-full min-h-11 text-base sm:text-sm"
                      dir="ltr"
                      autoFocus
                    />
                    {closingCount > 0 && (
                      <div className="rounded-lg bg-stone-50 p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[var(--muted)]">{t("drawerDifference")}</span>
                          <span
                            className={`font-bold ${
                              money(closingCount - todayStats.expected) === 0
                                ? "text-green-600"
                                : money(closingCount - todayStats.expected) > 0
                                  ? "text-blue-600"
                                  : "text-red-600"
                            }`}
                            dir="ltr"
                          >
                            {money(closingCount - todayStats.expected) === 0
                              ? t("drawerMatch")
                              : `${money(closingCount - todayStats.expected) > 0 ? "+" : ""}${formatPkr(money(closingCount - todayStats.expected))}`}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost min-h-11 flex-1"
                        disabled={busy}
                        onClick={() => setCloseFormVisible(false)}
                      >
                        {t("cancel")}
                      </button>
                      <button
                        type="button"
                        className="btn min-h-11 flex-1"
                        disabled={busy || !statsReady || closingCount <= 0}
                        onClick={() => setConfirmCloseDrawer(true)}
                      >
                        {busy ? t("saving") : t("closeDrawer")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5">
              {!withinBusinessDay ? (
                <div className="text-center">
                  <p className="mb-1 text-sm font-semibold text-[var(--ink)]">{t("drawerDayEnded")}</p>
                  <p className="mb-3 text-sm text-[var(--muted)]">
                    {t("drawerOpensAt").replace("{start}", startLabel)}
                  </p>
                </div>
              ) : !openFormVisible ? (
                <div className="text-center">
                  <p className="mb-3 text-sm text-[var(--muted)]">{t("noCashDrawers")}</p>
                  <button
                    type="button"
                    className="btn min-h-11 px-8 py-3"
                    disabled={busy}
                    onClick={() => setOpenFormVisible(true)}
                  >
                    {t("openDrawer")}
                  </button>
                </div>
              ) : (
                <div className="mx-auto max-w-sm space-y-3">
                  <label className="block text-xs font-semibold text-[var(--ink)]">{t("openingBalance")}</label>
                  <input
                    type="number"
                    min={0}
                    value={openingBalance || ""}
                    onChange={(e) => setOpeningBalance(Math.max(0, Number(e.target.value) || 0))}
                    className="input w-full min-h-11 text-base sm:text-sm"
                    dir="ltr"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost min-h-11 flex-1"
                      disabled={busy}
                      onClick={() => setOpenFormVisible(false)}
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      className="btn min-h-11 flex-1"
                      disabled={busy}
                      onClick={() => void handleOpenDrawer()}
                    >
                      {busy ? t("saving") : t("openDrawer")}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {pastSessions.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
              <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
                <h2 className="font-bold text-[var(--ink)]">{t("drawerClosed")}</h2>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {pastSessions.map((s) => {
                  const diff = s.difference ?? 0;
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--ink)]" dir="ltr">{s.date}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {t("openingBalance")}: <span dir="ltr">{formatPkr(s.openingBalance)}</span>
                          {" | "}{t("expectedCash")}: <span dir="ltr">{formatPkr(s.expectedCash ?? 0)}</span>
                          {" | "}{t("closingCount")}:{" "}
                          {s.closingCount == null ? (
                            t("drawerNotCounted")
                          ) : (
                            <span dir="ltr">{formatPkr(s.closingCount)}</span>
                          )}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {s.autoClosed ? t("drawerAutoClosedBy") : s.closedByName}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                          s.autoClosed
                            ? "bg-amber-100 text-amber-800"
                            : diff === 0
                              ? "bg-green-100 text-green-700"
                              : diff > 0
                                ? "bg-blue-100 text-blue-700"
                                : "bg-red-100 text-red-700"
                        }`}
                        dir="ltr"
                      >
                        {s.autoClosed
                          ? t("drawerAutoClosedBadge")
                          : diff === 0
                            ? t("drawerMatch")
                            : `${diff > 0 ? "+" : ""}${formatPkr(diff)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmCloseDrawer}
        title={t("closeDrawerTitle")}
        message={t("confirmCloseDrawer")}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={busy}
        danger
        focusConfirm
        onCancel={() => {
          if (!busy) setConfirmCloseDrawer(false);
        }}
        onConfirm={() => void handleCloseDrawer()}
      />
    </div>
  );
}
