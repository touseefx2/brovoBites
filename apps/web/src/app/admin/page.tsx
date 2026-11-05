"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/**
 * One end of the business day. The date follows the page direction and the
 * time is always left-to-right, each isolated so Urdu never splits "12:00 AM".
 */
function DayWindowEnd({ date, time }: { date: string; time: string }) {
  return (
    <span className="dash-window-end">
      <bdi>{date}</bdi> <bdi dir="ltr">{time}</bdi>
    </span>
  );
}

/** A translated sentence with {start}/{end} swapped for left-to-right isolated times. */
function withTimes(template: string, times: { start: string; end: string }): ReactNode[] {
  return template.split(/(\{start\}|\{end\})/).map((part, i) =>
    part === "{start}" || part === "{end}" ? (
      <bdi key={i} dir="ltr">
        {part === "{start}" ? times.start : times.end}
      </bdi>
    ) : (
      part
    ),
  );
}

type BranchRef = { id: string; name: string };

function sameBranches(a: BranchRef[], b: BranchRef[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.name === b[i]!.name);
}

type PayTone = "cash" | "card" | "digital" | "good" | "plain" | "bad" | "warn" | "muted";

/** Cheese-drip edge (the logo's mustard bite) hanging from the top of the brand card. */
const DRIP_PATH = (() => {
  const w = 400;
  const band = 7;
  // [centre x, width, length]
  const drips: [number, number, number][] = [
    [326, 14, 26],
    [292, 10, 13],
    [252, 12, 19],
    [366, 9, 11],
  ];
  let d = `M0 0H${w}V${band}`;
  for (const [x, dw, len] of [...drips].sort((a, b) => b[0] - a[0])) {
    const r = dw / 2;
    const xr = x + r;
    const xl = x - r;
    d += `H${xr + 4}Q${xr} ${band} ${xr} ${band + 4}V${band + len}A${r} ${r} 0 0 1 ${xl} ${band + len}V${band + 4}Q${xl} ${band} ${xl - 4} ${band}`;
  }
  return `${d}H0Z`;
})();

function DripEdge() {
  return (
    <svg className="dash-drip" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden>
      <path d={DRIP_PATH} />
    </svg>
  );
}

const ICON = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function KpiIcon({
  name,
}: {
  name: "sales" | "net" | "month" | "alltime" | "wallet" | "branch" | "receipt";
}) {
  switch (name) {
    case "sales":
      return (
        <svg {...ICON}>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </svg>
      );
    case "net":
      return (
        <svg {...ICON}>
          <path d="M12 3v18" />
          <path d="M5 8h14" />
          <path d="M5 8l-2.5 6a3 3 0 0 0 5 0L5 8zM19 8l-2.5 6a3 3 0 0 0 5 0L19 8z" />
          <path d="M8 21h8" />
        </svg>
      );
    case "month":
      return (
        <svg {...ICON}>
          <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
          <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
          <path d="M7.5 14h3M13.5 14h3M7.5 17.5h3" />
        </svg>
      );
    case "alltime":
      return (
        <svg {...ICON}>
          <path d="M8 21h8M12 17v4" />
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
          <path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 4M17 6h2.5a2.5 2.5 0 0 1-2.5 4" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...ICON}>
          <path d="M3 7a2 2 0 0 1 2-2h12v4" />
          <path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" />
          <circle cx="16" cy="14.5" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
    case "branch":
      return (
        <svg {...ICON}>
          <path d="M3 21h18" />
          <path d="M5 21V10l7-5 7 5v11" />
          <path d="M10 21v-6h4v6" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...ICON}>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </svg>
      );
  }
}

function TileIcon({
  name,
}: {
  name: "discount" | "tax" | "delivery" | "expenses" | "refunds" | "cancelled";
}) {
  switch (name) {
    case "discount":
      return (
        <svg {...ICON}>
          <path d="M19 5L5 19" />
          <circle cx="7" cy="7" r="2.5" />
          <circle cx="17" cy="17" r="2.5" />
        </svg>
      );
    case "tax":
      return (
        <svg {...ICON}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M9 13h6M9 17h4" />
        </svg>
      );
    case "delivery":
      return (
        <svg {...ICON}>
          <path d="M3 7h11v10H3z" />
          <path d="M14 10h4l3 3v4h-7V10z" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="17.5" cy="18" r="1.5" />
        </svg>
      );
    case "expenses":
      return (
        <svg {...ICON}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h5" />
        </svg>
      );
    case "refunds":
      return (
        <svg {...ICON}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
      );
    case "cancelled":
      return (
        <svg {...ICON}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
        </svg>
      );
  }
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
  const todayWindowFrom = {
    date: shortDayLabel(openingOfBusinessDay(todayKey, dayHours), locale),
    time: formatHm12(dayHours.start),
  };
  const todayWindowTo = {
    date: shortDayLabel(endOfBusinessDay(todayKey, dayHours), locale),
    time: formatHm12(dayHours.end),
  };

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

  const welcomeName = (profile?.displayName || profile?.email?.split("@")[0] || "").trim();
  const welcome = welcomeName
    ? t("dashWelcome").replace("{name}", welcomeName)
    : t("brand");

  const payCells: {
    key: string;
    label: string;
    value: number;
    tone: PayTone;
    count?: number;
    icon: ReactNode;
  }[] = [
    { key: "cash", label: t("cash"), value: todayCash, tone: "cash", icon: <PaymentMethodIcon method="cash" size={18} /> },
    { key: "card", label: t("card"), value: todayCard, tone: "card", icon: <PaymentMethodIcon method="card" size={18} /> },
    { key: "digital", label: t("digital"), value: todayDigital, tone: "digital", icon: <PaymentMethodIcon method="digital" size={18} /> },
    ...(todayDiscounts > 0
      ? [{ key: "discounts", label: t("todayDiscounts"), value: todayDiscounts, tone: "good" as const, icon: <TileIcon name="discount" /> }]
      : []),
    ...(todayTax > 0
      ? [{ key: "tax", label: t("todayTax"), value: todayTax, tone: "plain" as const, icon: <TileIcon name="tax" /> }]
      : []),
    ...(todayDelivery > 0
      ? [{ key: "delivery", label: t("todayDelivery"), value: todayDelivery, tone: "plain" as const, icon: <TileIcon name="delivery" /> }]
      : []),
    { key: "expenses", label: t("todayExpenses"), value: todayExpenses, tone: "bad", icon: <TileIcon name="expenses" /> },
    { key: "refunds", label: t("todayRefunds"), value: todayRefunds, tone: "warn", icon: <TileIcon name="refunds" /> },
    {
      key: "cancelled",
      label: t("todayCancelled"),
      value: todayCancelled,
      tone: "muted",
      count: todayCancelledOrders.length,
      icon: <TileIcon name="cancelled" />,
    },
  ];

  return (
    <div className="dash mx-auto w-full max-w-6xl">
      {!online || showingCache ? (
        <div className="dash-banner" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <span>
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
          </span>
        </div>
      ) : null}

      {/* Hero — the logo's dark radial background */}
      <header className="dash-hero">
        <Image
          src="/logo.png"
          alt=""
          width={176}
          height={176}
          className="dash-hero-badge"
          aria-hidden
          priority
        />
        <div className="dash-hero-body">
          <p className="dash-hero-eyebrow">{welcome}</p>
          <h1 className="dash-hero-title">{t("dashboard")}</h1>
          <div className="dash-hero-pills">
            <span className="dash-pill dash-pill--today">{t("today")}</span>
            <span className="dash-pill dash-pill--window">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <span className="dash-window-range">
                <DayWindowEnd date={todayWindowFrom.date} time={todayWindowFrom.time} />
                <svg className="dash-window-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                <DayWindowEnd date={todayWindowTo.date} time={todayWindowTo.time} />
              </span>
            </span>
            {online && !showingCache ? (
              <span className="dash-pill dash-pill--live">
                <span className="dash-live-dot" aria-hidden />
                {t("dashLive")}
              </span>
            ) : null}
          </div>
          <p className="dash-hero-hint">
            {withTimes(t("todayWindowHint"), {
              start: todayWindowFrom.time,
              end: todayWindowTo.time,
            })}
          </p>
        </div>
      </header>

      {loading ? <PageSpinner label={t("loading")} /> : null}

      {!loading && loadError ? (
        <LoadError message={loadError} onRetry={() => void loadBranches()} retryLabel={t("retry")} />
      ) : null}

      {!loading && !loadError ? (
        <div className="dash-stack">
          {/* KPI cards — today's sales is the red brand card */}
          <div className="dash-kpis" data-cols={allTimeSameAsMonth ? "4" : "5"}>
            <div className="dash-kpi dash-kpi--brand">
              <DripEdge />
              <span className="dash-kpi-icon" aria-hidden>
                <KpiIcon name="sales" />
              </span>
              <p className="dash-kpi-label">{t("todaySales")}</p>
              <p className="dash-kpi-brand-value" dir="ltr">
                {formatPkr(todaySales)}
              </p>
              <div className="dash-kpi-chips">
                {today.length === 0 ? (
                  <span className="dash-kpi-note">{t("noOrdersToday")}</span>
                ) : (
                  <>
                    <span className="dash-brand-chip">
                      <span className="tabular-nums">{today.length}</span> {t("todayOrders").toLowerCase()}
                    </span>
                    <span className="dash-brand-chip" dir="ltr">
                      {t("avgOrderValue")}: {formatPkr(avgOrder)}
                    </span>
                  </>
                )}
              </div>
              <div className="dash-kpi-foot">
                <span>
                  {t("yesterday")}:{" "}
                  <strong dir="ltr">{formatPkr(yesterdaySales)}</strong>
                </span>
                {salesDelta !== 0 ? (
                  <span className={`dash-delta ${salesDelta > 0 ? "is-up" : "is-down"}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {salesDelta > 0 ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
                    </svg>
                    <span dir="ltr">{formatPkr(Math.abs(salesDelta))}</span>{" "}
                    {salesDelta > 0 ? t("moreThanYesterday") : t("lessThanYesterday")}
                  </span>
                ) : today.length > 0 && yesterdaySales > 0 ? (
                  <span className="dash-delta">{t("sameAsYesterday")}</span>
                ) : null}
              </div>
              {todayHasSalesBridge ? (
                <p className="dash-kpi-bridge" dir="ltr">
                  <span>{t("itemRevenue")}</span>
                  <strong>{formatPkr(todayItemRevenue)}</strong>
                  {todayDiscounts > 0 ? (
                    <>
                      <span className="dash-op">−</span>
                      <span>{t("discount")}</span>
                      <strong>{formatPkr(todayDiscounts)}</strong>
                    </>
                  ) : null}
                  {todayTax > 0 ? (
                    <>
                      <span className="dash-op">+</span>
                      <span>{t("tax")}</span>
                      <strong>{formatPkr(todayTax)}</strong>
                    </>
                  ) : null}
                  {todayDelivery > 0 ? (
                    <>
                      <span className="dash-op">+</span>
                      <span>{t("deliveryCharges")}</span>
                      <strong>{formatPkr(todayDelivery)}</strong>
                    </>
                  ) : null}
                  <span className="dash-op">=</span>
                  <strong className="dash-kpi-bridge-total">{formatPkr(todaySales)}</strong>
                </p>
              ) : null}
            </div>

            <div className="dash-kpi dash-kpi--net">
              <span className={`dash-kpi-icon ${todayNet >= 0 ? "is-good" : "is-bad"}`} aria-hidden>
                <KpiIcon name="net" />
              </span>
              <p className="dash-kpi-label">{t("todayNet")}</p>
              <div className="dash-kpi-main">
                <p className={`dash-kpi-value ${todayNet >= 0 ? "is-good" : "is-bad"}`} dir="ltr">
                  {todayNet >= 0 ? "" : "−"}
                  {formatPkr(Math.abs(todayNet))}
                </p>
              </div>
              <p className="dash-kpi-foot-note">{t("todayNetHint")}</p>
            </div>

            <div className="dash-kpi dash-kpi--month">
              <span className="dash-kpi-icon" aria-hidden>
                <KpiIcon name="month" />
              </span>
              <p className="dash-kpi-label">{t("thisMonth")}</p>
              <div className="dash-kpi-main">
                <p className="dash-kpi-value" dir="ltr">
                  {closedMonth ? formatPkr(monthSales) : "—"}
                </p>
                <p className="dash-kpi-sub">
                  <strong className="tabular-nums">{closedMonth ? monthCount : "—"}</strong>{" "}
                  {t("monthOrders").toLowerCase()}
                </p>
              </div>
              {allTimeSameAsMonth ? (
                <p className="dash-kpi-foot-note">{t("allSalesThisMonth")}</p>
              ) : null}
            </div>

            {!allTimeSameAsMonth ? (
              <div className="dash-kpi dash-kpi--alltime">
                <span className="dash-kpi-icon" aria-hidden>
                  <KpiIcon name="alltime" />
                </span>
                <p className="dash-kpi-label">{t("allTimeSales")}</p>
                <div className="dash-kpi-main">
                  <p className="dash-kpi-value" dir="ltr">
                    {allTime ? formatPkr(allTime.sales) : "—"}
                  </p>
                  <p className="dash-kpi-sub">
                    <strong className="tabular-nums">{allTime ? allTime.orders : "—"}</strong>{" "}
                    {t("allTimeOrders").toLowerCase()}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Payment breakdown + daily deductions */}
          <section className="dash-panel">
            <div className="dash-panel-head">
              <span className="dash-panel-icon" aria-hidden>
                <KpiIcon name="wallet" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="dash-eyebrow">{t("today")}</p>
                <h2 className="dash-panel-title">{t("paymentBreakdown")}</h2>
              </div>
            </div>
            <div className="dash-pay-grid">
              {payCells.map((cell) => (
                <div key={cell.key} className={`dash-pay dash-pay--${cell.tone}`}>
                  <div className="dash-pay-head">
                    <span className="dash-pay-icon" aria-hidden>
                      {cell.icon}
                    </span>
                    <p className="dash-pay-label">{cell.label}</p>
                  </div>
                  <p className="dash-pay-value" dir="ltr">
                    {cell.tone === "good" && cell.value > 0
                      ? `−${formatPkr(cell.value)}`
                      : formatPkr(cell.value)}
                  </p>
                  {cell.count != null ? (
                    <p className="dash-pay-count">
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
            <section className="dash-panel">
              <div className="dash-panel-head">
                <span className="dash-panel-icon" aria-hidden>
                  <KpiIcon name="branch" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="dash-eyebrow">{t("branches")}</p>
                  <h2 className="dash-panel-title">{t("branchWiseSales")}</h2>
                </div>
              </div>
              <ul className="dash-branch-list">
                {branchStats.map((b) => (
                  <li key={b.id} className="dash-branch-row">
                    <p className="dash-branch-name">
                      <span className="dash-branch-dot" aria-hidden />
                      {b.name}
                    </p>
                    <div className="dash-branch-chips">
                      <span className="dash-chip dash-chip--brand">
                        {t("todaySales")}:{" "}
                        <strong dir="ltr">{formatPkr(b.todaySales)}</strong>
                        <span className="dash-chip-sep" aria-hidden>·</span>
                        {b.todayCount} {t("orders").toLowerCase()}
                      </span>
                      <span className="dash-chip dash-chip--bad">
                        {t("todayExpenses")}:{" "}
                        <strong dir="ltr">{formatPkr(b.todayExpenses)}</strong>
                      </span>
                      <span className="dash-chip">
                        {t("thisMonth")}:{" "}
                        <strong dir="ltr">{formatPkr(b.monthSales)}</strong>
                        <span className="dash-chip-sep" aria-hidden>·</span>
                        {b.monthCount} {t("orders").toLowerCase()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recent orders */}
          <section className="dash-panel">
            <div className="dash-panel-head">
              <span className="dash-panel-icon" aria-hidden>
                <KpiIcon name="receipt" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="dash-eyebrow">{t("today")}</p>
                <h2 className="dash-panel-title">{t("recentOrders")}</h2>
              </div>
              <Link href="/admin/orders" className="dash-link-btn">
                {t("viewAllOrders")}
                <svg
                  className="size-4 rtl:rotate-180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
            </div>

            {recent.length === 0 ? (
              <div className="dash-empty">
                <span className="dash-empty-icon" aria-hidden>
                  <KpiIcon name="receipt" />
                </span>
                <p>{t("noOrdersToday")}</p>
              </div>
            ) : (
              <ul className="dash-recent-list">
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
