"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AppUser,
  BusinessDayHours,
  Expense,
  ExpenseCategory,
  Order,
  OrderType,
  PaymentMethod,
  ShopSettings,
} from "@bravobites/domain";
import {
  businessDateKey,
  businessDayHoursFromSettings,
  canEditExpense,
  endOfBusinessDay,
  formatOrderDateTime,
  openingOfBusinessDay,
  formatPkr,
  shiftBusinessDateKey,
  startOfBusinessDay,
} from "@bravobites/domain";
import { OrderListCard } from "@/components/OrderListCard";
import { ReviewRequest } from "@/components/ReviewRequest";
import { LocalDataSheet, useLocalDataClearable } from "@/components/LocalDataSheet";
import { SyncStatusSheet } from "@/components/SyncStatusSheet";
import { PosActivityLog, PosLogsLink, type PosLogEntity } from "@/components/PosActivityLog";
import { OwnerReportView, useOwnerReportExtras, useReportCatalog } from "@/components/OwnerReport";
import { PAYMENT_TONE, PaymentTile } from "@/components/PaymentMethodIcon";
import { CATEGORY_TILE, CategoryIcon, EditExpenseDialog } from "@/components/PosExpensesSheet";
import { useLocale } from "@/i18n/locale-context";
import {
  computeDayReport,
  computeItemSales,
  computeSalesBridge,
  type DayReport,
  type ItemStat,
  type SalesBridgeKey,
} from "@/lib/day-report";
import { expenseCategoryLabelKey } from "@/lib/expense-labels";
import { computeOwnerReport } from "@/lib/owner-report";
import { DayStockTab } from "@/components/inventory/DayStockTab";
import { periodText } from "@/lib/owner-report-text";
import { fetchOwners, onExpensesSnapshot, onOrdersSnapshot, uncachedOrderIds } from "@/lib/firestore";
import {
  matchesOrderSearch,
  matchesOrderStatus,
  type OrderStatusFilter,
} from "@/lib/order-filters";
import {
  applyPendingExpenseOps,
  applyPendingOrderOps,
  listActiveQueuedExpenses,
  listActiveQueuedMutations,
  kickSync,
  listActiveQueuedOrders,
  listAllQueuedMutations,
  listAllQueuedOrders,
  subscribeQueue,
  syncedLocalOrders,
  type QueuedExpense,
  type QueuedMutation,
  type QueuedOrder,
} from "@/lib/pos-queue";
import { openDatePicker } from "@/lib/open-date-picker";
import { useSyncedExpenseFill } from "@/lib/use-synced-expense-fill";
import { pcClockBlocksSales, shopNow } from "@/lib/shop-clock";

type Tab = "summary" | "items" | "orders" | "expenses" | "stock" | "owner";
type OrderChip = OrderStatusFilter | "pending";

/** Numbers stay in the Latin sans face (Urdu UI uses Naskh for text). */
const NUM: CSSProperties = { fontFamily: "var(--font-en), system-ui, sans-serif" };

const TZ = "Asia/Karachi";

function dayTitle(dayKey: string) {
  return new Date(`${dayKey}T12:00:00+05:00`).toLocaleDateString("en-PK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });
}

function shortTime(d: Date) {
  return d.toLocaleString("en-PK", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

function shortDay(d: Date) {
  return d.toLocaleDateString("en-PK", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
}

function pct(part: number, whole: number) {
  if (!(whole > 0)) return 0;
  return Math.round((part / whole) * 100);
}

/* ── Small building blocks ── */

function PendingDot({ label }: { label: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400"
      title={label}
      aria-label={label}
    />
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative block min-w-0 flex-1">
      <svg
        className="pointer-events-none absolute inset-y-0 start-3 my-auto text-stone-600"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-[var(--border)] bg-white ps-9 pe-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-stone-400 focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/20"
        autoComplete="off"
        enterKeyHint="search"
      />
    </label>
  );
}

function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
        active
          ? "border-[var(--ink)] bg-[var(--ink)] text-white"
          : "border-[var(--border)] bg-white text-stone-600 hover:border-stone-300 hover:text-[var(--ink)]"
      }`}
    >
      {children}
      {count != null ? (
        <span
          className={`rounded-full px-1.5 text-[10px] leading-4 ${active ? "bg-white/20" : "bg-stone-100 text-stone-600"}`}
          style={NUM}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-xl bg-stone-100 p-1 text-xs font-semibold">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-lg px-3 py-1.5 transition ${
            value === o.id ? "bg-white text-[var(--ink)] shadow-sm" : "text-stone-600 hover:text-stone-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const CARD =
  "rounded-2xl border border-[#e8dfcf] bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04),0_12px_28px_-18px_rgba(28,25,23,0.25)]";

function Card({
  title,
  icon,
  action,
  children,
  className = "",
}: {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD} ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-[#f0e9dc] px-5 py-3.5">
          <h3 className="flex items-center gap-2.5 text-[15px] font-bold text-[var(--ink)]">
            {icon ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f6efe0] text-[var(--gold-deep)]">
                {icon}
              </span>
            ) : null}
            {title}
          </h3>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Line icons (stroke = currentColor) for tiles and card titles. */
const ICON: Record<string, ReactNode> = {
  orders: <path d="M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6l2-4ZM4 6h16M9 10h6" />,
  items: <path d="M3 7l9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4" />,
  avg: <path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6" />,
  discount: <path d="M19 5 5 19M7.5 7.5h.01M16.5 16.5h.01" />,
  tax: <path d="M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2V3Zm4 6h8M8 13h5" />,
  delivery: <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  wallet: <path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 2-4h12l2 4M16 13h.01" />,
  sum: <path d="M18 4H6l6 8-6 8h12" />,
  star: <path d="m12 3 2.7 5.5 6 .9-4.4 4.2 1 6L12 16.8 6.7 19.6l1-6L3.3 9.4l6-.9L12 3Z" />,
  people: <path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />,
  gross: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  refund: <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5" />,
  cancel: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15 9l-6 6M9 9l6 6" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4" />,
  box: <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />,
};

const TAB_ICON: Record<Tab, keyof typeof ICON> = {
  summary: "sum",
  items: "items",
  orders: "orders",
  expenses: "wallet",
  stock: "box",
  owner: "shield",
};

/** Tabs with their own activity log popup. */
const TAB_LOG = { orders: "order", expenses: "expense", stock: "inventory" } as const satisfies Partial<Record<Tab, PosLogEntity>>;

function Icon({ name, size = 16 }: { name: keyof typeof ICON; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON[name]}
    </svg>
  );
}

/** Resolves a menu item's photo (POS passes its catalog lookup). */
type ItemImage = (productId: string, name: string) => string;

function ItemThumb({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className="shrink-0 rounded-xl object-cover ring-1 ring-black/5"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl bg-[#f6efe0] text-sm font-bold text-[var(--gold-deep)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {name.charAt(0)}
    </span>
  );
}

/** Gold / silver / bronze medal for the top 3, plain number after. */
function Rank({ n }: { n: number }) {
  const medal =
    n === 1
      ? "bg-gradient-to-b from-[#f3d27a] to-[#c9a227] text-[#3d2c06] shadow-[0_2px_6px_-2px_rgba(201,162,39,0.8)]"
      : n === 2
        ? "bg-gradient-to-b from-[#eef0f2] to-[#b9bfc6] text-[#2f3438]"
        : n === 3
          ? "bg-gradient-to-b from-[#f0c9a2] to-[#b9783f] text-[#3a2210]"
          : "bg-transparent text-stone-500";
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${medal}`}
      style={NUM}
    >
      {n}
    </span>
  );
}

/** Single-hue magnitude bar (gold on a light gold track). */
function Bar({ ratio }: { ratio: number }) {
  const w = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f3ecdf]" aria-hidden>
      <div className="h-full rounded-full bg-gradient-to-r from-[#e4c15a] to-[#b8860b]" style={{ width: `${w}%` }} />
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-14 text-center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-stone-300" aria-hidden>
        <path d="M3 7h18M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      </svg>
      <p className="mt-2 text-sm text-stone-600">{label}</p>
    </div>
  );
}

type BridgeLine = { label: string; value: number; sign?: "+" | "−"; strong?: boolean };

function useBridgeLines(report: DayReport, itemRevenue: number): BridgeLine[] {
  const { t } = useLocale();
  const label: Record<SalesBridgeKey, string> = {
    items: t("reportItemRevenue"),
    discount: t("discount"),
    tax: t("tax"),
    delivery: t("deliveryCharges"),
    other: t("reportRounding"),
    gross: t("reportGrossSales"),
    refunds: t("totalRefunds"),
    net: t("netSales"),
  };
  return computeSalesBridge(report, itemRevenue).map((r) => ({
    label: label[r.key],
    value: r.value,
    sign: r.sign,
    strong: r.total,
  }));
}

function SignBadge({ sign }: { sign?: "+" | "−" }) {
  if (!sign) return <span className="h-5 w-5 shrink-0" aria-hidden />;
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold leading-none ${
        sign === "−" ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"
      }`}
      aria-hidden
    >
      {sign}
    </span>
  );
}

function bridgeAmount(r: BridgeLine) {
  return `${r.value < 0 ? "−" : ""}${formatPkr(Math.abs(r.value))}`;
}

/** Statement layout: signed lines, cream subtotal bands, dark final total. */
function BridgeList({ lines }: { lines: BridgeLine[] }) {
  return (
    <dl className="space-y-0.5 p-3">
      {lines.map((r, i) => {
        if (r.strong && i === lines.length - 1) {
          return (
            <div
              key={r.label}
              className="relative mt-2 flex items-center justify-between gap-3 overflow-hidden rounded-xl bg-[#1c1917] px-4 py-3.5 text-white"
            >
              <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#b8860b] via-[#e4c15a] to-[#c9a227]" aria-hidden />
              <dt className="text-sm font-semibold">{r.label}</dt>
              <dd
                className={`text-lg font-bold tracking-[-0.01em] ${r.value < 0 ? "text-red-300" : "text-[#f3d27a]"}`}
                style={NUM}
                dir="ltr"
              >
                {bridgeAmount(r)}
              </dd>
            </div>
          );
        }
        if (r.strong) {
          return (
            <div
              key={r.label}
              className="my-1.5 flex items-center justify-between gap-3 rounded-xl bg-[#fbf8f2] px-4 py-2.5 text-sm font-bold text-[var(--ink)] ring-1 ring-inset ring-[#f0e9dc]"
            >
              <dt>{r.label}</dt>
              <dd className="tabular-nums" style={NUM} dir="ltr">{bridgeAmount(r)}</dd>
            </div>
          );
        }
        return (
          <div key={r.label} className="flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-stone-600">
            <SignBadge sign={r.sign} />
            <dt className="min-w-0 flex-1 truncate">{r.label}</dt>
            <dd className="tabular-nums text-[var(--ink)]" style={NUM} dir="ltr">
              {r.sign === "−" ? "− " : ""}
              {bridgeAmount(r)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/* ── Main ── */

/**
 * Day-end report for one branch's business day (shop hours from settings).
 * Works offline: cloud data (Firestore cache) + this PC's unsynced queue,
 * computed with the same formula as the admin Day report.
 */
export function PosDayReport({
  branchId,
  branchName,
  user,
  settings,
  onClose,
  onOpenOrder,
  itemImage,
}: {
  branchId: string;
  branchName?: string;
  user: AppUser;
  settings: ShopSettings | null;
  onClose: () => void;
  onOpenOrder: (order: Order) => void;
  itemImage?: ItemImage;
}) {
  const { t, locale } = useLocale();
  const [tab, setTab] = useState<Tab>("summary");
  const [logEntity, setLogEntity] = useState<PosLogEntity | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  // "Secret" local-data button: only shows once everything has synced.
  const localClearable = useLocalDataClearable();
  /** null = today (follows the clock); otherwise a picked business day. */
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  /** uid or "all" — like the admin Day report staff filter. */
  const [staff, setStaff] = useState("all");
  const [cloudOrders, setCloudOrders] = useState<Order[]>([]);
  const [cloudExpenses, setCloudExpenses] = useState<Expense[]>([]);
  const [ordersReady, setOrdersReady] = useState(false);
  /** Cloud orders came from this PC's cache (offline), not the server. */
  const [ordersFromCache, setOrdersFromCache] = useState(false);
  /** Synced sales this PC still keeps that the Firestore cache lacks (offline only). */
  const [localCopyOrders, setLocalCopyOrders] = useState<Order[]>([]);
  const [queued, setQueued] = useState<QueuedOrder[]>([]);
  const [mutations, setMutations] = useState<QueuedMutation[]>([]);
  const [expenseOps, setExpenseOps] = useState<QueuedExpense[]>([]);
  /** Everything on this PC still waiting for the cloud (all days, all types). */
  // null until the queue has been read — never flash "Synced" before we know.
  const [pcPending, setPcPending] = useState<number | null>(null);
  /** Of those, how many failed (no answer / refused) — the chip turns red. */
  const [pcFailed, setPcFailed] = useState(0);
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

  // This PC's queue — re-read whenever it changes (new sale, synced, failed…).
  useEffect(() => {
    let alive = true;
    const unsub = subscribeQueue((snap) => {
      setPcPending(snap.pendingCount);
      setPcFailed(snap.failedCount);
      void Promise.all([
        listActiveQueuedOrders(),
        listActiveQueuedMutations(),
        listActiveQueuedExpenses(),
      ]).then(([q, m, e]) => {
        if (!alive) return;
        setQueued(q.filter((x) => x.branchId === branchId));
        setMutations(m.filter((x) => x.orderBefore.branchId === branchId));
        setExpenseOps(e.filter((x) => x.branchId === branchId));
      });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [branchId]);

  const dayHours = useMemo(() => businessDayHoursFromSettings(settings), [settings]);
  const todayKey = businessDateKey(shopNow(), dayHours);
  const yesterdayKey = shiftBusinessDateKey(todayKey, -1);
  const dayKey = pickedKey ?? todayKey;
  const dayMode = dayKey === todayKey ? "today" : dayKey === yesterdayKey ? "yesterday" : "custom";
  const from = useMemo(() => startOfBusinessDay(dayKey, dayHours), [dayKey, dayHours]);
  const to = useMemo(() => endOfBusinessDay(dayKey, dayHours), [dayKey, dayHours]);

  // Only the picked day's expenses; Firestore serves them from the local cache when offline.
  const [expensesFromCache, setExpensesFromCache] = useState(false);
  useEffect(() => {
    return onExpensesSnapshot(
      branchId,
      (e, fromCache) => {
        setCloudExpenses(e);
        setExpensesFromCache(fromCache);
      },
      () => {},
      { fromKey: dayKey, toKey: dayKey, serverConfirm: true },
    );
  }, [branchId, dayKey]);
  // Offline: expenses this PC already uploaded that the cache never got.
  const expenseFill = useSyncedExpenseFill({
    branchId,
    days: [dayKey],
    cloud: cloudExpenses,
    fromCache: expensesFromCache,
  });

  // Only the picked day's orders from the cloud — not the branch's whole history.
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  useEffect(() => {
    setOrdersReady(false);
    return onOrdersSnapshot(
      branchId,
      (o, fromCache) => {
        setCloudOrders(o);
        setOrdersFromCache(fromCache);
        setOrdersReady(true);
      },
      () => setOrdersReady(true),
      { sinceIso: fromIso, untilIso: toIso },
    );
  }, [branchId, fromIso, toIso]);

  // Offline, a synced day can be missing from the Firestore cache (transaction
  // writes only land there once a listener saw them). Fill it from this PC's
  // synced local copy — only ids the cache knows nothing about, so a cloud
  // edit/delete the cache did see still wins.
  useEffect(() => {
    if (!ordersFromCache) {
      setLocalCopyOrders([]);
      return;
    }
    let alive = true;
    void (async () => {
      const [q, m] = await Promise.all([listAllQueuedOrders(), listAllQueuedMutations()]);
      const inCloud = new Set(cloudOrders.map((o) => o.id));
      const candidates = syncedLocalOrders(
        q.filter((x) => x.branchId === branchId),
        m.filter((x) => x.orderBefore.branchId === branchId),
      ).filter((o) => !inCloud.has(o.id) && o.createdAt >= fromIso && o.createdAt <= toIso);
      const missing = new Set(
        candidates.length ? await uncachedOrderIds(candidates.map((o) => o.id)) : [],
      );
      if (alive) setLocalCopyOrders(candidates.filter((o) => missing.has(o.id)));
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [ordersFromCache, cloudOrders, branchId, fromIso, toIso]);

  const orderView = useMemo(
    () =>
      applyPendingOrderOps(
        // Cloud last → it wins on the same id. Gated here too, so a server
        // snapshot never renders with a stale local fill.
        ordersFromCache ? [...localCopyOrders, ...cloudOrders] : cloudOrders,
        queued,
        mutations,
      ),
    [ordersFromCache, cloudOrders, localCopyOrders, queued, mutations],
  );
  const expenseView = useMemo(
    () => applyPendingExpenseOps(expensesFromCache ? [...expenseFill, ...cloudExpenses] : cloudExpenses, expenseOps),
    [expensesFromCache, expenseFill, cloudExpenses, expenseOps],
  );

  const allStaffReport = useMemo(
    () =>
      computeDayReport({
        orders: orderView.list,
        expenses: expenseView.list,
        from,
        to,
        fromKey: dayKey,
        toKey: dayKey,
      }),
    [orderView.list, expenseView.list, from, to, dayKey],
  );
  /**
   * Everyone who sold or spent in this branch (any day) — the staff filter
   * keeps the same list when switching Today / Yesterday / a date.
   */
  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orderView.list) {
      if (o.branchId !== branchId) continue;
      map.set(o.createdBy, o.createdByName || o.createdByEmail || o.createdBy);
    }
    for (const e of expenseView.list) {
      if (e.branchId !== branchId || map.has(e.createdBy)) continue;
      map.set(e.createdBy, e.createdByName || e.createdBy);
    }
    return [...map.entries()]
      .map(([uid, name]) => ({ uid, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orderView.list, expenseView.list, branchId]);
  const report = useMemo(
    () =>
      staff === "all"
        ? allStaffReport
        : computeDayReport({
            orders: orderView.list,
            expenses: expenseView.list,
            from,
            to,
            fromKey: dayKey,
            toKey: dayKey,
            staffFilter: staff,
          }),
    [staff, allStaffReport, orderView.list, expenseView.list, from, to, dayKey],
  );
  const items = useMemo(
    () =>
      computeItemSales(
        staff === "all" ? orderView.list : orderView.list.filter((o) => o.createdBy === staff),
        from,
        to,
      ),
    [orderView.list, from, to, staff],
  );

  // Owner report: who did what this day. Staff see it too, read-only (no
  // opening orders); its change log, drawer and owners list are read only
  // while the tab is open.
  const isOwner = user.role === "owner";
  const ownerTab = tab === "owner";
  const ownerExtras = useOwnerReportExtras({
    branchIds: [branchId],
    sinceIso: fromIso,
    untilIso: toIso,
    fromKey: dayKey,
    toKey: dayKey,
    enabled: ownerTab,
    withLocal: true,
  });
  // Owners' own changes are notes, not warnings. Offline this comes from the
  // cache; an owner always counts themself.
  const [ownerUids, setOwnerUids] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!ownerTab || ownerUids) return;
    let alive = true;
    fetchOwners()
      .then((owners) => {
        if (alive) setOwnerUids(new Set(owners.map((o) => o.uid)));
      })
      .catch(() => {
        if (alive) setOwnerUids(new Set());
      });
    return () => {
      alive = false;
    };
  }, [ownerTab, ownerUids]);
  const reportCatalog = useReportCatalog(ownerTab);
  const ownerReport = useMemo(
    () =>
      ownerTab && ownerUids
        ? computeOwnerReport({
            orders: orderView.list,
            expenses: expenseView.list,
            logs: ownerExtras.logs,
            pendingLogIds: ownerExtras.pendingIds,
            drawers: ownerExtras.drawers,
            stock: ownerExtras.stock,
            from,
            to,
            fromKey: dayKey,
            toKey: dayKey,
            ownerUids: isOwner ? new Set([...ownerUids, user.uid]) : ownerUids,
            catalog: reportCatalog,
          })
        : null,
    [isOwner, ownerTab, ownerUids, orderView.list, expenseView.list, ownerExtras.logs, ownerExtras.pendingIds, ownerExtras.drawers, ownerExtras.stock, from, to, dayKey, user.uid, reportCatalog],
  );

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "summary", label: t("reportSummary") },
    { id: "items", label: t("itemSales"), count: items.length },
    { id: "orders", label: t("orders"), count: report.dayOrders.length },
    { id: "expenses", label: t("expenses"), count: report.dayExpenses.length },
    { id: "stock", label: t("inventory") },
    { id: "owner", label: t("ownerReport") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t("dayEndReport")}
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-950/55 backdrop-blur-[2px]"
        aria-label={t("close")}
        onClick={onClose}
      />
      <div
        className="relative z-10 flex h-full w-full max-w-[1680px] flex-col overflow-hidden bg-[#f4f0e8] shadow-2xl sm:h-[calc(100dvh-1.5rem)] sm:rounded-3xl"
        style={locale === "ur" ? undefined : NUM}
      >
        {/* Header — dark espresso band with gold accents */}
        <header className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#1c1714] via-[#241c16] to-[#2e2318] text-white">
          <div
            className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(212,168,67,0.28),transparent_65%)]"
            aria-hidden
          />
          <div className="relative flex flex-wrap items-start justify-between gap-3 px-5 pt-4 sm:px-8 sm:pt-5">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.22em] text-[#d4a843]">
                {t("dayEndReport")}
                {branchName ? (
                  <span className="font-medium normal-case tracking-normal text-white/55"> · {branchName}</span>
                ) : null}
              </p>
              {/* Day title + TODAY + shop-hours pill on one line (wraps on small screens). */}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 className="truncate text-xl font-bold tracking-tight sm:text-2xl" style={NUM}>
                  {dayTitle(dayKey)}
                </h2>
                {dayMode !== "custom" ? (
                  <span className="inline-flex min-h-7 items-center rounded-full bg-[#e4c15a] px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#14110e] shadow-[0_0_0_1px_rgba(228,193,90,0.45)]">
                    {dayMode === "today" ? t("today") : t("dateYesterday")}
                  </span>
                ) : null}
                {/* Shop hours (open → close); sales after close still count in this day. */}
                <span
                  className="inline-flex min-h-7 cursor-help items-center rounded-full border border-[rgba(228,193,90,0.35)] bg-white/5 px-2.5 text-[11px] font-semibold text-[#e4c15a]"
                  style={NUM}
                  dir="ltr"
                  title={t("businessDayHint").replace("{end}", shortTime(to))}
                >
                  {shortDay(openingOfBusinessDay(dayKey, dayHours))} {shortTime(openingOfBusinessDay(dayKey, dayHours))} → {shortDay(to)} {shortTime(to)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-white/10 p-1 text-xs font-semibold ring-1 ring-white/10">
                {(["today", "yesterday"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={dayMode === m}
                    onClick={() => setPickedKey(m === "today" ? null : yesterdayKey)}
                    className={`rounded-lg px-3.5 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a843] ${
                      dayMode === m ? "bg-white text-[#1c1714] shadow dark:bg-[#f3ede4]" : "text-white/70 hover:text-white"
                    }`}
                  >
                    {m === "today" ? t("dateToday") : t("dateYesterday")}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={dayKey}
                max={todayKey}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setPickedKey(v === todayKey ? null : v);
                }}
                onClick={(e) => openDatePicker(e.currentTarget)}
                className={`h-9 rounded-xl px-3 text-xs font-semibold outline-none ring-1 transition [color-scheme:dark] focus:ring-[#d4a843] ${
                  dayMode === "custom" ? "bg-white/15 text-white ring-[#d4a843]/70" : "bg-white/10 text-white/80 ring-white/10"
                }`}
                style={NUM}
                dir="ltr"
                aria-label={t("dateCustom")}
              />
              {tab !== "owner" && (staffOptions.length > 0 || staff !== "all") ? (
                <select
                  value={staff}
                  onChange={(e) => setStaff(e.target.value)}
                  className={`h-9 max-w-[14rem] rounded-xl px-3 text-xs font-semibold capitalize outline-none ring-1 transition [color-scheme:dark] focus:ring-[#d4a843] [&>option]:bg-[#1c1814] [&>option]:text-[#f5efe6] ${
                    staff !== "all" ? "bg-white/15 text-white ring-[#d4a843]/70" : "bg-white/10 text-white/80 ring-white/10"
                  }`}
                  aria-label={t("staff")}
                >
                  <option value="all">{t("createdByAll")}</option>
                  {staffOptions.map((p) => (
                    <option key={p.uid} value={p.uid}>{p.name}</option>
                  ))}
                  {staff !== "all" && !staffOptions.some((p) => p.uid === staff) ? (
                    <option value={staff}>{staff}</option>
                  ) : null}
                </select>
              ) : null}
              {localClearable ? (
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/30 transition hover:bg-white/10 hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a843]"
                  onClick={() => setLocalOpen(true)}
                  aria-label={t("localDataButton")}
                  title={t("localDataButton")}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <ellipse cx="12" cy="5" rx="8" ry="3" />
                    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
                    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/10 transition hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a843]"
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

          {/* Tabs + sync status */}
          <div className="relative mt-3.5 flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 sm:px-8">
            <nav
              className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-black/30 p-1.5 ring-1 ring-white/10"
              role="tablist"
            >
              {tabs.map((tb) => {
                const active = tab === tb.id;
                return (
                  <button
                    key={tb.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(tb.id)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a843] ${
                      active
                        ? "bg-white text-[#1c1714] shadow-[0_6px_18px_-8px_rgba(0,0,0,0.6)] dark:bg-[#f3ede4]"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span className={active ? "text-[var(--gold-deep)] dark:text-[#8a6508]" : "text-[#d4a843]/80"}>
                      <Icon name={TAB_ICON[tb.id]} size={15} />
                    </span>
                    {tb.label}
                    {tb.count != null ? (
                      <span
                        className={`min-w-[20px] rounded-md px-1.5 text-center text-[11px] font-bold leading-5 ${
                          active ? "bg-[#1c1714] text-white" : "bg-white/10 text-white/75"
                        }`}
                        style={NUM}
                      >
                        {tb.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
            <div className="flex items-center gap-2.5 text-[11px] font-semibold">
              {/* Connection: dot only — green online, red offline */}
              <span
                className="relative flex h-2.5 w-2.5"
                title={online ? t("reportOnline") : t("reportOffline")}
                aria-label={online ? t("reportOnline") : t("reportOffline")}
                role="img"
              >
                {online ? (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" aria-hidden />
                ) : null}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-400" : "bg-rose-500"}`} />
              </span>
              {/* Whole-PC sync state — compact */}
              {pcPending == null ? null : pcPending > 0 ? (
                <button
                  type="button"
                  onClick={() => setSyncOpen(true)}
                  className={`inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold ${pcFailed > 0 ? "text-rose-300" : "text-orange-300"} ring-1 ring-white/10 transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a843]`}
                  title={t("syncStatusTitle")}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${pcFailed > 0 ? "bg-rose-500" : "bg-orange-400"}`} aria-hidden />
                  <span style={NUM}>{pcPending}</span> {t("reportSyncShort")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSyncOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-white/10 transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a843]"
                  title={t("syncStatusTitle")}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {t("reportSynced")}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">
          {!settings ? (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
              {t("posCatalogNeedNet")}
            </p>
          ) : !ordersReady ? (
            <p className="py-16 text-center text-sm text-stone-600">{t("loading")}</p>
          ) : tab === "summary" ? (
            <SummaryTab report={report} items={items} itemImage={itemImage} onViewItems={() => setTab("items")} />
          ) : tab === "items" ? (
            <ItemsTab items={items} report={report} itemImage={itemImage} />
          ) : tab === "stock" ? (
            <DayStockTab branchId={branchId} fromIso={fromIso} toIso={toIso} />
          ) : tab === "owner" ? (
            ownerReport && ownerExtras.ready ? (
              <OwnerReportView
                report={ownerReport}
                multiDay={false}
                onOpenOrder={
                  isOwner
                    ? (id) => {
                        const o = orderView.list.find((x) => x.id === id);
                        if (o) onOpenOrder(o);
                      }
                    : undefined
                }
                canOpenOrder={(id) => orderView.list.some((x) => x.id === id)}
                extrasError={ownerExtras.error}
                drawerFailed={ownerExtras.drawerError}
                print={{
                  shopName: settings.shopName || t("brand"),
                  branchLabel: branchName,
                  periodLabel: periodText({ from: openingOfBusinessDay(dayKey, dayHours), to, locale, t }),
                  paper: settings.receiptPaper,
                  paperWidthMm: settings.receiptPrintWidthMm,
                  fromKey: dayKey,
                  toKey: dayKey,
                  periodFrom: openingOfBusinessDay(dayKey, dayHours),
                  periodTo: to,
                  isOwner,
                }}
              />
            ) : (
              <p className="py-16 text-center text-sm text-stone-600">{t("loading")}</p>
            )
          ) : tab === "orders" ? (
            <OrdersTab
              orders={report.dayOrders}
              pendingIds={orderView.pendingIds}
              onOpenOrder={onOpenOrder}
            />
          ) : (
            <ExpensesTab
              expenses={report.dayExpenses}
              pendingIds={expenseView.pendingIds}
              user={user}
              todayKey={todayKey}
              dayHours={dayHours}
            />
          )}

          {/* Each tab's related activity log (opens its own popup; offline too). */}
          {settings && ordersReady && (tab === "orders" || tab === "expenses" || tab === "stock") ? (
            <PosLogsLink
              entityType={TAB_LOG[tab]}
              onClick={() => setLogEntity(TAB_LOG[tab])}
              className="mt-5"
            />
          ) : null}
        </div>
      </div>

      {logEntity ? (
        <PosActivityLog
          entityType={logEntity}
          branchId={branchId}
          branchName={branchName}
          user={user}
          settings={settings}
          onClose={() => setLogEntity(null)}
        />
      ) : null}
      {localOpen ? <LocalDataSheet onClose={() => setLocalOpen(false)} /> : null}
      {syncOpen ? <SyncStatusSheet user={user} onClose={() => setSyncOpen(false)} /> : null}
    </div>
  );
}

/* ── Summary ── */

function SummaryTab({
  report,
  items,
  itemImage,
  onViewItems,
}: {
  report: DayReport;
  items: ItemStat[];
  itemImage?: ItemImage;
  onViewItems: () => void;
}) {
  const { t } = useLocale();
  const netSales = report.totalSales - report.totalRefunds;
  const netInHand = report.netProfit;
  const itemRevenue = items.reduce((s, i) => s + i.revenue, 0);
  const itemsSold = items.reduce((s, i) => s + i.qty, 0);
  const avgOrder = report.totalOrders > 0 ? Math.round(report.totalSales / report.totalOrders) : 0;
  const active = report.dayOrders.filter((o) => o.status !== "cancelled");
  const discountedOrders = active.filter((o) => (o.discountAmount ?? 0) > 0).length;
  const taxedOrders = active.filter((o) => (o.taxAmount ?? 0) > 0).length;
  const deliveryOrders = active.filter((o) => (o.deliveryCharges ?? 0) > 0).length;
  const topItems = items.slice(0, 5);
  const topMax = Math.max(1, ...topItems.map((i) => i.qty));

  const methodCount = (m: PaymentMethod) => active.filter((o) => o.paymentMethod === m).length;
  const payments: { id: PaymentMethod; label: string; amount: number; count: number }[] = [
    { id: "cash", label: t("cash"), amount: report.cashSales, count: methodCount("cash") },
    { id: "card", label: t("card"), amount: report.cardSales, count: methodCount("card") },
    { id: "digital", label: t("digital"), amount: report.digitalSales, count: methodCount("digital") },
  ];
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0);

  const salesLines = useBridgeLines(report, itemRevenue);
  const bridge: BridgeLine[] = [
    ...salesLines,
    { label: t("totalExpenses"), value: report.totalExpenses, sign: "−" },
    { label: t("reportNetInHand"), value: netInHand, strong: true },
  ];
  const keptPct = netSales > 0 ? Math.max(0, Math.min(100, pct(netInHand, netSales))) : 0;
  const spentPct = netSales > 0 ? Math.min(100 - keptPct, pct(report.totalExpenses, netSales)) : 0;

  const adjustments: { label: string; icon: keyof typeof ICON; value: number; sign?: "+" | "−"; sub: string }[] = [
    { label: t("reportGrossSales"), icon: "gross", value: report.totalSales, sub: `${report.totalOrders} ${t("orders")}` },
    { label: t("discount"), icon: "discount", value: report.totalDiscounts, sign: "−", sub: `${discountedOrders} ${t("orders")}` },
    { label: t("tax"), icon: "tax", value: report.totalTax, sign: "+", sub: `${taxedOrders} ${t("orders")}` },
    { label: t("deliveryCharges"), icon: "delivery", value: report.totalDelivery, sign: "+", sub: `${deliveryOrders} ${t("orders")}` },
    { label: t("totalRefunds"), icon: "refund", value: report.totalRefunds, sign: "−", sub: "" },
    { label: t("cancelled"), icon: "cancel", value: report.cancelledAmount, sub: `${report.cancelledOrders} ${t("orders")}` },
  ];

  return (
    <div className="space-y-4">
      {/* Statement: the day's money in one place */}
      <section className={`${CARD} overflow-hidden`}>
        <div className="grid lg:grid-cols-[1.6fr_1fr]">
          <div className="relative overflow-hidden p-6 sm:p-8">
            <span
              className="pointer-events-none absolute -start-24 -top-28 h-72 w-72 rounded-full bg-[#f3d27a]/25 blur-3xl"
              aria-hidden
            />
            <div className="relative">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] shadow-[0_0_0_3px_rgba(184,134,11,0.15)]" aria-hidden />
                {t("netSales")}
                <span className="font-medium normal-case tracking-normal text-stone-400">· {t("reportNetSalesSub")}</span>
              </p>
              <p
                className="mt-3 text-[52px] font-bold leading-none tracking-[-0.035em] text-[var(--ink)] sm:text-[64px]"
                style={NUM}
                dir="ltr"
              >
                {formatPkr(netSales)}
              </p>
              <div className="mt-6 grid max-w-xl grid-cols-3 gap-2 sm:gap-3">
                {[
                  { icon: "orders" as const, value: String(report.totalOrders), label: t("orders") },
                  { icon: "items" as const, value: String(itemsSold), label: t("itemsCount") },
                  { icon: "avg" as const, value: formatPkr(avgOrder), label: t("reportAvgOrder") },
                ].map((k) => (
                  <div
                    key={k.icon}
                    className="flex min-w-0 items-center gap-2.5 rounded-xl border border-[#efe6d6] bg-white/80 px-3 py-2.5 backdrop-blur-sm"
                  >
                    <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f6efe0] text-[var(--gold-deep)] sm:flex">
                      <Icon name={k.icon} size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold leading-tight text-[var(--ink)]" style={NUM} dir="ltr">
                        {k.value}
                      </p>
                      <p className="truncate text-[11px] text-stone-500">{k.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Net after expenses — dark panel, gold hairline (brand signature) */}
          <div className="relative flex flex-col justify-center gap-4 overflow-hidden bg-[#1c1917] p-6 text-white sm:p-8">
            <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#b8860b] via-[#e4c15a] to-[#c9a227]" aria-hidden />
            <span
              className="pointer-events-none absolute -end-20 -top-20 h-56 w-56 rounded-full bg-[#c9a227]/20 blur-3xl"
              aria-hidden
            />
            <div className="relative flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#e4c15a]">{t("reportNetInHand")}</p>
              {netSales > 0 ? (
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-stone-200" style={NUM}>
                  <span dir="ltr">{keptPct}%</span> {t("reportKept")}
                </span>
              ) : null}
            </div>
            <p
              className={`relative text-[40px] font-bold leading-none tracking-[-0.03em] ${netInHand < 0 ? "text-red-300" : "text-white"}`}
              style={NUM}
              dir="ltr"
            >
              {netInHand < 0 ? "−" : ""}
              {formatPkr(Math.abs(netInHand))}
            </p>
            {/* Where net sales went: kept vs spent */}
            <div className="relative flex h-2 gap-[2px] overflow-hidden rounded-full bg-white/10" aria-hidden>
              {netSales > 0 ? (
                <>
                  <div
                    className="h-full rounded-s-full bg-gradient-to-r from-[#c9a227] to-[#f3d27a] transition-[width] duration-500"
                    style={{ width: `${keptPct}%` }}
                  />
                  <div className="h-full rounded-e-full bg-rose-400/80 transition-[width] duration-500" style={{ width: `${spentPct}%` }} />
                </>
              ) : null}
            </div>
            <div className="relative space-y-2 text-sm" style={NUM}>
              <div className="flex items-center justify-between gap-3 text-stone-300">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#e4c15a]" aria-hidden />
                  {t("netSales")}
                </span>
                <span className="font-semibold text-white" dir="ltr">{formatPkr(netSales)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-stone-300">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-400" aria-hidden />
                  {t("totalExpenses")} ({report.dayExpenses.length})
                </span>
                <span className="font-semibold text-white" dir="ltr">−{formatPkr(report.totalExpenses)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Day's adjustments — always shown, zero values muted */}
        <dl className="grid grid-cols-2 border-t border-[#f0e9dc] bg-[#fdfbf7] sm:grid-cols-3 xl:grid-cols-6">
          {adjustments.map((m, i) => {
            const zero = m.value === 0;
            const tone = zero
              ? "bg-stone-100 text-stone-400"
              : m.sign === "−"
                ? "bg-rose-50 text-rose-600"
                : m.sign === "+"
                  ? "bg-emerald-50 text-emerald-700"
                  : m.icon === "cancel"
                    ? "bg-stone-100 text-stone-600"
                    : "bg-[#f6efe0] text-[var(--gold-deep)]";
            return (
              <div
                key={m.label}
                className={`px-5 py-4 transition-colors hover:bg-white ${i > 0 ? "border-s border-[#f0e9dc]" : ""} max-xl:border-b max-xl:border-[#f0e9dc]`}
              >
                <dt className="flex items-center gap-2 text-xs font-medium text-stone-500">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tone}`}>
                    <Icon name={m.icon} size={13} />
                  </span>
                  <span className="truncate">{m.label}</span>
                </dt>
                <dd
                  className={`mt-2.5 flex items-baseline gap-1 text-xl font-semibold tracking-[-0.01em] ${zero ? "text-stone-300" : "text-[var(--ink)]"}`}
                  style={NUM}
                  dir="ltr"
                >
                  {!zero && m.sign ? (
                    <span className={`text-sm font-bold ${m.sign === "−" ? "text-rose-500" : "text-emerald-600"}`}>{m.sign}</span>
                  ) : null}
                  {formatPkr(m.value)}
                </dd>
                {m.sub ? <p className="mt-0.5 text-[11px] text-stone-400" style={NUM}>{m.sub}</p> : null}
              </div>
            );
          })}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Payments */}
        <Card
          title={t("reportPayments")}
          icon={<Icon name="wallet" />}
          action={
            <span className="text-xs text-stone-500">
              {t("reportCollected")}{" "}
              <span className="font-bold text-[var(--ink)]" style={NUM} dir="ltr">{formatPkr(paidTotal)}</span>
            </span>
          }
        >
          {/* Payment mix — one stacked bar, 2px gaps between methods */}
          <div className="px-5 pt-4">
            <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-stone-100">
              {paidTotal > 0
                ? payments
                    .filter((p) => p.amount > 0)
                    .map((p) => (
                      <div
                        key={p.id}
                        className={`h-full transition-[width] duration-500 ${PAYMENT_TONE[p.id].bar}`}
                        style={{ width: `${(p.amount / paidTotal) * 100}%` }}
                        title={`${p.label} · ${formatPkr(p.amount)} · ${pct(p.amount, paidTotal)}%`}
                      />
                    ))
                : null}
            </div>
          </div>
          <ul className="divide-y divide-stone-100 px-5 py-1.5">
            {payments.map((p) => {
              const share = pct(p.amount, paidTotal);
              return (
                <li key={p.id} className={`flex items-center gap-3.5 py-3 ${p.amount > 0 ? "" : "opacity-50"}`}>
                  <PaymentTile method={p.id} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--ink)]">{p.label}</p>
                    <p className="mt-0.5 text-xs text-stone-500" style={NUM}>
                      <span className="tabular-nums">{p.count}</span> {t("orders")}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-base font-bold tabular-nums text-[var(--ink)]" style={NUM} dir="ltr">
                      {formatPkr(p.amount)}
                    </p>
                    <span
                      className="mt-1 inline-block rounded-full bg-stone-100 px-2 py-px text-[11px] font-semibold tabular-nums text-stone-600"
                      style={NUM}
                      dir="ltr"
                    >
                      {share}%
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Bridge */}
        <Card title={t("reportBreakdown")} icon={<Icon name="sum" />}>
          <BridgeList lines={bridge} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top items */}
        <Card
          title={t("reportTopItems")}
          icon={<Icon name="star" />}
          action={
            items.length > topItems.length ? (
              <button
                type="button"
                onClick={onViewItems}
                className="text-xs font-semibold text-[var(--gold-deep)] hover:underline"
              >
                {t("reportViewAll")} →
              </button>
            ) : undefined
          }
        >
          {topItems.length === 0 ? (
            <p className="px-5 pb-5 pt-2 text-sm text-stone-600">{t("noReportData")}</p>
          ) : (
            <ol className="space-y-3.5 px-5 py-4">
              {topItems.map((it, i) => (
                <li key={it.key} className="flex items-center gap-3">
                  <Rank n={i + 1} />
                  <ItemThumb src={itemImage?.(it.productId, it.productName)} name={it.productName} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-[var(--ink)]">
                        {it.productName}
                        {it.variationLabel ? <span className="ms-1 text-xs text-stone-600">({it.variationLabel})</span> : null}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums text-[var(--ink)]" style={NUM} dir="ltr">×{it.qty}</span>
                    </div>
                    <Bar ratio={it.qty / topMax} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Staff */}
        {report.staffBreakdown.length > 0 ? (
          <Card title={t("staffSales")} icon={<Icon name="people" />}>
            <div className="overflow-x-auto px-1 pb-2">
              <table className="w-full text-sm">
                <thead className="text-[11px] font-semibold text-stone-600">
                  <tr>
                    <th className="px-4 py-2 text-start">{t("staff")}</th>
                    <th className="px-3 py-2 text-end">{t("orders")}</th>
                    <th className="px-3 py-2 text-end">{t("cash")}</th>
                    <th className="hidden px-3 py-2 text-end sm:table-cell">{t("card")}</th>
                    <th className="hidden px-3 py-2 text-end sm:table-cell">{t("digital")}</th>
                    <th className="px-4 py-2 text-end">{t("total")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {report.staffBreakdown.map((r) => (
                    <tr key={r.key}>
                      <td className="px-4 py-2.5 font-medium capitalize text-[var(--ink)]">{r.name}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums" style={NUM}>{r.orders}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums" style={NUM} dir="ltr">{formatPkr(r.cash)}</td>
                      <td className="hidden px-3 py-2.5 text-end tabular-nums sm:table-cell" style={NUM} dir="ltr">{formatPkr(r.card)}</td>
                      <td className="hidden px-3 py-2.5 text-end tabular-nums sm:table-cell" style={NUM} dir="ltr">{formatPkr(r.digital)}</td>
                      <td className="px-4 py-2.5 text-end font-bold tabular-nums" style={NUM} dir="ltr">{formatPkr(r.total - r.refunds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/* ── Items ── */

function ItemsTab({
  items,
  report,
  itemImage,
}: {
  items: ItemStat[];
  report: DayReport;
  itemImage?: ItemImage;
}) {
  const { t } = useLocale();
  const bridgeLines = useBridgeLines(report, items.reduce((s, i) => s + i.revenue, 0));
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"qty" | "revenue">("qty");

  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter((i) => `${i.productName} ${i.variationLabel || ""}`.toLowerCase().includes(q))
      : [...items];
    list.sort((a, b) => (sortBy === "qty" ? b.qty - a.qty || b.revenue - a.revenue : b.revenue - a.revenue));
    return list;
  }, [items, query, sortBy]);
  const max = Math.max(1, ...shown.map((i) => (sortBy === "qty" ? i.qty : i.revenue)));

  if (items.length === 0) return <Empty label={t("noReportData")} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchBox value={query} onChange={setQuery} placeholder={t("reportSearchItems")} />
        <Segmented
          value={sortBy}
          onChange={setSortBy}
          options={[
            { id: "qty", label: t("sortByQty") },
            { id: "revenue", label: t("sortByRevenue") },
          ]}
        />
      </div>

      {/* Insight strip */}
      {!query.trim() && items.length > 0 ? (
        <section className={`${CARD} grid grid-cols-2 overflow-hidden lg:grid-cols-4`}>
          {(() => {
            const top = [...items].sort((a, b) => b.qty - a.qty)[0]!;
            const qty = items.reduce((n, i) => n + i.qty, 0);
            return (
              <>
                <div className="px-5 py-4">
                  <p className="text-xs font-medium text-stone-500">{t("reportItemsSold")}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]" style={NUM}>{qty}</p>
                </div>
                <div className="border-s border-[#f0e9dc] px-5 py-4">
                  <p className="text-xs font-medium text-stone-500">{t("reportItemRevenue")}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]" style={NUM} dir="ltr">{formatPkr(totalRevenue)}</p>
                </div>
                <div className="flex items-center gap-3 border-t border-[#f0e9dc] px-5 py-4 lg:border-s lg:border-t-0">
                  <ItemThumb src={itemImage?.(top.productId, top.productName)} name={top.productName} size={44} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-stone-500">{t("reportBestSeller")}</p>
                    <p className="truncate text-sm font-bold text-[var(--ink)]">{top.productName}</p>
                    <p className="text-xs text-stone-500" style={NUM}>×{top.qty}</p>
                  </div>
                </div>
                <div className="border-s border-t border-[#f0e9dc] px-5 py-4 lg:border-t-0">
                  <p className="text-xs font-medium text-stone-500">{t("reportProducts")}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]" style={NUM}>{items.length}</p>
                </div>
              </>
            );
          })()}
        </section>
      ) : null}

      {shown.length === 0 ? (
        <Empty label={t("reportNoMatch")} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[#f0e9dc] bg-[#fbf8f2] text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                <tr>
                  <th className="w-12 px-4 py-3 text-start">#</th>
                  <th className="px-2 py-3 text-start">{t("itemName")}</th>
                  <th className="hidden w-[26%] px-3 py-3 sm:table-cell" aria-hidden />
                  <th className="px-3 py-3 text-end">{t("qtySold")}</th>
                  <th className="px-3 py-3 text-end">{t("revenue")}</th>
                  <th className="hidden px-5 py-3 text-end sm:table-cell">{t("reportShare")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3ede2]">
                {shown.map((it, i) => (
                  <tr key={it.key} className="transition hover:bg-[#fbf8f2]">
                    <td className="px-4 py-3"><Rank n={i + 1} /></td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-3">
                        <ItemThumb src={itemImage?.(it.productId, it.productName)} name={it.productName} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--ink)]">{it.productName}</p>
                          {it.variationLabel ? (
                            <span className="mt-0.5 inline-block rounded-md bg-stone-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                              {it.variationLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell">
                      <Bar ratio={(sortBy === "qty" ? it.qty : it.revenue) / max} />
                    </td>
                    <td className="px-3 py-3 text-end text-base font-bold tabular-nums text-[var(--ink)]" style={NUM}>{it.qty}</td>
                    <td className="px-3 py-3 text-end font-medium tabular-nums text-[var(--ink)]" style={NUM} dir="ltr">{formatPkr(it.revenue)}</td>
                    <td className="hidden px-5 py-3 text-end sm:table-cell">
                      <span className="rounded-full bg-[#f6efe0] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--gold-deep)]" style={NUM}>
                        {pct(it.revenue, totalRevenue)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-[var(--border)] bg-[#faf7f2] font-bold text-[var(--ink)]">
                <tr>
                  <td className="px-4 py-3" />
                  <td className="px-2 py-3">
                    {t("total")}
                    {query.trim() ? (
                      <span className="ms-2 text-xs font-medium text-stone-600" style={NUM}>
                        {t("reportShowing").replace("{n}", String(shown.length)).replace("{total}", String(items.length))}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden sm:table-cell" />
                  <td className="px-3 py-3 text-end tabular-nums" style={NUM}>{shown.reduce((s, i) => s + i.qty, 0)}</td>
                  <td className="px-3 py-3 text-end tabular-nums" style={NUM} dir="ltr">{formatPkr(shown.reduce((s, i) => s + i.revenue, 0))}</td>
                  <td className="hidden sm:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {!query.trim() ? (
        <Card title={t("reportWhyDiffers")}>
          <p className="px-4 text-xs leading-relaxed text-stone-600 sm:px-5">{t("reportWhyDiffersHint")}</p>
          <BridgeList lines={bridgeLines} />
          {report.cancelledOrders > 0 ? (
            <p className="mx-4 mb-4 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600 ring-1 ring-stone-200 sm:mx-5">
              {t("reportCancelledExcluded")
                .replace("{n}", String(report.cancelledOrders))
                .replace("{amount}", formatPkr(report.cancelledAmount))}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

/* ── Orders ── */

function OrderRow({
  order: o,
  pending,
  onClick,
}: {
  order: Order;
  pending: boolean;
  onClick: () => void;
}) {
  const { t } = useLocale();
  const cancelled = o.status === "cancelled";
  const refundAmount = o.refundAmount ?? 0;
  const refunded = refundAmount > 0;
  const partialRefund = refunded && refundAmount < o.total;
  const edited = !cancelled && Boolean(o.updatedAt);
  const discountAmount = cancelled ? 0 : o.discountAmount ?? 0;
  const discounted = discountAmount > 0;
  const discountPct =
    discounted && o.discountType === "percent" && (o.discountValue ?? 0) > 0 ? `${o.discountValue}%` : null;
  const taxAmount = cancelled ? 0 : o.taxAmount ?? 0;
  const deliveryAmount = cancelled ? 0 : o.deliveryCharges ?? 0;
  const subtotal = o.subtotal > 0 ? o.subtotal : o.items.reduce((s, i) => s + i.lineTotal, 0);
  const hasBreakdown = discounted || taxAmount > 0 || deliveryAmount > 0;
  const items = o.items
    .map((i) => `${i.qty}× ${i.productName}${i.variationLabel ? ` (${i.variationLabel})` : ""}`)
    .join(", ");
  const type =
    o.orderType === "takeaway" ? t("takeaway") : o.orderType === "delivery" ? t("delivery") : t("dineIn");
  const pay = o.paymentMethod === "card" ? t("card") : o.paymentMethod === "digital" ? t("digital") : t("cash");
  const cashier = (o.createdByName || "—").split("@")[0];
  const editor = edited ? (o.updatedByName || "").split("@")[0] : "";
  const customerName = o.customerName?.trim() || "";
  const customerPhone = o.customerPhone?.trim() || "";
  const tableNumber = o.tableNumber?.trim() || "";
  const deliveryAddress = o.deliveryAddress?.trim() || "";
  const hasCustomer = Boolean(customerName || customerPhone || tableNumber || deliveryAddress);
  const time = new Date(o.createdAt).toLocaleTimeString("en-PK", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  });
  // Calendar date of the sale — after midnight it's the next date, same business day.
  const date = new Date(o.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
  const tag = (label: string, cls: string) => (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`} dir="ltr">
      {label}
    </span>
  );
  const meta = (label: string, value: string, ltr = false) => (
    <span className="min-w-0" dir={ltr ? "ltr" : undefined}>
      <span className="text-stone-500">{label}: </span>
      <span className="font-semibold text-[var(--ink)]" style={ltr ? NUM : undefined}>{value}</span>
    </span>
  );
  const moneyLine = (label: string, value: string, cls = "text-stone-600") => (
    <span className={`flex items-baseline justify-end gap-2 text-[11px] ${cls}`} dir="ltr">
      <span>{label}</span>
      <span className="tabular-nums" style={NUM}>{value}</span>
    </span>
  );

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer align-top transition hover:bg-[#fbf8f2] ${cancelled ? "opacity-60" : ""}`}
    >
      <td className="px-5 py-3.5">
        <span className="inline-flex items-center gap-2 font-bold text-[var(--ink)]" style={NUM}>
          {pending ? <PendingDot label={t("recentPendingLocal")} /> : null}#{String(o.orderNumber).padStart(4, "0")}
        </span>
        {o.printedOrderNumber != null ? (
          <span className="block whitespace-nowrap text-[10px] font-semibold text-[var(--gold-deep)]" style={NUM} dir="ltr">
            {t("receiptNumber").replace("{n}", String(o.printedOrderNumber).padStart(4, "0"))}
          </span>
        ) : null}
        <span className="mt-0.5 block whitespace-nowrap text-xs text-stone-500" style={NUM} dir="ltr">
          {date} · {time}
        </span>
      </td>
      <td className="max-w-[22rem] px-3 py-3.5">
        <p className={`font-medium leading-snug text-[var(--ink)] ${cancelled ? "line-through" : ""}`}>{items}</p>
        {cancelled || edited || refunded || discounted ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {cancelled ? tag(t("cancelled"), "bg-red-50 text-red-700") : null}
            {edited ? tag(t("amended"), "bg-amber-50 text-amber-800") : null}
            {refunded
              ? tag(
                  `${partialRefund ? t("partialRefund") : t("refunded")} −${formatPkr(refundAmount)}`,
                  "bg-orange-50 text-orange-700",
                )
              : null}
            {discounted
              ? tag(
                  `${t("discounted")} ${discountPct ? discountPct : `−${formatPkr(discountAmount)}`}`,
                  "bg-emerald-50 text-emerald-700",
                )
              : null}
          </div>
        ) : null}
        {editor ? (
          <p className="mt-1 text-[11px] text-stone-500">
            {t("amended")}: <span className="capitalize">{editor}</span>
          </p>
        ) : null}
      </td>
      <td className="px-3 py-3.5 text-xs leading-relaxed">
        {hasCustomer ? (
          <div className="flex max-w-[16rem] flex-col gap-0.5">
            {customerName ? meta(t("customerName"), customerName) : null}
            {customerPhone ? meta(t("customerPhone"), customerPhone, true) : null}
            {tableNumber ? meta(t("tableNumber"), tableNumber, true) : null}
            {deliveryAddress ? <span className="line-clamp-2">{meta(t("deliveryAddress"), deliveryAddress)}</span> : null}
            <ReviewRequest order={o} compact />
          </div>
        ) : (
          <span className="text-stone-400">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3.5 text-stone-600">
        <span className="block">{type}</span>
        <span className="block text-xs text-stone-500">{pay}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-3.5 capitalize text-stone-600">{cashier}</td>
      <td className="whitespace-nowrap px-5 py-3.5 text-end">
        {hasBreakdown ? (
          <span className="mb-1 flex flex-col gap-0.5 border-b border-stone-200/80 pb-1">
            {moneyLine(t("subtotal"), formatPkr(subtotal))}
            {discounted
              ? moneyLine(
                  `${t("discount")}${discountPct ? ` ${discountPct}` : ""}`,
                  `−${formatPkr(discountAmount)}`,
                  "text-emerald-700",
                )
              : null}
            {taxAmount > 0 ? moneyLine(t("tax"), `+${formatPkr(taxAmount)}`) : null}
            {deliveryAmount > 0 ? moneyLine(t("deliveryShort"), `+${formatPkr(deliveryAmount)}`) : null}
          </span>
        ) : null}
        <span className={`block font-bold text-[var(--ink)] ${cancelled ? "line-through" : ""}`} style={NUM} dir="ltr">
          {formatPkr(o.total)}
        </span>
        {refunded ? moneyLine(t("refund"), `−${formatPkr(refundAmount)}`, "text-orange-700") : null}
      </td>
    </tr>
  );
}

function OrdersTab({
  orders,
  pendingIds,
  onOpenOrder,
}: {
  orders: Order[];
  pendingIds: Set<string>;
  onOpenOrder: (o: Order) => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<OrderChip>("all");
  const [payment, setPayment] = useState<"all" | PaymentMethod>("all");
  const [type, setType] = useState<"all" | OrderType>("all");

  const chips: { id: OrderChip; label: string }[] = [
    { id: "all", label: t("all") },
    { id: "original", label: t("statusOriginal") },
    { id: "edited", label: t("statusEdited") },
    { id: "discounted", label: t("statusDiscounted") },
    { id: "cancelled", label: t("cancelled") },
    { id: "refunded", label: t("refunded") },
    { id: "pending", label: t("recentPendingLocal") },
  ];
  const matchesChip = (o: Order, c: OrderChip) =>
    c === "pending" ? pendingIds.has(o.id) : matchesOrderStatus(o, c);

  // Search + payment + type first; chip counts reflect those so they stay honest.
  const base = useMemo(
    () =>
      orders.filter((o) => {
        if (!matchesOrderSearch(o, query)) return false;
        if (payment !== "all" && o.paymentMethod !== payment) return false;
        if (type !== "all" && (o.orderType ?? "dine-in") !== type) return false;
        return true;
      }),
    [orders, query, payment, type],
  );
  const shown = base.filter((o) => matchesChip(o, chip));
  const shownSales = shown
    .filter((o) => o.status !== "cancelled")
    .reduce((s, o) => s + o.total - (o.refundAmount ?? 0), 0);
  const filtersActive = Boolean(query.trim()) || chip !== "all" || payment !== "all" || type !== "all";

  if (orders.length === 0) return <Empty label={t("noOrders")} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchBox value={query} onChange={setQuery} placeholder={t("reportSearchOrders")} />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select
            className="h-10 rounded-xl border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--gold)]"
            value={payment}
            onChange={(e) => setPayment(e.target.value as "all" | PaymentMethod)}
            aria-label={t("paymentMethod")}
          >
            <option value="all">{t("paymentMethod")}: {t("all")}</option>
            <option value="cash">{t("cash")}</option>
            <option value="card">{t("card")}</option>
            <option value="digital">{t("digital")}</option>
          </select>
          <select
            className="h-10 rounded-xl border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--gold)]"
            value={type}
            onChange={(e) => setType(e.target.value as "all" | OrderType)}
            aria-label={t("orderType")}
          >
            <option value="all">{t("orderType")}: {t("all")}</option>
            <option value="dine-in">{t("dineIn")}</option>
            <option value="takeaway">{t("takeaway")}</option>
            <option value="delivery">{t("delivery")}</option>
          </select>
        </div>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {chips.map((c) => {
          const count = base.filter((o) => matchesChip(o, c.id)).length;
          if (c.id !== "all" && count === 0 && chip !== c.id) return null;
          return (
            <Chip key={c.id} active={chip === c.id} onClick={() => setChip(c.id)} count={count}>
              {c.id === "pending" ? <PendingDot label={c.label} /> : null}
              {c.label}
            </Chip>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 px-1 text-xs text-stone-600">
        <span style={NUM}>
          {t("reportShowing").replace("{n}", String(shown.length)).replace("{total}", String(orders.length))}
          {" · "}
          <span className="font-semibold text-[var(--ink)]" dir="ltr">{formatPkr(shownSales)}</span>
        </span>
        {filtersActive ? (
          <button
            type="button"
            className="font-semibold text-[var(--gold-deep)] hover:underline"
            onClick={() => {
              setQuery("");
              setChip("all");
              setPayment("all");
              setType("all");
            }}
          >
            {t("resetFilters")}
          </button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <Empty label={t("reportNoMatch")} />
      ) : (
        <>
          <div className={`${CARD} hidden overflow-hidden md:block`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0e9dc] bg-[#fbf8f2] text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                  <th className="px-5 py-3 text-start">{t("order")}</th>
                  <th className="px-3 py-3 text-start">{t("itemsCount")}</th>
                  <th className="px-3 py-3 text-start">{t("customerName")}</th>
                  <th className="px-3 py-3 text-start">{t("orderType")} · {t("paymentMethod")}</th>
                  <th className="px-3 py-3 text-start">{t("cashier")}</th>
                  <th className="px-5 py-3 text-end">{t("total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3ede2]">
                {shown.map((o) => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    pending={pendingIds.has(o.id)}
                    onClick={() => onOpenOrder(o)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {shown.map((o) => (
              <li key={o.id}>
                <OrderListCard
                  order={o}
                  dense
                  onClick={() => onOpenOrder(o)}
                  badge={
                    pendingIds.has(o.id) ? (
                      <span className="block">
                        <PendingDot label={t("recentPendingLocal")} />
                      </span>
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ── Expenses ── */

function ExpensesTab({
  expenses,
  pendingIds,
  user,
  todayKey,
  dayHours,
}: {
  expenses: Expense[];
  pendingIds: Set<string>;
  user: AppUser;
  todayKey: string;
  dayHours: BusinessDayHours;
}) {
  // Tap a row to edit it in the same popup as the Expenses sheet.
  const [editing, setEditing] = useState<Expense | null>(null);
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | ExpenseCategory>("all");

  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((e) =>
      `${e.description} ${t(expenseCategoryLabelKey[e.category])} ${e.category} ${e.createdByName}`
        .toLowerCase()
        .includes(q),
    );
  }, [expenses, query, t]);
  const shown = category === "all" ? base : base.filter((e) => e.category === category);
  const shownTotal = shown.reduce((s, e) => s + e.amount, 0);
  const categories = Array.from(new Set(expenses.map((e) => e.category)));

  if (expenses.length === 0) return <Empty label={t("noExpenses")} />;

  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} placeholder={t("reportSearchExpenses")} />

      {categories.length > 1 ? (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Chip active={category === "all"} onClick={() => setCategory("all")} count={base.length}>
            {t("all")}
          </Chip>
          {categories.map((c) => (
            <Chip
              key={c}
              active={category === c}
              onClick={() => setCategory(c)}
              count={base.filter((e) => e.category === c).length}
            >
              {t(expenseCategoryLabelKey[c])}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 px-1 text-xs text-stone-600">
        <span style={NUM}>
          {t("reportShowing").replace("{n}", String(shown.length)).replace("{total}", String(expenses.length))}
        </span>
        <span className="font-bold text-[var(--ink)]" style={NUM} dir="ltr">−{formatPkr(shownTotal)}</span>
      </div>

      {shown.length === 0 ? (
        <Empty label={t("reportNoMatch")} />
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {shown.map((e) => {
              // Staff: own entries only; owner: any.
              const mayEdit =
                (user.role === "owner" || !pcClockBlocksSales()) &&
                canEditExpense(user, e, shopNow().getTime(), dayHours);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    disabled={!mayEdit}
                    onClick={() => setEditing(e)}
                    title={mayEdit ? t("edit") : undefined}
                    className="group flex w-full items-center gap-3 px-4 py-3 text-start transition enabled:hover:bg-amber-50/60 disabled:cursor-default sm:px-5"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${CATEGORY_TILE[e.category]}`}
                      aria-hidden
                    >
                      <CategoryIcon category={e.category} size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                        {pendingIds.has(e.id) ? <PendingDot label={t("recentPendingLocal")} /> : null}
                        <span className="truncate">{e.description || t(expenseCategoryLabelKey[e.category])}</span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-stone-600">
                        {t(expenseCategoryLabelKey[e.category])} ·{" "}
                        <span style={NUM} dir="ltr">{formatOrderDateTime(e.createdAt)}</span> ·{" "}
                        <span className="capitalize">{e.createdByName}</span>
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-bold text-[var(--ink)]" style={NUM} dir="ltr">
                      −{formatPkr(e.amount)}
                    </p>
                    {mayEdit ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-300 transition group-hover:text-[var(--gold-deep)]" aria-hidden>
                        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {editing ? (
        <EditExpenseDialog
          key={editing.id}
          expense={editing}
          todayKey={todayKey}
          dayHours={dayHours}
          user={user}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void kickSync();
          }}
        />
      ) : null}
    </div>
  );
}
