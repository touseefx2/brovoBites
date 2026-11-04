"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatPkr, money, type StockDayRow } from "@bravobites/domain";
import { ActivityChangeView } from "@/components/ActivityChangeView";
import { ReceiptPreview } from "@/components/ReceiptPreview";
import { useLocale } from "@/i18n/locale-context";
import { translator, type Locale, type MessageKey } from "@/i18n/dictionaries";
import { buildLogView } from "@/lib/activity-change";
import { changeLineText, changeSummary } from "@/lib/activity-change-text";
import { useAuth } from "@/lib/auth-context";
import type {
  DrawerRow,
  FlagKind,
  FlagLevel,
  ItemSales,
  OwnerReport,
  ReportEvent,
  ReportEventKind,
  ReportFlag,
  StaffAudit,
  StockLogLine,
} from "@/lib/owner-report";
import { downloadOwnerReportPdf, makeOwnerReportPdf } from "@/lib/owner-report-pdf";
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
  ownerReportFileName,
  periodText,
  reportFormatters,
  TYPE_LABEL,
  variantsText,
  type CheckMark,
  type CheckRow,
  type OwnerSummary,
} from "@/lib/owner-report-text";
import { buildOwnerReportHtml, type OwnerReportPrintInfo } from "@/lib/print-owner-report";
import { printHtmlDocument } from "@/lib/print-receipt";
import { unitLabelKey } from "@/lib/stock-labels";
import { EMAIL_PDF_MAX_BYTES, localePdfName, REPORT_EMAIL_LOCALES } from "@/lib/report-email";
import {
  dropReportEmail,
  queueReportEmail,
  sendQueuedReportEmail,
  subscribeReportOutbox,
  type OutboxPage,
} from "@/lib/report-outbox";

/**
 * The owner report on screen, written for an owner who may not be technical
 * or read English well. General first, details further down: the summary (one
 * status line, sales − expenses = left, quick facts), cash in the drawer, how
 * customers ordered and paid, what sold, the staff, the things to check (what
 * we checked, then each one with its bill open on a tap) and every change last.
 * The A4 PDF and the slip follow the same order. Symbols, colour and a word say
 * every status, so it reads without reading.
 */

/** Numbers stay in the Latin sans face (Urdu UI uses Naskh for text). */
const NUM: CSSProperties = { fontFamily: "var(--font-en), system-ui, sans-serif" };

const CARD =
  "rounded-2xl border border-[#e8dfcf] bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04),0_12px_28px_-18px_rgba(28,25,23,0.25)]";

const BTN =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#e8dfcf] bg-white px-3 text-sm font-semibold text-[var(--gold-deep)] transition hover:bg-[#faf8f5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]";

/** A 28px chip that still takes a 44px tap (the hit area reaches 8px above and below). */
const HIT = "relative after:absolute after:inset-x-0 after:-inset-y-2";

const PATH = {
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6v-4m0-4h.01",
  check: "M20 6 9 17l-5-5",
  checkCircle: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3",
  x: "M6 6l12 12M18 6L6 18",
  minus: "M5 12h14",
  people:
    "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  drawer: "M3 5h18v14H3zM3 10h18M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  wallet: "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 2-4h12l2 4M16 13h.01",
  bag: "M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6l2-4ZM4 6h16M9 10h6",
  flag: "M4 22V4M4 4h12l-2 4 2 4H4",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  utensils: "M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7",
  banknote: "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 12h.01M18 12h.01",
  card: "M2 5h20v14H2zM2 10h20M6 15h4",
  phone: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM11 18h2",
  bike: "M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm14 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 18V14l-3-3 4-3 2 3h3",
  pencil: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  xCircle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM15 9l-6 6M9 9l6 6",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  percent: "M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  arrowDown: "M12 5v14M19 12l-7 7-7-7",
  receipt: "M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2ZM8 8h8M8 12h8M8 16h5",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2",
  box: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12",
  chevron: "m6 9 6 6 6-6",
  chevronEnd: "m9 18 6-6-6-6",
  chart: "M3 3v18h18M7 15l4-4 3 3 5-6",
} as const;

function Svg({ d, size = 16, className = "" }: { d: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/**
 * "{name} changed order #{num}" → text with each value isolated (LTR numbers in Urdu).
 * An amount never breaks between "Rs" and the number (a phone wraps there).
 */
function Tpl({ text, vars }: { text: string; vars: Record<string, ReactNode> }) {
  const parts = text.split(/\{(\w+)\}/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <bdi key={i} className="font-semibold" style={NUM}>
            {typeof vars[p] === "string" ? keepRs(vars[p]) : (vars[p] ?? `{${p}}`)}
          </bdi>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Rs({ value, sign, className = "" }: { value: number; sign?: "+" | "−" | ""; className?: string }) {
  return (
    <bdi className={`whitespace-nowrap tabular-nums ${className}`} style={NUM} dir="ltr">
      {sign ?? ""}
      {formatPkr(value)}
    </bdi>
  );
}

/** "1 changed · 2 removed" (a zero part left out). */
function ExpChanges({ edits, deletes }: { edits: number; deletes: number }) {
  const { t } = useLocale();
  return (
    <>
      {expenseChangeParts(edits, deletes).map((p, i) => (
        <span key={p.key}>
          {i > 0 ? " · " : ""}
          <Tpl text={t(p.key)} vars={{ n: p.n }} />
        </span>
      ))}
    </>
  );
}

type Tone = "red" | "amber" | "green" | "info" | "neutral";

const TONE: Record<Tone, { tint: string; ring: string; text: string; icon: string; strong: string }> = {
  red: { tint: "bg-red-50", ring: "ring-red-200", text: "text-red-700", icon: PATH.alert, strong: "text-red-700" },
  amber: { tint: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-800", icon: PATH.eye, strong: "text-amber-900" },
  green: { tint: "bg-emerald-50", ring: "ring-emerald-200", text: "text-emerald-800", icon: PATH.check, strong: "text-emerald-800" },
  info: { tint: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-700", icon: PATH.info, strong: "text-sky-700" },
  neutral: { tint: "bg-stone-100", ring: "ring-stone-200", text: "text-stone-700", icon: PATH.minus, strong: "text-stone-700" },
};

const LEVEL_TONE: Record<FlagLevel, Tone> = { high: "red", medium: "amber", low: "neutral" };

const MARK: Record<CheckMark, { tone: Tone; icon: string; word: MessageKey }> = {
  bad: { tone: "red", icon: PATH.x, word: "orMarkBad" },
  warn: { tone: "amber", icon: PATH.alert, word: "orMarkWarn" },
  info: { tone: "neutral", icon: PATH.info, word: "orMarkInfo" },
  na: { tone: "neutral", icon: PATH.minus, word: "orMarkNa" },
  ok: { tone: "green", icon: PATH.check, word: "orMarkOk" },
};

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

function useFormatters(multiDay: boolean) {
  const { locale } = useLocale();
  return useMemo(() => reportFormatters(locale, multiDay), [locale, multiDay]);
}

/**
 * Scroll a section into view (inside the POS sheet or the admin page) and put focus on it.
 * With `focus`, the matched row / group heading is what scrolls into view — it can sit
 * well below the section's top (e.g. under "What we checked").
 */
function jumpTo(id: string, focus?: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const hit = focus ? el.querySelector<HTMLElement>(focus) : null;
  const row = hit?.closest<HTMLElement>("li, h3") ?? null;
  (row ?? el).scrollIntoView({ block: row?.tagName === "LI" ? "center" : "start", behavior: reduce ? "auto" : "smooth" });
  (hit ?? el.querySelector<HTMLElement>("h2"))?.focus({ preventScroll: true });
}

function Section({
  id,
  title,
  hint,
  icon,
  action,
  children,
  className = "",
  testId,
}: {
  id?: string;
  title: string;
  hint?: string;
  icon: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section id={id} className={`${CARD} scroll-mt-4 ${className}`} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#f0e9dc] px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f6efe0] text-[var(--gold-deep)]">
            <Svg d={icon} size={20} />
          </span>
          <div className="min-w-0">
            <h2 tabIndex={-1} className="text-lg font-bold text-[var(--ink)] focus:outline-none">
              {title}
            </h2>
            {hint ? <p className="mt-0.5 text-sm text-stone-600">{hint}</p> : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function useExpanded(all = false) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { isOpen: (id: string) => all || open.has(id), toggle, setOpen };
}

/* ── 1. Actions: Save PDF · Print slip · Send to Gmail ── */

/** What the page around the report knows, for its PDF / print / email buttons. */
export type OwnerReportActionsInfo = OwnerReportPrintInfo & {
  fromKey: string | null;
  toKey: string;
  /** The period's times: the emailed PDFs label it in their own language. */
  periodFrom: Date | null;
  periodTo: Date;
  /** "All branches" (said in each PDF's language). */
  allBranches?: boolean;
  /** An owner is looking (staff are told to ask the owner when no email is set). */
  isOwner: boolean;
};

type Status = { tone: "ok" | "error" | "info"; text: string } | null;

/** Gmail's envelope "M" in its colours, so the button reads "Gmail" at a glance. */
function GmailIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7a3 3 0 0 0 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3V16.2z" />
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 45 12.298z" />
    </svg>
  );
}

const ACTION_BTN =
  "inline-flex min-h-11 items-center gap-2 rounded-xl border text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-wait disabled:opacity-60";

function Dialog({
  title,
  onClose,
  children,
  footer,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  testId?: string;
}) {
  const { t } = useLocale();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
    >
      <button type="button" className="absolute inset-0 bg-stone-950/55 backdrop-blur-[2px]" aria-label={t("close")} onClick={onClose} />
      <div className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#f0e9dc] px-5 py-3.5">
          <h3 className="text-base font-bold text-[var(--ink)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
            aria-label={t("close")}
          >
            <Svg d={PATH.x} size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <div className="flex justify-end gap-2 border-t border-[#f0e9dc] px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

/**
 * Save PDF (made on this PC, works offline), print the slip after a preview,
 * or email the report (English + Urdu PDFs) to the owner's report emails —
 * through this PC's outbox, so without internet it goes once the net is back.
 */
function useReportActions(
  report: OwnerReport,
  multiDay: boolean,
  info: OwnerReportActionsInfo,
  branchNameFor?: (id: string) => string | undefined,
  failed: { logsFailed?: boolean; drawerFailed?: boolean } = {},
) {
  const { t, locale } = useLocale();
  const { profile } = useAuth();
  const [status, setStatus] = useState<Status>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** Report emails on this PC still waiting for the internet. */
  const [waiting, setWaiting] = useState(0);
  useEffect(() => subscribeReportOutbox(setWaiting), []);

  // The printouts say "Couldn't load" too, never a ✓ for something that didn't load.
  const build = { ...info, report, t, locale, multiDay, branchNameFor, ...failed };
  /** The same report in another language (the email carries English and Urdu). */
  const buildIn = (l: Locale) => {
    const lt = translator(l);
    return {
      ...build,
      t: lt,
      locale: l,
      periodLabel: periodText({ from: info.periodFrom, to: info.periodTo, locale: l, t: lt }),
      branchLabel: info.allBranches ? lt("allBranches") : info.branchLabel,
    };
  };

  const savePdf = async () => {
    setPdfBusy(true);
    setStatus({ tone: "info", text: t("orPdfMaking") });
    const fileName = ownerReportFileName(info.fromKey, info.toKey);
    try {
      await downloadOwnerReportPdf({ ...build, fileName });
      setStatus({ tone: "ok", text: fill(t("orPdfSaved"), { name: fileName }) });
    } catch (err) {
      console.error("[owner-report] pdf", err);
      setStatus({ tone: "error", text: t("orPdfFailed") });
    } finally {
      setPdfBusy(false);
    }
  };

  const emailError = (code: unknown, reason: unknown): string => {
    if (code === "no_recipients") return t(info.isOwner ? "orEmailNoRecipientsOwner" : "orEmailNoRecipientsStaff");
    if (code === "not_configured") return t("orEmailNotSetUp");
    if (code === "too_big") return t("orEmailTooBig");
    return fill(t("orEmailFailed"), { reason: String(reason || "") });
  };

  const emailReport = async () => {
    setSending(true);
    setStatus({ tone: "info", text: t("orPdfMaking") });
    try {
      const fileName = ownerReportFileName(info.fromKey, info.toKey);
      const pages: OutboxPage[] = [];
      for (const l of REPORT_EMAIL_LOCALES) {
        const b = buildIn(l);
        // The PDFs share one email's size limit.
        const pdf = await makeOwnerReportPdf({ ...b, maxBytes: EMAIL_PDF_MAX_BYTES / REPORT_EMAIL_LOCALES.length });
        pages.push({ locale: l, fileName: localePdfName(fileName, l), pdf, branchLabel: b.branchLabel, periodLabel: b.periodLabel });
      }
      if (pages.reduce((n, p) => n + p.pdf.size, 0) > EMAIL_PDF_MAX_BYTES) {
        setStatus({ tone: "error", text: t("orEmailTooBig") });
        return;
      }
      const id = await queueReportEmail({ pages, queuedByName: profile?.displayName || profile?.email || "" });
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setStatus({ tone: "ok", text: t("orEmailQueued") });
        return;
      }
      setStatus({ tone: "info", text: t("orEmailSending") });
      const result = await sendQueuedReportEmail(id);
      if (result.ok) {
        setStatus({ tone: "ok", text: fill(t("orEmailSent"), { to: result.to.join(", ") }) });
      } else if (result.code === "no_recipients" || result.code === "not_configured") {
        // Needs the owner's setup first — nothing to keep waiting.
        await dropReportEmail(id);
        setStatus({ tone: "error", text: emailError(result.code, result.error) });
      } else if (result.retry) {
        setStatus({ tone: "info", text: fill(t("orEmailQueuedRetry"), { reason: result.error }) });
      } else {
        setStatus({ tone: "error", text: emailError(result.code, result.error) });
      }
    } catch (err) {
      console.error("[owner-report] email", err);
      setStatus({ tone: "error", text: emailError(null, err instanceof Error ? err.message : "") });
    } finally {
      setSending(false);
    }
  };

  return {
    status,
    setStatus,
    waiting,
    pdfBusy,
    sending,
    preview,
    setPreview,
    savePdf: () => void savePdf(),
    printSlip: () => setPreview(buildOwnerReportHtml({ ...build, format: "slip" })),
    emailReport: () => void emailReport(),
  };
}

type Actions = ReturnType<typeof useReportActions>;

function ActionButtons({ a, compact }: { a: Actions; compact?: boolean }) {
  const { t } = useLocale();
  const tile = compact ? "min-h-12 flex-col gap-0.5 whitespace-nowrap px-1 sm:min-h-11 sm:flex-row sm:gap-2 sm:px-4" : "px-4";
  return (
    <>
      <button
        type="button"
        className={`${ACTION_BTN} ${tile} justify-center border-[#e8dfcf] bg-white text-[var(--ink)] hover:bg-[#faf8f5]`}
        onClick={a.savePdf}
        disabled={a.pdfBusy}
      >
        <Svg d={PATH.download} size={18} className="text-[var(--gold-deep)]" />
        {a.pdfBusy ? t("orPdfMakingShort") : t("orSavePdf")}
      </button>
      <button
        type="button"
        className={`${ACTION_BTN} ${tile} justify-center border-[#e8dfcf] bg-white text-[var(--ink)] hover:bg-[#faf8f5]`}
        onClick={a.printSlip}
      >
        <Svg d={PATH.printer} size={18} className="text-[var(--gold-deep)]" />
        {t("orPrint")}
      </button>
      <button
        type="button"
        className={`${ACTION_BTN} ${tile} justify-center border-[var(--ink)] bg-[var(--ink)] text-white hover:opacity-90`}
        onClick={a.emailReport}
        disabled={a.sending}
        aria-label={t("orEmailSend")}
      >
        {/* Always white (not the dark theme's surface) — the logo's own tile. */}
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#fff]">
          <GmailIcon size={18} />
        </span>
        <span className="sm:hidden">{a.sending ? t("orEmailSendingShort") : t("orEmailSendShort")}</span>
        <span className="hidden sm:inline">{a.sending ? t("orEmailSendingShort") : t("orEmailSend")}</span>
      </button>
    </>
  );
}

function ActionsBar({ a }: { a: Actions }) {
  const { t } = useLocale();
  const s = a.status;
  const cls = s?.tone === "error" ? "font-semibold text-red-700" : s?.tone === "ok" ? "font-semibold text-emerald-700" : "text-stone-600";
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center" data-testid="owner-actions">
      <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm sm:me-auto" role="status" aria-live="polite">
        {s ? <Svg d={s.tone === "error" ? PATH.alert : s.tone === "ok" ? PATH.check : PATH.info} size={16} className={cls} /> : null}
        <span className={cls}>{s ? s.text : t("orActionsHint")}</span>
        {a.waiting > 0 ? (
          <span
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 text-sm font-semibold text-amber-800 ring-1 ring-amber-200"
            data-testid="owner-email-waiting"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
            <Tpl text={t(a.waiting === 1 ? "orEmailWaitingOne" : "orEmailWaiting")} vars={{ n: a.waiting }} />
          </span>
        ) : null}
      </p>
      <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
        <ActionButtons a={a} compact />
      </div>
    </div>
  );
}

function PrintPreview({ a }: { a: Actions }) {
  const { t } = useLocale();
  if (!a.preview) return null;
  const html = a.preview;
  return (
    <Dialog
      title={t("orPrintPreview")}
      onClose={() => a.setPreview(null)}
      testId="owner-print-preview"
      footer={
        <>
          <button
            type="button"
            className={`${ACTION_BTN} border-[#e8dfcf] bg-white px-4 text-stone-700 hover:bg-[#faf8f5]`}
            onClick={() => a.setPreview(null)}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className={`${ACTION_BTN} border-[var(--ink)] bg-[var(--ink)] px-4 text-white hover:opacity-90`}
            onClick={() => {
              const ok = printHtmlDocument(html);
              a.setPreview(null);
              a.setStatus(ok ? { tone: "ok", text: t("orPrintSent") } : { tone: "error", text: t("orPrintFailed") });
            }}
            autoFocus
          >
            <Svg d={PATH.printer} size={16} />
            {t("orPrintNow")}
          </button>
        </>
      }
    >
      <div className="bg-[#efebe4] px-2 py-3">
        <ReceiptPreview html={html} title={t("orPrintPreview")} />
      </div>
    </Dialog>
  );
}

/* ── 2. Summary: is anything wrong · sales − expenses = left · also ── */

function MarkDot({ mark, size = "h-7 w-7" }: { mark: CheckMark; size?: string }) {
  const { t } = useLocale();
  const m = MARK[mark];
  const tone = TONE[m.tone];
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full ring-1 ${tone.tint} ${tone.ring} ${tone.text}`}>
      <Svg d={m.icon} size={16} />
      <span className="sr-only">{t(m.word)}</span>
    </span>
  );
}

/** One compact line: is anything wrong, and a button down to the list when there is. */
function StatusStrip({ s, onSeeChecks }: { s: OwnerSummary; onSeeChecks: () => void }) {
  const { t } = useLocale();
  const tone = TONE[s.tone];
  const icon = s.tone === "red" ? PATH.alert : s.tone === "amber" ? PATH.eye : PATH.checkCircle;
  return (
    <div
      data-testid="owner-verdict"
      className={`flex flex-col gap-3 rounded-2xl px-4 py-3.5 ring-1 sm:flex-row sm:items-center sm:gap-4 ${tone.tint} ${tone.ring}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white ring-1 ${tone.ring} ${tone.text}`}>
          <Svg d={icon} size={20} />
        </span>
        <div className="min-w-0">
          <p role="status" className={`text-base font-bold leading-6 sm:text-[17px] ${tone.strong}`}>
            {s.headline}
          </p>
          <p className="text-sm text-stone-700">{s.hint}</p>
        </div>
      </div>
      {s.high + s.medium > 0 ? (
        <button type="button" onClick={onSeeChecks} className={`${BTN} shrink-0`}>
          {t("orSeeChecks")}
          <Svg d={PATH.chevronEnd} size={16} className="rtl:-scale-x-100" />
        </button>
      ) : null}
    </div>
  );
}

/** One term of "Sales − Expenses = Left": label + sub beside the number on a phone, stacked on a wide screen. */
function EqTile({
  label,
  sub,
  value,
  valueClass = "text-[var(--ink)]",
  dark,
  testId,
}: {
  label: string;
  sub?: ReactNode;
  value: ReactNode;
  valueClass?: string;
  dark?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-2xl px-4 py-3.5 lg:grid-cols-1 lg:content-start lg:py-4 ${
        dark ? "bg-[#1c1917] text-white ring-1 ring-[#f0e9dc]" : "bg-[#faf8f5] ring-1 ring-[#f0e9dc]"
      }`}
    >
      <p className={`col-start-1 row-start-1 text-sm font-semibold ${dark ? "text-white" : "text-stone-600"}`}>{label}</p>
      <p
        className={`col-start-2 row-span-2 row-start-1 text-[26px] font-bold leading-tight tabular-nums lg:col-start-1 lg:row-span-1 lg:row-start-2 lg:mt-1 xl:text-[30px] ${valueClass}`}
        style={NUM}
      >
        {value}
      </p>
      {sub ? <p className="col-start-1 row-start-2 text-sm text-stone-600 lg:row-start-3 lg:mt-0.5">{sub}</p> : null}
    </div>
  );
}

/** The − / = between the tiles: a small centred row on a phone, a circle between tiles on a wide screen. */
function EqOp({ sign }: { sign: string }) {
  return (
    <div className="flex shrink-0 items-center justify-center" aria-hidden>
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f6efe0] text-base font-bold text-[var(--gold-deep)] lg:h-9 lg:w-9 lg:text-lg"
        style={NUM}
      >
        {sign}
      </span>
    </div>
  );
}

function SummarySection({
  report,
  s,
  onSeeChecks,
  onTile,
}: {
  report: OwnerReport;
  s: OwnerSummary;
  onSeeChecks: () => void;
  onTile: (target: "check-discount" | "staff" | "cancels" | "refunds" | "edits") => void;
}) {
  const { t } = useLocale();
  const x = report.totals;
  const left = money(x.net - x.expenses);
  const flagLevel = (kinds: FlagKind[]) => {
    const levels = report.flags.filter((fl) => kinds.includes(fl.kind)).map((fl) => fl.level);
    return levels.includes("high") ? "high" : levels.includes("medium") ? "medium" : null;
  };

  const tiles: {
    key: string;
    label: string;
    icon: string;
    value: number;
    sub: ReactNode;
    warn: "red" | "amber" | null;
    testId?: string;
    target: Parameters<typeof onTile>[0];
    count: number;
  }[] = [
    {
      key: "disc",
      label: t("orDiscounts"),
      icon: PATH.percent,
      value: x.discountAmount,
      sub: <Tpl text={t(nKey(x.discountOrders, "orOneOrder", "orNOrders"))} vars={{ n: x.discountOrders }} />,
      warn: flagLevel(["bigDiscount"]) ? "amber" : null,
      target: report.flags.some((fl) => fl.kind === "bigDiscount" && fl.level !== "low") ? "check-discount" : "staff",
      count: x.discountOrders,
    },
    {
      key: "cancel",
      label: t("orCancelled"),
      icon: PATH.xCircle,
      value: x.cancelledAmount,
      sub: (
        <>
          <Tpl text={t(nKey(x.cancelledOrders, "orOneOrder", "orNOrders"))} vars={{ n: x.cancelledOrders }} /> · {t("orNotInSales")}
        </>
      ),
      warn: flagLevel(["cancelCash"]) === "high" ? "red" : x.cancelledOrders > 0 ? "amber" : null,
      testId: "owner-kpi-cancelled",
      target: "cancels",
      count: x.cancelledOrders,
    },
    {
      key: "refund",
      label: t("orRefunds"),
      icon: PATH.undo,
      value: x.refunds,
      sub: <Tpl text={t(nKey(x.refundOrders, "orOneOrder", "orNOrders"))} vars={{ n: x.refundOrders }} />,
      warn: x.refunds > 0 ? "amber" : null,
      target: "refunds",
      count: x.refundOrders,
    },
    {
      key: "edit",
      label: t("orEdits"),
      icon: PATH.pencil,
      value: x.edits,
      sub:
        x.editsDown > 0 ? (
          <span className="font-semibold text-red-700">
            <Tpl text={t("orEditsSub")} vars={{ n: x.editsDown, amount: formatPkr(x.editsDownAmount) }} />
          </span>
        ) : (
          t("orEditsNoneLowered")
        ),
      warn: x.editsDown > 0 ? "red" : null,
      testId: "owner-kpi-edits",
      target: "edits",
      count: x.edits,
    },
  ];

  return (
    <Section id="or-money" title={t("orSummaryTitle")} icon={PATH.chart}>
      <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-5">
        <StatusStrip s={s} onSeeChecks={onSeeChecks} />

        <div>
          {/* Sales [− money given back] − expenses = left (left = net − expenses, net = gross − refunds). */}
          <div className="flex flex-col gap-1.5 lg:flex-row lg:items-stretch lg:gap-2">
            <EqTile
              label={t("orLedgerSales")}
              sub={
                x.orders === 0 ? (
                  t("orNoOrders")
                ) : x.orders === 1 ? (
                  t("orLedgerSalesSubOne")
                ) : (
                  <Tpl text={t("orLedgerSalesSub")} vars={{ n: x.orders, avg: formatPkr(x.avgOrder) }} />
                )
              }
              value={<Rs value={x.refunds > 0 ? x.gross : x.net} />}
              testId={x.refunds > 0 ? undefined : "owner-kpi-net"}
            />
            {x.refunds > 0 ? (
              <>
                <EqOp sign="−" />
                <EqTile
                  label={t("orLedgerRefunds")}
                  sub={<Tpl text={t(nKey(x.refundOrders, "orOneOrder", "orNOrders"))} vars={{ n: x.refundOrders }} />}
                  value={<Rs value={x.refunds} />}
                  valueClass="text-amber-800"
                />
              </>
            ) : null}
            <EqOp sign="−" />
            <EqTile
              label={t("orLedgerExpenses")}
              sub={
                x.expenseEdits + x.expenseDeletes > 0 ? (
                  <>
                    <Tpl text={t("orExpensesSub")} vars={{ n: x.expenseCount }} />{" "}
                    <span className="text-amber-800">
                      · <Svg d={PATH.eye} size={14} className="me-1 inline align-[-2px]" />
                      <ExpChanges edits={x.expenseEdits} deletes={x.expenseDeletes} />
                    </span>
                  </>
                ) : (
                  <Tpl text={t("orExpensesSub")} vars={{ n: x.expenseCount }} />
                )
              }
              value={<Rs value={x.expenses} />}
            />
            <EqOp sign="=" />
            <EqTile
              dark
              label={t(left < 0 ? "orLeftLoss" : "orLeft")}
              value={<Rs value={Math.abs(left)} sign={left < 0 ? "−" : ""} />}
              valueClass={left < 0 ? "text-[#fca5a5]" : "text-[var(--gold-soft)]"}
            />
          </div>
          <p className="mt-3 text-sm text-stone-600">
            {x.refunds > 0 ? (
              <span data-testid="owner-kpi-net" className="me-2 inline-flex flex-wrap items-baseline gap-x-1.5">
                {t("orLedgerNet")}
                <Rs value={x.net} className="font-semibold text-[var(--ink)]" />
                <span aria-hidden>·</span>
              </span>
            ) : null}
            {t("orLedgerFoot")}
          </p>
        </div>
      </div>

      <div className="border-t border-[#f0e9dc] px-4 py-4 sm:px-6 sm:py-5">
        <p className="mb-3 text-sm font-semibold text-stone-600">
          {t("orAlsoTitle")} <span className="font-normal">— {t("orAlsoHint")}</span>
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile) => {
            const warn = tile.warn ? TONE[tile.warn] : null;
            const body = (
              <>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-stone-600">
                  <Svg d={warn ? warn.icon : tile.icon} size={18} className={warn ? warn.text : "text-[var(--gold-deep)]"} />
                  {tile.label}
                </span>
                <span className={`mt-1.5 block text-xl font-bold tabular-nums ${warn ? warn.text : "text-[var(--ink)]"}`} style={NUM}>
                  {tile.key === "edit" ? tile.value : <Rs value={tile.value} />}
                </span>
                <span className="mt-0.5 block text-sm text-stone-600">{tile.sub}</span>
              </>
            );
            const cls = `min-h-[104px] rounded-2xl bg-white p-4 text-start ${warn ? `border border-transparent ring-1 ${warn.ring}` : "border border-[#e8dfcf]"}`;
            return tile.count > 0 ? (
              <button
                key={tile.key}
                type="button"
                data-testid={tile.testId}
                onClick={() => onTile(tile.target)}
                className={`${cls} transition hover:bg-[#faf8f5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]`}
              >
                {body}
              </button>
            ) : (
              <div key={tile.key} data-testid={tile.testId} className={cls}>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ── 3. Cash in the drawer ── */

function drawerTone(d: DrawerRow): { tone: Tone; key: MessageKey; sub?: MessageKey; amount?: number } {
  const counted = d.status === "closed" && !d.autoClosed && d.closingCount != null;
  const diff = d.difference ?? 0;
  if (d.status === "open") return { tone: "info", key: "orDrawerResOpen", sub: "orDrawerResOpenSub" };
  // Closed by the system at day end: nobody to ask who closed it.
  if (!counted) return { tone: "amber", key: "orDrawerResNoCount", sub: d.autoClosed ? "orDrawerResAutoSub" : "orDrawerResNoCountSub" };
  if (diff < 0) return { tone: "red", key: "orDrawerResShort", sub: "orDrawerResShortSub", amount: -diff };
  if (diff > 0) return { tone: "amber", key: "orDrawerResOver", sub: "orDrawerResOverSub", amount: diff };
  return { tone: "green", key: "orDrawerResMatch", sub: "orDrawerResMatchSub" };
}

/** "Closed by Ali" — or "Closed automatically" (the system's own name isn't a person). */
function closedText(d: DrawerRow, t: (key: MessageKey) => string): string {
  if (d.autoClosed) return t("orClosedAuto");
  return d.closedByName ? fill(t("orClosedBy"), { name: d.closedByName }) : t("orNotClosedYet");
}

function Difference({ d }: { d: DrawerRow }) {
  const counted = d.status === "closed" && !d.autoClosed && d.closingCount != null;
  if (!counted || d.difference == null) return <span className="text-stone-600">—</span>;
  const diff = d.difference;
  if (diff < 0) return <Rs value={-diff} sign="−" className="text-red-700" />;
  if (diff > 0) return <Rs value={diff} sign="+" className="text-amber-800" />;
  return <Rs value={0} className="text-emerald-700" />;
}

function CashSection({
  report,
  multiBranch,
  branchNameFor,
  drawerFailed,
}: {
  report: OwnerReport;
  multiBranch: boolean;
  branchNameFor?: (id: string) => string | undefined;
  drawerFailed: boolean;
}) {
  const { t } = useLocale();
  const oneDrawer = report.drawers.length === 1 ? report.drawers[0]! : null;
  return (
    <Section id="or-drawers" title={t("orCashTitle")} hint={t("orDrawerHint")} icon={PATH.drawer}>
      <div data-testid="owner-kpi-drawer">
        {/* One branch failing: said above the drawers that did load (never instead of them). */}
        {drawerFailed ? <ResultBox tone="amber" title={t("orDrawerFailed")} /> : null}
        {report.drawers.length === 0 ? (
          drawerFailed ? null : <ResultBox tone="neutral" title={t("orDrawerNone")} />
        ) : oneDrawer ? (
          <OneDrawer d={oneDrawer} branch={multiBranch ? branchNameFor?.(oneDrawer.branchId) ?? oneDrawer.branchId : undefined} />
        ) : (
          <>
            <DrawerSummary report={report} />
            <DrawerDays report={report} multiBranch={multiBranch} branchNameFor={branchNameFor} />
          </>
        )}
      </div>
    </Section>
  );
}

/** Cash at start | Should be | Counted | Difference, then what that means in words. */
function OneDrawer({ d, branch }: { d: DrawerRow; branch?: string }) {
  const { t } = useLocale();
  const f = useFormatters(true);
  const r = drawerTone(d);
  const tn = TONE[r.tone];
  const counted = d.status === "closed" && !d.autoClosed && d.closingCount != null;
  const fig = (label: string, value: ReactNode, tinted?: boolean) => (
    <div className={`rounded-2xl p-4 ring-1 ${tinted ? `${tn.tint} ${tn.ring}` : "bg-[#faf8f5] ring-[#f0e9dc]"}`}>
      <dt className="text-sm text-stone-600">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums text-[var(--ink)]" style={NUM}>
        {value}
      </dd>
    </div>
  );
  return (
    <div data-testid="owner-drawers">
      <dl className="grid grid-cols-2 gap-3 px-4 pt-4 sm:px-6 sm:pt-5 md:grid-cols-4">
        {fig(t("orCashStart"), <Rs value={d.openingBalance} />)}
        {fig(t("orShouldBe"), d.expectedCash != null ? <Rs value={d.expectedCash} /> : <span className="text-stone-600">—</span>)}
        {fig(t("orCountedClose"), counted ? <Rs value={d.closingCount!} /> : <span className="text-stone-600">—</span>)}
        {fig(t("orDifference"), <Difference d={d} />, true)}
      </dl>
      <ResultBox
        tone={r.tone}
        title={r.amount != null ? <Tpl text={t(r.key)} vars={{ amount: formatPkr(r.amount) }} /> : t(r.key)}
        sub={r.sub ? t(r.sub) : undefined}
      />
      <p className="px-4 pb-4 text-sm text-stone-600 sm:px-6">
        {f.day(d.date)}
        {branch ? ` · ${branch}` : ""} · {fill(t("orOpenedBy"), { name: d.openedByName })} · {closedText(d, t)}
      </p>
    </div>
  );
}

function ResultBox({ tone, title, sub }: { tone: Tone; title: ReactNode; sub?: string }) {
  const tn = TONE[tone];
  return (
    <div className={`mx-4 my-4 flex gap-3 rounded-2xl px-4 py-4 ring-1 sm:mx-6 ${tn.tint} ${tn.ring}`}>
      <Svg d={tn.icon} size={24} className={tn.text} />
      <div className="min-w-0">
        <p className={`text-lg font-bold ${tn.strong}`}>{title}</p>
        {sub ? <p className="text-sm text-stone-700">{sub}</p> : null}
      </div>
    </div>
  );
}

/** Several drawers: how many matched / were short / … and the total difference. */
function DrawerSummary({ report }: { report: OwnerReport }) {
  const { t } = useLocale();
  const groups: { tone: Tone; key: MessageKey; n: number; amount?: number }[] = [];
  const by = (pred: (d: DrawerRow) => boolean) => report.drawers.filter(pred);
  const counted = (d: DrawerRow) => d.status === "closed" && !d.autoClosed && d.closingCount != null;
  const short = by((d) => counted(d) && (d.difference ?? 0) < 0);
  const over = by((d) => counted(d) && (d.difference ?? 0) > 0);
  const match = by((d) => counted(d) && (d.difference ?? 0) === 0);
  const noCount = by((d) => d.status === "closed" && !counted(d));
  const open = by((d) => d.status === "open");
  if (short.length) groups.push({ tone: "red", key: "orDrawerSumShort", n: short.length, amount: report.drawerShort });
  if (noCount.length) groups.push({ tone: "amber", key: "orDrawerSumNoCount", n: noCount.length });
  if (over.length) groups.push({ tone: "amber", key: "orDrawerSumOver", n: over.length, amount: report.drawerOver });
  if (open.length) groups.push({ tone: "info", key: "orDrawerSumOpen", n: open.length });
  if (match.length) groups.push({ tone: "green", key: "orDrawerSumMatch", n: match.length });
  const total = money(report.drawers.reduce((s, d) => s + (counted(d) ? d.difference ?? 0 : 0), 0));
  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
      <ul className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const tn = TONE[g.tone];
          return (
            <li key={g.key}>
              <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${tn.tint} ${tn.ring} ${tn.text}`}>
                <Svg d={tn.icon} size={14} />
                <Tpl text={t(g.key)} vars={{ n: g.n, amount: g.amount != null ? formatPkr(g.amount) : "" }} />
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex shrink-0 items-baseline justify-between gap-3 rounded-2xl bg-[#faf8f5] px-4 py-3 ring-1 ring-[#f0e9dc] sm:flex-col sm:items-end sm:gap-0">
        <span className="text-sm font-semibold text-stone-600">{t("orDifference")}</span>
        <span className="text-2xl font-bold">
          {total < 0 ? (
            <Rs value={-total} sign="−" className="text-red-700" />
          ) : total > 0 ? (
            <Rs value={total} sign="+" className="text-amber-800" />
          ) : (
            <Rs value={0} className="text-emerald-700" />
          )}
        </span>
      </div>
    </div>
  );
}

/** Several drawers: each day's four figures and result, inside the cash card. */
function DrawerDays({ report, multiBranch, branchNameFor }: { report: OwnerReport; multiBranch: boolean; branchNameFor?: (id: string) => string | undefined }) {
  const { t } = useLocale();
  const f = useFormatters(true);
  const cell = (label: string, value: ReactNode) => (
    <div>
      <p className="text-sm text-stone-600">{label}</p>
      <p className="text-[15px] font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
  return (
    <>
      <h3 className="border-t border-[#f0e9dc] bg-[#faf7f2] px-4 py-2.5 text-sm font-bold text-stone-700 sm:px-6">{t("orDrawerTitle")}</h3>
      <ul data-testid="owner-drawers" className="divide-y divide-[#f3ede2]">
        {report.drawers.map((d) => {
          const r = drawerTone(d);
          const tn = TONE[r.tone];
          const counted = d.status === "closed" && !d.autoClosed && d.closingCount != null;
          return (
            <li key={d.id} className="px-4 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[15px] font-semibold text-[var(--ink)]" style={NUM}>
                  {f.day(d.date)}
                  {multiBranch ? <span className="font-normal text-stone-600"> · {branchNameFor?.(d.branchId) ?? d.branchId}</span> : null}
                </p>
                <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold ring-1 ${tn.tint} ${tn.ring} ${tn.text}`}>
                  <Svg d={tn.icon} size={14} />
                  {r.amount != null ? <Tpl text={t(r.key)} vars={{ amount: formatPkr(r.amount) }} /> : t(r.key)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {cell(t("orCashStart"), <Rs value={d.openingBalance} />)}
                {cell(t("orShouldBe"), d.expectedCash != null ? <Rs value={d.expectedCash} /> : "—")}
                {cell(t("orCountedClose"), counted ? <Rs value={d.closingCount!} /> : "—")}
                {cell(t("orDifference"), <Difference d={d} />)}
              </div>
              <p className="mt-2 text-sm text-stone-600">
                {fill(t("orOpenedBy"), { name: d.openedByName })}
                {d.autoClosed || d.closedByName ? ` · ${closedText(d, t)}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ── 7. Things to check: what we checked, then each thing ── */

function CheckLine({ row, onJump }: { row: CheckRow; onJump: () => void }) {
  const m = MARK[row.mark];
  const tone = TONE[m.tone];
  const body = (
    <>
      <MarkDot mark={row.mark} />
      <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-3">
        <span className="block text-[15px] text-[var(--ink)]">{row.label}</span>
        <span
          className={`block text-[15px] font-semibold sm:text-end ${row.mark === "ok" ? "text-emerald-700" : row.mark === "na" ? "text-stone-600" : tone.text}`}
        >
          {row.result}
        </span>
      </span>
    </>
  );
  const base = "flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start";
  return (
    <li data-check={row.id} data-mark={row.mark}>
      {row.mark === "bad" || row.mark === "warn" || row.mark === "info" ? (
        <button type="button" onClick={onJump} className={`${base} transition hover:bg-[#faf8f5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]`}>
          {body}
          <Svg d={PATH.chevronEnd} size={16} className="text-stone-500 rtl:-scale-x-100" />
        </button>
      ) : (
        <div className={base}>{body}</div>
      )}
    </li>
  );
}

function CheckSection({
  flags,
  logs,
  multiDay,
  branchNameFor,
  onOpenOrder,
  canOpenOrder,
  state,
  checks,
  onCheck,
}: {
  flags: ReportFlag[];
  logs: Map<string, ReportEvent["log"]>;
  multiDay: boolean;
  branchNameFor?: (id: string) => string | undefined;
  onOpenOrder?: (orderId: string) => void;
  canOpenOrder?: (orderId: string) => boolean;
  state: CheckState;
  /** "What we checked" — shown first, each problem row jumps to its things below. */
  checks: CheckRow[];
  onCheck: (row: CheckRow) => void;
}) {
  const { t } = useLocale();
  const f = useFormatters(multiDay);
  const expanded = useExpanded(state.openAll);
  const main = flags.filter((x) => x.level !== "low");
  const notes = flags.filter((x) => x.level === "low");
  const LIMIT = 8;
  const shownMain = state.showAll ? main : main.slice(0, LIMIT);
  const anyLog = flags.some((x) => x.logId && logs.has(x.logId));
  const groups: { level: FlagLevel; word: MessageKey; list: ReportFlag[] }[] = [
    { level: "high", word: "orGroupHigh", list: shownMain.filter((x) => x.level === "high") },
    { level: "medium", word: "orGroupMedium", list: shownMain.filter((x) => x.level === "medium") },
    { level: "low", word: "orGroupLow", list: state.showNotes ? notes : [] },
  ];

  return (
    <Section
      id="or-check"
      title={t("orNeedsAttention")}
      hint={t(onOpenOrder ? "orNeedsAttentionHint" : "orNeedsAttentionHintView")}
      icon={PATH.flag}
    >
      <div className="px-2 py-3 sm:px-4" data-testid="owner-checklist">
        <p className="px-2 pb-1 text-sm font-semibold text-stone-600">{t("orChkTitle")}</p>
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {checks.map((c) => (
            <CheckLine key={c.id} row={c} onJump={() => onCheck(c)} />
          ))}
        </ul>
      </div>
      <div className="border-t border-[#f0e9dc]">
        {anyLog || notes.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2 px-4 py-3 sm:px-6">
            {anyLog ? (
              <button
                type="button"
                aria-pressed={state.openAll}
                onClick={() => {
                  state.setOpenAll(!state.openAll);
                  if (!state.openAll) state.setShowAll(true);
                }}
                className={`${BTN} rounded-full text-stone-700`}
              >
                {t(state.openAll ? "orCloseAllBills" : "orOpenAllBills")}
              </button>
            ) : null}
            {notes.length > 0 ? (
              <button
                type="button"
                aria-pressed={state.showNotes}
                onClick={() => state.setShowNotes(!state.showNotes)}
                className={`${BTN} rounded-full text-stone-700`}
              >
                <Tpl text={t(state.showNotes ? "orHideNotes" : "orShowNotes")} vars={{ n: notes.length }} />
              </button>
            ) : null}
          </div>
        ) : null}
        {main.length === 0 && !(state.showNotes && notes.length > 0) ? (
          <p className="flex items-center gap-3 px-4 py-6 text-[15px] font-semibold text-emerald-800 sm:px-6">
            <Svg d={PATH.checkCircle} size={20} />
            {t("orNothingToCheck")}
          </p>
        ) : (
          <div data-testid="owner-flags">
            {groups
              .filter((g) => g.list.length > 0)
              .map((g) => {
                const tn = TONE[LEVEL_TONE[g.level]];
                const total = g.level === "high" ? main.filter((x) => x.level === "high").length : g.level === "medium" ? main.filter((x) => x.level === "medium").length : notes.length;
                return (
                  <div key={g.level}>
                    <h3
                      id={`or-grp-${g.level}`}
                      tabIndex={-1}
                      className={`flex scroll-mt-4 items-center gap-2 bg-[#faf7f2] px-4 py-2.5 text-sm font-bold focus:outline-none sm:px-6 ${tn.text}`}
                    >
                      <Svg d={tn.icon} size={16} />
                      {t(g.word)} ({total})
                    </h3>
                    <ul className="divide-y divide-[#f3ede2]">
                      {g.list.map((flag) => (
                        <FlagRow
                          key={flag.id}
                          flag={flag}
                          log={flag.logId ? logs.get(flag.logId) : undefined}
                          f={f}
                          branch={flag.branchId ? branchNameFor?.(flag.branchId) : undefined}
                          open={expanded.isOpen(flag.id)}
                          onToggle={() => expanded.toggle(flag.id)}
                          onOpen={
                            flag.orderId && onOpenOrder && flag.kind !== "delete" && (canOpenOrder?.(flag.orderId) ?? true)
                              ? () => onOpenOrder(flag.orderId!)
                              : undefined
                          }
                          highlight={state.highlight === flag.kind}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
          </div>
        )}
        {main.length > LIMIT ? (
          <div className="border-t border-[#f0e9dc] px-4 py-3 sm:px-6">
            <button type="button" onClick={() => state.setShowAll(!state.showAll)} className={`${BTN} w-full`}>
              {state.showAll ? t("orShowLess") : fill(t("orShowAll"), { n: main.length })}
            </button>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function FlagRow({
  flag,
  log,
  f,
  branch,
  open,
  onToggle,
  onOpen,
  highlight,
}: {
  flag: ReportFlag;
  log?: ReportEvent["log"];
  f: ReturnType<typeof reportFormatters>;
  branch?: string;
  open: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  highlight?: boolean;
}) {
  const { t } = useLocale();
  const tn = TONE[LEVEL_TONE[flag.level]];
  const amount = flagAmount(flag);
  const late = afterSaleText(flag.minutesAfterSale, t);
  const changes = log ? changeSummary(log, t) : "";
  const isExpense = flag.kind === "expenseEdit" || flag.kind === "expenseDelete";
  const levelWord: Record<FlagLevel, MessageKey> = { high: "orLevelHigh", medium: "orLevelMedium", low: "orLevelLow" };
  const vars = flagVars(flag, f.day);

  let detail: ReactNode = null;
  if (flag.kind === "drawerShort" || flag.kind === "drawerOver") {
    detail = (
      <Tpl
        text={t("orFdDrawer")}
        vars={{
          date: flag.date ? f.day(flag.date) : "",
          before: flag.before != null ? formatPkr(flag.before) : "—",
          after: flag.after != null ? formatPkr(flag.after) : "—",
        }}
      />
    );
  } else if (flag.kind === "drawerNotCounted") {
    detail = flag.date ? f.day(flag.date) : null;
  } else if ((flag.kind === "editDown" || (flag.kind === "expenseEdit" && !changes)) && flag.before != null && flag.after != null) {
    detail = (
      <>
        <s className="text-stone-600">
          <Rs value={flag.before} />
        </s>{" "}
        {t("lgArrow")} <b className="text-[var(--ink)]">
          <Rs value={flag.after} />
        </b>
      </>
    );
  } else if (flag.kind === "cancelCash") {
    detail = t("orFdCancelCash");
  }

  return (
    <li
      data-kind={flag.kind}
      data-level={flag.level}
      className={`grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:px-6 ${highlight ? "ring-2 ring-inset ring-[var(--gold)]" : ""}`}
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${tn.tint} ${tn.ring} ${tn.text}`}>
        <Svg d={KIND_ICON[flag.kind]} size={20} />
        <span className="sr-only">{t(levelWord[flag.level])}</span>
      </span>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[15px] font-semibold leading-6 text-[var(--ink)]">
            <Tpl text={t(FLAG_TITLE_KEY[flag.kind])} vars={vars} />
          </p>
          {amount ? (
            <span className={`shrink-0 text-lg font-extrabold ${flag.level === "low" ? "text-[var(--ink)]" : tn.text}`}>
              <Rs value={amount.value} sign={amount.sign} />
            </span>
          ) : null}
        </div>
        {detail ? <p className="text-sm text-stone-700">{detail}</p> : null}
        {changes ? <p className="text-sm text-stone-700">{changes}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600">
          {flag.byName ? (
            <span className="inline-flex items-center gap-1">
              <Svg d={PATH.user} size={14} />
              {fill(t("orByName"), { name: flag.byName })}
            </span>
          ) : null}
          {flag.kind.startsWith("drawer") ? null : (
            <span className="inline-flex items-center gap-1">
              <Svg d={PATH.clock} size={14} />
              <bdi dir="ltr" style={NUM}>
                {f.when(flag.at)}
              </bdi>
            </span>
          )}
          {late ? (
            <span className="inline-flex h-7 items-center rounded-full bg-amber-50 px-2.5 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">{late}</span>
          ) : null}
          {branch ? <span>{branch}</span> : null}
        </p>
      </div>
      {log || onOpen ? (
        <div className={`col-start-2 mt-2 grid gap-2 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:flex sm:self-start ${log && onOpen ? "grid-cols-2" : "grid-cols-1"}`}>
          {log ? (
            <button type="button" className={BTN} onClick={onToggle} aria-expanded={open}>
              {t(isExpense ? (open ? "orHideChange" : "orSeeChange") : open ? "orHideBill" : "orSeeBill")}
              <Svg d={PATH.chevron} size={14} className={open ? "rotate-180" : ""} />
            </button>
          ) : null}
          {onOpen ? (
            <button type="button" className={BTN} onClick={onOpen}>
              {t("orOpenOrder")}
            </button>
          ) : null}
        </div>
      ) : null}
      {log && open ? (
        <div className="col-span-full mt-3 rounded-2xl bg-[#faf7f2] p-3 sm:p-4 [&_.text-\[11px\]]:text-sm [&_.text-xs]:text-sm">
          <ActivityChangeView log={log} showTotals={flag.kind !== "editDown"} billsOpen />
        </div>
      ) : null}
    </li>
  );
}

/* ── 6. Your staff ── */

function nKey(n: number, one: MessageKey, many: MessageKey) {
  return n === 1 ? one : many;
}

function StaffSection({ staff, onPerson }: { staff: StaffAudit[]; onPerson: (uid: string) => void }) {
  const { t } = useLocale();
  const [table, setTable] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    try {
      setTable(localStorage.getItem("or.staffView") === "table");
    } catch {
      /* private mode */
    }
  }, []);
  const toggle = () => {
    setTable((v) => {
      try {
        localStorage.setItem("or.staffView", v ? "cards" : "table");
      } catch {
        /* private mode */
      }
      return !v;
    });
  };
  const list = showAll ? staff : staff.slice(0, 6);
  return (
    <Section
      id="or-staff"
      title={t("orStaffTitle")}
      hint={t("orStaffHint")}
      icon={PATH.people}
      action={
        staff.length > 0 ? (
          <button type="button" className={`${BTN} rounded-full text-stone-700`} aria-pressed={table} onClick={toggle}>
            {t(table ? "orShowCards" : "orCompareTable")}
          </button>
        ) : null
      }
    >
      {staff.length === 0 ? (
        <p className="px-4 py-6 text-[15px] text-stone-600 sm:px-6">{t("orNoStaffActivity")}</p>
      ) : table ? (
        <StaffTable staff={staff} />
      ) : (
        <>
          <div data-testid="owner-staff" className="grid grid-cols-1 gap-3 p-4 sm:p-5 lg:grid-cols-2">
            {list.map((s) => (
              <StaffPerson key={s.uid} s={s} onPerson={onPerson} />
            ))}
          </div>
          {staff.length > 6 ? (
            <div className="border-t border-[#f0e9dc] px-4 py-3 sm:px-6">
              <button type="button" className={`${BTN} w-full`} onClick={() => setShowAll((v) => !v)}>
                {showAll ? t("orShowLess") : fill(t("orShowAll"), { n: staff.length })}
              </button>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

function StaffPerson({ s, onPerson }: { s: StaffAudit; onPerson: (uid: string) => void }) {
  const { t } = useLocale();
  const initials = s.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  // What they did (on anyone's order), and what happened on their own orders — a cancel of
  // their own order is said once, under what they did.
  type Line = { tone: Tone; icon: string; node: ReactNode };
  const lines: Line[] = [];
  const theirs: Line[] = [];
  if (s.editsDown > 0) {
    lines.push({
      tone: "red",
      icon: PATH.arrowDown,
      node: (
        <>
          <Tpl text={t(nKey(s.editsDown, "orSChMadeSmallerOne", "orSChMadeSmaller"))} vars={{ n: s.editsDown, amount: formatPkr(s.editsDownAmount) }} />
          {s.edits > s.editsDown ? <> · <Tpl text={t("orSChEditsAll")} vars={{ n: s.edits }} /></> : null}
        </>
      ),
    });
  } else if (s.edits > 0) {
    lines.push({ tone: "neutral", icon: PATH.pencil, node: <Tpl text={t(nKey(s.edits, "orSChEditsOne", "orSChEdits"))} vars={{ n: s.edits }} /> });
  }
  if (s.deletes > 0)
    lines.push({ tone: "red", icon: PATH.trash, node: <Tpl text={t(nKey(s.deletes, "orSChDeletedOne", "orSChDeleted"))} vars={{ n: s.deletes, amount: formatPkr(s.deletesAmount) }} /> });
  if (s.cancelsDone > 0)
    lines.push({
      tone: "amber",
      icon: PATH.xCircle,
      node: <Tpl text={t(nKey(s.cancelsDone, "orSChCancelsDoneOne", "orSChCancelsDone"))} vars={{ n: s.cancelsDone, amount: formatPkr(s.cancelsDoneAmount) }} />,
    });
  if (s.refunds > 0)
    lines.push({ tone: "amber", icon: PATH.undo, node: <Tpl text={t(nKey(s.refunds, "orSChRefundsOne", "orSChRefunds"))} vars={{ n: s.refunds, amount: formatPkr(s.refundAmount) }} /> });
  if (s.expensesAdded > 0 || s.expenseEdits + s.expenseDeletes > 0)
    lines.push({
      tone: s.expenseEdits + s.expenseDeletes > 0 ? "amber" : "neutral",
      icon: PATH.receipt,
      node: (
        <>
          {s.expensesAdded > 0 ? (
            <Tpl text={t(nKey(s.expensesAdded, "orSChExpensesOne", "orSChExpenses"))} vars={{ n: s.expensesAdded, amount: formatPkr(s.expenseAmount) }} />
          ) : null}
          {s.expenseEdits + s.expenseDeletes > 0 ? (
            <span className="text-amber-800">
              {s.expensesAdded > 0 ? " · " : ""}
              <ExpChanges edits={s.expenseEdits} deletes={s.expenseDeletes} />
            </span>
          ) : null}
        </>
      ),
    });
  if (s.cancelledOrders > s.cancelsOwn)
    theirs.push({
      tone: "amber",
      icon: PATH.xCircle,
      node: <Tpl text={t(nKey(s.cancelledOrders, "orSChTheirCancelledOne", "orSChTheirCancelled"))} vars={{ n: s.cancelledOrders, amount: formatPkr(s.cancelledAmount) }} />,
    });
  if (s.discountOrders > 0)
    theirs.push({
      tone: "neutral",
      icon: PATH.percent,
      node: <Tpl text={t(nKey(s.discountOrders, "orSChDiscountsOne", "orSChDiscounts"))} vars={{ n: s.discountOrders, amount: formatPkr(s.discountAmount) }} />,
    });
  const lineList = (list: Line[]) =>
    list.map((l, i) => (
      <li key={i} className="flex gap-2 text-[15px] leading-6 text-[var(--ink)]">
        <Svg d={l.icon} size={18} className={`mt-0.5 ${TONE[l.tone].text}`} />
        <span className="min-w-0">{l.node}</span>
      </li>
    ));

  const pay = (label: string, v: number) => (
    <div>
      <p className="text-sm text-stone-600">{label}</p>
      <p className="text-[15px] font-semibold text-[var(--ink)]">{v ? <Rs value={v} /> : <span className="text-stone-600">—</span>}</p>
    </div>
  );

  return (
    <article data-uid={s.uid} className="min-w-0 rounded-2xl border border-[#e8dfcf] bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f6efe0] text-base font-bold text-[var(--gold-deep)]" aria-hidden>
          {initials || "?"}
        </span>
        {/* A narrow phone: "Sold" moves under the name (the head row wraps) instead of pushing the card wider. */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-[var(--ink)]">{s.name}</p>
          {s.flags > 0 ? (
            <button
              type="button"
              onClick={() => onPerson(s.uid)}
              className={`mt-1 inline-flex h-7 items-center gap-1 rounded-full bg-amber-50 px-2.5 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${HIT}`}
            >
              <Svg d={PATH.eye} size={14} />
              <Tpl text={t("orStaffFlags")} vars={{ n: s.flags }} />
            </button>
          ) : (
            <span className="mt-1 inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
              <Svg d={PATH.check} size={14} />
              {t("orStaffNothing")}
            </span>
          )}
        </div>
        <div className="ms-auto shrink-0 text-end">
          <p className="text-sm text-stone-600">{t("orStaffSold")}</p>
          <p className="text-xl font-bold text-[var(--ink)]">
            <Rs value={s.sales} />
          </p>
          <p className="text-sm text-stone-600">
            <Tpl text={t(nKey(s.orders, "orOneOrder", "orNOrders"))} vars={{ n: s.orders }} />
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold text-stone-600">{t("orPaidBy")}</p>
      <div className="mt-1 grid grid-cols-3 gap-2 rounded-xl bg-[#faf7f2] p-3">
        {pay(t("cash"), s.cash)}
        {pay(t("card"), s.card)}
        {pay(t("digital"), s.digital)}
      </div>
      <p className="mt-2 text-sm text-stone-700">
        {t("dineIn")} <b style={NUM}>{s.dineIn}</b> · {t("takeaway")} <b style={NUM}>{s.takeaway}</b> · {t("delivery")} <b style={NUM}>{s.delivery}</b>
      </p>
      {theirs.length > 0 ? (
        <div className="mt-3 border-t border-[#f0e9dc] pt-3">
          <p className="text-sm font-semibold text-stone-600">{t("orStaffOnTheirOrders")}</p>
          <ul className="mt-1 space-y-2">{lineList(theirs)}</ul>
        </div>
      ) : null}
      <div className="mt-3 border-t border-[#f0e9dc] pt-3">
        <p className="text-sm font-semibold text-stone-600">{t("orStaffChanges")}</p>
        <ul className="mt-1 space-y-2">
          {lines.length === 0 ? (
            <li className="flex gap-2 text-[15px] leading-6 text-emerald-800">
              <Svg d={PATH.check} size={18} className="mt-0.5" />
              {t(theirs.length > 0 ? "orChkNone" : "orSChNone")}
            </li>
          ) : (
            lineList(lines)
          )}
        </ul>
      </div>
    </article>
  );
}

function StaffTable({ staff }: { staff: StaffAudit[] }) {
  const { t } = useLocale();
  const anyDeletes = staff.some((s) => s.deletes > 0);
  const zero = <span className="text-stone-500">—</span>;
  const head = "px-3 py-2.5 text-end text-sm font-semibold text-stone-600";
  const small = "mt-0.5 block whitespace-nowrap text-sm";
  const cell = "px-3 py-3 align-top text-end";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm" data-testid="owner-staff">
        <thead className="bg-[#faf7f2]">
          <tr>
            <th scope="col" className={`${head} text-start`}>{t("orColStaff")}</th>
            <th scope="col" className={head}>{t("orStaffSold")}</th>
            <th scope="col" className={head}>{t("cash")}</th>
            <th scope="col" className={head}>{t("card")}</th>
            <th scope="col" className={head}>{t("digital")}</th>
            <th scope="col" className={head}>{t("dineIn")}</th>
            <th scope="col" className={head}>{t("takeaway")}</th>
            <th scope="col" className={head}>{t("delivery")}</th>
            <th scope="col" className={head}>{t("orDiscounts")}</th>
            <th scope="col" className={head}>{t("orCancelled")}</th>
            <th scope="col" className={head}>{t("orEdits")}</th>
            <th scope="col" className={head}>{t("orRefunds")}</th>
            {anyDeletes ? <th scope="col" className={head}>{t("orColDeletes")}</th> : null}
            <th scope="col" className={head}>{t("orExpenses")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f3ede2]">
          {staff.map((s) => (
            <tr key={s.uid} data-uid={s.uid}>
              <th scope="row" className="px-3 py-3 text-start align-top font-semibold text-[var(--ink)]">
                <span className="block max-w-[12rem] truncate">{s.name}</span>
                {s.flags > 0 ? (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
                    <Tpl text={t("orStaffFlags")} vars={{ n: s.flags }} />
                  </span>
                ) : null}
              </th>
              <td className={cell}>
                <Rs value={s.sales} className="font-bold" />
                <span className={`${small} text-stone-600`}>
                  <Tpl text={t(nKey(s.orders, "orOneOrder", "orNOrders"))} vars={{ n: s.orders }} />
                </span>
              </td>
              <td className={cell}>{s.cash ? <Rs value={s.cash} /> : zero}</td>
              <td className={cell}>{s.card ? <Rs value={s.card} /> : zero}</td>
              <td className={cell}>{s.digital ? <Rs value={s.digital} /> : zero}</td>
              <td className={cell} style={NUM}>{s.dineIn}</td>
              <td className={cell} style={NUM}>{s.takeaway}</td>
              <td className={cell} style={NUM}>{s.delivery}</td>
              <td className={cell}>
                {s.discountOrders ? (
                  <>
                    <Rs value={s.discountAmount} />
                    <span className={`${small} text-stone-600`}><Tpl text={t(nKey(s.discountOrders, "orOneOrder", "orNOrders"))} vars={{ n: s.discountOrders }} /></span>
                  </>
                ) : zero}
              </td>
              <td className={cell}>
                {s.cancelledOrders || s.cancelsDone ? (
                  <>
                    {s.cancelledOrders ? <Rs value={s.cancelledAmount} className="text-amber-800" /> : null}
                    {s.cancelledOrders ? <span className={`${small} text-amber-800`}><Tpl text={t(nKey(s.cancelledOrders, "orOneOrder", "orNOrders"))} vars={{ n: s.cancelledOrders }} /></span> : null}
                    {s.cancelsDone ? <span className={`${small} text-stone-600`}><Tpl text={t(nKey(s.cancelsDone, "orSChCancelsDoneOne", "orSChCancelsDone"))} vars={{ n: s.cancelsDone, amount: formatPkr(s.cancelsDoneAmount) }} /></span> : null}
                  </>
                ) : zero}
              </td>
              <td className={cell}>
                {s.edits ? (
                  <>
                    <span className="font-semibold" style={NUM}>{s.edits}</span>
                    {s.editsDown ? (
                      <span className={`${small} font-semibold text-red-700`}>
                        <Tpl text={t("orEditsSub")} vars={{ n: s.editsDown, amount: formatPkr(s.editsDownAmount) }} />
                      </span>
                    ) : null}
                  </>
                ) : zero}
              </td>
              <td className={cell}>
                {s.refunds ? (
                  <>
                    <Rs value={s.refundAmount} className="text-amber-800" />
                    <span className={`${small} text-stone-600`}><Tpl text={t(nKey(s.refunds, "orOnce", "orNTimes"))} vars={{ n: s.refunds }} /></span>
                  </>
                ) : zero}
              </td>
              {anyDeletes ? (
                <td className={cell}>
                  {s.deletes ? (
                    <>
                      <span className="font-semibold text-red-700" style={NUM}>{s.deletes}</span>
                      <span className={`${small} text-red-700`}><Rs value={s.deletesAmount} /></span>
                    </>
                  ) : zero}
                </td>
              ) : null}
              <td className={cell}>
                {s.expensesAdded || s.expenseEdits || s.expenseDeletes ? (
                  <>
                    {s.expensesAdded ? <Rs value={s.expenseAmount} /> : null}
                    {s.expensesAdded ? <span className={`${small} text-stone-600`}><Tpl text={t("orNAdded")} vars={{ n: s.expensesAdded }} /></span> : null}
                    {s.expenseEdits || s.expenseDeletes ? (
                      <span className={`${small} text-amber-800`}>
                        <ExpChanges edits={s.expenseEdits} deletes={s.expenseDeletes} />
                      </span>
                    ) : null}
                  </>
                ) : zero}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[#f0e9dc] px-4 py-3 text-sm text-stone-600 sm:px-6">{t("orStaffFootnote")}</p>
    </div>
  );
}

/* ── 5. What sold ── */

function ItemsSection({ items, sales }: { items: ItemSales; sales: number }) {
  const { t } = useLocale();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const all = useMemo(() => items.groups.flatMap((g) => g.items), [items]);
  const top = useMemo(
    () => [...all].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.localeCompare(b.name)).slice(0, 5),
    [all],
  );
  const maxQty = top[0]?.qty ?? 1;
  return (
    <Section
      title={t("orItemsTitle")}
      hint={t("orItemsHint")}
      icon={PATH.utensils}
      action={
        items.qty > 0 ? (
          // A phone: under the title, lined up with it (not floating on the far side).
          <div className="w-full ps-[3.25rem] sm:w-auto sm:ps-0 sm:text-end">
            <p className="text-base font-bold text-[var(--ink)]">
              <Tpl text={t(items.qty === 1 ? "orItemsTotalOne" : "orItemsTotal")} vars={{ n: items.qty }} />{" "}
              <span className="font-semibold text-stone-600">
                · <Rs value={items.revenue} />
              </span>
            </p>
            {/* Item prices are before the bill's discount: tie the total to the Sales tile. */}
            {money(items.revenue) !== money(sales) ? (
              <p className="text-sm text-stone-600">
                <Tpl text={t("orItemsVsSales")} vars={{ sales: formatPkr(sales) }} />
              </p>
            ) : null}
          </div>
        ) : null
      }
    >
      {items.groups.length === 0 ? (
        <p className="px-4 py-6 text-[15px] text-stone-600 sm:px-6">{t("orItemsNone")}</p>
      ) : (
        <>
          {all.length > 5 ? (
            <div className="border-b border-[#f0e9dc] px-4 py-4 sm:px-6">
              <p className="text-sm font-semibold text-stone-600">{t("orTopSellers")}</p>
              <ol className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {top.map((it, i) => (
                  <li key={it.productId || it.name}>
                    <div className="flex items-center gap-3">
                      <span className="w-6 text-sm font-bold text-stone-600" style={NUM}>
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-[15px] font-semibold text-[var(--ink)]">{it.name}</span>
                      <bdi dir="ltr" className="text-base font-extrabold text-[var(--ink)]" style={NUM}>
                        ×{it.qty}
                      </bdi>
                    </div>
                    <div className="ms-9 mt-1 h-2 overflow-hidden rounded-full bg-stone-100" aria-hidden>
                      <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: `${Math.round((it.qty / maxQty) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <div data-testid="owner-items" className="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
            {items.groups.map((g) => {
              const key = g.id || "other";
              const expanded = openGroups.has(key);
              const list = expanded ? g.items : g.items.slice(0, 6);
              return (
                <div key={key} data-group={g.name ?? ""} className="overflow-hidden rounded-2xl border border-[#e8dfcf] bg-white">
                  {items.grouped ? (
                    <div className="flex items-baseline justify-between gap-3 bg-[#faf7f2] px-4 py-3">
                      <h3 className="truncate text-[15px] font-bold text-[var(--gold-deep)]">{g.name ?? t("orItemsOther")}</h3>
                      <span className="shrink-0 text-sm text-stone-600" style={NUM}>
                        <bdi dir="ltr">×{g.qty}</bdi> · <Rs value={g.revenue} />
                      </span>
                    </div>
                  ) : null}
                  {g.families.map((fam) => (
                    <div
                      key={fam.name}
                      data-testid="owner-item-family"
                      className="mx-3 mt-3 flex items-start justify-between gap-3 rounded-xl bg-[#f6efe0] px-3 py-3 ring-1 ring-[#f0e9dc]"
                    >
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold text-[var(--ink)]">{fill(t("orItemsFamily"), { name: fam.name })}</p>
                        {fam.variants.length > 0 ? <p className="mt-0.5 text-sm text-stone-700">{variantsText(fam.variants, t)}</p> : null}
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="text-xl font-bold leading-tight text-[var(--ink)]" style={NUM}>
                          <bdi dir="ltr">×{fam.qty}</bdi>
                        </p>
                        <Rs value={fam.revenue} className="text-sm text-stone-600" />
                      </div>
                    </div>
                  ))}
                  <ul className="divide-y divide-[#f3ede2]">
                    {list.map((it) => (
                      <li key={it.productId || it.name} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-[var(--ink)]">{it.name}</p>
                          {it.variants.length > 0 ? (
                            <p className="mt-1.5 flex flex-wrap gap-1.5">
                              {it.variants.map((v) => (
                                <span key={v.label} className="inline-flex h-7 items-center rounded-full bg-stone-100 px-2.5 text-sm font-semibold text-stone-700">
                                  {v.label || t("orItemsPlain")} <bdi dir="ltr" className="ms-1" style={NUM}>×{v.qty}</bdi>
                                </span>
                              ))}
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-end">
                          <p className="text-lg font-bold leading-tight text-[var(--ink)]" style={NUM}>
                            <bdi dir="ltr">×{it.qty}</bdi>
                          </p>
                          <Rs value={it.revenue} className="text-sm text-stone-600" />
                        </div>
                      </li>
                    ))}
                  </ul>
                  {g.items.length > 6 ? (
                    <div className="border-t border-[#f0e9dc] px-4 py-2">
                      <button
                        type="button"
                        className={`${BTN} w-full border-transparent`}
                        onClick={() =>
                          setOpenGroups((cur) => {
                            const next = new Set(cur);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                      >
                        {expanded ? t("orShowLess") : fill(t("orShowAll"), { n: g.items.length })}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Section>
  );
}

/* ── 4. How customers ordered and paid ── */

/** Signed stock figure: "—" for none, +in, −out. */
function stockFig(key: keyof StockDayRow, n: number): string {
  if (key === "opening") return String(n);
  if (n === 0) return "—";
  if (key === "received" || key === "returned" || (key === "adjusted" && n > 0)) return `+${n}`;
  if (key === "sold" || key === "wasted") return `−${n}`;
  return `−${Math.abs(n)}`;
}

function closingTone(r: StockDayRow): string {
  return r.closing <= 0 ? "bg-red-100 text-red-800" : r.closing <= r.lowStockThreshold ? "bg-amber-100 text-amber-800 dark:bg-[rgba(245,158,11,0.2)]" : "bg-emerald-100 text-emerald-800";
}

/** Tag for a hand stock change: what kind (receive / waste / recount / add / delete / edit) and its colour. */
function stockLogTag(l: StockLogLine): { key: MessageKey; tone: string } {
  if (l.action === "create") return { key: "activityCreate", tone: "bg-emerald-100 text-emerald-800" };
  if (l.action === "delete") return { key: "activityDelete", tone: "bg-red-100 text-red-700" };
  if (/^Received/.test(l.summary)) return { key: "invReceive", tone: "bg-emerald-100 text-emerald-800" };
  if (/^Recorded waste/.test(l.summary)) return { key: "wasteStock", tone: "bg-red-100 text-red-700" };
  if (/^Adjusted/.test(l.summary)) return { key: "invRecount", tone: "bg-amber-100 text-amber-800 dark:bg-[rgba(245,158,11,0.2)]" };
  return { key: "activityUpdate", tone: "bg-stone-100 text-stone-700" };
}

/**
 * Each stocked item over the period (opening, came in, sold, left) and who
 * changed stock by hand — received, wasted, recounted, added, deleted.
 * A table on wide screens, one card per item on a phone.
 */
export function StockSection({ rows, log, multiDay }: { rows: StockDayRow[] | undefined; log: StockLogLine[]; multiDay: boolean }) {
  const { t } = useLocale();
  const f = useFormatters(multiDay);
  const [allLog, setAllLog] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const list = rows ?? [];
  const cols: { key: keyof StockDayRow; label: MessageKey }[] = [
    { key: "opening", label: "stockOpening" },
    { key: "received", label: "stockReceived" },
    { key: "sold", label: "stockSold" },
    { key: "returned", label: "stockReturned" },
    { key: "wasted", label: "stockWasted" },
    { key: "adjusted", label: "stockAdjusted" },
  ];
  // Columns nobody used stay out (no wall of zeros).
  const shown = cols.filter((c) => c.key === "opening" || c.key === "sold" || list.some((r) => r[c.key] !== 0));
  const logShown = allLog ? log : log.slice(0, 8);
  return (
    <Section id="or-stock" title={t("stockToday")} hint={t("stockTodayHint")} icon={PATH.box}>
      {list.length === 0 ? (
        <p className="px-4 py-6 text-[15px] text-stone-600 sm:px-6">{t("stockNoItems")}</p>
      ) : (
        <>
          {/* Phone: a card per item. */}
          <ul className="divide-y divide-[#f6f1e7] dark:divide-[var(--border)] sm:hidden">
            {list.map((r) => (
              <li key={r.inventoryItemId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-[15px] font-semibold text-[var(--ink)]">
                    {r.name}
                    <span className="ms-1.5 text-xs font-medium text-stone-500">{t(unitLabelKey[r.unit])}</span>
                  </p>
                  <span className="shrink-0 text-end" dir="ltr">
                    <span className={`inline-block min-w-10 rounded-md px-2 py-0.5 text-center font-bold tabular-nums ${closingTone(r)}`}>{r.closing}</span>
                    <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-stone-500">{t("stockClosing")}</span>
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[13px]">
                  {shown.map((c) => (
                    <div key={c.key} className="flex items-baseline justify-between gap-1 rounded-md bg-[#faf7f2] px-2 py-1">
                      <dt className="text-[11px] text-stone-500">{t(c.label)}</dt>
                      <dd className="font-semibold tabular-nums text-stone-800" dir="ltr">{stockFig(c.key, r[c.key] as number)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          {/* Wider: one table. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="border-b border-[#f0e9dc] text-[11px] font-bold uppercase tracking-[0.1em] text-stone-500">
                  <th className="px-6 py-2.5 text-start">{t("itemName")}</th>
                  {shown.map((c) => (
                    <th key={c.key} className="px-2 py-2.5 text-end">{t(c.label)}</th>
                  ))}
                  <th className="px-6 py-2.5 text-end">{t("stockClosing")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.inventoryItemId} className="border-b border-[#f6f1e7] last:border-0 dark:border-[var(--border)]">
                    <td className="px-6 py-2.5 font-semibold text-[var(--ink)]">
                      {r.name}
                      <span className="ms-1.5 text-xs font-medium text-stone-500">{t(unitLabelKey[r.unit])}</span>
                    </td>
                    {shown.map((c) => (
                      <td key={c.key} className="px-2 py-2.5 text-end tabular-nums text-stone-700" dir="ltr">
                        {stockFig(c.key, r[c.key] as number)}
                      </td>
                    ))}
                    <td className="px-6 py-2.5 text-end" dir="ltr">
                      <span className={`inline-block min-w-10 rounded-md px-2 py-0.5 text-center font-bold tabular-nums ${closingTone(r)}`}>{r.closing}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Who changed stock by hand: closed until asked for. */}
      <div className="border-t border-[#f0e9dc] px-4 py-3 sm:px-6">
        <h3>
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-2 text-start text-sm font-bold text-[var(--ink)]"
            onClick={() => setLogOpen((v) => !v)}
            aria-expanded={logOpen}
            aria-controls="or-stock-log"
          >
            <Svg d={PATH.chevronEnd} size={16} className={`shrink-0 text-stone-500 transition-transform ${logOpen ? "rotate-90" : "rtl:-scale-x-100"}`} />
            <span className="flex-1">{t("stockChangesTitle")}</span>
            <span className="rounded-full bg-[#f3eee6] px-2 py-0.5 text-xs font-bold tabular-nums text-[var(--gold-deep)]" dir="ltr">
              {log.length}
            </span>
          </button>
        </h3>
        {!logOpen ? null : log.length === 0 ? (
          <p id="or-stock-log" className="mt-1 text-sm text-stone-600">{t("stockNoChanges")}</p>
        ) : (
          <>
            <ul id="or-stock-log" className="mt-2 space-y-1.5">
              {logShown.map((l) => (
                <li key={l.id} className="flex items-start gap-3 rounded-xl bg-[#faf7f2] px-3 py-2">
                  <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${stockLogTag(l).tone}`}>
                    {t(stockLogTag(l).key)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--ink)] [overflow-wrap:anywhere]">{l.summary}</p>
                    {l.detail ? <p className="text-xs text-stone-600 [overflow-wrap:anywhere]">{l.detail}</p> : null}
                    <p className="mt-0.5 text-xs text-stone-500">
                      <span className="capitalize">{l.byName}</span> · <span dir="ltr">{f.when(l.at)}</span>
                      {l.pending ? <span className="ms-1.5 font-semibold text-amber-700">· {t("invPending")}</span> : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {log.length > logShown.length || allLog ? (
              <button type="button" className="mt-2 min-h-10 text-sm font-bold text-[var(--gold-deep)]" onClick={() => setAllLog((v) => !v)}>
                {allLog ? t("stockShowFewer") : `${t("stockShowAllChanges")} (${log.length})`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}

function SplitSection({ title, icon, rows, foot }: { title: string; icon: string; rows: { id: string; label: string; icon: string; orders: number; amount: number }[]; foot?: string }) {
  const { t } = useLocale();
  const total = rows.reduce((s, r) => s + Math.max(0, r.amount), 0);
  // Payments always list cash / card / online: all at zero is "no orders" too.
  const empty = rows.every((r) => r.orders === 0 && r.amount === 0);
  return (
    <Section title={title} icon={icon}>
      {empty ? (
        <p className="px-4 py-6 text-[15px] text-stone-600 sm:px-6">{t("orNoOrders")}</p>
      ) : (
        <ul className="space-y-4 px-4 py-4 sm:px-6">
          {rows.map((r) => {
            const share = total > 0 ? Math.round((Math.max(0, r.amount) / total) * 100) : 0;
            return (
              <li key={r.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Svg d={r.icon} size={18} className="text-[var(--gold-deep)]" />
                    <span className="text-[15px] font-semibold text-[var(--ink)]">{r.label}</span>
                    <span className="text-sm text-stone-600">
                      · <Tpl text={t(nKey(r.orders, "orOneOrder", "orNOrders"))} vars={{ n: r.orders }} />
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <Rs value={r.amount} className="text-[15px] font-bold text-[var(--ink)]" />
                    <span className="w-12 text-end text-sm text-stone-600" style={NUM}>
                      {share}%
                    </span>
                  </span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-100" aria-hidden>
                  <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {foot && !empty ? <p className="px-4 pb-4 text-sm text-stone-600 sm:px-6">{foot}</p> : null}
    </Section>
  );
}

/* ── 8. Every change, by time ── */

type FilterId = "all" | "edits" | "cancels" | "refunds" | "deletes" | "expenses";

const FILTERS: { id: FilterId; key: MessageKey; kinds: ReportEventKind[] }[] = [
  { id: "all", key: "orFilterAll", kinds: [] },
  { id: "edits", key: "orFilterEdits", kinds: ["edit"] },
  { id: "cancels", key: "orFilterCancels", kinds: ["cancel"] },
  { id: "refunds", key: "orFilterRefunds", kinds: ["refund"] },
  { id: "deletes", key: "orFilterDeletes", kinds: ["delete"] },
  { id: "expenses", key: "orFilterExpenses", kinds: ["expenseAdd", "expenseEdit", "expenseDelete"] },
];

/**
 * The line under a change: what changed. An expense change whose headline already
 * says "Rs 600 → Rs 900" doesn't repeat "Amount: Rs 600 → Rs 900".
 */
function eventChanges(ev: ReportEvent, parsed: boolean, t: (key: MessageKey) => string): string {
  if (!(ev.kind === "expenseEdit" && parsed)) return changeSummary(ev.log, t);
  const lines = buildLogView(ev.log).lines.filter((l) => !(l.kind === "field" && l.field === "amount"));
  const shown = lines.slice(0, 3).map((l) => changeLineText(l, t));
  if (lines.length > 3) shown.push(`+${lines.length - 3}`);
  return shown.join(" · ");
}

function eventTone(ev: ReportEvent): Tone {
  if (ev.kind === "delete") return "red";
  if (ev.kind === "edit" && ev.before != null && ev.after != null && ev.after < ev.before) return "red";
  if (ev.kind === "cancel" || ev.kind === "refund" || ev.kind === "expenseDelete" || ev.kind === "expenseEdit") return "amber";
  return "neutral";
}

const EVENT_ICON: Record<ReportEventKind, string> = {
  edit: PATH.pencil,
  cancel: PATH.xCircle,
  refund: PATH.undo,
  delete: PATH.trash,
  expenseAdd: PATH.receipt,
  expenseEdit: PATH.receipt,
  expenseDelete: PATH.receipt,
};

function TimelineSection({
  events,
  flaggedLogs,
  multiDay,
  onOpenOrder,
  canOpenOrder,
  filter,
  setFilter,
  who,
  setWho,
}: {
  events: ReportEvent[];
  /** Log id → the highest level of the flags it is under. */
  flaggedLogs: Map<string, FlagLevel>;
  multiDay: boolean;
  onOpenOrder?: (orderId: string) => void;
  canOpenOrder?: (orderId: string) => boolean;
  filter: FilterId;
  setFilter: (f: FilterId) => void;
  who: string;
  setWho: (w: string) => void;
}) {
  const { t } = useLocale();
  const f = useFormatters(multiDay);
  const [limitN, setLimitN] = useState(40);
  const expanded = useExpanded();
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) m.set(e.byUid, e.byName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const fl of FILTERS) c[fl.id] = fl.kinds.length ? events.filter((e) => fl.kinds.includes(e.kind)).length : events.length;
    return c;
  }, [events]);
  const kinds = FILTERS.find((x) => x.id === filter)!.kinds;
  const list = events.filter((e) => (kinds.length === 0 || kinds.includes(e.kind)) && (who === "all" || e.byUid === who));
  const shown = list.slice(0, limitN);
  const fDay = useFormatters(true);

  return (
    <Section id="or-changes" title={t("orTimelineTitle")} hint={t("orTimelineHint")} icon={PATH.list}>
      <div className="border-b border-[#f0e9dc] px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:px-6">
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {FILTERS.filter((x) => x.id === "all" || counts[x.id] > 0).map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={filter === x.id}
              onClick={() => setFilter(x.id)}
              className={`inline-flex h-11 shrink-0 snap-start items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition ${
                filter === x.id ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[#e8dfcf] bg-white text-stone-700 hover:bg-[#faf8f5]"
              }`}
            >
              {t(x.key)}
              <span style={NUM}>{counts[x.id]}</span>
            </button>
          ))}
        </div>
        {people.length > 1 ? (
          <select
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label={t("staff")}
            className="mt-2 h-11 w-full rounded-xl border border-[#e8dfcf] bg-white px-3 text-sm font-semibold text-stone-700 outline-none focus:border-[var(--gold)] sm:ms-auto sm:mt-0 sm:w-auto"
          >
            <option value="all">{t("orEveryone")}</option>
            {people.map(([uid, name]) => (
              <option key={uid} value={uid}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-[15px] text-stone-600 sm:px-6">{t(events.length === 0 ? "orNoActivity" : "orNoActivityKind")}</p>
      ) : (
        <ol data-testid="owner-timeline">
          {shown.map((ev, i) => {
            const vars = eventVars(ev);
            const parsed = eventParsed(ev);
            const isOrder = !ev.kind.startsWith("expense") && ev.kind !== "delete";
            const openable = isOrder && !!onOpenOrder && (canOpenOrder?.(ev.entityId) ?? true);
            const changes = eventChanges(ev, parsed, t);
            const isOpen = expanded.isOpen(ev.id);
            const level = flaggedLogs.get(ev.id);
            // Flagged: the mark takes the flag's colour (a red "please check" stays red here).
            const tn = TONE[level ? LEVEL_TONE[level] : eventTone(ev)];
            const dayKey = dayKeyOf(ev.at);
            const newDay = multiDay && (i === 0 || dayKeyOf(shown[i - 1]!.at) !== dayKey);
            return (
              <li key={ev.id} data-kind={ev.kind}>
                {newDay ? (
                  <p className="border-t border-[#f0e9dc] bg-[#faf7f2] px-4 py-2 text-sm font-bold text-stone-700 sm:px-6" style={NUM}>
                    {fDay.day(dayKey)}
                  </p>
                ) : null}
                <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-[#f0e9dc] px-4 py-3.5 sm:grid-cols-[5.5rem_2.25rem_minmax(0,1fr)_auto] sm:px-6">
                  <span className="hidden pt-2 text-sm tabular-nums text-stone-600 sm:block" style={NUM} dir="ltr">
                    {f.when(ev.at)}
                  </span>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 ${tn.tint} ${tn.ring} ${tn.text}`}>
                    <Svg d={EVENT_ICON[ev.kind]} size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] leading-6 text-[var(--ink)]">
                      {parsed ? <Tpl text={t(EVENT_KEY[ev.kind])} vars={vars} /> : `${ev.byName}: ${ev.summary}`}
                    </p>
                    {changes ? <p className="text-sm text-stone-600">{changes}</p> : null}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-600">
                      <span className="sm:hidden" style={NUM} dir="ltr">
                        {f.when(ev.at)}
                      </span>
                      {ev.pending ? (
                        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-orange-50 px-2.5 text-sm font-semibold text-orange-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-400" aria-hidden />
                          {t("orPendingSync")}
                        </span>
                      ) : null}
                      {level ? (
                        <button
                          type="button"
                          onClick={() => jumpTo("or-check")}
                          className={`inline-flex h-7 items-center gap-1 text-sm font-semibold underline-offset-2 hover:underline ${HIT} ${tn.text}`}
                        >
                          <Svg d={PATH.flag} size={14} />
                          {t("orInCheck")}
                        </button>
                      ) : null}
                    </p>
                  </div>
                  <div className={`col-start-2 mt-2 grid gap-2 sm:col-start-4 sm:mt-0 sm:flex sm:self-start ${openable ? "grid-cols-2" : "grid-cols-1"}`}>
                    <button type="button" className={BTN} onClick={() => expanded.toggle(ev.id)} aria-expanded={isOpen}>
                      {t(ev.kind.startsWith("expense") ? (isOpen ? "orHideChange" : "orSeeChange") : isOpen ? "orHideBill" : "orSeeBill")}
                      <Svg d={PATH.chevron} size={14} className={isOpen ? "rotate-180" : ""} />
                    </button>
                    {openable ? (
                      <button type="button" className={BTN} onClick={() => onOpenOrder!(ev.entityId)}>
                        {t("orOpenOrder")}
                      </button>
                    ) : null}
                  </div>
                  {isOpen ? (
                    <div className="col-span-full mt-3 rounded-2xl bg-[#faf7f2] p-3 sm:p-4 [&_.text-\[11px\]]:text-sm [&_.text-xs]:text-sm">
                      <ActivityChangeView log={ev.log} billsOpen />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > limitN ? (
        <div className="border-t border-[#f0e9dc] px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setLimitN((n) => n + 60)} className={`${BTN} w-full`}>
            {fill(t("orLoadMore"), { n: list.length - limitN })}
          </button>
        </div>
      ) : null}
    </Section>
  );
}

/* ── The report ── */

type CheckState = {
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  showNotes: boolean;
  setShowNotes: (v: boolean) => void;
  openAll: boolean;
  setOpenAll: (v: boolean) => void;
  highlight: FlagKind | null;
};

const TYPE_ICON: Record<string, string> = { "dine-in": PATH.utensils, takeaway: PATH.bag, delivery: PATH.bike, unset: PATH.info };
const PAY_ICON: Record<string, string> = { cash: PATH.banknote, card: PATH.card, digital: PATH.phone };

type ViewProps = {
  report: OwnerReport;
  /** Period longer than one business day (times show the date too). */
  multiDay: boolean;
  multiBranch?: boolean;
  branchNameFor?: (id: string) => string | undefined;
  onOpenOrder?: (orderId: string) => void;
  canOpenOrder?: (orderId: string) => boolean;
  /** The change log couldn't load (edits / cancels may be missing). */
  extrasError?: string | null;
  drawerFailed?: boolean;
  /** Shows "Save PDF", "Print slip" (with preview) and "Send to Gmail". */
  print?: OwnerReportActionsInfo;
};

export function OwnerReportView(props: ViewProps) {
  return props.print ? <WithActions {...props} print={props.print} /> : <ReportBody {...props} />;
}

function WithActions(props: ViewProps & { print: OwnerReportActionsInfo }) {
  const a = useReportActions(props.report, props.multiDay, props.print, props.multiBranch ? props.branchNameFor : undefined, {
    logsFailed: Boolean(props.extrasError),
    drawerFailed: Boolean(props.drawerFailed),
  });
  return (
    <>
      <ReportBody {...props} a={a} />
      <PrintPreview a={a} />
    </>
  );
}

function ReportBody({
  report,
  multiDay,
  multiBranch = false,
  branchNameFor,
  onOpenOrder,
  canOpenOrder,
  extrasError,
  drawerFailed = false,
  a,
}: ViewProps & { a?: Actions }) {
  const { t } = useLocale();
  const logsById = useMemo(() => new Map(report.events.map((ev) => [ev.id, ev.log])), [report.events]);
  const flaggedLogs = useMemo(() => {
    const rank: Record<FlagLevel, number> = { high: 0, medium: 1, low: 2 };
    const m = new Map<string, FlagLevel>();
    for (const f of report.flags) {
      const was = f.logId ? m.get(f.logId) : undefined;
      if (f.logId && (!was || rank[f.level] < rank[was])) m.set(f.logId, f.level);
    }
    return m;
  }, [report.flags]);
  const branchFor = multiBranch ? branchNameFor : undefined;
  const logsFailed = Boolean(extrasError);
  const summary = useMemo(() => buildOwnerSummary(report, t, { logsFailed, drawerFailed }), [report, t, logsFailed, drawerFailed]);

  // Lifted so the summary, the quick facts, the checklist and the staff cards can jump into them.
  const [showAll, setShowAll] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [openAll, setOpenAll] = useState(false);
  const [highlight, setHighlight] = useState<FlagKind | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  const [who, setWho] = useState("all");
  useEffect(() => {
    if (!highlight) return;
    const id = window.setTimeout(() => setHighlight(null), 1500);
    return () => window.clearTimeout(id);
  }, [highlight]);

  const jumpToFlags = (target: { level?: FlagLevel; kinds?: FlagKind[]; drawer?: boolean }) => {
    if (target.drawer) return jumpTo("or-drawers");
    setShowAll(true);
    const kinds = target.kinds ?? [];
    const first = target.level
      ? report.flags.find((f) => f.level === target.level)
      : report.flags.find((f) => kinds.includes(f.kind));
    if (target.level === "low" || first?.level === "low") setShowNotes(true);
    if (first && !target.level) setHighlight(first.kind);
    // After the list re-renders with everything shown.
    window.setTimeout(() => {
      if (target.level) jumpTo("or-check", `#or-grp-${target.level}`);
      else if (first) jumpTo("or-check", `li[data-kind="${first.kind}"] button`);
      else jumpTo("or-check");
    }, 30);
  };

  const onTile = (target: "check-discount" | "staff" | "cancels" | "refunds" | "edits") => {
    if (target === "check-discount") return jumpToFlags({ kinds: ["bigDiscount"] });
    if (target === "staff") return jumpTo("or-staff");
    setFilter(target);
    setWho("all");
    window.setTimeout(() => jumpTo("or-changes"), 30);
  };

  return (
    <div className="space-y-5 sm:space-y-6" data-testid="owner-report">
      {a ? <ActionsBar a={a} /> : null}
      {extrasError ? (
        <p className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-[15px] text-amber-900 ring-1 ring-amber-200">
          <Svg d={PATH.alert} size={20} className="mt-0.5" />
          <span>
            {t("orLogsFailed")} <span className="text-sm text-amber-800">({extrasError})</span>
          </span>
        </p>
      ) : null}
      <SummarySection
        report={report}
        s={summary}
        onSeeChecks={() => jumpToFlags({ level: summary.high > 0 ? "high" : "medium" })}
        onTile={onTile}
      />
      <CashSection report={report} multiBranch={multiBranch} branchNameFor={branchNameFor} drawerFailed={drawerFailed} />
      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <SplitSection
          title={t("orOrderedTitle")}
          icon={PATH.bag}
          rows={report.byType.map((r) => ({ id: r.type, label: t(TYPE_LABEL[r.type]), icon: TYPE_ICON[r.type] ?? PATH.info, orders: r.orders, amount: r.amount }))}
        />
        <SplitSection
          title={t("orPayments")}
          icon={PATH.wallet}
          rows={report.byPayment.map((r) => ({ id: r.method, label: t(r.method), icon: PAY_ICON[r.method] ?? PATH.wallet, orders: r.orders, amount: r.amount }))}
          foot={t("orPaidAfterRefunds")}
        />
      </div>
      <ItemsSection items={report.items} sales={report.totals.refunds > 0 ? report.totals.gross : report.totals.net} />
      {report.stock || report.stockLog.length > 0 ? <StockSection rows={report.stock} log={report.stockLog} multiDay={multiDay} /> : null}
      <StaffSection
        staff={report.staff}
        onPerson={(uid) => {
          setWho(uid);
          setFilter("all");
          window.setTimeout(() => jumpTo("or-changes"), 30);
        }}
      />
      <CheckSection
        flags={report.flags}
        logs={logsById}
        multiDay={multiDay}
        branchNameFor={branchFor}
        onOpenOrder={onOpenOrder}
        canOpenOrder={canOpenOrder}
        state={{ showAll, setShowAll, showNotes, setShowNotes, openAll, setOpenAll, highlight }}
        checks={summary.checks}
        onCheck={(c) =>
          jumpToFlags(c.id === "drawer" && !report.flags.some((f) => c.kinds.includes(f.kind)) ? { drawer: true } : { kinds: c.kinds })
        }
      />
      <TimelineSection
        events={report.events}
        flaggedLogs={flaggedLogs}
        multiDay={multiDay}
        onOpenOrder={onOpenOrder}
        canOpenOrder={canOpenOrder}
        filter={filter}
        setFilter={setFilter}
        who={who}
        setWho={setWho}
      />
    </div>
  );
}
