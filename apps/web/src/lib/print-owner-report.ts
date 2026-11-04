import type { ReceiptPaper, StockDayRow } from "@bravobites/domain";
import { formatPkr, money } from "@bravobites/domain";
import type { Locale, MessageKey } from "@/i18n/dictionaries";
import type { DrawerRow, FlagKind, FlagLevel, ItemSales, OwnerReport, ReportEventKind, ReportFlag, StaffAudit } from "@/lib/owner-report";
import {
  afterSaleText,
  buildOwnerSummary,
  dayKeyOf,
  EVENT_KEY,
  eventParsed,
  eventVars,
  expenseChangeParts,
  fill,
  FLAG_TITLE_KEY,
  flagAmount,
  flagVars,
  keepRs,
  LEVEL_KEY,
  reportFormatters,
  TYPE_LABEL,
  variantsText,
  type CheckMark,
  type OwnerSummary,
} from "@/lib/owner-report-text";
import { escapeHtml as e, receiptPrintWidthMm } from "@/lib/print-receipt";
import { unitLabelKey } from "@/lib/stock-labels";
import { changeSummary } from "@/lib/activity-change-text";
import { LOG_DETAIL_CSS, LOG_DETAIL_SLIP_CSS, logDetailHtml, logDetailSlipHtml } from "@/lib/print-activity-change";

/**
 * The owner report on paper: a short slip for the counter's receipt printer
 * (same roll width as the receipts), or a full A4 page — the browser's print
 * dialog also saves it as PDF, and the emails attach it. Same order, words and
 * (as far as paper allows) look as the screen: summary → cash in the drawer →
 * how customers ordered / paid → what sold → staff → things to check → every
 * change. Paper can't be tapped, so every bill, note and list is already open.
 */

export type OwnerReportPrintFormat = "slip" | "a4";

/** What the page around the report knows (shop, branch, period, roll width). */
export type OwnerReportPrintInfo = {
  shopName: string;
  branchLabel?: string;
  periodLabel: string;
  paper?: ReceiptPaper;
  paperWidthMm?: number;
};

type T = (key: MessageKey) => string;
type Fmt = ReturnType<typeof reportFormatters>;
type Tone = "red" | "amber" | "green" | "info" | "neutral";

/** Slip keeps the newest changes only; the A4 page lists them all. */
const SLIP_EVENTS = 40;

/* ── Small pieces ── */

function rs(n: number, sign = "", cls = ""): string {
  return `<bdi dir="ltr" class="num${cls ? ` ${cls}` : ""}">${sign}${e(formatPkr(n))}</bdi>`;
}

function num(n: number): string {
  return `<bdi dir="ltr" class="num">${n}</bdi>`;
}

/** "{name} changed order #{num}" → escaped text, each value isolated (Urdu stays in order). */
function tpl(text: string, vars: Record<string, string | number>): string {
  return text
    .split(/\{(\w+)\}/g)
    .map((p, i) => (i % 2 === 1 ? `<bdi class="var">${e(keepRs(String(vars[p] ?? `{${p}}`)))}</bdi>` : e(p)))
    .join("");
}

function nKey(n: number, one: MessageKey, many: MessageKey): MessageKey {
  return n === 1 ? one : many;
}

function orders(t: T, n: number): string {
  return tpl(t(nKey(n, "orOneOrder", "orNOrders")), { n });
}

/** "1 changed · 2 removed" (a zero part left out). */
function expChanges(t: T, edits: number, deletes: number): string {
  return expenseChangeParts(edits, deletes)
    .map((p) => tpl(t(p.key), { n: p.n }))
    .join(" · ");
}

/** Slip line: label (+ small line under it) … value at the end. */
function row(label: string, value: string, sub?: string, cls = ""): string {
  return `<div class="row${cls ? ` ${cls}` : ""}"><span class="l">${label}${sub ? `<small>${sub}</small>` : ""}</span><span class="v">${value}</span></div>`;
}

/** The screen's line icons (A4 only — the slip is text). */
const PATH = {
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6v-4m0-4h.01",
  check: "M20 6 9 17l-5-5",
  minus: "M5 12h14",
  chart: "M3 3v18h18M8 17v-6M13 17V7M18 17v-3",
  drawer: "M3 5h18v14H3zM3 10h18M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  bag: "M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6l2-4ZM4 6h16M9 10h6",
  wallet: "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 2-4h12l2 4M16 13h.01",
  box: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12",
  utensils: "M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7",
  people:
    "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  flag: "M4 22V4M4 4h12l-2 4 2 4H4",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  banknote: "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 12h.01M18 12h.01",
  pencil: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  xCircle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM15 9l-6 6M9 9l6 6",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  percent: "M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  arrowDown: "M12 5v14M19 12l-7 7-7-7",
  receipt: "M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2ZM8 8h8M8 12h8M8 16h5",
} as const;

function ico(d: string, size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

const TONE_ICON: Record<Tone, string> = { red: PATH.alert, amber: PATH.eye, green: PATH.check, info: PATH.info, neutral: PATH.minus };
const LEVEL_TONE: Record<FlagLevel, Tone> = { high: "red", medium: "amber", low: "neutral" };

const KIND_ICON: Record<FlagKind, string> = {
  drawerShort: PATH.banknote,
  drawerOver: PATH.banknote,
  drawerNotCounted: PATH.banknote,
  editDown: PATH.arrowDown,
  cancelCash: PATH.xCircle,
  cancel: PATH.xCircle,
  refund: PATH.undo,
  delete: PATH.trash,
  bigDiscount: PATH.percent,
  expenseEdit: PATH.receipt,
  expenseDelete: PATH.receipt,
  manyEdits: PATH.pencil,
};

const EVENT_ICON: Record<ReportEventKind, string> = {
  edit: PATH.pencil,
  cancel: PATH.xCircle,
  refund: PATH.undo,
  delete: PATH.trash,
  expenseAdd: PATH.receipt,
  expenseEdit: PATH.receipt,
  expenseDelete: PATH.receipt,
};

/** Checklist marks: a symbol, never colour alone (the slip is black). */
const MARK: Record<CheckMark, { sym: string; tone: Tone }> = {
  ok: { sym: "✓", tone: "green" },
  bad: { sym: "✗", tone: "red" },
  warn: { sym: "!", tone: "amber" },
  info: { sym: "i", tone: "neutral" },
  na: { sym: "–", tone: "neutral" },
};

type Ctx = {
  report: OwnerReport;
  t: T;
  /** Times with the day when the period spans days. */
  f: Fmt;
  /** Always with the day (drawer dates, day headers). */
  fd: Fmt;
  slip: boolean;
  multiDay: boolean;
  summary: OwnerSummary;
  logsFailed: boolean;
  drawerFailed: boolean;
  branchNameFor?: (id: string) => string | undefined;
};

/** A section: title with the gold rule (A4: icon, hint, something at the end). */
function sec(c: Ctx, o: { title: string; icon: string; hint?: string; end?: string; body: string; cls?: string }): string {
  if (c.slip) return `<section class="sec${o.cls ? ` ${o.cls}` : ""}"><h2>${e(o.title)}</h2>${o.body}</section>`;
  return `<section class="sec${o.cls ? ` ${o.cls}` : ""}">
    <div class="sec-h"><span class="sec-ic">${ico(o.icon, 16)}</span><div class="sec-t"><h2>${e(o.title)}</h2>${o.hint ? `<p class="sec-hint">${e(o.hint)}</p>` : ""}</div>${o.end ? `<div class="sec-end">${o.end}</div>` : ""}</div>
    ${o.body}
  </section>`;
}

/** Tinted result box (A4) / boxed lines (slip, thick for red). */
function resBox(c: Ctx, tone: Tone, title: string, sub?: string): string {
  return `<div class="res r-${tone}">${c.slip ? "" : `<span class="res-ic">${ico(TONE_ICON[tone], 18)}</span>`}<div><p class="res-t">${title}</p>${sub ? `<p class="res-s">${e(sub)}</p>` : ""}</div></div>`;
}

/* ── 1. Summary: status · sales − expenses = left · quick facts ── */

function statusHtml(c: Ctx): string {
  const s = c.summary;
  const hint =
    s.high > 0 ? `${c.t("orVerdictHighHintPrint")}${s.medium > 0 ? ` ${fill(c.t("orVerdictAlsoMedium"), { n: s.medium })}` : ""}` : s.hint;
  const mark = c.slip ? (s.tone === "green" ? "✓" : "!") : ico(s.tone === "red" ? PATH.alert : s.tone === "amber" ? PATH.eye : PATH.check, 18);
  // Something to check and something didn't load: say both (the partial status already says the second).
  const failed = s.partial ? [] : [c.logsFailed ? c.t("orLogsFailed") : "", c.drawerFailed ? c.t("orDrawerFailed") : ""].filter(Boolean);
  return `<div class="status st-${s.tone}"><span class="st-ic">${mark}</span><div><p class="st-h">${e(s.headline)}</p><p class="st-hint">${e(hint)}</p></div></div>${failed
    .map((m) => resBox(c, "amber", e(m)))
    .join("")}`;
}

function equationHtml(c: Ctx): string {
  const { t } = c;
  const x = c.report.totals;
  const left = money(x.net - x.expenses);
  const terms: { op: string; label: string; value: string; sub: string; cls?: string }[] = [
    {
      op: "",
      label: t("orLedgerSales"),
      // With money given back: gross here, the refunds next — still ends at net − expenses.
      value: rs(x.refunds > 0 ? x.gross : x.net),
      sub:
        x.orders === 0
          ? e(t("orNoOrders"))
          : x.orders === 1
            ? e(t("orLedgerSalesSubOne"))
            : tpl(t("orLedgerSalesSub"), { n: x.orders, avg: formatPkr(x.avgOrder) }),
    },
    ...(x.refunds > 0 ? [{ op: "−", label: t("orLedgerRefunds"), value: rs(x.refunds), sub: orders(t, x.refundOrders), cls: "amber" }] : []),
    {
      op: "−",
      label: t("orLedgerExpenses"),
      value: rs(x.expenses),
      sub:
        x.expenseEdits + x.expenseDeletes > 0
          ? `${tpl(t("orExpensesSub"), { n: x.expenseCount })} <span class="amber">· ${expChanges(t, x.expenseEdits, x.expenseDeletes)}</span>`
          : tpl(t("orExpensesSub"), { n: x.expenseCount }),
    },
  ];
  const leftLabel = e(t(left < 0 ? "orLeftLoss" : "orLeft"));
  const leftValue = rs(Math.abs(left), left < 0 ? "−" : "");
  // With money given back the tiles show gross: say the sales after it, as the screen does.
  const net = x.refunds > 0 ? `${e(t("orLedgerNet"))} ${rs(x.net, "", "b")} · ` : "";
  const foot = `<p class="foot">${net}${e(t("orLedgerFoot"))}</p>`;
  if (c.slip) {
    return `<div class="eq">${terms
      .map((m) => row(`${m.op ? `${m.op} ` : ""}${e(m.label)}`, m.value, m.sub))
      .join("")}${row(`= ${leftLabel}`, leftValue, undefined, "eq-left")}</div>${foot}`;
  }
  const tiles = terms
    .map(
      (m) =>
        `${m.op ? `<span class="op">${m.op}</span>` : ""}<div class="tile"><p class="k">${e(m.label)}</p><p class="val${m.cls ? ` ${m.cls}` : ""}">${m.value}</p><p class="sub">${m.sub}</p></div>`,
    )
    .join("");
  return `<div class="eq${terms.length > 2 ? " eq-4" : ""}">${tiles}<span class="op">=</span><div class="tile tile-left${left < 0 ? " loss" : ""}"><p class="k">${leftLabel}</p><p class="val">${leftValue}</p></div></div>${foot}`;
}

function factsHtml(c: Ctx): string {
  const { t, report } = c;
  const x = report.totals;
  const flagged = (kinds: FlagKind[], level?: FlagLevel) =>
    report.flags.some((fl) => kinds.includes(fl.kind) && (level ? fl.level === level : fl.level !== "low"));
  const facts: { label: string; value: string; sub: string; warn: "red" | "amber" | "" }[] = [
    { label: t("orDiscounts"), value: rs(x.discountAmount), sub: orders(t, x.discountOrders), warn: flagged(["bigDiscount"]) ? "amber" : "" },
    {
      label: t("orCancelled"),
      value: rs(x.cancelledAmount),
      sub: `${orders(t, x.cancelledOrders)} · ${e(t("orNotInSales"))}`,
      warn: flagged(["cancelCash"], "high") ? "red" : x.cancelledOrders > 0 ? "amber" : "",
    },
    { label: t("orRefunds"), value: rs(x.refunds), sub: orders(t, x.refundOrders), warn: x.refunds > 0 ? "amber" : "" },
    {
      label: t("orEdits"),
      value: num(x.edits),
      sub:
        x.editsDown > 0
          ? `<span class="red b">${tpl(t("orEditsSub"), { n: x.editsDown, amount: formatPkr(x.editsDownAmount) })}</span>`
          : e(t("orEditsNoneLowered")),
      warn: x.editsDown > 0 ? "red" : "",
    },
  ];
  const cap = `<p class="cap">${e(t("orAlsoTitle"))}</p>`;
  if (c.slip) return `${cap}${facts.map((m) => row(e(m.label), m.value, m.sub)).join("")}`;
  return `${cap}<div class="facts">${facts
    .map((m) => `<div class="fact${m.warn ? ` w-${m.warn}` : ""}"><p class="k">${e(m.label)}</p><p class="val">${m.value}</p><p class="sub">${m.sub}</p></div>`)
    .join("")}</div>`;
}

/* ── 2. Cash in the drawer ── */

function counted(d: DrawerRow): boolean {
  return d.status === "closed" && !d.autoClosed && d.closingCount != null;
}

function drawerTone(d: DrawerRow): { tone: Tone; key: MessageKey; sub: MessageKey; amount?: number } {
  const diff = d.difference ?? 0;
  if (d.status === "open") return { tone: "info", key: "orDrawerResOpen", sub: "orDrawerResOpenSub" };
  // Closed by the system at day end: nobody to ask who closed it.
  if (!counted(d)) return { tone: "amber", key: "orDrawerResNoCount", sub: d.autoClosed ? "orDrawerResAutoSub" : "orDrawerResNoCountSub" };
  if (diff < 0) return { tone: "red", key: "orDrawerResShort", sub: "orDrawerResShortSub", amount: -diff };
  if (diff > 0) return { tone: "amber", key: "orDrawerResOver", sub: "orDrawerResOverSub", amount: diff };
  return { tone: "green", key: "orDrawerResMatch", sub: "orDrawerResMatchSub" };
}

function diffValue(diff: number | null): string {
  if (diff == null) return "—";
  if (diff < 0) return rs(-diff, "−", "red");
  if (diff > 0) return rs(diff, "+", "amber");
  return rs(0, "", "green");
}

/** Cash at start | should be | counted | difference. */
function figsHtml(c: Ctx, d: DrawerRow, small = false): string {
  const { t } = c;
  const figs: [string, string, string][] = [
    [t("orCashStart"), rs(d.openingBalance), ""],
    [t("orShouldBe"), d.expectedCash != null ? rs(d.expectedCash) : "—", ""],
    [t("orCountedClose"), counted(d) ? rs(d.closingCount!) : "—", ""],
    [t("orDifference"), diffValue(counted(d) ? d.difference : null), "diff"],
  ];
  if (c.slip) return figs.map(([k, v, cls]) => row(e(k), v, undefined, cls)).join("");
  // Like the screen: the difference tile takes its result's tint once the cash is counted.
  const tint = counted(d) ? ` r-${drawerTone(d).tone}` : "";
  return `<div class="figs${small ? " figs-sm" : ""}">${figs
    .map(([k, v, cls]) => `<div class="fig${cls ? ` ${cls}${tint}` : ""}"><p class="k">${e(k)}</p><p class="val">${v}</p></div>`)
    .join("")}</div>`;
}

function drawerResult(c: Ctx, d: DrawerRow): { tone: Tone; title: string; sub: string } {
  const r = drawerTone(d);
  return { tone: r.tone, title: r.amount != null ? tpl(c.t(r.key), { amount: formatPkr(r.amount) }) : e(c.t(r.key)), sub: c.t(r.sub) };
}

function cashHtml(c: Ctx): string {
  const { t, report } = c;
  // One branch failing: say so above the drawers that did load (never hide them).
  const failed = c.drawerFailed ? resBox(c, "amber", e(t("orDrawerFailed"))) : "";
  if (report.drawers.length === 0) return failed || resBox(c, "neutral", e(t("orDrawerNone")));
  const branch = (d: DrawerRow) => (c.branchNameFor ? c.branchNameFor(d.branchId) : undefined);
  const closed = (d: DrawerRow) =>
    d.autoClosed ? t("orClosedAuto") : d.closedByName ? fill(t("orClosedBy"), { name: d.closedByName }) : t("orNotClosedYet");
  const by = (d: DrawerRow) => `${e(fill(t("orOpenedBy"), { name: d.openedByName }))} · ${e(closed(d))}`;

  if (report.drawers.length === 1) {
    const d = report.drawers[0]!;
    const r = drawerResult(c, d);
    const b = branch(d);
    return `${failed}<div class="cash">${figsHtml(c, d)}${resBox(c, r.tone, r.title, r.sub)}<p class="cash-meta">${e(c.fd.day(d.date))}${b ? ` · ${e(b)}` : ""} · ${by(d)}</p></div>`;
  }

  // Several drawers: how many short / extra / matched, the total, then each day.
  const list = report.drawers;
  const groups: { tone: Tone; key: MessageKey; n: number; amount?: number }[] = [];
  const short = list.filter((d) => counted(d) && (d.difference ?? 0) < 0).length;
  const over = list.filter((d) => counted(d) && (d.difference ?? 0) > 0).length;
  const match = list.filter((d) => counted(d) && (d.difference ?? 0) === 0).length;
  const noCount = list.filter((d) => d.status === "closed" && !counted(d)).length;
  const open = list.filter((d) => d.status === "open").length;
  if (short) groups.push({ tone: "red", key: "orDrawerSumShort", n: short, amount: report.drawerShort });
  if (noCount) groups.push({ tone: "amber", key: "orDrawerSumNoCount", n: noCount });
  if (over) groups.push({ tone: "amber", key: "orDrawerSumOver", n: over, amount: report.drawerOver });
  if (open) groups.push({ tone: "info", key: "orDrawerSumOpen", n: open });
  if (match) groups.push({ tone: "green", key: "orDrawerSumMatch", n: match });
  const total = money(list.reduce((s, d) => s + (counted(d) ? d.difference ?? 0 : 0), 0));
  const label = (g: (typeof groups)[number]) => tpl(c.t(g.key), { n: g.n, amount: g.amount != null ? formatPkr(g.amount) : "" });

  const sum = c.slip
    ? groups.map((g) => `<div class="dsum-l">${g.tone === "red" ? "! " : ""}${label(g)}</div>`).join("")
    : `<div class="dsum">${groups.map((g) => `<span class="chip r-${g.tone}">${ico(TONE_ICON[g.tone], 12)}${label(g)}</span>`).join("")}</div>`;
  const totalRow = c.slip
    ? row(e(t("orDifference")), diffValue(total), undefined, "diff")
    : `<div class="dtotal"><span>${e(t("orDifference"))}</span><span>${diffValue(total)}</span></div>`;
  const days = list
    .map((d) => {
      const r = drawerResult(c, d);
      const b = branch(d);
      const when = `${e(c.fd.day(d.date))}${b ? ` · ${e(b)}` : ""}`;
      if (c.slip) {
        return `<div class="day${r.tone === "red" ? " bad" : ""}"><div class="day-h"><b>${when}</b><span>${r.title}</span></div>${figsHtml(c, d)}<small>${by(d)}</small></div>`;
      }
      return `<li class="day"><div class="day-h"><span>${when}</span><span class="chip r-${r.tone}">${ico(TONE_ICON[r.tone], 12)}${r.title}</span></div>${figsHtml(c, d, true)}<p class="cash-meta">${by(d)}</p></li>`;
    })
    .join("");
  const cap = `<p class="cap">${e(t("orDrawerTitle"))}</p>`;
  return failed + (c.slip ? `<div class="cash">${sum}${totalRow}${cap}${days}</div>` : `<div class="cash">${sum}${totalRow}${cap}<ul class="days">${days}</ul></div>`);
}

/* ── 3. How customers ordered / paid ── */

function splitHtml(c: Ctx, rows: { label: string; orders: number; amount: number }[], foot?: string): string {
  const { t } = c;
  // Payments always list cash / card / online: all at zero is "no orders" too.
  if (rows.every((r) => r.orders === 0 && r.amount === 0)) return `<p class="muted">${e(t("orNoOrders"))}</p>`;
  const total = rows.reduce((s, r) => s + Math.max(0, r.amount), 0);
  const share = (a: number) => (total > 0 ? Math.round((Math.max(0, a) / total) * 100) : 0);
  const end = foot ? `<p class="foot">${e(foot)}</p>` : "";
  if (c.slip) return rows.map((r) => row(e(r.label), `${rs(r.amount)} <span class="pct">${share(r.amount)}%</span>`, orders(t, r.orders))).join("") + end;
  return `<ul class="bars">${rows
    .map(
      (r) =>
        `<li><div class="bar-top"><span><b>${e(r.label)}</b> <span class="muted">· ${orders(t, r.orders)}</span></span><span class="bar-v">${rs(r.amount, "", "b")}<span class="pct"><bdi dir="ltr" class="num">${share(r.amount)}%</bdi></span></span></div><div class="bar"><i style="width:${share(r.amount)}%"></i></div></li>`,
    )
    .join("")}</ul>${end}`;
}

/* ── 4. What sold ── */

function itemsHtml(c: Ctx, items: ItemSales): string {
  const { t } = c;
  if (items.groups.length === 0) return `<p class="muted">${e(t("orItemsNone"))}</p>`;
  const qty = (n: number) => `<bdi dir="ltr" class="num">×${n}</bdi>`;
  const all = items.groups.flatMap((g) => g.items);
  const top = [...all].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.localeCompare(b.name)).slice(0, 5);
  const maxQty = top[0]?.qty || 1;

  if (c.slip) {
    const topHtml =
      all.length > 5
        ? `<p class="cap">${e(t("orTopSellers"))}</p>${top.map((it, i) => row(`${i + 1}. ${e(it.name)}`, qty(it.qty))).join("")}`
        : "";
    const groups = items.groups
      .map((g) => {
        const head = items.grouped ? `<div class="igroup-h"><span>${e(g.name ?? t("orItemsOther"))}</span><span>${qty(g.qty)} · ${rs(g.revenue)}</span></div>` : "";
        const fams = g.families
          .map(
            (fm) =>
              `<div class="ifam">${row(e(fill(t("orItemsFamily"), { name: fm.name })), `${qty(fm.qty)} · ${rs(fm.revenue)}`, fm.variants.length ? e(variantsText(fm.variants, t)) : undefined)}</div>`,
          )
          .join("");
        const list = g.items.map((it) => row(e(it.name), `${qty(it.qty)} · ${rs(it.revenue)}`, it.variants.length ? e(variantsText(it.variants, t)) : undefined)).join("");
        return `<div class="igroup">${head}${fams}${list}</div>`;
      })
      .join("");
    return `${topHtml}${groups}`;
  }

  const topHtml =
    all.length > 5
      ? `<p class="cap">${e(t("orTopSellers"))}</p><ol class="top">${top
          .map(
            (it, i) =>
              `<li><div class="top-row"><span class="rank">${num(i + 1)}</span><span class="nm">${e(it.name)}</span><b>${qty(it.qty)}</b></div><div class="bar"><i style="width:${Math.round((it.qty / maxQty) * 100)}%"></i></div></li>`,
          )
          .join("")}</ol>`
      : "";
  const groups = items.groups
    .map((g) => {
      const head = items.grouped
        ? `<div class="igroup-h"><span>${e(g.name ?? t("orItemsOther"))}</span><span class="muted">${qty(g.qty)} · ${rs(g.revenue)}</span></div>`
        : "";
      const fams = g.families
        .map(
          (fm) =>
            `<div class="ifam"><div><p class="nm">${e(fill(t("orItemsFamily"), { name: fm.name }))}</p>${
              fm.variants.length ? `<p class="muted">${e(variantsText(fm.variants, t))}</p>` : ""
            }</div><div class="qty"><b class="big">${qty(fm.qty)}</b><small>${rs(fm.revenue)}</small></div></div>`,
        )
        .join("");
      const list = g.items
        .map(
          (it) =>
            `<li class="irow"><div><p class="nm">${e(it.name)}</p>${
              it.variants.length
                ? `<p class="chips">${it.variants.map((v) => `<span class="vchip">${e(v.label || t("orItemsPlain"))} ${qty(v.qty)}</span>`).join("")}</p>`
                : ""
            }</div><div class="qty"><b>${qty(it.qty)}</b><small>${rs(it.revenue)}</small></div></li>`,
        )
        .join("");
      return `<div class="igroup">${head}${fams}<ul class="irows">${list}</ul></div>`;
    })
    .join("");
  return `${topHtml}${groups}`;
}

/* ── 4b. Stock ── */

function stockHtml(c: Ctx, rows: StockDayRow[] | undefined): string {
  const { t } = c;
  const n = (v: number, sign = "") => (v === 0 ? "—" : `<bdi dir="ltr" class="num">${sign}${Math.abs(v)}</bdi>`);
  const parts = (r: StockDayRow) =>
    [
      `${e(t("stockOpening"))} <bdi dir="ltr" class="num">${r.opening}</bdi>`,
      r.received ? `${e(t("stockReceived"))} ${n(r.received, "+")}` : "",
      `${e(t("stockSold"))} ${n(r.sold, "−")}`,
      r.returned ? `${e(t("stockReturned"))} ${n(r.returned, "+")}` : "",
      r.wasted ? `${e(t("stockWasted"))} ${n(r.wasted, "−")}` : "",
      r.adjusted ? `${e(t("stockAdjusted"))} ${n(r.adjusted, r.adjusted > 0 ? "+" : "−")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const left = (r: StockDayRow) =>
    `<b${r.closing <= 0 ? ' style="color:#b91c1c"' : ""}><bdi dir="ltr" class="num">${r.closing}</bdi></b> <small>${e(t(unitLabelKey[r.unit]))}</small>`;
  const list = rows ?? [];
  const items =
    list.length === 0
      ? `<p class="muted">${e(t("stockNoItems"))}</p>`
      : c.slip
        ? list.map((r) => row(e(r.name), left(r), parts(r))).join("")
        : `<ul class="irows">${list
            .map(
              (r) =>
                `<li class="irow"><div><p class="nm">${e(r.name)}</p><p class="muted">${parts(r)}</p></div><div class="qty"><small>${e(t("stockClosing"))}</small>${left(r)}</div></li>`,
            )
            .join("")}</ul>`;

  // Who changed stock by hand, oldest first (reads like a diary on paper).
  const log = [...c.report.stockLog].reverse();
  const lines = log.length
    ? log
        .map((l) => {
          const by = `${e(l.byName)} · <bdi dir="ltr">${e(c.f.when(l.at))}</bdi>`;
          return c.slip
            ? row(e(l.summary), "", `${l.detail ? `${e(l.detail)} · ` : ""}${by}`)
            : `<li class="irow"><div><p class="nm">${e(l.summary)}</p>${l.detail ? `<p class="muted">${e(l.detail)}</p>` : ""}<p class="muted">${by}</p></div></li>`;
        })
        .join("")
    : `<p class="muted">${e(t("stockNoChanges"))}</p>`;
  const logHtml = `<p class="cap">${e(t("stockChangesTitle"))}</p>${log.length && !c.slip ? `<ul class="irows">${lines}</ul>` : lines}`;
  return items + logHtml;
}

/* ── 5. Your staff ── */

type StaffLine = { tone: Tone; icon: string; html: string };

/**
 * A person's card lines (same as the screen's): what they did, on anyone's
 * order, and what happened on their own orders — a cancel of their own order
 * is said once, under what they did.
 */
function staffLines(s: StaffAudit, t: T): { did: StaffLine[]; theirs: StaffLine[] } {
  const did: StaffLine[] = [];
  const theirs: StaffLine[] = [];
  if (s.editsDown > 0) {
    did.push({
      tone: "red",
      icon: PATH.arrowDown,
      html: `${tpl(t(nKey(s.editsDown, "orSChMadeSmallerOne", "orSChMadeSmaller")), { n: s.editsDown, amount: formatPkr(s.editsDownAmount) })}${
        s.edits > s.editsDown ? ` · ${tpl(t("orSChEditsAll"), { n: s.edits })}` : ""
      }`,
    });
  } else if (s.edits > 0) {
    did.push({ tone: "neutral", icon: PATH.pencil, html: tpl(t(nKey(s.edits, "orSChEditsOne", "orSChEdits")), { n: s.edits }) });
  }
  if (s.deletes > 0)
    did.push({ tone: "red", icon: PATH.trash, html: tpl(t(nKey(s.deletes, "orSChDeletedOne", "orSChDeleted")), { n: s.deletes, amount: formatPkr(s.deletesAmount) }) });
  if (s.cancelsDone > 0)
    did.push({
      tone: "amber",
      icon: PATH.xCircle,
      html: tpl(t(nKey(s.cancelsDone, "orSChCancelsDoneOne", "orSChCancelsDone")), { n: s.cancelsDone, amount: formatPkr(s.cancelsDoneAmount) }),
    });
  if (s.refunds > 0)
    did.push({ tone: "amber", icon: PATH.undo, html: tpl(t(nKey(s.refunds, "orSChRefundsOne", "orSChRefunds")), { n: s.refunds, amount: formatPkr(s.refundAmount) }) });
  const expChanged = s.expenseEdits + s.expenseDeletes > 0;
  if (s.expensesAdded > 0 || expChanged) {
    const added = s.expensesAdded > 0 ? tpl(t(nKey(s.expensesAdded, "orSChExpensesOne", "orSChExpenses")), { n: s.expensesAdded, amount: formatPkr(s.expenseAmount) }) : "";
    const changed = expChanged ? `<span class="amber">${added ? " · " : ""}${expChanges(t, s.expenseEdits, s.expenseDeletes)}</span>` : "";
    did.push({ tone: expChanged ? "amber" : "neutral", icon: PATH.receipt, html: added + changed });
  }
  if (s.cancelledOrders > s.cancelsOwn)
    theirs.push({
      tone: "amber",
      icon: PATH.xCircle,
      html: tpl(t(nKey(s.cancelledOrders, "orSChTheirCancelledOne", "orSChTheirCancelled")), { n: s.cancelledOrders, amount: formatPkr(s.cancelledAmount) }),
    });
  if (s.discountOrders > 0)
    theirs.push({
      tone: "neutral",
      icon: PATH.percent,
      html: tpl(t(nKey(s.discountOrders, "orSChDiscountsOne", "orSChDiscounts")), { n: s.discountOrders, amount: formatPkr(s.discountAmount) }),
    });
  return { did, theirs };
}

function staffHtml(c: Ctx, staff: StaffAudit[]): string {
  const { t } = c;
  if (staff.length === 0) return `<p class="muted">${e(t("orNoStaffActivity"))}</p>`;
  const types = (s: StaffAudit) =>
    `${e(t("dineIn"))} <b>${num(s.dineIn)}</b> · ${e(t("takeaway"))} <b>${num(s.takeaway)}</b> · ${e(t("delivery"))} <b>${num(s.delivery)}</b>`;
  const pay = (v: number) => (v ? rs(v) : "—");

  if (c.slip) {
    return staff
      .map((s) => {
        const { did, theirs } = staffLines(s, t);
        const tag = s.flags > 0 ? ` <span class="tag">${tpl(t("orStaffFlags"), { n: s.flags })}</span>` : "";
        const ln = (l: StaffLine) => `<div class="ln">${l.tone === "red" ? "!" : "•"} ${l.html}</div>`;
        return `<div class="person"><div class="p-name">${e(s.name)}${tag}</div>
          ${row(e(t("orStaffSold")), rs(s.sales), orders(t, s.orders))}
          ${row(e(t("cash")), pay(s.cash))}${row(e(t("card")), pay(s.card))}${row(e(t("digital")), pay(s.digital))}
          <small>${types(s)}</small>
          ${theirs.length ? `<div class="p-chg"><b>${e(t("orStaffOnTheirOrders"))}</b>${theirs.map(ln).join("")}</div>` : ""}
          <div class="p-chg">${
            did.length === 0
              ? `<div>✓ ${e(t(theirs.length ? "orChkNone" : "orSChNone"))}</div>`
              : `${theirs.length ? `<b>${e(t("orStaffChanges"))}</b>` : ""}${did.map(ln).join("")}`
          }</div></div>`;
      })
      .join("");
  }

  return `<div class="staff-grid">${staff
    .map((s) => {
      const initials = s.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join("");
      const { did, theirs } = staffLines(s, t);
      const li = (l: StaffLine) => `<li><span class="ln-ic t-${l.tone}">${ico(l.icon)}</span><span>${l.html}</span></li>`;
      const badge =
        s.flags > 0
          ? `<span class="chip r-amber">${ico(PATH.eye, 12)}${tpl(t("orStaffFlags"), { n: s.flags })}</span>`
          : `<span class="chip r-green">${ico(PATH.check, 12)}${e(t("orStaffNothing"))}</span>`;
      const cell = (label: string, v: number) => `<div><p class="k">${e(label)}</p><p class="val">${pay(v)}</p></div>`;
      return `<article class="person">
        <div class="p-head"><span class="avatar">${e(initials || "?")}</span><div class="p-who"><p class="p-name">${e(s.name)}</p>${badge}</div>
          <div class="p-sold"><p class="k">${e(t("orStaffSold"))}</p><p class="val">${rs(s.sales)}</p><p class="k">${orders(t, s.orders)}</p></div></div>
        <p class="p-cap">${e(t("orPaidBy"))}</p>
        <div class="p-pay">${cell(t("cash"), s.cash)}${cell(t("card"), s.card)}${cell(t("digital"), s.digital)}</div>
        <p class="p-types">${types(s)}</p>
        ${theirs.length ? `<div class="p-chg"><p class="p-cap">${e(t("orStaffOnTheirOrders"))}</p><ul>${theirs.map(li).join("")}</ul></div>` : ""}
        <div class="p-chg"><p class="p-cap">${e(t("orStaffChanges"))}</p><ul>${
          did.length === 0
            ? `<li class="green"><span class="ln-ic">${ico(PATH.check)}</span><span>${e(t(theirs.length ? "orChkNone" : "orSChNone"))}</span></li>`
            : did.map(li).join("")
        }</ul></div>
      </article>`;
    })
    .join("")}</div>`;
}

/* ── 6. Things to check: what we checked, then each flag with its bill ── */

function checklistHtml(c: Ctx): string {
  const rows = c.summary.checks;
  const cap = `<p class="cap">${e(c.t("orChkTitle"))}</p>`;
  if (c.slip) return `${cap}<ul class="chk-list">${rows.map((r) => `<li class="chk">${MARK[r.mark].sym} ${e(keepRs(r.label))} — <b>${e(keepRs(r.result))}</b></li>`).join("")}</ul>`;
  return `<div class="chk-box">${cap}<ul class="chk-list">${rows
    .map((r) => {
      const m = MARK[r.mark];
      const tone = r.mark === "ok" ? "green" : r.mark === "na" ? "muted" : `t-${m.tone}`;
      return `<li class="chk"><span class="dot r-${m.tone}">${m.sym}</span><span class="chk-l">${e(r.label)}</span><span class="chk-r ${tone}">${e(r.result)}</span></li>`;
    })
    .join("")}</ul></div>`;
}

/** The line under a flag's title (same as the screen's). */
function flagDetail(flag: ReportFlag, t: T, f: Fmt, hasChanges: boolean): string {
  if (flag.kind === "drawerShort" || flag.kind === "drawerOver") {
    return tpl(t("orFdDrawer"), {
      date: flag.date ? f.day(flag.date) : "",
      before: flag.before != null ? formatPkr(flag.before) : "—",
      after: flag.after != null ? formatPkr(flag.after) : "—",
    });
  }
  if (flag.kind === "drawerNotCounted") return flag.date ? e(f.day(flag.date)) : "";
  if ((flag.kind === "editDown" || (flag.kind === "expenseEdit" && !hasChanges)) && flag.before != null && flag.after != null) {
    return `<s class="was">${rs(flag.before)}</s> ${e(t("lgArrow"))} <b>${rs(flag.after)}</b>`;
  }
  if (flag.kind === "cancelCash") return e(t("orFdCancelCash"));
  return "";
}

function flagsHtml(c: Ctx): string {
  const { t, report, f } = c;
  const flags = report.flags;
  if (flags.length === 0) {
    return c.slip ? `<p class="ok-line">✓ ${e(t("orNothingToCheck"))}</p>` : `<p class="ok-line">${ico(PATH.check, 16)}${e(t("orNothingToCheck"))}</p>`;
  }
  const logs = new Map(report.events.map((ev) => [ev.id, ev.log]));
  // One change can sit under two flags ("bill lowered" + "edited 2 times"): full bills once.
  const billed = new Set<string>();
  const groups: { level: FlagLevel; word: MessageKey }[] = [
    { level: "high", word: "orGroupHigh" },
    { level: "medium", word: "orGroupMedium" },
    { level: "low", word: "orGroupLow" },
  ];
  const one = (flag: ReportFlag) => {
    const tone = LEVEL_TONE[flag.level];
    const log = flag.logId ? logs.get(flag.logId) : undefined;
    const bills = !!log && !billed.has(log.id);
    if (log) billed.add(log.id);
    const amount = flagAmount(flag);
    const amt = amount ? rs(amount.value, amount.sign) : "";
    const title = tpl(t(FLAG_TITLE_KEY[flag.kind]), flagVars(flag, f.day));
    // The screen's "See bill" panel, already open (paper can't be tapped).
    const more = log ? (c.slip ? logDetailSlipHtml(log, t, { bills }) : logDetailHtml(log, t, { bills })) : "";
    const changes = log && !more ? changeSummary(log, t) : "";
    const detail = flagDetail(flag, t, f, !!(log && changeSummary(log, t)));
    const late = afterSaleText(flag.minutesAfterSale, t);
    const branch = flag.branchId && c.branchNameFor ? c.branchNameFor(flag.branchId) : undefined;
    const when = flag.kind.startsWith("drawer") ? "" : `<bdi dir="ltr">${e(f.when(flag.at))}</bdi>`;
    if (c.slip) {
      const meta = [flag.byName ? e(fill(t("orByName"), { name: flag.byName })) : "", when, late ? e(late) : "", branch ? e(branch) : ""].filter(Boolean);
      return `<li class="flag lv-${flag.level}">
        <div class="f-top"><span class="f-title"><span class="lvl">${e(t(LEVEL_KEY[flag.level]))}</span> ${title}</span>${amt ? `<span class="f-amt">${amt}</span>` : ""}</div>
        ${detail ? `<div class="f-d">${detail}</div>` : ""}${changes ? `<small class="chg">${e(changes)}</small>` : ""}${meta.length ? `<small>${meta.join(" · ")}</small>` : ""}${more}
      </li>`;
    }
    const meta = [
      `<span class="chip r-${tone}">${e(t(LEVEL_KEY[flag.level]))}</span>`,
      flag.byName ? `<span>${e(fill(t("orByName"), { name: flag.byName }))}</span>` : "",
      when ? `<span>${when}</span>` : "",
      late ? `<span class="chip r-amber">${e(late)}</span>` : "",
      branch ? `<span>${e(branch)}</span>` : "",
    ].filter(Boolean);
    return `<li class="flag lv-${flag.level}">
      <span class="f-ic r-${tone}">${ico(KIND_ICON[flag.kind], 16)}</span>
      <div class="f-main"><p class="f-title">${title}</p>${detail ? `<p class="f-d">${detail}</p>` : ""}${changes ? `<p class="f-d">${e(changes)}</p>` : ""}<p class="f-meta">${meta.join("")}</p></div>
      ${amt ? `<span class="f-amt${flag.level === "low" ? "" : ` t-${tone}`}">${amt}</span>` : "<span></span>"}
      ${more ? `<div class="f-more">${more}</div>` : ""}
    </li>`;
  };
  return groups
    .map((g) => {
      const list = flags.filter((x) => x.level === g.level);
      if (list.length === 0) return "";
      const head = c.slip
        ? `<h3 class="grp-h">${e(t(g.word))} (${list.length})</h3>`
        : `<h3 class="grp-h g-${g.level}">${ico(TONE_ICON[LEVEL_TONE[g.level]], 15)}${e(t(g.word))} <span class="num">(${list.length})</span></h3>`;
      return `<div class="grp">${head}<ul class="flags">${list.map(one).join("")}</ul></div>`;
    })
    .join("");
}

/* ── 7. Every change, by time ── */

function eventTone(ev: OwnerReport["events"][number]): Tone {
  if (ev.kind === "delete") return "red";
  if (ev.kind === "edit" && ev.before != null && ev.after != null && ev.after < ev.before) return "red";
  if (ev.kind === "cancel" || ev.kind === "refund" || ev.kind === "expenseDelete" || ev.kind === "expenseEdit") return "amber";
  return "neutral";
}

function eventsHtml(c: Ctx): string {
  const { t, report, f } = c;
  if (report.events.length === 0) return `<p class="muted">${e(t("orNoActivity"))}</p>`;
  const shown = c.slip ? report.events.slice(0, SLIP_EVENTS) : report.events;
  // Bills already printed in full under a flag aren't repeated here; the mark takes the flag's colour.
  const RANK: Record<FlagLevel, number> = { high: 0, medium: 1, low: 2 };
  const flagged = new Map<string, FlagLevel>();
  for (const x of report.flags) {
    const was = x.logId ? flagged.get(x.logId) : undefined;
    if (x.logId && (!was || RANK[x.level] < RANK[was])) flagged.set(x.logId, x.level);
  }
  const more = report.events.length - shown.length;
  let lastDay = "";
  const items = shown
    .map((ev) => {
      const day = dayKeyOf(ev.at);
      const dayHead = c.multiDay && day !== lastDay ? `<li class="ev-day">${e(c.fd.day(day))}</li>` : "";
      lastDay = day;
      const text = eventParsed(ev) ? tpl(t(EVENT_KEY[ev.kind]), eventVars(ev)) : e(`${ev.byName}: ${ev.summary}`);
      const level = flagged.get(ev.id);
      const inCheck = level != null;
      // Slip: what changed only (its bills are under the flags, the roll stays short).
      const detail = c.slip ? logDetailSlipHtml(ev.log, t, { bills: false }) : logDetailHtml(ev.log, t, { bills: !inCheck });
      const changes = detail ? "" : changeSummary(ev.log, t, 6);
      const time = `<bdi dir="ltr">${e(f.when(ev.at))}</bdi>`;
      if (c.slip) {
        const tags = [ev.pending ? `<span class="tag">${e(t("orPendingSync"))}</span>` : "", inCheck ? `<span class="tag">${e(t("orInCheck"))}</span>` : ""].join(" ");
        return `${dayHead}<li class="ev"><span class="ev-t">${time}</span><span class="txt">${text}${tags.trim() ? ` ${tags}` : ""}${changes ? `<small class="chg">${e(changes)}</small>` : ""}${detail}</span></li>`;
      }
      const tags = [
        ev.pending ? `<span class="chip r-orange">${e(t("orPendingSync"))}</span>` : "",
        level ? `<span class="chip r-${LEVEL_TONE[level]}">${ico(PATH.flag, 11)}${e(t("orInCheck"))}</span>` : "",
      ].filter(Boolean);
      return `${dayHead}<li class="ev"><span class="ev-t">${time}</span><span class="ev-ic r-${level ? LEVEL_TONE[level] : eventTone(ev)}">${ico(EVENT_ICON[ev.kind], 13)}</span><div class="ev-main"><p>${text}</p>${
        changes ? `<p class="f-d">${e(changes)}</p>` : ""
      }${tags.length ? `<p class="ev-tags">${tags.join("")}</p>` : ""}${detail}</div></li>`;
    })
    .join("");
  return `<ol class="events${c.multiDay ? " md" : ""}">${items}</ol>${more > 0 ? `<p class="muted">${e(fill(t("orPrintMore"), { n: more }))}</p>` : ""}`;
}

/* ── Styles ── */

const SLIP_CSS = (widthMm: number) => `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: ${widthMm}mm; margin: 0 auto;
    font-family: Verdana, Tahoma, Arial, sans-serif;
    font-size: ${widthMm < 60 ? 10.5 : 11.5}px; line-height: 1.35;
    overflow-wrap: anywhere;
  }
  p, h2, h3 { margin: 0; }
  ul, ol { list-style: none; padding: 0; margin: 0; }
  .sheet { padding: 3mm ${widthMm < 60 ? 1 : 2}mm 0; }
  .sheet::after { content: "."; display: block; padding-top: 16mm; }
  .head { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2mm; }
  .shop { font-weight: 700; font-size: 1.25em; }
  .title { font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-top: 1mm; }
  .period, .printed, .branch { font-size: 0.9em; }
  h2 { font-size: 1em; text-transform: uppercase; letter-spacing: 0.5px; margin: 3.5mm 0 1mm; padding-bottom: 0.5mm; border-bottom: 1px solid #000; }
  .cap { font-weight: 700; font-size: 0.9em; margin: 2mm 0 0.5mm; text-decoration: underline; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; margin: 0.6mm 0; }
  .row .l { min-width: 0; }
  .row .v { white-space: nowrap; font-weight: 700; text-align: end; }
  small { display: block; font-size: 0.85em; font-weight: 400; }
  .pct { font-weight: 400; font-size: 0.85em; }
  .num { white-space: nowrap; }
  .var { font-weight: 700; }
  .muted { margin: 1mm 0; }
  .foot { font-size: 0.85em; margin-top: 0.8mm; }
  .status { display: flex; gap: 1.5mm; margin: 1.5mm 0 2mm; padding: 1.5mm; border: 1px solid #000; }
  .status.st-red { border-width: 2.5px; }
  .st-ic { flex-shrink: 0; font-weight: 700; font-size: 1.3em; line-height: 1; }
  .st-h { font-weight: 700; }
  .st-hint { font-size: 0.88em; }
  .eq-left { border: 2px solid #000; padding: 1mm; margin-top: 1mm; font-weight: 700; font-size: 1.1em; }
  .row.diff { border-top: 1px solid #000; padding-top: 0.5mm; }
  .res { margin: 1.5mm 0; padding: 1mm 1.5mm; border: 1px solid #000; }
  .res.r-red { border-width: 2.5px; }
  .res-t { font-weight: 700; }
  .res-s { font-size: 0.88em; }
  .cash-meta { font-size: 0.85em; }
  .dsum-l { font-weight: 700; }
  .day { border-top: 1px dashed #000; padding-top: 1mm; margin-top: 1.5mm; }
  .day.bad { border: 2px solid #000; padding: 1mm; }
  .day-h { display: flex; justify-content: space-between; gap: 2mm; flex-wrap: wrap; }
  .day-h span { font-weight: 700; }
  .igroup-h { display: flex; justify-content: space-between; gap: 2mm; font-weight: 700; font-size: 0.9em; margin-top: 2mm; border-bottom: 1px dotted #000; }
  .igroup-h > :first-child { text-transform: uppercase; }
  .ifam { font-weight: 700; border: 1px solid #000; padding: 0 1mm; margin: 1mm 0; }
  .ifam small { font-weight: 400; }
  .items-vs { font-size: 0.85em; }
  .person { border-top: 1px dashed #000; padding-top: 1mm; margin-top: 1.5mm; }
  .person:first-of-type { border-top: 0; }
  .p-name { font-weight: 700; font-size: 1.05em; }
  .p-chg { margin-top: 0.8mm; }
  .p-chg .ln { padding-inline-start: 2.5mm; text-indent: -2.5mm; }
  .tag { font-size: 0.8em; border: 1px solid #000; padding: 0 1mm; font-weight: 700; white-space: nowrap; }
  .chk { margin: 0.5mm 0; }
  .grp-h { font-size: 0.95em; margin: 2.5mm 0 0.5mm; padding: 0.3mm 1mm; border: 1px solid #000; }
  .flag { margin: 1.2mm 0; padding-bottom: 1mm; border-bottom: 1px dotted #000; }
  .f-top { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
  .f-title { font-weight: 700; min-width: 0; }
  .f-amt { white-space: nowrap; font-weight: 700; }
  .lvl { font-size: 0.85em; border: 1px solid #000; padding: 0 1mm; }
  .lv-high .lvl { background: #000; color: #fff; }
  .f-d s, .was { text-decoration: line-through; }
  .ok-line { font-weight: 700; margin: 1mm 0; }
  .ev-day { font-weight: 700; margin-top: 2mm; border-bottom: 1px dotted #000; }
  .ev { display: flex; flex-wrap: wrap; gap: 1.5mm; margin: 0.8mm 0; }
  .ev-t { flex-shrink: 0; font-size: 0.85em; min-width: 14mm; }
  .ev .txt { flex: 1; min-width: 0; }
  small.chg { font-style: italic; }
  .end { text-align: center; margin-top: 3mm; border-top: 1px dashed #000; padding-top: 1mm; font-size: 0.85em; }
${LOG_DETAIL_SLIP_CSS}`;

const A4_CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1c1917; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Naskh Arabic", "Noto Nastaliq Urdu", sans-serif; font-size: 12px; line-height: 1.5; }
  p, h2, h3 { margin: 0; }
  ul, ol { list-style: none; padding: 0; margin: 0; }
  svg { flex-shrink: 0; display: block; }
  .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .var { font-weight: 600; }
  .b { font-weight: 700; }
  .muted { color: #57534e; }
  .red, .t-red { color: #b91c1c; }
  .amber, .t-amber { color: #92400e; }
  .green, .t-green { color: #047857; }
  .t-neutral { color: #57534e; }
  .t-info { color: #0369a1; }

  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; border-bottom: 2px solid #b8860b; padding-bottom: 3mm; }
  .title { font-size: 10.5px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #8a6508; }
  .shop { font-size: 20px; font-weight: 800; line-height: 1.25; }
  .branch { color: #57534e; }
  .meta { text-align: end; color: #57534e; }
  .period { font-weight: 700; color: #1c1917; font-size: 12.5px; }

  .sec { margin-top: 7mm; }
  .sec-h { display: flex; align-items: center; gap: 2.5mm; padding-bottom: 2mm; margin-bottom: 3mm; border-bottom: 1px solid #e3cf9c; break-after: avoid; }
  .sec-ic { flex-shrink: 0; width: 8mm; height: 8mm; border-radius: 2mm; background: #f6efe0; color: #8a6508; display: flex; align-items: center; justify-content: center; }
  .sec-t { flex: 1; min-width: 0; }
  .sec-end { flex-shrink: 0; text-align: end; }
  h2 { font-size: 15px; font-weight: 800; line-height: 1.3; }
  .sec-hint { font-size: 11px; color: #57534e; }
  .cap { font-size: 11.5px; font-weight: 700; color: #57534e; margin: 4mm 0 1.5mm; }
  .foot { font-size: 10.5px; color: #57534e; margin-top: 1.5mm; }

  /* Status strip */
  .status { display: flex; align-items: center; gap: 3mm; padding: 3mm 4mm; border: 1px solid; border-radius: 3mm; break-inside: avoid; }
  .st-red { background: #fef2f2; border-color: #fecaca; }
  .st-amber { background: #fffbeb; border-color: #fde68a; }
  .st-green { background: #ecfdf5; border-color: #a7f3d0; }
  .st-ic { flex-shrink: 0; width: 9mm; height: 9mm; border-radius: 99px; background: #fff; border: 1.5px solid currentColor; display: flex; align-items: center; justify-content: center; }
  .st-red .st-ic, .st-red .st-h { color: #b91c1c; }
  .st-amber .st-ic, .st-amber .st-h { color: #92400e; }
  .st-green .st-ic, .st-green .st-h { color: #065f46; }
  .st-h { font-size: 15px; font-weight: 800; line-height: 1.35; }
  .st-hint { font-size: 11.5px; color: #44403c; }

  /* Sales − expenses = left */
  .eq { display: flex; align-items: stretch; gap: 2mm; margin-top: 4mm; break-inside: avoid; }
  .tile { flex: 1 1 0; min-width: 0; border: 1px solid #e8dfcf; border-radius: 3mm; padding: 3mm 3.5mm; background: #fff; }
  .tile .k { font-size: 11px; font-weight: 600; color: #57534e; }
  .tile .val { font-size: 21px; font-weight: 800; line-height: 1.3; margin-top: 0.5mm; }
  .tile .sub { font-size: 10.5px; color: #57534e; margin-top: 0.5mm; }
  .eq-4 .tile .val { font-size: 17px; }
  .op { align-self: center; flex-shrink: 0; width: 7mm; height: 7mm; border-radius: 99px; background: #f6efe0; color: #8a6508; font-size: 15px; font-weight: 800; line-height: 1; display: flex; align-items: center; justify-content: center; }
  .tile-left { background: #1c1917; border-color: #1c1917; }
  .tile-left .k { color: #e7e5e4; }
  .tile-left .val { color: #c9a227; font-size: 24px; }
  .eq-4 .tile-left .val { font-size: 20px; }
  .tile-left.loss .val { color: #fca5a5; }

  /* Quick facts */
  .facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2.5mm; break-inside: avoid; }
  .fact { border: 1px solid #e8dfcf; border-radius: 3mm; padding: 2.5mm 3mm; }
  .fact .k { font-size: 11px; font-weight: 600; color: #57534e; }
  .fact .val { font-size: 15px; font-weight: 800; line-height: 1.35; }
  .fact .sub { font-size: 10.5px; color: #57534e; }
  .fact.w-red { background: #fef2f2; border-color: #fecaca; }
  .fact.w-red .val { color: #b91c1c; }
  .fact.w-amber { background: #fffbeb; border-color: #fde68a; }
  .fact.w-amber .val { color: #92400e; }

  /* Tints shared by result boxes, chips, marks and icons */
  .r-red { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }
  .r-amber { background: #fffbeb; border-color: #fde68a; color: #92400e; }
  .r-green { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
  .r-info { background: #f0f9ff; border-color: #bae6fd; color: #0369a1; }
  .r-neutral { background: #f5f5f4; border-color: #e7e5e4; color: #44403c; }
  .r-orange { background: #fff7ed; border-color: #fed7aa; color: #c2410c; }
  .chip { display: inline-flex; align-items: center; gap: 1mm; padding: 0.3mm 2.2mm; border-width: 1px; border-style: solid; border-radius: 99px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }

  /* Cash in the drawer */
  .cash { border: 1px solid #e8dfcf; border-radius: 3mm; padding: 3.5mm 4mm; }
  .figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2.5mm; break-inside: avoid; }
  .fig { background: #faf7f2; border: 1px solid #faf7f2; border-radius: 2mm; padding: 2mm 3mm; }
  .fig .k { font-size: 10.5px; color: #57534e; }
  .fig .val { font-size: 15px; font-weight: 800; }
  .fig.diff { background: #fff; border: 1.5px solid #1c1917; }
  .fig.diff.r-red { background: #fef2f2; border-color: #fecaca; }
  .fig.diff.r-amber { background: #fffbeb; border-color: #fde68a; }
  .fig.diff.r-green { background: #ecfdf5; border-color: #a7f3d0; }
  .figs-sm .val { font-size: 12.5px; }
  .res { display: flex; align-items: flex-start; gap: 3mm; margin-top: 3mm; padding: 2.5mm 3.5mm; border-width: 1px; border-style: solid; border-radius: 2.5mm; break-inside: avoid; }
  .res-ic { padding-top: 0.5mm; }
  .res-t { font-size: 13.5px; font-weight: 800; }
  .res-s { font-size: 11px; color: #44403c; }
  .sec > .res { margin-top: 0; }
  .cash-meta { margin-top: 2mm; font-size: 11px; color: #57534e; }
  .dsum { display: flex; flex-wrap: wrap; gap: 1.5mm; }
  .dtotal { display: flex; justify-content: space-between; gap: 3mm; margin-top: 2.5mm; padding-top: 2mm; border-top: 2px solid #1c1917; font-size: 13px; font-weight: 800; }
  .day { padding: 2.5mm 0; border-top: 1px solid #f3ede2; break-inside: avoid; }
  .day-h { display: flex; justify-content: space-between; align-items: center; gap: 3mm; margin-bottom: 1.5mm; font-weight: 700; }

  /* How customers ordered / paid */
  .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6mm; break-inside: avoid; }
  .bars li { margin-bottom: 3mm; }
  .bar-top { display: flex; justify-content: space-between; align-items: baseline; gap: 3mm; }
  .bar-v { white-space: nowrap; }
  .pct { display: inline-block; min-width: 9mm; text-align: end; font-size: 10.5px; color: #57534e; margin-inline-start: 1.5mm; }
  .bar { height: 2mm; margin-top: 1mm; background: #f5f5f4; border-radius: 99px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #b8860b; border-radius: 99px; }

  /* What sold */
  .items-total { font-size: 13px; font-weight: 800; }
  .items-vs { font-size: 11px; color: #57534e; }
  .top { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2.5mm 6mm; }
  .top-row { display: flex; align-items: center; gap: 2mm; }
  .top-row .rank { width: 4mm; color: #57534e; font-weight: 700; }
  .top-row .nm { flex: 1; min-width: 0; font-weight: 600; }
  .top .bar { margin-inline-start: 6mm; }
  .igroup { margin-top: 3.5mm; border: 1px solid #e8dfcf; border-radius: 3mm; overflow: hidden; }
  .igroup-h { display: flex; justify-content: space-between; align-items: baseline; gap: 3mm; padding: 2mm 3.5mm; background: #faf7f2; font-size: 12.5px; font-weight: 800; color: #8a6508; }
  .ifam { display: flex; justify-content: space-between; align-items: flex-start; gap: 3mm; margin: 2.5mm 3mm 0; padding: 2mm 3mm; background: #f6efe0; border: 1px solid #f0e9dc; border-radius: 2mm; break-inside: avoid; }
  .nm { font-weight: 600; }
  .ifam .nm { font-weight: 800; }
  .irows { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 6mm; padding: 0.5mm 3.5mm 1.5mm; }
  .irow { display: flex; justify-content: space-between; align-items: flex-start; gap: 3mm; padding: 1.8mm 0; border-bottom: 1px solid #f3ede2; break-inside: avoid; }
  .qty { flex-shrink: 0; text-align: end; }
  .qty b { font-size: 13px; }
  .qty b.big { font-size: 15px; }
  .qty small { display: block; font-size: 10.5px; color: #57534e; }
  .chips { display: flex; flex-wrap: wrap; gap: 1mm; margin-top: 0.8mm; }
  .vchip { padding: 0 2mm; border-radius: 99px; background: #f5f5f4; font-size: 10.5px; font-weight: 600; color: #44403c; }

  /* Staff */
  .staff-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 3mm; }
  .person { border: 1px solid #e8dfcf; border-radius: 3mm; padding: 3mm 3.5mm; break-inside: avoid; }
  .p-head { display: flex; align-items: flex-start; gap: 2.5mm; }
  .avatar { flex-shrink: 0; width: 9mm; height: 9mm; border-radius: 99px; background: #f6efe0; color: #8a6508; font-weight: 800; display: flex; align-items: center; justify-content: center; }
  .p-who { flex: 1; min-width: 0; }
  .p-name { font-size: 13.5px; font-weight: 800; margin-bottom: 0.8mm; }
  .p-sold { flex-shrink: 0; text-align: end; }
  .p-sold .k { font-size: 10.5px; color: #57534e; }
  .p-sold .val { font-size: 16px; font-weight: 800; line-height: 1.3; }
  .p-cap { margin-top: 2.5mm; font-size: 10.5px; font-weight: 700; color: #57534e; }
  .p-pay { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2mm; margin-top: 1mm; padding: 2mm 2.5mm; background: #faf7f2; border-radius: 2mm; }
  .p-pay .k { font-size: 10.5px; color: #57534e; }
  .p-pay .val { font-weight: 700; }
  .p-types { margin-top: 1.5mm; font-size: 11px; color: #44403c; }
  .p-chg { margin-top: 2.5mm; padding-top: 0.5mm; border-top: 1px solid #f0e9dc; }
  .p-chg li { display: flex; align-items: flex-start; gap: 2mm; margin-top: 1mm; }
  .ln-ic { padding-top: 0.6mm; }

  /* Things to check */
  .chk-box { border: 1px solid #e8dfcf; border-radius: 3mm; padding: 0 3.5mm 1.5mm; }
  .chk-box .cap { margin-top: 2.5mm; }
  .chk-list { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 6mm; }
  .chk { display: flex; align-items: center; gap: 2.5mm; padding: 1.6mm 0; border-bottom: 1px solid #f3ede2; break-inside: avoid; }
  .dot { flex-shrink: 0; width: 6mm; height: 6mm; border-width: 1px; border-style: solid; border-radius: 99px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; }
  .chk-l { flex: 1; min-width: 0; }
  .chk-r { flex-shrink: 0; max-width: 45%; text-align: end; font-weight: 700; }
  .grp { margin-top: 4mm; }
  .grp-h { display: flex; align-items: center; gap: 2mm; padding: 1.8mm 3mm; background: #faf7f2; border-radius: 2mm; font-size: 12.5px; font-weight: 800; break-after: avoid; }
  .g-high { color: #b91c1c; }
  .g-medium { color: #92400e; }
  .g-low { color: #44403c; }
  .flag { display: grid; grid-template-columns: 9mm minmax(0, 1fr) auto; column-gap: 3mm; padding: 3mm 1mm; border-bottom: 1px solid #f3ede2; break-inside: avoid; }
  .f-ic { width: 9mm; height: 9mm; border-width: 1px; border-style: solid; border-radius: 2.5mm; display: flex; align-items: center; justify-content: center; }
  .f-title { font-size: 12.5px; font-weight: 700; line-height: 1.45; }
  .f-d { color: #44403c; }
  .f-d s, .was { color: #78716c; }
  .f-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 1mm 3mm; margin-top: 1mm; font-size: 11px; color: #57534e; }
  .f-amt { font-size: 14px; font-weight: 800; white-space: nowrap; text-align: end; }
  .f-more { grid-column: 2 / -1; }
  .ok-line { display: flex; align-items: center; gap: 2mm; margin-top: 3mm; font-weight: 700; color: #065f46; }

  /* Every change */
  .ev-day { margin-top: 2.5mm; padding: 1.5mm 3mm; background: #faf7f2; border-radius: 2mm; font-weight: 800; color: #44403c; break-after: avoid; }
  .ev { display: grid; grid-template-columns: 17mm 7mm minmax(0, 1fr); column-gap: 2.5mm; padding: 2.5mm 0; border-bottom: 1px solid #f3ede2; break-inside: avoid; }
  .md .ev { grid-template-columns: 33mm 7mm minmax(0, 1fr); }
  .ev-t { padding-top: 0.8mm; font-size: 11px; color: #57534e; }
  .ev-ic { width: 7mm; height: 7mm; border-width: 1px; border-style: solid; border-radius: 99px; display: flex; align-items: center; justify-content: center; }
  .ev-main { min-width: 0; }
  .ev-tags { display: flex; flex-wrap: wrap; gap: 1.5mm; margin-top: 1mm; }

  .end { margin-top: 8mm; color: #a8a29e; font-size: 9.5px; text-align: center; }

  /* Urdu: Naskh reads much smaller than Latin at the same size — small text a step up (numbers stay isolated). */
  html[lang="ur"] body { font-size: 13.5px; line-height: 1.7; }
  html[lang="ur"] :is(.sub, .foot, .k, .cash-meta, .f-meta, .sec-hint, .p-cap, .res-s, .st-hint, .pct, .chip, .vchip, .items-vs, .p-types, .ev-t, .qty small) { font-size: 12px; line-height: 1.7; }
  html[lang="ur"] :is(.cap, .title) { letter-spacing: 0; text-transform: none; }
  html[lang="ur"] .cap { font-size: 12.5px; }
${LOG_DETAIL_CSS}`;

/* ── The page ── */

export function buildOwnerReportHtml(
  opts: OwnerReportPrintInfo & {
    report: OwnerReport;
    format: OwnerReportPrintFormat;
    t: T;
    locale: Locale;
    multiDay: boolean;
    branchNameFor?: (id: string) => string | undefined;
    printedAt?: Date;
    /** The change log / cash drawer couldn't load (the checklist says "Couldn't load", never ✓). */
    logsFailed?: boolean;
    drawerFailed?: boolean;
  },
): string {
  const { report, t, format } = opts;
  const dir = opts.locale === "ur" ? "rtl" : "ltr";
  const f = reportFormatters(opts.locale, opts.multiDay);
  const c: Ctx = {
    report,
    t,
    f,
    fd: reportFormatters(opts.locale, true),
    slip: format === "slip",
    multiDay: opts.multiDay,
    summary: buildOwnerSummary(report, t, { logsFailed: opts.logsFailed, drawerFailed: opts.drawerFailed }),
    logsFailed: !!opts.logsFailed,
    drawerFailed: !!opts.drawerFailed,
    branchNameFor: opts.branchNameFor,
  };
  const printed = fill(t("orPrintedAt"), { time: f.dayTime(opts.printedAt ?? new Date()) });
  const title = `${t("ownerReport")} · ${opts.periodLabel}`;

  const head = c.slip
    ? `<header class="head">
        <div class="shop">${e(opts.shopName)}</div>
        ${opts.branchLabel ? `<div class="branch">${e(opts.branchLabel)}</div>` : ""}
        <div class="title">${e(t("ownerReport"))}</div>
        <div class="period">${e(opts.periodLabel)}</div>
        <div class="printed">${e(printed)}</div>
      </header>`
    : `<header class="head">
        <div><div class="title">${e(t("ownerReport"))}</div><div class="shop">${e(opts.shopName)}</div>${opts.branchLabel ? `<div class="branch">${e(opts.branchLabel)}</div>` : ""}</div>
        <div class="meta"><div class="period">${e(opts.periodLabel)}</div><div>${e(printed)}</div></div>
      </header>`;

  const ordered = report.byType.map((r) => ({ label: t(TYPE_LABEL[r.type]), orders: r.orders, amount: r.amount }));
  const paid = report.byPayment.map((r) => ({ label: t(r.method), orders: r.orders, amount: r.amount }));
  const orderedSec = sec(c, { title: t("orOrderedTitle"), icon: PATH.bag, body: splitHtml(c, ordered) });
  const paidSec = sec(c, { title: t("orPayments"), icon: PATH.wallet, body: splitHtml(c, paid, t("orPaidAfterRefunds")) });
  const itemsTotal = report.items.qty > 0 ? `${tpl(t(nKey(report.items.qty, "orItemsTotalOne", "orItemsTotal")), { n: report.items.qty })} · ${rs(report.items.revenue)}` : "";
  // Item prices are before the bill's discount: tie the total to the Sales tile when they differ.
  const sales = report.totals.refunds > 0 ? report.totals.gross : report.totals.net;
  const itemsVsSales =
    report.items.qty > 0 && money(report.items.revenue) !== money(sales) ? `<p class="items-vs">${tpl(t("orItemsVsSales"), { sales: formatPkr(sales) })}</p>` : "";

  // Same order as the screen: the general picture first, the details below it.
  const sections = [
    sec(c, { title: t("orSummaryTitle"), icon: PATH.chart, body: statusHtml(c) + equationHtml(c) + factsHtml(c), cls: "summary" }),
    sec(c, { title: t("orCashTitle"), icon: PATH.drawer, hint: report.drawers.length > 0 ? t("orDrawerHint") : undefined, body: cashHtml(c) }),
    c.slip ? orderedSec + paidSec : `<div class="split">${orderedSec}${paidSec}</div>`,
    sec(c, {
      title: t("orItemsTitle"),
      icon: PATH.utensils,
      hint: t("orItemsHint"),
      end: itemsTotal ? `<p class="items-total">${itemsTotal}</p>${itemsVsSales}` : undefined,
      body: (c.slip && itemsTotal ? `<p class="items-total">${itemsTotal}</p>${itemsVsSales}` : "") + itemsHtml(c, report.items),
    }),
    report.stock || report.stockLog.length > 0
      ? sec(c, { title: t("stockToday"), icon: PATH.box, hint: t("stockTodayHint"), body: stockHtml(c, report.stock) })
      : "",
    sec(c, { title: t("orStaffTitle"), icon: PATH.people, hint: t("orStaffHint"), body: staffHtml(c, report.staff) }),
    sec(c, { title: t("orNeedsAttention"), icon: PATH.flag, hint: t("orNeedsAttentionHintView"), body: checklistHtml(c) + flagsHtml(c), cls: "check" }),
    sec(c, { title: t("orTimelineTitle"), icon: PATH.list, hint: t("orTimelineHint"), body: eventsHtml(c) }),
  ];

  const body = [head, ...sections, `<div class="end">${e(opts.shopName)} · ${e(t("ownerReport"))}</div>`].join("\n");

  const css = c.slip ? SLIP_CSS(receiptPrintWidthMm(opts.paper, opts.paperWidthMm)) : A4_CSS;
  return `<!DOCTYPE html>
<html dir="${dir}" lang="${opts.locale}">
<head>
  <meta charset="utf-8" />
  <title>${e(title)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="sheet">${body}</div>
</body>
</html>`;
}
