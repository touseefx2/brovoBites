"use client";

import { useCallback, useEffect, useState } from "react";
import { shiftBusinessDateKey, type BusinessDayHours } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { mapFirebaseError } from "@/lib/errors";
import { getClientAuth } from "@/lib/firebase/client";
import { fetchReportEmailLog, fetchReportEmailSettings, saveReportEmailSettings } from "@/lib/firestore";
import { apiFetch } from "@/lib/http";
import { fill, reportFormatters } from "@/lib/owner-report-text";
import {
  dailyEmailId,
  DEFAULT_REPORT_EMAIL_SETTINGS,
  isValidEmail,
  lastClosedBusinessDay,
  normalizeEmail,
  REPORT_EMAILS_MAX,
  type ReportEmailSettings,
} from "@/lib/report-email";
import { shopNow } from "@/lib/shop-clock";

type Note = { tone: "ok" | "error" | "info"; text: string } | null;
type LastDaily = { day: string; status: "sending" | "sent" | "failed"; sentAt?: string; error?: string } | null;

async function authed(path: string, method: "GET" | "POST") {
  const token = await getClientAuth().currentUser?.getIdToken();
  const res = await apiFetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} }, { timeoutMs: 90_000 });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/** "04:00" → "4:00 am" (shop time, in the screen's language). */
function clockText(hm: string, locale: "en" | "ur"): string {
  return new Intl.DateTimeFormat(locale === "ur" ? "ur-PK" : "en-PK", {
    timeZone: "Asia/Karachi",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(`2000-01-01T${hm}:00+05:00`));
}

/**
 * Landing Page → who gets the owner report by email (Gmail): the list, the
 * daily auto-send switch, a "send now" check and how the
 * last daily email went. Kept in an owner-only doc with its own Save.
 */
export function ReportEmailSettings({ hours }: { hours: BusinessDayHours }) {
  const { t, locale } = useLocale();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<ReportEmailSettings>(DEFAULT_REPORT_EMAIL_SETTINGS);
  const [form, setForm] = useState<ReportEmailSettings>(DEFAULT_REPORT_EMAIL_SETTINGS);
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [server, setServer] = useState<{ mailer: boolean; cron: boolean } | null>(null);
  const [lastDaily, setLastDaily] = useState<LastDaily>(null);

  const lastDay = lastClosedBusinessDay(shopNow(), hours);
  const f = reportFormatters(locale, true);

  const load = useCallback(async () => {
    setLoading(true);
    setNote(null);
    try {
      const s = await fetchReportEmailSettings();
      setSaved(s);
      setForm(s);
    } catch (err) {
      setNote({ tone: "error", text: mapFirebaseError(err, locale) || t("loadFailed") });
    } finally {
      setLoading(false);
    }
    authed("/api/admin/owner-report/email-test", "GET")
      .then(({ ok, data }) => ok && setServer({ mailer: data.mailer === true, cron: data.cron === true }))
      .catch(() => {});
  }, [locale, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // The newest closed day; before its email went, the day before.
      for (const day of [lastDay, shiftBusinessDateKey(lastDay, -1)]) {
        const row = await fetchReportEmailLog(dailyEmailId(day)).catch(() => null);
        if (row) {
          if (alive) setLastDaily({ day, ...row });
          return;
        }
      }
      if (alive) setLastDaily(null);
    })();
    return () => {
      alive = false;
    };
  }, [lastDay]);

  const dirty = form.autoDaily !== saved.autoDaily || form.emails.join(",") !== saved.emails.join(",");

  const addEmail = () => {
    const email = normalizeEmail(draft);
    if (!email) return;
    if (!isValidEmail(email)) return setInputError(t("repEmailInvalid"));
    if (form.emails.includes(email)) return setInputError(t("repEmailDuplicate"));
    if (form.emails.length >= REPORT_EMAILS_MAX) return setInputError(fill(t("repEmailMax"), { n: REPORT_EMAILS_MAX }));
    setForm((cur) => ({ ...cur, emails: [...cur.emails, email] }));
    setDraft("");
    setInputError(null);
    setNote(null);
  };

  const save = async () => {
    if (!profile) return;
    // A typed but not added address still counts.
    const pending = normalizeEmail(draft);
    let next = form;
    if (pending) {
      if (!isValidEmail(pending)) return setInputError(t("repEmailInvalid"));
      if (!form.emails.includes(pending) && form.emails.length < REPORT_EMAILS_MAX) {
        next = { ...form, emails: [...form.emails, pending] };
      }
      setDraft("");
      setInputError(null);
    }
    setSaving(true);
    setNote(null);
    try {
      await saveReportEmailSettings(next, profile);
      setSaved(next);
      setForm(next);
      setNote({ tone: "ok", text: t("repEmailSaved") });
    } catch (err) {
      setNote({ tone: "error", text: fill(t("repEmailSaveFailed"), { reason: mapFirebaseError(err, locale) || "" }) });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setNote({ tone: "info", text: t("repEmailTestSending") });
    try {
      const { ok, data } = await authed("/api/admin/owner-report/email-test", "POST");
      if (ok) {
        setNote({ tone: "ok", text: fill(t("repEmailTestSent"), { to: ((data.to as string[]) ?? []).join(", ") }) });
      } else if (data.code === "not_configured") {
        setNote({ tone: "error", text: t("orEmailNotSetUp") });
      } else if (data.code === "no_recipients") {
        setNote({ tone: "error", text: t("repEmailNone") });
      } else {
        setNote({ tone: "error", text: fill(t("orEmailFailed"), { reason: String(data.error ?? "") }) });
      }
    } catch (err) {
      setNote({ tone: "error", text: fill(t("orEmailFailed"), { reason: err instanceof Error ? err.message : "" }) });
    } finally {
      setTesting(false);
    }
  };

  const noteCls = note?.tone === "error" ? "text-red-700" : note?.tone === "ok" ? "text-emerald-700" : "text-[var(--muted)]";
  const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]";

  return (
    <section
      className="admin-section-card"
      data-testid="report-email-settings"
      aria-labelledby="report-email-title"
    >
      <div className="admin-section-head">
        <h2 id="report-email-title" className="admin-section-title">
          {t("repEmailTitle")}
        </h2>
        <p className="admin-section-hint">{t("repEmailHint")}</p>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {server && !server.mailer ? (
          <p className="toast-warn">{t("repEmailServerOff")}</p>
        ) : server && !server.cron && form.autoDaily ? (
          <p className="toast-warn">{t("repEmailCronOff")}</p>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-[var(--muted)]">
            <span className="spinner" aria-hidden />
            {t("loading")}
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="report-email-input" className={label}>
                {t("repEmailLabel")}
              </label>
              {form.emails.length > 0 ? (
                <ul className="mb-2.5 flex flex-wrap gap-2" data-testid="report-email-list">
                  {form.emails.map((email) => (
                    <li
                      key={email}
                      className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bb-cream-100)] ps-3.5 text-sm font-semibold text-[var(--ink)]"
                    >
                      <bdi dir="ltr" className="min-w-0 truncate">{email}</bdi>
                      <button
                        type="button"
                        onClick={() => setForm((cur) => ({ ...cur, emails: cur.emails.filter((e) => e !== email) }))}
                        className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted)]"
                        aria-label={fill(t("repEmailRemove"), { email })}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full transition-colors group-hover:bg-[var(--bb-cream-200)] group-hover:text-[var(--danger)]">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-2.5 text-sm text-amber-800">{t("repEmailNone")}</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="report-email-input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  dir="ltr"
                  className="input min-h-11 w-full text-base sm:max-w-sm"
                  placeholder="owner@gmail.com"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setInputError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addEmail();
                    }
                  }}
                  aria-invalid={inputError ? true : undefined}
                  aria-describedby={inputError ? "report-email-error" : undefined}
                  disabled={saving || form.emails.length >= REPORT_EMAILS_MAX}
                />
                <button
                  type="button"
                  className="btn btn-ghost shrink-0"
                  onClick={addEmail}
                  disabled={saving || !draft.trim()}
                >
                  {t("repEmailAdd")}
                </button>
              </div>
              {inputError ? (
                <p id="report-email-error" className="mt-1.5 text-xs font-semibold text-red-700" role="alert">
                  {inputError}
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-[var(--muted)]">{fill(t("repEmailMax"), { n: REPORT_EMAILS_MAX })}</p>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--gold-deep)]"
                checked={form.autoDaily}
                onChange={(e) => setForm((cur) => ({ ...cur, autoDaily: e.target.checked }))}
                disabled={saving}
              />
              <span>
                <span className="block text-sm font-semibold text-[var(--ink)]">{t("repEmailAuto")}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {fill(t("repEmailAutoHint"), { time: clockText(hours.end, locale) })}
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:flex-wrap sm:items-center">
              <button type="button" className="btn" onClick={() => void save()} disabled={saving || (!dirty && !draft.trim())}>
                {saving ? t("saving") : t("repEmailSave")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void sendTest()}
                disabled={testing || saving || dirty || saved.emails.length === 0}
                title={fill(t("repEmailTestHint"), { day: f.day(lastDay) })}
              >
                {testing ? t("orEmailSendingShort") : t("repEmailTest")}
              </button>
              <p className={`min-w-0 text-sm ${noteCls}`} role="status" aria-live="polite">
                {note ? note.text : dirty ? <span className="text-amber-800">{t("repEmailUnsaved")}</span> : null}
              </p>
            </div>

            <p className="text-xs text-[var(--muted)]" data-testid="report-email-last">
              {lastDaily
                ? lastDaily.status === "sent"
                  ? fill(t("repEmailLastSent"), { day: f.day(lastDaily.day), time: lastDaily.sentAt ? f.dayTime(new Date(lastDaily.sentAt)) : "" })
                  : lastDaily.status === "failed"
                    ? fill(t("repEmailLastFailed"), { day: f.day(lastDaily.day), reason: lastDaily.error ?? "" })
                    : fill(t("repEmailLastSending"), { day: f.day(lastDaily.day) })
                : t("repEmailLastNone")}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
