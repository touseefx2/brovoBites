"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { BusinessDayHours, Order } from "@bravobites/domain";
import {
  DEFAULT_BUSINESS_DAY_HOURS,
  businessDateKey,
  businessHour,
  endOfBusinessDay,
  openingOfBusinessDay,
  formatPkr,
  shiftBusinessDateKey,
  startOfBusinessDay,
  startOfBusinessMonthKey,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { shopNow } from "@/lib/shop-clock";

type FilterKey = "today" | "yesterday" | "last7" | "thisMonth";

function getFilterRange(
  key: FilterKey,
  hours: BusinessDayHours,
): { start: Date; end: Date; salesEnd: Date } {
  const now = shopNow();
  const todayKey = businessDateKey(now, hours);
  // Hourly axis runs open→close (not from the previous close).
  const todayStart = openingOfBusinessDay(todayKey, hours);
  const todayEnd = endOfBusinessDay(todayKey, hours);
  const todayEndExclusive = new Date(todayEnd.getTime() + 1);
  // Sales for "today" stop at now (or day end if already closed).
  const salesEnd = now < todayEndExclusive ? now : todayEndExclusive;

  switch (key) {
    case "today":
      // Axis = full open→close window; sales only up to now.
      return { start: todayStart, end: todayEndExclusive, salesEnd };
    case "yesterday": {
      const yKey = shiftBusinessDateKey(todayKey, -1);
      const yStart = openingOfBusinessDay(yKey, hours);
      const yEnd = new Date(endOfBusinessDay(yKey, hours).getTime() + 1);
      return { start: yStart, end: yEnd, salesEnd: yEnd };
    }
    case "last7": {
      const wKey = shiftBusinessDateKey(todayKey, -6);
      return {
        start: startOfBusinessDay(wKey, hours),
        end: salesEnd,
        salesEnd,
      };
    }
    case "thisMonth": {
      const mKey = startOfBusinessMonthKey(todayKey);
      return {
        start: startOfBusinessDay(mKey, hours),
        end: salesEnd,
        salesEnd,
      };
    }
  }
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

/** 1-hour buckets across the full open→close window (Today / Yesterday). */
const HOUR_SLOT_MS = 3_600_000;

/**
 * Full business-day axis, every hour: e.g. 12 PM … 11 PM, 12 AM … 4 AM.
 * Sales fill buckets up to `salesEnd`.
 */
function buildHourlyData(
  orders: Order[],
  start: Date,
  end: Date,
  salesEnd: Date,
) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const salesEndMs = Math.min(salesEnd.getTime(), endMs);
  if (!(endMs > startMs)) return [];

  const slots: { hour: string; sales: number }[] = [];
  for (let ms = startMs; ms < endMs; ms += HOUR_SLOT_MS) {
    slots.push({ hour: hourLabel(businessHour(new Date(ms))), sales: 0 });
  }
  if (slots.length === 0) return [];

  for (const o of orders) {
    const t = new Date(o.createdAt).getTime();
    if (t < startMs || t >= salesEndMs) continue;
    const idx = Math.floor((t - startMs) / HOUR_SLOT_MS);
    if (idx >= 0 && idx < slots.length) {
      slots[idx]!.sales += o.total;
    }
  }

  return slots;
}

function buildDailyData(
  orders: Order[],
  start: Date,
  end: Date,
  hours: BusinessDayHours,
  /** Days before the live orders, as server totals (dateKey → sales). */
  older: Map<string, number>,
) {
  const filtered = orders.filter((o) => {
    const d = new Date(o.createdAt);
    return d >= start && d < end;
  });

  const ordered: { key: string; hour: string; sales: number }[] = [];
  const indexByKey = new Map<string, number>();
  let cursorKey = businessDateKey(start, hours);
  while (openingOfBusinessDay(cursorKey, hours) < end) {
    const label = openingOfBusinessDay(cursorKey, hours).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Karachi",
    });
    indexByKey.set(cursorKey, ordered.length);
    ordered.push({ key: cursorKey, hour: label, sales: older.get(cursorKey) ?? 0 });
    cursorKey = shiftBusinessDateKey(cursorKey, 1);
  }

  for (const o of filtered) {
    const key = businessDateKey(new Date(o.createdAt), hours);
    const idx = indexByKey.get(key);
    if (idx != null) ordered[idx].sales += o.total;
  }

  return ordered.map(({ hour, sales }) => ({ hour, sales }));
}

const filterLabels: Record<FilterKey, { en: string; ur: string }> = {
  today: { en: "Today", ur: "آج" },
  yesterday: { en: "Yesterday", ur: "کل" },
  last7: { en: "Last 7 days", ur: "آخری ۷ دن" },
  thisMonth: { en: "This month", ur: "اس مہینے" },
};

const FILTERS: FilterKey[] = ["today", "yesterday", "last7", "thisMonth"];

type TodaySummary = { sales: number; orders: number };

export function SalesChart({
  orders,
  todaySummary,
  dayHours = DEFAULT_BUSINESS_DAY_HOURS,
  liveFromKey,
  loadDailyTotals,
}: {
  orders: Order[];
  todaySummary?: TodaySummary;
  dayHours?: BusinessDayHours;
  /** First business day `orders` covers; earlier days come from loadDailyTotals. */
  liveFromKey?: string;
  /** Server sales per earlier day (dateKey → sales), asked only for Last 7 / This month. */
  loadDailyTotals?: (keys: string[]) => Promise<Record<string, number>>;
}) {
  const [filter, setFilter] = useState<FilterKey>("today");
  const [open, setOpen] = useState(false);
  const { locale } = useLocale();
  // Earlier days already fetched this visit (closed days don't change often).
  const olderRef = useRef(new Map<string, number>());
  const [olderVersion, setOlderVersion] = useState(0);
  const [olderFailed, setOlderFailed] = useState(false);

  useEffect(() => {
    if ((filter !== "last7" && filter !== "thisMonth") || !loadDailyTotals || !liveFromKey) return;
    const { start, end } = getFilterRange(filter, dayHours);
    const missing: string[] = [];
    for (
      let k = businessDateKey(start, dayHours);
      k < liveFromKey && openingOfBusinessDay(k, dayHours) < end;
      k = shiftBusinessDateKey(k, 1)
    ) {
      if (!olderRef.current.has(k)) missing.push(k);
    }
    if (missing.length === 0) return;
    let alive = true;
    setOlderFailed(false);
    loadDailyTotals(missing).then(
      (totals) => {
        for (const [k, v] of Object.entries(totals)) olderRef.current.set(k, v);
        if (alive) setOlderVersion((n) => n + 1);
      },
      () => {
        if (alive) setOlderFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [filter, dayHours, liveFromKey, loadDailyTotals]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== "cancelled"),
    [orders],
  );

  const data = useMemo(() => {
    const { start, end, salesEnd } = getFilterRange(filter, dayHours);
    if (filter === "today" || filter === "yesterday") {
      return buildHourlyData(activeOrders, start, end, salesEnd);
    }
    return buildDailyData(activeOrders, start, end, dayHours, olderRef.current);
    // olderVersion: re-run once earlier days arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrders, filter, dayHours, olderVersion]);

  const windowLabel = useMemo(() => {
    const { start, end } = getFilterRange(
      filter === "yesterday" ? "yesterday" : "today",
      dayHours,
    );
    return {
      from: hourLabel(businessHour(start)),
      to: hourLabel(businessHour(new Date(end.getTime() - 1))),
    };
  }, [filter, dayHours]);

  const totalForPeriod = useMemo(
    () => data.reduce((s, d) => s + d.sales, 0),
    [data],
  );

  const denseHourly =
    (filter === "today" || filter === "yesterday") && data.length > 10;

  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Axis labels stay flat and 12px; when they would touch, label every Nth bar instead.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const sync = () => setBodyWidth(el.clientWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const yAxisWidth = narrow ? 44 : 58;
  const longestLabel = data.reduce((m, d) => Math.max(m, d.hour.length), 0);
  const labelSlot = longestLabel * 7 + 10;
  const plotWidth = bodyWidth - yAxisWidth - 36;
  const labelEvery =
    plotWidth > 0 && data.length > 0
      ? Math.max(1, Math.ceil((data.length * labelSlot) / plotWidth))
      : narrow && data.length > 10
        ? Math.ceil(data.length / 8)
        : 1;

  const L = locale === "ur" ? "ur" : "en";

  return (
    <section className="dash-panel dash-chart">
      <div className="dash-panel-head">
        <span className="dash-panel-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 21h18" />
            <rect x="5" y="12" width="3.5" height="6" rx="1" />
            <rect x="10.25" y="7" width="3.5" height="11" rx="1" />
            <rect x="15.5" y="3.5" width="3.5" height="14.5" rx="1" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          {filter === "today" ? (
            <span className="dash-chart-today">{filterLabels.today[L]}</span>
          ) : (
            <p className="dash-eyebrow">{L === "ur" ? "چارٹ" : "Chart"}</p>
          )}
          <h2 className="dash-panel-title">
            {L === "ur" ? "سیل کا جائزہ" : "Sales Overview"}
          </h2>
        </div>

        <div className="dash-range">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="dash-range-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
              <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
            </svg>
            {filterLabels[filter][L]}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`dash-range-chevron${open ? " is-open" : ""}`} aria-hidden>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="dash-range-menu">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setFilter(f);
                      setOpen(false);
                    }}
                    aria-pressed={f === filter}
                    className={`dash-range-item${f === filter ? " is-active" : ""}`}
                  >
                    {filterLabels[f][L]}
                    {f === filter ? (
                      <svg className="dash-range-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="dash-chart-meta">
        <p className="dash-chart-summary">
          {filter === "today" && todaySummary
            ? L === "ur"
              ? `آج · ${todaySummary.orders} آرڈرز`
              : `Today · ${todaySummary.orders} orders`
            : L === "ur"
              ? "وقت کے مطابق سیل"
              : "Sales by time"}
          {" · "}
          <span className="dash-chart-total" dir="ltr">
            {formatPkr(totalForPeriod)}
          </span>
        </p>
        <p className="dash-chart-hint">
          {L === "ur"
            ? "بائیں = سیل (روپے) · نیچے = وقت"
            : "Left = sales in rupees · Bottom = time of day"}
        </p>
        {olderFailed && (filter === "last7" || filter === "thisMonth") ? (
          <p className="dash-chart-warn">
            {L === "ur"
              ? "پرانے دن انٹرنیٹ پر دکھیں گے — ابھی صرف کل اور آج"
              : "Earlier days need the internet — showing yesterday and today only"}
          </p>
        ) : null}
      </div>

      <div className="dash-chart-body" dir="ltr" ref={bodyRef}>
        {(filter === "today" || filter === "yesterday") && (
          <p className="dash-chart-day" dir={L === "ur" ? "rtl" : "ltr"}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span>{L === "ur" ? "کاروباری دن:" : "Business day:"}</span>
            <bdi dir="ltr">{windowLabel.from}</bdi>
            <svg className="dash-window-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <bdi dir="ltr">{windowLabel.to}</bdi>
          </p>
        )}
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={data}
            margin={{
              top: 8,
              right: 8,
              left: 4,
              bottom: 8,
            }}
            barCategoryGap={denseHourly ? "12%" : "18%"}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--bb-cream-200)" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 12, fill: "var(--bb-muted)" }}
              axisLine={false}
              tickLine={false}
              interval={labelEvery - 1}
              height={26}
              minTickGap={0}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "var(--bb-muted)" }}
              axisLine={false}
              tickLine={false}
              width={yAxisWidth}
              tickCount={5}
              tickFormatter={(v: number) => {
                if (!Number.isFinite(v) || v <= 0) return "0";
                if (v >= 100_000) return `${(v / 1000).toFixed(0)}k`;
                if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
                return String(Math.round(v));
              }}
            />
            <Tooltip
              cursor={{ fill: "var(--bb-cream-100)" }}
              contentStyle={{
                background: "var(--bb-brown-900)",
                border: "1px solid var(--bb-brown-700)",
                borderRadius: 12,
                padding: "8px 14px",
                fontSize: 13,
              }}
              labelStyle={{ color: "var(--bb-muted-on-dark)", marginBottom: 2 }}
              itemStyle={{ color: "var(--bb-cream-100)", fontWeight: 700, padding: 0 }}
              formatter={(value) => [formatPkr(Number(value ?? 0)), L === "ur" ? "سیل" : "Sales"]}
              labelFormatter={(label) =>
                L === "ur" ? `وقت: ${label}` : `Time: ${label}`
              }
            />
            <defs>
              <linearGradient id="bbBarMustard" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--bb-mustard-400)" />
                <stop offset="100%" stopColor="var(--bb-mustard-700)" />
              </linearGradient>
            </defs>
            <Bar
              dataKey="sales"
              fill="url(#bbBarMustard)"
              activeBar={{ fill: "var(--bb-red-500)" }}
              radius={[6, 6, 0, 0]}
              maxBarSize={denseHourly ? 18 : 36}
            />
          </BarChart>
        </ResponsiveContainer>
        <p className="dash-chart-foot" dir={L === "ur" ? "rtl" : "ltr"}>
          {L === "ur"
            ? "۷k = ۷,۰۰۰ روپے · بار جتنی اونچی، اتنی زیادہ سیل"
            : "7k = Rs 7,000 · Taller bar = more sales that hour"}
        </p>
      </div>
    </section>
  );
}
