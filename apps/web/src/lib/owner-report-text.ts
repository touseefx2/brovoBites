import { formatPkr } from "@bravobites/domain";
import type { Locale, MessageKey } from "@/i18n/dictionaries";
import { money } from "@bravobites/domain";
import {
  BIG_DISCOUNT_RUPEES,
  BIG_DISCOUNT_SHARE,
  type FlagKind,
  type FlagLevel,
  type ItemVariant,
  type OwnerReport,
  type ReportEvent,
  type ReportEventKind,
  type ReportFlag,
  type TypeRow,
} from "@/lib/owner-report";

/**
 * Owner report wording shared by the screen (OwnerReport.tsx) and the printed
 * slip / A4 page (print-owner-report.ts), so both say exactly the same.
 */

type T = (key: MessageKey) => string;
const TZ = "Asia/Karachi";

export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export const FLAG_KEY: Record<ReportFlag["kind"], MessageKey> = {
  drawerShort: "flagDrawerShort",
  drawerOver: "flagDrawerOver",
  drawerNotCounted: "flagDrawerNotCounted",
  editDown: "flagEditDown",
  cancelCash: "flagCancelCash",
  cancel: "flagCancel",
  refund: "flagRefund",
  delete: "flagDelete",
  bigDiscount: "flagBigDiscount",
  expenseEdit: "flagExpenseEdit",
  expenseDelete: "flagExpenseDelete",
  manyEdits: "flagManyEdits",
};

export const EVENT_KEY: Record<ReportEventKind, MessageKey> = {
  edit: "evEdit",
  cancel: "evCancel",
  refund: "evRefund",
  delete: "evDelete",
  expenseAdd: "evExpenseAdd",
  expenseEdit: "evExpenseEdit",
  expenseDelete: "evExpenseDelete",
};

export const TYPE_LABEL: Record<TypeRow["type"], MessageKey> = {
  "dine-in": "dineIn",
  takeaway: "takeaway",
  delivery: "delivery",
  unset: "orTypeUnset",
};

export const LEVEL_KEY: Record<ReportFlag["level"], MessageKey> = {
  high: "orLevelHigh",
  medium: "orLevelMedium",
  low: "orLevelLow",
};

type Wrap = (v: string | number) => string;
const keep: Wrap = (v) => String(v);

/**
 * A flag's sentence values. `wrap` isolates each one for plain-text Urdu
 * (isolator in activity-change-text); the screen isolates them itself (bdi).
 */
export function flagVars(f: ReportFlag, day: (key: string) => string, wrap: Wrap = keep): Record<string, string | number> {
  return {
    num: wrap(f.orderNumber ?? "?"),
    amount: wrap(f.amount != null ? formatPkr(f.amount) : "—"),
    before: wrap(f.before != null ? formatPkr(f.before) : "—"),
    after: wrap(f.after != null ? formatPkr(f.after) : "—"),
    n: wrap(f.count ?? 0),
    pct: wrap(f.count ?? 0),
    date: f.date ? wrap(day(f.date)) : "",
  };
}

export function eventVars(ev: ReportEvent, wrap: Wrap = keep): Record<string, string | number> {
  return {
    name: wrap(ev.byName),
    num: wrap(ev.orderNumber ?? "?"),
    amount: wrap(ev.amount != null ? formatPkr(ev.amount) : "—"),
    before: wrap(ev.before != null ? formatPkr(ev.before) : "—"),
    after: wrap(ev.after != null ? formatPkr(ev.after) : "—"),
  };
}

/** The log line gave the amounts the sentence needs (else show its raw text). */
export function eventParsed(ev: ReportEvent): boolean {
  return ev.kind === "edit" || ev.kind === "expenseEdit" ? ev.after != null : ev.amount != null;
}

/** "3 h after the sale" — only when the change came a while after the sale. */
export function afterSaleText(minutes: number | undefined, t: T): string | null {
  if (minutes == null || minutes < 15) return null;
  if (minutes < 120) return fill(t("orMinutesAfterSale"), { m: minutes });
  return fill(t("orHoursAfterSale"), { h: Math.round(minutes / 60) });
}

export function reportFormatters(locale: Locale, multiDay: boolean) {
  const lang = locale === "ur" ? "ur-PK" : "en-PK";
  const time = new Intl.DateTimeFormat(lang, { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const dayTime = new Intl.DateTimeFormat(lang, {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  const dayOnly = new Intl.DateTimeFormat(lang, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  return {
    /** Time of a change (with the day when the period spans days). */
    when: (iso: string) => (multiDay ? dayTime : time).format(new Date(iso)),
    /** Business-day key (YYYY-MM-DD) → "Sat, 24 Oct". */
    day: (key: string) => dayOnly.format(new Date(`${key}T12:00:00Z`)),
    /** Any moment → "Sat, 24 Oct, 12:00 pm" (the time kept whole, and left-to-right in Urdu). */
    dayTime: (d: Date) => keepTime(dayTime, d, locale === "ur"),
  };
}

/**
 * "12:00 AM" never breaks before "AM", and in Urdu it is isolated left-to-right
 * (else it reads "AM 12:00"); the weekday and month keep the text's direction.
 */
function keepTime(fmt: Intl.DateTimeFormat, d: Date, isolate: boolean): string {
  const parts = fmt.formatToParts(d);
  const at = parts.flatMap((p, i) => (p.type === "hour" || p.type === "minute" || p.type === "dayPeriod" ? [i] : []));
  if (at.length === 0) return fmt.format(d);
  const join = (ps: Intl.DateTimeFormatPart[]) => ps.map((p) => p.value).join("");
  const a = Math.min(...at);
  const b = Math.max(...at);
  const time = join(parts.slice(a, b + 1)).replace(/\s/g, "\u00a0");
  return `${join(parts.slice(0, a))}${isolate ? `\u2066${time}\u2069` : time}${join(parts.slice(b + 1))}`;
}

const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Business day (Karachi) of a moment, as the YYYY-MM-DD key the formatters' `day` takes. */
export function dayKeyOf(iso: string): string {
  return DAY_KEY.format(new Date(iso));
}

/** "Rs 760" never breaks between "Rs" and the number (a narrow screen wraps there, and in Urdu the halves swap). */
export function keepRs(text: string): string {
  return text.replace(/Rs /g, "Rs\u00a0");
}

/** "Sat, 24 Oct, 12:00 pm → Sun, 25 Oct, 4:00 am" (or "All time → …"); the arrow points the reading way. */
export function periodText(opts: { from: Date | null; to: Date; locale: Locale; t: T }): string {
  const f = reportFormatters(opts.locale, true);
  return `${opts.from ? f.dayTime(opts.from) : opts.t("dateAll")} ${opts.t("lgArrow")} ${f.dayTime(opts.to)}`;
}

/** "1 changed · 2 removed" — an expense change count, leaving out a part that is zero. */
export function expenseChangeParts(edits: number, deletes: number): { key: MessageKey; n: number }[] {
  return [
    ...(edits > 0 ? [{ key: "orExpPartChanged" as MessageKey, n: edits }] : []),
    ...(deletes > 0 ? [{ key: "orExpPartRemoved" as MessageKey, n: deletes }] : []),
  ];
}

/** "BrovoBites-Owner-Report_2026-10-24_saved-2026-10-24_21-35-07.pdf" — a new name every time. */
export function ownerReportFileName(fromKey: string | null, toKey: string, now = new Date()): string {
  const period = !fromKey ? `all-time-to-${toKey}` : fromKey === toKey ? toKey : `${fromKey}_to_${toKey}`;
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(now)
    .replace(", ", "_")
    .replace(/:/g, "-");
  return `BrovoBites-Owner-Report_${period}_saved-${stamp}.pdf`;
}

/** "Full ×5 · Half ×10" — an item's sizes, most sold first. */
export function variantsText(variants: ItemVariant[], t: T): string {
  return variants.map((v) => `${v.label || t("orItemsPlain")} ×${v.qty}`).join(" · ");
}

/* ── Plain-language summary (screen, PDF, slip and email say the same) ── */

/** A flag's short title — what happened, in everyday words. */
export const FLAG_TITLE_KEY: Record<FlagKind, MessageKey> = {
  drawerShort: "orFtDrawerShort",
  drawerOver: "orFtDrawerOver",
  drawerNotCounted: "orFtDrawerNotCounted",
  editDown: "orFtEditDown",
  cancelCash: "orFtCancelCash",
  cancel: "orFtCancel",
  refund: "orFtRefund",
  delete: "orFtDelete",
  bigDiscount: "orFtBigDiscount",
  expenseEdit: "orFtExpenseEdit",
  expenseDelete: "orFtExpenseDelete",
  manyEdits: "orFtManyEdits",
};

/** The money a flag is about, signed the way the owner should read it (null: none). */
export function flagAmount(f: ReportFlag): { value: number; sign: "" | "+" | "−" } | null {
  switch (f.kind) {
    case "drawerShort":
      return f.amount != null ? { value: f.amount, sign: "−" } : null;
    case "drawerOver":
      return f.amount != null ? { value: f.amount, sign: "+" } : null;
    case "editDown":
      return f.before != null && f.after != null ? { value: money(f.before - f.after), sign: "−" } : null;
    case "expenseEdit":
      return f.before != null && f.after != null && f.after !== f.before
        ? { value: money(Math.abs(f.after - f.before)), sign: f.after > f.before ? "+" : "−" }
        : null;
    case "drawerNotCounted":
    case "manyEdits":
      return null;
    default:
      return f.amount != null ? { value: f.amount, sign: "" } : null;
  }
}

export type CheckMark = "ok" | "bad" | "warn" | "info" | "na";

export type CheckRow = {
  id: "drawer" | "edits" | "cancels" | "deletes" | "refunds" | "discounts" | "expenses";
  label: string;
  mark: CheckMark;
  result: string;
  /** Flags behind the row (the first one to jump to). */
  kinds: FlagKind[];
};

export type OwnerSummary = {
  high: number;
  medium: number;
  low: number;
  tone: "red" | "amber" | "green";
  headline: string;
  hint: string;
  story: string;
  checks: CheckRow[];
  /** Nothing found, but the change log or the drawer didn't load (the hint says which). */
  partial: boolean;
};

const LEVEL_MARK: Record<FlagLevel, CheckMark> = { high: "bad", medium: "warn", low: "info" };
const MARK_RANK: Record<CheckMark, number> = { bad: 0, warn: 1, info: 2, na: 3, ok: 4 };

/**
 * The report in a few plain lines: is anything wrong (counts by level), how
 * the money went (one sentence), and the 7 things checked, each ✓ / ✗ / ! /
 * i / – with its result. Never a ✓ for something that couldn't be read.
 */
export function buildOwnerSummary(report: OwnerReport, t: T, opts: { logsFailed?: boolean; drawerFailed?: boolean } = {}): OwnerSummary {
  const x = report.totals;
  const flags = report.flags;
  const high = flags.filter((f) => f.level === "high").length;
  const medium = flags.filter((f) => f.level === "medium").length;
  const low = flags.filter((f) => f.level === "low").length;
  // Nothing found but something didn't load: never "Nothing wrong found" — nobody could check it.
  const partial = high + medium === 0 && Boolean(opts.logsFailed || opts.drawerFailed);
  const tone = high > 0 ? "red" : medium > 0 || partial ? "amber" : "green";
  const rs = (n: number) => formatPkr(n);
  const failedText = [opts.logsFailed ? t("orLogsFailed") : "", opts.drawerFailed ? t("orDrawerFailed") : ""].filter(Boolean).join(" ");

  const headline =
    high > 0
      ? fill(t(high === 1 ? "orVerdictHighOne" : "orVerdictHigh"), { n: high })
      : medium > 0
        ? fill(t(medium === 1 ? "orVerdictMediumOne" : "orVerdictMedium"), { n: medium })
        : partial
          ? t("orVerdictPartial")
          : t("orVerdictClear");
  const hint =
    high > 0
      ? `${t("orVerdictHighHint")}${medium > 0 ? ` ${fill(t("orVerdictAlsoMedium"), { n: medium })}` : ""}`
      : medium > 0
        ? t("orVerdictMediumHint")
        : partial
          ? failedText
          : t("orVerdictClearHint");

  const left = money(x.net - x.expenses);
  const story =
    x.orders === 0
      ? `${t("orStoryNone")}${x.expenses > 0 ? ` ${fill(t("orStoryNoneExp"), { expenses: rs(x.expenses) })}` : ""}`
      : left < 0
        ? fill(t(x.orders === 1 ? "orStoryLossOne" : "orStoryLoss"), { sales: rs(x.net), n: x.orders, expenses: rs(x.expenses), loss: rs(-left) })
        : fill(t(x.orders === 1 ? "orStoryOne" : "orStory"), { sales: rs(x.net), n: x.orders, left: rs(left) });

  const worst = (kinds: FlagKind[]): CheckMark | null => {
    const marks = flags.filter((f) => kinds.includes(f.kind)).map((f) => LEVEL_MARK[f.level]);
    return marks.length ? marks.sort((a, b) => MARK_RANK[a] - MARK_RANK[b])[0]! : null;
  };
  const sum = (kinds: FlagKind[]) => money(flags.filter((f) => kinds.includes(f.kind)).reduce((s, f) => s + (f.amount ?? 0), 0));
  const count = (kinds: FlagKind[]) => flags.filter((f) => kinds.includes(f.kind)).length;
  /** Flags decide; with none, a count above zero is just a note (e.g. the owner's own). */
  const mark = (kinds: FlagKind[], n: number, failed = false): CheckMark => worst(kinds) ?? (failed ? "na" : n > 0 ? "info" : "ok");
  const none = t("orChkNone");
  const cantLoad = t("orChkCantLoad");

  // 1 · Cash in the drawer
  const drawerKinds: FlagKind[] = ["drawerShort", "drawerNotCounted", "drawerOver"];
  const counted = report.drawers.filter((d) => d.status === "closed" && !d.autoClosed && d.closingCount != null);
  let drawerMark: CheckMark;
  let drawerResult: string;
  // What did load is said first (one branch failing can't hide another's shortage).
  if (report.drawerShort > 0) {
    drawerMark = worst(drawerKinds) ?? "bad";
    drawerResult = fill(t("orChkShort"), { amount: rs(report.drawerShort) });
  } else if (report.drawers.some((d) => d.status === "closed" && (d.autoClosed || d.closingCount == null))) {
    drawerMark = worst(drawerKinds) ?? "warn";
    drawerResult = t("orChkNoCount");
  } else if (report.drawerOver > 0) {
    drawerMark = worst(drawerKinds) ?? "info";
    drawerResult = fill(t("orChkExtra"), { amount: rs(report.drawerOver) });
  } else if (opts.drawerFailed) {
    drawerMark = "na";
    drawerResult = cantLoad;
  } else if (report.drawers.length === 0) {
    drawerMark = "na";
    drawerResult = t("orChkNotOpened");
  } else if (counted.length === 0) {
    drawerMark = "na";
    drawerResult = t("orChkStillOpen");
  } else {
    drawerMark = "ok";
    drawerResult = t("orChkMatches");
  }

  const nAmount = (n: number, amount: number, one: MessageKey, many: MessageKey) =>
    fill(t(n === 1 ? one : many), { n, amount: rs(amount) });
  const cashCancels = count(["cancelCash"]);
  const refunds = flags.filter((f) => f.kind === "refund");

  const checks: CheckRow[] = [
    { id: "drawer", label: t("orChkDrawer"), mark: drawerMark, result: drawerResult, kinds: drawerKinds },
    {
      id: "edits",
      label: t("orChkEdits"),
      mark: mark(["editDown"], x.editsDown, opts.logsFailed),
      result: opts.logsFailed && x.editsDown === 0 ? cantLoad : x.editsDown > 0 ? nAmount(x.editsDown, x.editsDownAmount, "orChkBillsLessOne", "orChkBillsLess") : none,
      kinds: ["editDown"],
    },
    {
      id: "cancels",
      label: t("orChkCancels"),
      mark: mark(["cancelCash", "cancel"], x.cancelledOrders),
      result:
        x.cancelledOrders > 0
          ? `${nAmount(x.cancelledOrders, x.cancelledAmount, "orChkOrdersAmtOne", "orChkOrdersAmt")}${cashCancels > 0 ? ` ${fill(t("orChkCashPart"), { n: cashCancels })}` : ""}`
          : none,
      kinds: ["cancelCash", "cancel"],
    },
    {
      id: "deletes",
      label: t("orChkDeletes"),
      mark: mark(["delete"], x.deletes, opts.logsFailed),
      result:
        opts.logsFailed && x.deletes === 0
          ? cantLoad
          : x.deletes > 0
            ? nAmount(x.deletes, report.staff.reduce((s, p) => s + p.deletesAmount, 0), "orChkOrdersAmtOne", "orChkOrdersAmt")
            : none,
      kinds: ["delete"],
    },
    {
      id: "refunds",
      label: t("orChkRefunds"),
      mark: mark(["refund"], Math.max(x.refundOrders, refunds.length)),
      result: x.refundOrders > 0 ? nAmount(x.refundOrders, x.refunds, "orChkOrdersAmtOne", "orChkOrdersAmt") : none,
      kinds: ["refund"],
    },
    {
      id: "discounts",
      label: fill(t("orChkDiscounts"), { pct: Math.round(BIG_DISCOUNT_SHARE * 100), amount: rs(BIG_DISCOUNT_RUPEES) }),
      mark: mark(["bigDiscount"], 0),
      result: count(["bigDiscount"]) > 0 ? nAmount(count(["bigDiscount"]), sum(["bigDiscount"]), "orChkOrdersAmtOne", "orChkOrdersAmt") : none,
      kinds: ["bigDiscount"],
    },
    {
      id: "expenses",
      label: t("orChkExpenses"),
      mark: mark(["expenseEdit", "expenseDelete"], x.expenseEdits + x.expenseDeletes, opts.logsFailed),
      result:
        opts.logsFailed && x.expenseEdits + x.expenseDeletes === 0
          ? cantLoad
          : x.expenseEdits + x.expenseDeletes > 0
            ? expenseChangeParts(x.expenseEdits, x.expenseDeletes)
                .map((p) => fill(t(p.key), { n: p.n }))
                .join(" · ")
            : none,
      kinds: ["expenseEdit", "expenseDelete"],
    },
  ];

  return { high, medium, low, tone, headline, hint, story, checks, partial };
}
