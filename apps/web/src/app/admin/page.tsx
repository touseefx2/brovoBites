"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Expense, Order, ShopSettings } from "@bravobites/domain";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  endOfBusinessDay,
  formatPkr,
  openingOfBusinessDay,
  money,
  shiftBusinessDateKey,
  startOfBusinessDay,
  startOfBusinessMonthKey,
} from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { shopNow } from "@/lib/shop-clock";
import { LoadError, PageSpinner } from "@/components/Loading";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import {
  readDashboardCache,
  writeDashboardCache,
  type DashboardAllTime,
  type DashboardMonthClosed,
} from "@/lib/admin-dashboard-cache";
import {
  fetchActiveOrderTotals,
  fetchBranches,
  fetchOrderTotalsBetween,
  onExpensesSnapshot,
  onOrdersSnapshot,
  onSettingsSnapshot,
} from "@/lib/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { PaymentMethodIcon } from "@/components/PaymentMethodIcon";
import { OrderDetailSheet } from "@/components/OrderDetailSheet";
import { OrderListCard } from "@/components/OrderListCard";
import { RequireAuth } from "@/components/RequireAuth";
import { SalesChart } from "@/components/SalesChart";

/** "Mon, 5 Oct" for an instant, in shop time. */
function shortDayLabel(d: Date, locale: string): string {
  return d.toLocaleDateString(locale === "ur" ? "ur-PK" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Karachi",
  });
}

function formatHm12(hm: string): string {
  const [hs, ms] = hm.split(":").map(Number);
  const h = hs ?? 0;
  const m = ms ?? 0;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

type BranchRef = { id: string; name: string };

function sameBranches(a: BranchRef[], b: BranchRef[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.name === b[i]!.name);
}

/** Offline copy is rewritten at most this often (and when the page hides). */
const PERSIST_EVERY_MS = 2 * 60_000;

function AdminDashboardPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const { t, locale } = useLocale();
  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Order | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  /** Shop hours unreadable — listen with default hours rather than never. */
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null);
  const [showingCache, setShowingCache] = useState(false);
  /** "branchIds|sinceIso" once every branch's window came from the server. */
  const [liveWindowKey, setLiveWindowKey] = useState<string | null>(null);
  /** Active orders before that window: server totals minus the window then. */
  const [allTimeBase, setAllTimeBase] = useState<(DashboardAllTime & { key: string }) | null>(null);
  /** This month's days before the live window, per branch (server totals). */
  const [monthClosed, setMonthClosed] = useState<DashboardMonthClosed | null>(null);
  const monthClosedRef = useRef<DashboardMonthClosed | null>(null);
  const showingCacheRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistAt = useRef(0);
  const settingsRef = useRef<ShopSettings | null>(null);
  const branchesRef = useRef<BranchRef[]>([]);
  const ordersRef = useRef<Order[]>([]);
  const expensesRef = useRef<Expense[]>([]);
  const sinceIsoRef = useRef<string | undefined>(undefined);
  /** Last all-time value on screen (server, or this PC's saved copy). */
  const allTimeRef = useRef<DashboardAllTime | null>(null);
  /** Per branch: active orders in the live window, and if they came from cache. */
  const windowTotalsRef = useRef(new Map<string, DashboardAllTime & { fromCache: boolean }>());
  const readyRef = useRef({ orders: new Set<string>(), expenses: new Set<string>() });
  const branchesFetchedRef = useRef(false);

  const dayHours = useMemo(
    () => businessDayHoursFromSettings(settings),
    [settings],
  );
  const todayKey = businessDateKey(shopNow(), dayHours);
  // Live orders: yesterday + today only (the cards, recent orders and the
  // hourly chart). Older days of the month / week come as server totals.
  const yesterdayKey = shiftBusinessDateKey(todayKey, -1);
  const sinceIso = useMemo(
    () => startOfBusinessDay(yesterdayKey, dayHours).toISOString(),
    [yesterdayKey, dayHours],
  );
  const monthStartIso = useMemo(
    () => startOfBusinessDay(startOfBusinessMonthKey(todayKey), dayHours).toISOString(),
    [todayKey, dayHours],
  );
  // Listeners key on ids — the same branches in a fresh array don't re-subscribe.
  const branchKey = useMemo(() => branches.map((b) => b.id).sort().join(","), [branches]);
  const hoursKnown = settings != null || settingsFailed;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    branchesRef.current = branches;
  }, [branches]);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);
  useEffect(() => {
    expensesRef.current = expenses;
  }, [expenses]);
  useEffect(() => {
    sinceIsoRef.current = sinceIso;
  }, [sinceIso]);
  useEffect(() => {
    monthClosedRef.current = monthClosed;
  }, [monthClosed]);

  const persistNow = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = null;
    if (!profile?.uid) return;
    // Don't overwrite a good cache with an empty first paint.
    if (branchesRef.current.length === 0) return;
    lastPersistAt.current = Date.now();
    void writeDashboardCache({
      uid: profile.uid,
      branches: branchesRef.current,
      settings: settingsRef.current,
      orders: ordersRef.current,
      expenses: expensesRef.current,
      sinceIso: sinceIsoRef.current,
      allTime: allTimeRef.current,
      monthClosed: monthClosedRef.current,
    }).then((row) => {
      setCacheSavedAt(row.savedAt);
      setShowingCache(false);
    });
  }, [profile?.uid]);

  // Each sale would rewrite the whole window to IndexedDB — save at most every
  // couple of minutes instead, and right away when the page hides or closes.
  const schedulePersist = useCallback(() => {
    if (!profile?.uid) return;
    if (branchesRef.current.length === 0) return;
    if (persistTimer.current) return;
    const wait = Math.max(800, lastPersistAt.current + PERSIST_EVERY_MS - Date.now());
    persistTimer.current = setTimeout(persistNow, wait);
  }, [profile?.uid, persistNow]);

  // Profile docs re-arrive as new objects — depend on the ids, not the array.
  const allowedIdsKey = (profile?.branchIds ?? []).join(",");
  const loadBranches = useCallback(async () => {
    if (!profile?.uid) return;
    setLoadError(null);

    const hasPaintedUi =
      branchesRef.current.length > 0 || ordersRef.current.length > 0;

    // Cache-first: paint immediately if this PC has a prior dashboard snapshot —
    // only while nothing is on screen, never over live listener data.
    const cached = hasPaintedUi ? null : await readDashboardCache(profile.uid);
    if (cached) {
      setBranches((prev) => (sameBranches(prev, cached.branches) ? prev : cached.branches));
      setOrders(cached.orders);
      setExpenses(cached.expenses);
      allTimeRef.current = cached.allTime ?? null;
      if (cached.monthClosed) setMonthClosed(cached.monthClosed);
      if (cached.settings) setSettings(cached.settings);
      setCacheSavedAt(cached.savedAt);
      setShowingCache(true);
      showingCacheRef.current = true;
      setLoading(false);
    } else if (!hasPaintedUi) {
      setLoading(true);
    }

    const netOn =
      typeof navigator === "undefined" ? true : navigator.onLine;
    if (!netOn) {
      if (!cached && !hasPaintedUi) {
        setLoadError(t("dashboardOfflineBanner"));
        setLoading(false);
      }
      return;
    }

    try {
      const b = await fetchBranches();
      const allowedIds = allowedIdsKey.split(",");
      const allowed = isOwner
        ? b.filter((x) => x.isActive)
        : b.filter((x) => x.isActive && allowedIds.includes(x.id));
      const next = allowed.map((x) => ({ id: x.id, name: x.name }));
      setBranches((prev) => (sameBranches(prev, next) ? prev : next));
      branchesFetchedRef.current = true;
      if (allowed.length === 0) setLoading(false);
    } catch (e) {
      if (!cached && !hasPaintedUi) {
        setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
        setLoading(false);
      }
      // Keep cached branches/orders if network fetch fails.
    }
  }, [locale, t, isOwner, allowedIdsKey, profile?.uid]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      // Listeners resume by themselves — only fetch branches if that never worked.
      if (!branchesFetchedRef.current) void loadBranches();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [loadBranches]);

  useEffect(() => {
    // Hiding / leaving the page: save now instead of waiting for the throttle.
    const flush = () => {
      if (persistTimer.current) persistNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [persistNow]);

  // Live shop settings (business day window) — updates chart when Landing saves.
  useEffect(() => {
    return onSettingsSnapshot(
      (s) => {
        setSettings(s);
        if (branchesRef.current.length > 0) schedulePersist();
      },
      (err) => {
        if (!settingsRef.current) {
          setLoadError(mapFirebaseError(err, locale) || t("loadFailed"));
          setSettingsFailed(true);
        }
      },
    );
  }, [locale, t, schedulePersist]);

  const maybeDone = useCallback(
    (branchCount: number) => {
      const ready = readyRef.current;
      if (ready.orders.size >= branchCount && ready.expenses.size >= branchCount) {
        setLoading(false);
        setShowingCache(false);
        showingCacheRef.current = false;
        schedulePersist();
      }
    },
    [schedulePersist],
  );

  // Real-time branch-wide orders (staff sees own branch incl. owner-created) —
  // from the oldest day shown on, not the branch's whole history.
  useEffect(() => {
    const ids = branchKey ? branchKey.split(",") : [];
    if (ids.length === 0) {
      if (!showingCacheRef.current) {
        setOrders([]);
        setExpenses([]);
      }
      setLiveWindowKey(null);
      setLoading(false);
      return;
    }
    // Shop hours decide where the window starts — don't open it twice.
    if (!hoursKnown) return;
    const key = `${branchKey}|${sinceIso}`;
    const ordersByBranch = new Map<string, Order[]>();
    const serverReady = new Set<string>();
    readyRef.current.orders = new Set();
    windowTotalsRef.current = new Map();
    setLiveWindowKey(null);
    const mergeOrders = () => {
      const next = Array.from(ordersByBranch.values()).flat();
      setOrders(next);
    };
    const unsubs: Unsubscribe[] = ids.map((id) =>
      onOrdersSnapshot(
        id,
        (o, fromCache) => {
          ordersByBranch.set(id, o);
          readyRef.current.orders.add(id);
          let sales = 0;
          let count = 0;
          for (const x of o) {
            if (x.status === "cancelled") continue;
            sales += x.total;
            count += 1;
          }
          windowTotalsRef.current.set(id, { sales, orders: count, fromCache });
          if (!fromCache) serverReady.add(id);
          if (serverReady.size >= ids.length) setLiveWindowKey(key);
          mergeOrders();
          maybeDone(ids.length);
        },
        (err) => {
          if (!showingCacheRef.current) {
            setLoadError(mapFirebaseError(err, locale) || t("loadFailed"));
          }
          readyRef.current.orders.add(id);
          maybeDone(ids.length);
        },
        // The all-time card waits for the server's word on this window — also
        // when the window is empty (no sales yesterday or today).
        { sinceIso, serverConfirm: true },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [branchKey, sinceIso, hoursKnown, locale, t, maybeDone]);

  // Expenses: the dashboard only shows today's.
  useEffect(() => {
    const ids = branchKey ? branchKey.split(",") : [];
    if (ids.length === 0 || !hoursKnown) return;
    const expensesByBranch = new Map<string, Expense[]>();
    readyRef.current.expenses = new Set();
    const mergeExpenses = () => {
      const next = Array.from(expensesByBranch.values()).flat();
      setExpenses(next);
    };
    const unsubs: Unsubscribe[] = ids.map((id) =>
      onExpensesSnapshot(
        id,
        (e) => {
          expensesByBranch.set(id, e);
          readyRef.current.expenses.add(id);
          mergeExpenses();
          maybeDone(ids.length);
        },
        (err) => {
          if (!showingCacheRef.current) {
            setLoadError(mapFirebaseError(err, locale) || t("loadFailed"));
          }
          readyRef.current.expenses.add(id);
          maybeDone(ids.length);
        },
        { fromKey: todayKey, toKey: todayKey },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [branchKey, todayKey, hoursKnown, locale, t, maybeDone]);

  // All-time card: server count/sum once the window is live — never the whole
  // order history. The live window adds every new sale after that, so it isn't
  // re-asked while open (each ask costs ~1 read per 1000 orders). Offline it
  // keeps the last known value.
  useEffect(() => {
    if (!liveWindowKey) return;
    const ids = liveWindowKey.split("|")[0]!.split(",");
    let alive = true;
    const refresh = async () => {
      try {
        const totals = await Promise.all(ids.map((id) => fetchActiveOrderTotals(id)));
        if (!alive) return;
        let sales = 0;
        let count = 0;
        for (let i = 0; i < ids.length; i++) {
          const w = windowTotalsRef.current.get(ids[i]!);
          // Window only from cache right now — keep the previous base.
          if (!w || w.fromCache) return;
          sales += totals[i]!.sales - w.sales;
          count += totals[i]!.orders - w.orders;
        }
        setAllTimeBase({ key: liveWindowKey, sales, orders: count });
      } catch {
        // Offline / failed — the card keeps its last known value.
      }
    };
    void refresh();
    return () => {
      alive = false;
    };
  }, [liveWindowKey]);

  // This month's days before the live window: server count/sum per branch —
  // a handful of reads instead of every order of the month. Offline the last
  // value (also kept in the offline copy) stays on screen.
  const monthClosedKey = `${branchKey}|${monthStartIso}|${sinceIso}`;
  useEffect(() => {
    const ids = branchKey ? branchKey.split(",") : [];
    if (!hoursKnown || ids.length === 0) return;
    if (monthStartIso >= sinceIso) {
      setMonthClosed({ key: monthClosedKey, byBranch: {} });
      return;
    }
    let alive = true;
    Promise.all(ids.map((id) => fetchOrderTotalsBetween(id, monthStartIso, sinceIso)))
      .then((totals) => {
        if (!alive) return;
        setMonthClosed({
          key: monthClosedKey,
          byBranch: Object.fromEntries(ids.map((id, i) => [id, totals[i]!])),
        });
        schedulePersist();
      })
      .catch(() => {
        // Offline / failed — keep the last value.
      });
    return () => {
      alive = false;
    };
  }, [monthClosedKey, branchKey, monthStartIso, sinceIso, hoursKnown, online, schedulePersist]);

  // Chart "Last 7 days" / "This month": days before the live window, asked
  // only when picked — server totals per day, summed over the branches.
  const loadDailyTotals = useCallback(
    async (keys: string[]) => {
      const ids = branchKey ? branchKey.split(",") : [];
      const out: Record<string, number> = {};
      await Promise.all(
        keys.map(async (k) => {
          const from = startOfBusinessDay(k, dayHours).toISOString();
          const to = startOfBusinessDay(shiftBusinessDateKey(k, 1), dayHours).toISOString();
          const totals = await Promise.all(ids.map((id) => fetchOrderTotalsBetween(id, from, to)));
          out[k] = totals.reduce((sum, x) => sum + x.sales, 0);
        }),
      );
      return out;
    },
    [branchKey, dayHours],
  );

  useRetryOnReconnect(Boolean(loadError) && !loading, () => {
    void loadBranches();
  });

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== "cancelled"),
    [orders],
  );
  // Full business day with dates, e.g. "Mon, 5 Oct 12:00 PM → Tue, 6 Oct 4:00 AM".
  const todayWindowLabel = `${shortDayLabel(openingOfBusinessDay(todayKey, dayHours), locale)} ${formatHm12(dayHours.start)} → ${shortDayLabel(endOfBusinessDay(todayKey, dayHours), locale)} ${formatHm12(dayHours.end)}`;

  const today = useMemo(() => {
    const start = startOfBusinessDay(todayKey, dayHours);
    const end = endOfBusinessDay(todayKey, dayHours);
    return activeOrders.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= start && d <= end;
    });
  }, [activeOrders, todayKey, dayHours]);

  const todayCancelledOrders = useMemo(() => {
    const start = startOfBusinessDay(todayKey, dayHours);
    const end = endOfBusinessDay(todayKey, dayHours);
    return orders.filter((o) => {
      if (o.status !== "cancelled") return false;
      const d = new Date(o.createdAt);
      return d >= start && d <= end;
    });
  }, [orders, todayKey, dayHours]);

  const yesterdayOrders = useMemo(() => {
    const yKey = shiftBusinessDateKey(todayKey, -1);
    const start = startOfBusinessDay(yKey, dayHours);
    const end = endOfBusinessDay(yKey, dayHours);
    return activeOrders.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= start && d <= end;
    });
  }, [activeOrders, todayKey, dayHours]);

  const month = useMemo(() => {
    const start = startOfBusinessDay(startOfBusinessMonthKey(todayKey), dayHours);
    const end = endOfBusinessDay(todayKey, dayHours);
    return activeOrders.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= start && d <= end;
    });
  }, [activeOrders, todayKey, dayHours]);

  const todaySales = today.reduce((s, o) => s + o.total, 0);
  const todayRefunds = today.reduce((s, o) => s + (o.refundAmount ?? 0), 0);
  const todayCancelled = todayCancelledOrders.reduce((s, o) => s + o.total, 0);
  const todayDiscounts = today.reduce((s, o) => s + (o.discountAmount ?? 0), 0);
  const todayTax = today.reduce((s, o) => s + (o.taxAmount ?? 0), 0);
  const todayDelivery = today.reduce((s, o) => s + (o.deliveryCharges ?? 0), 0);
  const todayItemRevenue = today.reduce(
    (s, o) => s + o.items.reduce((ls, i) => ls + i.lineTotal, 0),
    0,
  );
  const yesterdaySales = yesterdayOrders.reduce((s, o) => s + o.total, 0);
  // Month = server totals for its earlier days + live yesterday / today.
  const closedByBranch = monthClosed?.key === monthClosedKey ? monthClosed.byBranch : null;
  const closedMonth = closedByBranch
    ? Object.values(closedByBranch).reduce(
        (acc, x) => ({ sales: acc.sales + x.sales, orders: acc.orders + x.orders }),
        { sales: 0, orders: 0 },
      )
    : null;
  const monthSales = (closedMonth?.sales ?? 0) + month.reduce((s, o) => s + o.total, 0);
  const monthCount = (closedMonth?.orders ?? 0) + month.length;
  // Server totals before the window + the live window = every order, as before.
  const allTime: DashboardAllTime | null =
    allTimeBase && allTimeBase.key === `${branchKey}|${sinceIso}`
      ? {
          sales: allTimeBase.sales + activeOrders.reduce((s, o) => s + o.total, 0),
          orders: allTimeBase.orders + activeOrders.length,
        }
      : allTimeRef.current;
  useEffect(() => {
    allTimeRef.current = allTime;
  });
  const allTimeSameAsMonth =
    allTime != null &&
    closedMonth != null &&
    monthSales === allTime.sales &&
    monthCount === allTime.orders;
  const avgOrder = today.length > 0 ? money(todaySales / today.length) : 0;
  const salesDelta = money(todaySales - yesterdaySales);
  const todayHasSalesBridge =
    today.length > 0 &&
    (todayDiscounts > 0 || todayTax > 0 || todayDelivery > 0);

  const todayCash = today
    .filter((o) => o.paymentMethod === "cash")
    .reduce((s, o) => s + o.total - (o.refundAmount ?? 0), 0);
  const todayCard = today
    .filter((o) => o.paymentMethod === "card")
    .reduce((s, o) => s + o.total - (o.refundAmount ?? 0), 0);
  const todayDigital = today
    .filter((o) => o.paymentMethod === "digital")
    .reduce((s, o) => s + o.total - (o.refundAmount ?? 0), 0);

  const todayExpenses = useMemo(() => {
    return expenses
      .filter((e) => (e.date || e.createdAt || "").slice(0, 10) === todayKey)
      .reduce((s, e) => s + e.amount, 0);
  }, [expenses, todayKey]);

  const todayNet = money(todaySales - todayExpenses - todayRefunds);

  const branchStats = useMemo(() => {
    const start = startOfBusinessDay(todayKey, dayHours);
    const end = endOfBusinessDay(todayKey, dayHours);
    const monthStart = startOfBusinessDay(startOfBusinessMonthKey(todayKey), dayHours);
    return branches.map((b) => {
      const branchOrders = activeOrders.filter((o) => o.branchId === b.id);
      const branchToday = branchOrders.filter((o) => {
        const d = new Date(o.createdAt);
        return d >= start && d <= end;
      });
      const branchMonth = branchOrders.filter((o) => {
        const d = new Date(o.createdAt);
        return d >= monthStart && d <= end;
      });
      const branchTodayExpenses = expenses
        .filter((e) => e.branchId === b.id && (e.date || e.createdAt || "").slice(0, 10) === todayKey)
        .reduce((s, e) => s + e.amount, 0);
      return {
        id: b.id,
        name: b.name,
        todayCount: branchToday.length,
        todaySales: branchToday.reduce((s, o) => s + o.total, 0),
        todayExpenses: branchTodayExpenses,
        monthCount: (closedByBranch?.[b.id]?.orders ?? 0) + branchMonth.length,
        monthSales: (closedByBranch?.[b.id]?.sales ?? 0) + branchMonth.reduce((s, o) => s + o.total, 0),
      };
    });
  }, [activeOrders, branches, expenses, todayKey, dayHours, closedByBranch]);

  // Recent orders = this business day only (e.g. 12 PM → 4 AM), incl. cancelled.
  const recent = useMemo(
    () =>
      [...today, ...todayCancelledOrders]
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 6),
    [today, todayCancelledOrders],
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      {!online || showingCache ? (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-950 sm:text-sm">
          {!online
            ? t("dashboardOfflineBanner")
            : t("dashboardCachedBanner").replace(
                "{time}",
                cacheSavedAt
                  ? new Date(cacheSavedAt).toLocaleString(
                      locale === "ur" ? "ur-PK" : "en-GB",
                      { timeZone: "Asia/Karachi" },
                    )
                  : "—",
              )}
        </div>
      ) : null}
      {/* Hero header — espresso rail */}
      <header
        className="relative mb-5 overflow-hidden rounded-[1.25rem] border border-[rgba(228,193,90,0.22)] px-4 py-4 text-[#f5efe6] shadow-[0_18px_40px_rgba(28,25,23,0.18)] sm:mb-7 sm:px-6 sm:py-5"
        style={{
          background:
            "radial-gradient(ellipse 90% 80% at 100% 0%, rgba(201,162,39,0.22), transparent 50%), linear-gradient(145deg, #1c1814 0%, #161210 55%, #12100e 100%)",
        }}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#b8860b] via-[#e4c15a] to-[#c9a227]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#e4c15a]">
              Bravo Bites
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#f5efe6] sm:text-3xl">
              {t("dashboard")}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-8 items-center rounded-full bg-[#e4c15a] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#14110e] shadow-[0_0_0_1px_rgba(228,193,90,0.45)]">
                {t("today")}
              </span>
              <span
                className="inline-flex min-h-8 items-center rounded-full border border-[rgba(228,193,90,0.35)] bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-[#e4c15a]"
                dir="ltr"
              >
                {todayWindowLabel}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-snug text-[#a89880] sm:text-[13px]">
              {t("todayWindowHint")
                .replaceAll("{start}", formatHm12(dayHours.start))
                .replaceAll("{end}", formatHm12(dayHours.end))}
            </p>
          </div>
        </div>
      </header>

      {loading ? <PageSpinner label={t("loading")} /> : null}

      {!loading && loadError ? (
        <LoadError message={loadError} onRetry={() => void loadBranches()} retryLabel={t("retry")} />
      ) : null}

      {!loading && !loadError ? (
        <div className="space-y-5 sm:space-y-6">
          {/* Today's primary KPIs */}
          <div
            className={`grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 ${
              allTimeSameAsMonth ? "lg:grid-cols-4" : "lg:grid-cols-5"
            }`}
          >
            <div
              className="relative overflow-hidden rounded-2xl border border-[rgba(228,193,90,0.28)] p-4 shadow-[0_16px_36px_rgba(28,25,23,0.2)] sm:col-span-2 sm:p-5 lg:col-span-2"
              style={{
                background:
                  "radial-gradient(ellipse 90% 80% at 100% 0%, rgba(201,162,39,0.28), transparent 55%), linear-gradient(145deg, #1c1814 0%, #161210 100%)",
              }}
            >
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-[#e4c15a] to-transparent" />
              <div className="relative">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#e4c15a] sm:text-xs">
                  {t("todaySales")}
                </p>
                <p
                  className="mt-2 font-mono text-3xl font-bold tracking-tight text-[#f5efe6] sm:text-4xl"
                  dir="ltr"
                >
                  {formatPkr(todaySales)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {today.length === 0 ? (
                    <span className="text-[12px] text-[#c9b8a0]">{t("noOrdersToday")}</span>
                  ) : (
                    <>
                      <span className="inline-flex items-center rounded-lg bg-white/[0.08] px-2 py-1 text-[11px] font-semibold text-[#f5efe6] ring-1 ring-white/10">
                        {today.length} {t("todayOrders").toLowerCase()}
                      </span>
                      <span className="inline-flex items-center rounded-lg bg-white/[0.08] px-2 py-1 text-[11px] font-semibold text-[#e8e0d4] ring-1 ring-white/10" dir="ltr">
                        {t("avgOrderValue")}: {formatPkr(avgOrder)}
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-3 text-[12px] text-[#c9b8a0]">
                  <span>
                    {t("yesterday")}:{" "}
                    <span className="font-semibold text-[#f5efe6]" dir="ltr">
                      {formatPkr(yesterdaySales)}
                    </span>
                  </span>
                  {salesDelta !== 0 ? (
                    <span
                      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                        salesDelta > 0
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-red-500/15 text-red-300"
                      }`}
                    >
                      {salesDelta > 0 ? "↑" : "↓"}{" "}
                      <span dir="ltr">{formatPkr(Math.abs(salesDelta))}</span>{" "}
                      {salesDelta > 0 ? t("moreThanYesterday") : t("lessThanYesterday")}
                    </span>
                  ) : today.length > 0 && yesterdaySales > 0 ? (
                    <span className="text-[11px]">{t("sameAsYesterday")}</span>
                  ) : null}
                </div>
                {todayHasSalesBridge ? (
                  <p
                    className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-white/10 pt-3 text-[11px] leading-snug text-[#c9b8a0]"
                    dir="ltr"
                  >
                    <span>{t("itemRevenue")}</span>
                    <span className="font-semibold text-[#f5efe6]">
                      {formatPkr(todayItemRevenue)}
                    </span>
                    {todayDiscounts > 0 ? (
                      <>
                        <span className="text-white/30">−</span>
                        <span>{t("discount")}</span>
                        <span className="font-semibold text-emerald-300">
                          {formatPkr(todayDiscounts)}
                        </span>
                      </>
                    ) : null}
                    {todayTax > 0 ? (
                      <>
                        <span className="text-white/30">+</span>
                        <span>{t("tax")}</span>
                        <span className="font-semibold text-[#f5efe6]">
                          {formatPkr(todayTax)}
                        </span>
                      </>
                    ) : null}
                    {todayDelivery > 0 ? (
                      <>
                        <span className="text-white/30">+</span>
                        <span>{t("deliveryCharges")}</span>
                        <span className="font-semibold text-[#f5efe6]">
                          {formatPkr(todayDelivery)}
                        </span>
                      </>
                    ) : null}
                    <span className="text-white/30">=</span>
                    <span className="font-semibold text-[#e4c15a]">
                      {formatPkr(todaySales)}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-[rgba(184,134,11,0.2)] bg-gradient-to-b from-white to-[#faf7f2] p-4 shadow-[0_10px_28px_rgba(28,25,23,0.06)] sm:p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--gold-deep)] sm:text-xs">
                {t("todayNet")}
              </p>
              <p
                className={`mt-2 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl ${
                  todayNet >= 0 ? "text-emerald-700" : "text-red-600"
                }`}
                dir="ltr"
              >
                {todayNet >= 0 ? "" : "−"}
                {formatPkr(Math.abs(todayNet))}
              </p>
              <p className="mt-2 text-[11px] leading-snug text-[var(--muted)] sm:text-xs">
                {t("todayNetHint")}
              </p>
            </div>

            <div className="rounded-2xl border border-[rgba(184,134,11,0.2)] bg-gradient-to-b from-white to-[#faf7f2] p-4 shadow-[0_10px_28px_rgba(28,25,23,0.06)] sm:p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--gold-deep)] sm:text-xs">
                {t("thisMonth")}
              </p>
              <p
                className="mt-2 text-2xl font-bold tabular-nums text-[var(--gold-deep)] sm:text-3xl"
                dir="ltr"
              >
                {closedMonth ? formatPkr(monthSales) : "—"}
              </p>
              <p className="mt-2 text-[11px] text-[var(--muted)] sm:text-xs">
                <span className="font-semibold text-[var(--ink)]">{closedMonth ? monthCount : "—"}</span>{" "}
                {t("monthOrders").toLowerCase()}
              </p>
              {allTimeSameAsMonth ? (
                <p className="mt-2 text-[11px] leading-snug text-[var(--muted)] sm:text-xs">
                  {t("allSalesThisMonth")}
                </p>
              ) : null}
            </div>

            {!allTimeSameAsMonth ? (
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/90 p-4 shadow-[0_10px_28px_rgba(28,25,23,0.05)] sm:p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-500 sm:text-xs">
                  {t("allTimeSales")}
                </p>
                <p
                  className="mt-2 text-xl font-bold tabular-nums text-[var(--ink)] sm:text-2xl"
                  dir="ltr"
                >
                  {allTime ? formatPkr(allTime.sales) : "—"}
                </p>
                <p className="mt-2 text-[11px] text-[var(--muted)] sm:text-xs">
                  <span className="font-semibold text-[var(--ink)]">{allTime ? allTime.orders : "—"}</span>{" "}
                  {t("allTimeOrders").toLowerCase()}
                </p>
              </div>
            ) : null}
          </div>

          {/* Payment breakdown + daily deductions */}
          <section className="overflow-hidden rounded-2xl border border-[rgba(184,134,11,0.18)] bg-white shadow-[0_12px_32px_rgba(28,25,23,0.06)]">
            <div className="flex items-center justify-between gap-3 border-b border-[rgba(184,134,11,0.12)] bg-gradient-to-r from-[#faf7f2] to-white px-4 py-3 sm:px-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--gold-deep)]">
                  {t("today")}
                </p>
                <h2 className="text-sm font-bold text-[var(--ink)] sm:text-base">
                  {t("paymentBreakdown")}
                </h2>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3 sm:gap-3 sm:p-4 lg:grid-cols-5">
              {(
                [
                  {
                    key: "cash",
                    label: t("cash"),
                    value: todayCash,
                    tone: "ink" as const,
                    icon: <PaymentMethodIcon method="cash" />,
                  },
                  {
                    key: "card",
                    label: t("card"),
                    value: todayCard,
                    tone: "ink" as const,
                    icon: <PaymentMethodIcon method="card" />,
                  },
                  {
                    key: "digital",
                    label: t("digital"),
                    value: todayDigital,
                    tone: "ink" as const,
                    icon: <PaymentMethodIcon method="digital" />,
                  },
                  ...(todayDiscounts > 0
                    ? [
                        {
                          key: "discounts",
                          label: t("todayDiscounts"),
                          value: todayDiscounts,
                          tone: "emerald" as const,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ),
                        },
                      ]
                    : []),
                  ...(todayTax > 0
                    ? [
                        {
                          key: "tax",
                          label: t("todayTax"),
                          value: todayTax,
                          tone: "ink" as const,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <path d="M14 2v6h6M9 13h6M9 17h4" strokeLinecap="round" />
                            </svg>
                          ),
                        },
                      ]
                    : []),
                  ...(todayDelivery > 0
                    ? [
                        {
                          key: "delivery",
                          label: t("todayDelivery"),
                          value: todayDelivery,
                          tone: "ink" as const,
                          icon: (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                              <path d="M3 7h11v10H3z" />
                              <path d="M14 10h4l3 3v4h-7V10z" />
                              <circle cx="7" cy="18" r="1.5" />
                              <circle cx="17.5" cy="18" r="1.5" />
                            </svg>
                          ),
                        },
                      ]
                    : []),
                  {
                    key: "expenses",
                    label: t("todayExpenses"),
                    value: todayExpenses,
                    tone: "red" as const,
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6M8 13h8M8 17h5" strokeLinecap="round" />
                      </svg>
                    ),
                  },
                  {
                    key: "refunds",
                    label: t("todayRefunds"),
                    value: todayRefunds,
                    tone: "orange" as const,
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                        <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" />
                        <path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ),
                  },
                  {
                    key: "cancelled",
                    label: t("todayCancelled"),
                    value: todayCancelled,
                    tone: "stone" as const,
                    count: todayCancelledOrders.length,
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M8 8l8 8M16 8l-8 8" strokeLinecap="round" />
                      </svg>
                    ),
                  },
                ] as const
              ).map((cell) => (
                <div
                  key={cell.key}
                  className={`rounded-xl border p-3 sm:p-3.5 ${
                    cell.tone === "red"
                      ? "border-red-200/70 bg-red-50/50"
                      : cell.tone === "orange"
                        ? "border-orange-200/70 bg-orange-50/40"
                        : cell.tone === "emerald"
                          ? "border-emerald-200/70 bg-emerald-50/50"
                          : cell.tone === "stone"
                            ? "border-stone-200/80 bg-stone-50/70"
                          : "border-[rgba(184,134,11,0.14)] bg-[#faf7f2]/70"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ${
                        cell.tone === "red"
                          ? "bg-red-100/80 text-red-600 ring-red-200/80"
                          : cell.tone === "orange"
                            ? "bg-orange-100/80 text-orange-600 ring-orange-200/80"
                            : cell.tone === "emerald"
                              ? "bg-emerald-100/80 text-emerald-700 ring-emerald-200/80"
                              : cell.tone === "stone"
                                ? "bg-stone-200/80 text-stone-600 ring-stone-300/80"
                              : "bg-[rgba(184,134,11,0.12)] text-[var(--gold-deep)] ring-[rgba(184,134,11,0.22)]"
                      }`}
                    >
                      {cell.icon}
                    </span>
                    <p className="min-w-0 truncate text-[11px] font-semibold text-[var(--muted)] sm:text-xs">
                      {cell.label}
                    </p>
                  </div>
                  <p
                    className={`mt-2 text-lg font-bold tabular-nums sm:text-xl ${
                      cell.tone === "red"
                        ? "text-red-600"
                        : cell.tone === "orange"
                          ? "text-orange-600"
                          : cell.tone === "emerald"
                            ? "text-emerald-700"
                            : cell.tone === "stone"
                              ? "text-stone-600"
                            : "text-[var(--ink)]"
                    }`}
                    dir="ltr"
                  >
                    {cell.tone === "emerald" && cell.value > 0
                      ? `−${formatPkr(cell.value)}`
                      : formatPkr(cell.value)}
                  </p>
                  {"count" in cell && cell.count != null ? (
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      {cell.count} {t("orders").toLowerCase()}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {/* Sales chart */}
          <SalesChart
            key={`${branchKey}|${dayHours.start}|${dayHours.end}`}
            orders={activeOrders}
            dayHours={dayHours}
            todaySummary={{ sales: todaySales, orders: today.length }}
            liveFromKey={yesterdayKey}
            loadDailyTotals={loadDailyTotals}
          />

          {/* Branch-wise breakdown (owner only) */}
          {isOwner && branches.length > 1 && (
            <section className="overflow-hidden rounded-2xl border border-[rgba(184,134,11,0.18)] bg-white shadow-[0_12px_32px_rgba(28,25,23,0.06)]">
              <div className="border-b border-[rgba(184,134,11,0.12)] bg-gradient-to-r from-[#faf7f2] to-white px-4 py-3.5 sm:px-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--gold-deep)]">
                  {t("branches")}
                </p>
                <h2 className="text-base font-bold text-[var(--ink)]">{t("branchWiseSales")}</h2>
              </div>
              <div className="divide-y divide-[rgba(184,134,11,0.1)]">
                {branchStats.map((b) => (
                  <div key={b.id} className="px-4 py-3.5 transition hover:bg-[#faf7f2]/50 sm:px-5">
                    <p className="text-sm font-bold text-[var(--ink)]">{b.name}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex items-center rounded-lg bg-[rgba(184,134,11,0.1)] px-2 py-1 text-[11px] font-semibold text-[var(--gold-deep)] ring-1 ring-[rgba(184,134,11,0.2)]">
                        {t("todaySales")}:{" "}
                        <span className="ms-1 font-bold" dir="ltr">{formatPkr(b.todaySales)}</span>
                        <span className="mx-1 text-[var(--gold-deep)]/40">·</span>
                        {b.todayCount} {t("orders").toLowerCase()}
                      </span>
                      <span className="inline-flex items-center rounded-lg bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-red-200/70">
                        {t("todayExpenses")}:{" "}
                        <span className="ms-1 font-bold" dir="ltr">{formatPkr(b.todayExpenses)}</span>
                      </span>
                      <span className="inline-flex items-center rounded-lg bg-stone-100 px-2 py-1 text-[11px] font-semibold text-stone-700 ring-1 ring-stone-200">
                        {t("thisMonth")}:{" "}
                        <span className="ms-1 font-bold" dir="ltr">{formatPkr(b.monthSales)}</span>
                        <span className="mx-1 text-stone-400">·</span>
                        {b.monthCount} {t("orders").toLowerCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent orders */}
          <section className="overflow-hidden rounded-2xl border border-[rgba(184,134,11,0.18)] bg-white shadow-[0_12px_32px_rgba(28,25,23,0.06)]">
            <div className="flex items-center justify-between gap-3 border-b border-[rgba(184,134,11,0.12)] bg-gradient-to-r from-[#faf7f2] to-white px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--gold-deep)]">
                  {t("today")}
                </p>
                <h2 className="text-base font-bold text-[var(--ink)] sm:text-lg">
                  {t("recentOrders")}
                </h2>
              </div>
              <Link
                href="/admin/orders"
                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-b from-[#e4c15a] via-[#c9a227] to-[#b8860b] px-3 py-1.5 text-xs font-bold text-[#14110e] shadow-[0_0_0_1px_rgba(228,193,90,0.35)] transition hover:brightness-105"
              >
                {t("viewAllOrders")}
                <svg
                  className="size-3.5 rtl:rotate-180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  aria-hidden
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
            </div>

            {recent.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[var(--muted)] sm:px-5">
                {t("noOrdersToday")}
              </p>
            ) : (
              <ul className="space-y-2 p-3 sm:space-y-2.5 sm:p-4">
                {recent.map((o) => (
                  <li key={o.id}>
                    <OrderListCard
                      order={o}
                      dense
                      showBranch
                      onClick={() => setSelected(o)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
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

export default function AdminDashboardRoute() {
  return (
    <RequireAuth roles={["owner", "counter"]}>
      <AdminDashboardPage />
    </RequireAuth>
  );
}
