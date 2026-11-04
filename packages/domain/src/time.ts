/** Shop business timezone — Pakistan (no DST). */
export const SHOP_TIMEZONE = "Asia/Karachi";

/**
 * Shop operating window in Pakistan local time (`HH:mm`).
 * If `end` is on/before `start` (e.g. 12:00 → 04:00), the day spans midnight.
 */
export type BusinessDayHours = {
  start: string;
  end: string;
};

/** Midnight–midnight Karachi calendar day (legacy / unset shops). */
export const DEFAULT_BUSINESS_DAY_HOURS: BusinessDayHours = {
  start: "00:00",
  end: "23:59",
};

const HM_PREFIX = /^([01]?\d|2[0-3]):([0-5]\d)/;

/** Accept `HH:mm`, `HH:mm:ss`, 12h `h:mm AM/PM`, or hour number 0–23. */
export function coerceBusinessTime(
  value: string | number | null | undefined,
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const h = Math.floor(value);
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const mins = ampm[2]!;
    const ap = ampm[3]!.toUpperCase();
    if (!Number.isFinite(h) || h < 1 || h > 12) return null;
    if (ap === "AM") {
      if (h === 12) h = 0;
    } else if (h !== 12) {
      h += 12;
    }
    return `${String(h).padStart(2, "0")}:${mins}`;
  }

  const m = raw.match(HM_PREFIX);
  if (!m) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

export function isValidBusinessTime(value: string | null | undefined): value is string {
  return coerceBusinessTime(value) != null;
}

export function normalizeBusinessDayHours(
  start?: string | null,
  end?: string | null,
): BusinessDayHours {
  return {
    start: coerceBusinessTime(start) ?? DEFAULT_BUSINESS_DAY_HOURS.start,
    end: coerceBusinessTime(end) ?? DEFAULT_BUSINESS_DAY_HOURS.end,
  };
}

export function businessDayHoursFromSettings(
  settings?: { businessDayStart?: string; businessDayEnd?: string } | null,
): BusinessDayHours {
  return normalizeBusinessDayHours(settings?.businessDayStart, settings?.businessDayEnd);
}

/** Pure Karachi calendar YYYY-MM-DD (ignores shop open/close). */
function calendarDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: SHOP_TIMEZONE });
}

function minutesFromHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function karachiMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHOP_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = Number(p.value);
    if (p.type === "minute") minute = Number(p.value);
  }
  // en-GB hour12:false can yield "24" for midnight in some engines
  if (hour === 24) hour = 0;
  return hour * 60 + minute;
}

/**
 * YYYY-MM-DD business date for an instant (Pakistan + shop hours).
 *
 * One business day = Landing Page window `[start, end]` (may span midnight).
 * - During the open window → that day's open date
 * - After close until the next open → **next** business day (dashboard "Today" is empty/0)
 * - Overnight example 12:00→04:00: 2am still previous open day; 9am (gap) → calendar day opening at noon
 */
export function businessDateKey(
  d: Date = new Date(),
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): string {
  const key = calendarDateKey(d);
  const mins = karachiMinutes(d);
  const startM = minutesFromHm(hours.start);
  const endM = minutesFromHm(hours.end);
  const overnight = endM <= startM;

  if (overnight) {
    // Open: [start, 24:00) on open date, then [00:00, end] next calendar morning
    if (mins >= startM) return key;
    if (mins <= endM) return shiftBusinessDateKey(key, -1);
    // Gap after close → next business day (opens later today at `start`)
    return key;
  }

  // Same calendar-day window
  if (mins >= startM && mins <= endM) return key;
  if (mins > endM) return shiftBusinessDateKey(key, 1); // after close → next day
  return key; // morning before open → upcoming open today
}

/** Opening time of a shop business day (UTC instant) — for chart axes / labels. */
export function openingOfBusinessDay(
  dateKey: string,
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): Date {
  return new Date(`${dateKey}T${hours.start}:00+05:00`);
}

/**
 * First instant of a shop business day: right after the previous day's close.
 * Days touch with no gap, so a sale after close (or before open) is in exactly
 * one day's report — the same day businessDateKey gives it. Default hours
 * 00:00→23:59 → midnight.
 */
export function startOfBusinessDay(
  dateKey: string,
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): Date {
  const prevEnd = endOfBusinessDay(shiftBusinessDateKey(dateKey, -1), hours);
  return new Date(prevEnd.getTime() + 1);
}

/** Inclusive end of a shop business day (UTC instant). */
export function endOfBusinessDay(
  dateKey: string,
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): Date {
  const startM = minutesFromHm(hours.start);
  const endM = minutesFromHm(hours.end);
  // Close == open (24h shop): the day ends just before the next day opens.
  if (endM === startM) {
    const nextOpen = openingOfBusinessDay(shiftBusinessDateKey(dateKey, 1), hours);
    return new Date(nextOpen.getTime() - 1);
  }
  const endKey = endM < startM ? shiftBusinessDateKey(dateKey, 1) : dateKey;
  return new Date(`${endKey}T${hours.end}:59.999+05:00`);
}

/** Hour 0–23 in the shop timezone. */
export function businessHour(d: Date): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHOP_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).format(d);
  const h = Number(raw);
  // en-GB hour12:false can yield "24" for midnight in some engines
  if (h === 24) return 0;
  return Number.isFinite(h) ? h : 0;
}

/** Shift a YYYY-MM-DD key by `deltaDays` in the shop calendar. */
export function shiftBusinessDateKey(dateKey: string, deltaDays: number): string {
  const noon = new Date(`${dateKey}T12:00:00+05:00`);
  return calendarDateKey(new Date(noon.getTime() + deltaDays * 86_400_000));
}

/** First day of the month containing `dateKey` (shop calendar). */
export function startOfBusinessMonthKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}
