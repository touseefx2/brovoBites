import {
  businessDateKey,
  endOfBusinessDay,
  shiftBusinessDateKey,
  type BusinessDayHours,
} from "@bravobites/domain";
import type { Locale } from "@/i18n/dictionaries";

/**
 * Owner report by email — the settings (who gets it) and the rules both the
 * app and the server use. The recipients live in an owner-only document,
 * never in the public shop settings.
 */

export type ReportEmailSettings = {
  emails: string[];
  /** Email each business day's report by itself after the shop closes. */
  autoDaily: boolean;
};

/** Every report email carries the report in these languages — one PDF each. */
export const REPORT_EMAIL_LOCALES: readonly Locale[] = ["en", "ur"];

/** "…_saved-….pdf" → "…_saved-…_English.pdf" / "_Urdu.pdf". */
export function localePdfName(fileName: string, locale: Locale): string {
  return fileName.replace(/(\.pdf)?$/i, `_${locale === "ur" ? "Urdu" : "English"}.pdf`);
}

export const REPORT_EMAIL_COLLECTION = "privateSettings";
export const REPORT_EMAIL_DOC_ID = "ownerReport";
/** Sent emails (daily + by hand) — written by the server only. */
export const REPORT_EMAIL_LOG_COLLECTION = "reportEmails";
export const REPORT_EMAILS_MAX = 5;
/** Vercel takes up to 4.5 MB per request (all the email's PDFs together). */
export const EMAIL_PDF_MAX_BYTES = 4 * 1024 * 1024;

export const DEFAULT_REPORT_EMAIL_SETTINGS: ReportEmailSettings = {
  emails: [],
  autoDaily: true,
};

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

export function isValidEmail(value: string): boolean {
  return value.length <= 120 && EMAIL_RE.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function parseReportEmailSettings(data: Record<string, unknown> | undefined | null): ReportEmailSettings {
  if (!data) return DEFAULT_REPORT_EMAIL_SETTINGS;
  const emails = Array.isArray(data.emails)
    ? [...new Set(data.emails.map((e) => normalizeEmail(String(e))).filter(isValidEmail))].slice(0, REPORT_EMAILS_MAX)
    : [];
  return {
    emails,
    autoDaily: data.autoDaily !== false,
  };
}

/** Log id of one business day's automatic email. */
export function dailyEmailId(dateKey: string): string {
  return `daily_${dateKey}`;
}

/** The newest business day that has fully closed by `now` (its report can go out). */
export function lastClosedBusinessDay(now: Date, hours: BusinessDayHours): string {
  let key = businessDateKey(now, hours);
  for (let i = 0; i < 3 && endOfBusinessDay(key, hours).getTime() >= now.getTime(); i++) {
    key = shiftBusinessDateKey(key, -1);
  }
  return key;
}
