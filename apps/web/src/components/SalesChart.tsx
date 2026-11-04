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
    const from = hourLabel(businessHour(start));
    const to = hourLabel(businessHour(new Date(end.getTime() - 1)));
    return `${from} → ${to}`;
  }, [filter, dayHours]);

  const totalForPeriod = useMemo(
    () => data.reduce((s, d) => s + d.sales, 0),
    [data],
  );

  const denseHourly =
    (filter === "today" || filter === "yesterday") && data.length > 10;

  return (
    <section className="overflow-hidden rounded-2xl border border-[rgba(184,134,11,0.18)] bg-white shadow-[0_12px_32px_rgba(28,25,23,0.06)]">
      <div className="flex items-center justify-between gap-3 border-b border-[rgba(184,134,11,0.12)] bg-gradient-to-r from-[#faf7f2] to-white px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-[rgba(184,134,11,0.12)] text-[var(--gold-deep)] ring-1 ring-[rgba(184,134,11,0.22)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <rect x="3" y="12" width="4" height="9" rx="1" fill="currentColor" stroke="none" opacity="0.35" />
                <rect x="10" y="7" width="4" height="14" rx="1" fill="currentColor" stroke="none" opacity="0.55" />
                <rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor" stroke="none" opacity="0.9" />
              </svg>
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {filter === "today" ? (
                  <span className="inline-flex items-center rounded-full bg-[var(--gold-deep)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
                    {filterLabels.today[locale === "ur" ? "ur" : "en"]}
                  </span>
                ) : (
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--gold-deep)]">
                    {locale === "ur" ? "چارٹ" : "Chart"}
                  </p>
                )}
              </div>
              <h2 className="mt-0.5 text-base font-bold text-[var(--ink)]">
                {locale === "ur" ? "سیل کا جائزہ" : "Sales Overview"}
              </h2>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {filter === "today" && todaySummary
              ? locale === "ur"
                ? `آج · ${todaySummary.orders} آرڈرز`
                : `Today · ${todaySummary.orders} orders`
              : locale === "ur"
                ? "وقت کے مطابق سیل"
                : "Sales by time"}
            {" · "}
            <span className="font-semibold text-[var(--gold-deep)]" dir="ltr">
              {formatPkr(totalForPeriod)}
            </span>
          </p>
          <p className="mt-1 text-[10px] leading-snug text-[var(--muted)] sm:text-xs">
            {locale === "ur"
              ? "بائیں = سیل (روپے) · نیچے = وقت"
              : "Left = sales in rupees · Bottom = time of day"}
          </p>
          {olderFailed && (filter === "last7" || filter === "thisMonth") ? (
            <p className="mt-1 text-[10px] leading-snug text-amber-700 sm:text-xs">
              {locale === "ur"
                ? "پرانے دن انٹرنیٹ پر دکھیں گے — ابھی صرف کل اور آج"
                : "Earlier days need the internet — showing yesterday and today only"}
            </p>
          ) : null}
        </div>

        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex min-h-10 items-center gap-1.5 rounded-xl border border-[rgba(184,134,11,0.25)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--ink)] shadow-sm transition hover:border-[var(--gold)] hover:bg-[#faf7f2]"
          >
            {filterLabels[filter][locale === "ur" ? "ur" : "en"]}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition ${open ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute end-0 z-20 mt-1 min-w-[160px] overflow-hidden rounded-xl border border-[rgba(184,134,11,0.2)] bg-white shadow-lg">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setFilter(f);
                      setOpen(false);
                    }}
                    className={`block w-full px-4 py-2.5 text-start text-sm transition hover:bg-[#faf7f2] ${
                      f === filter ? "font-bold text-[var(--gold-deep)]" : "text-[var(--ink)]"
                    }`}
                  >
                    {filterLabels[f][locale === "ur" ? "ur" : "en"]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto px-3 py-4 sm:px-5 sm:py-5" dir="ltr">
        {(filter === "today" || filter === "yesterday") && (
          <p className="mb-2 text-[10px] font-medium text-[var(--muted)] sm:text-xs">
            {locale === "ur" ? "کاروباری دن" : "Business day"}
            {": "}
            {windowLabel}
          </p>
        )}
        <ResponsiveContainer width="100%" height={denseHourly ? 280 : 260}>
          <BarChart
            data={data}
            margin={{
              top: 8,
              right: 8,
              left: 4,
              bottom: denseHourly ? 40 : 8,
            }}
            barCategoryGap={denseHourly ? "12%" : "18%"}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,25,23,0.06)" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: denseHourly ? 8 : 11, fill: "#78716c" }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={denseHourly ? -40 : 0}
              textAnchor={denseHourly ? "end" : "middle"}
              height={denseHourly ? 52 : 24}
              minTickGap={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#78716c" }}
              axisLine={false}
              tickLine={false}
              width={58}
              tickCount={5}
              tickFormatter={(v: number) => {
                if (!Number.isFinite(v) || v <= 0) return "0";
                if (v >= 100_000) return `${(v / 1000).toFixed(0)}k`;
                if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
                return String(Math.round(v));
              }}
            />
            <Tooltip
              cursor={{ fill: "rgba(201,162,39,0.08)" }}
              contentStyle={{
                background: "#1c1917",
                border: "none",
                borderRadius: 10,
                padding: "8px 14px",
                fontSize: 13,
              }}
              labelStyle={{ color: "#a8a29e", marginBottom: 2 }}
              formatter={(value) => [formatPkr(Number(value ?? 0)), locale === "ur" ? "سیل" : "Sales"]}
              labelFormatter={(label) =>
                locale === "ur" ? `وقت: ${label}` : `Time: ${label}`
              }
            />
            <defs>
              <linearGradient id="barGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e4c15a" />
                <stop offset="100%" stopColor="#8a6508" />
              </linearGradient>
            </defs>
            <Bar
              dataKey="sales"
              fill="url(#barGold)"
              radius={[4, 4, 0, 0]}
              maxBarSize={denseHourly ? 18 : 36}
            />
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-1 text-center text-[10px] text-[var(--muted)]">
          {locale === "ur"
            ? "۷k = ۷,۰۰۰ روپے · بار جتنی اونچی، اتنی زیادہ سیل"
            : "7k = Rs 7,000 · Taller bar = more sales that hour"}
        </p>
      </div>
    </section>
  );
}
