import { businessDayHoursFromSettings, shiftBusinessDateKey, type ShopSettings } from "@bravobites/domain";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  dailyEmailId,
  lastClosedBusinessDay,
  parseReportEmailSettings,
  REPORT_EMAIL_COLLECTION,
  REPORT_EMAIL_DOC_ID,
  REPORT_EMAIL_LOG_COLLECTION,
  type ReportEmailSettings,
} from "@/lib/report-email";
import { mailerReady, MailerNotConfiguredError, sendMail } from "@/lib/server/mailer";
import {
  buildServerOwnerReport,
  DAY_SIGNATURE_VERSION,
  daySignature,
  readShopSettings,
  reportEmailContent,
  signatureHasData,
} from "@/lib/server/owner-report-server";
import { htmlsToPdf } from "@/lib/server/report-pdf";

/**
 * The daily owner-report email. The cron calls this every hour; it sends the
 * newest business day that has closed, once: a log doc per day
 * (reportEmails/daily_<day>) is claimed in a transaction first, so a second
 * call at the same time — or the next hour's — does nothing. A failed send is
 * tried again on the next calls (a few times).
 *
 * A POS that was offline uploads its day later: the same hourly call checks
 * the last week's emailed days, and when one changed since its email (its
 * fingerprint, see daySignature) it sends that day again, marked "updated".
 */

const MAX_ATTEMPTS = 4;
/** "Updated" emails per day at most (a busy day of late edits stays quiet). */
const MAX_UPDATES = 3;
/** A send still "sending" after this long died half-way — try again. */
const STALE_MS = 10 * 60_000;
/** Closed days checked for late data: a POS offline for days still reports. */
const UPDATE_DAYS = 7;

/** The shop hours a fingerprint was made with ("12:00-03:00"). */
function hoursKey(settings: ShopSettings): string {
  const h = businessDayHoursFromSettings(settings);
  return `${h.start}-${h.end}`;
}

export async function readReportEmailSettings(db: Firestore): Promise<ReportEmailSettings> {
  const snap = await db.collection(REPORT_EMAIL_COLLECTION).doc(REPORT_EMAIL_DOC_ID).get();
  return parseReportEmailSettings(snap.data());
}

/** Builds one day's report, makes its PDFs (English and Urdu) and emails them. */
export async function emailDayReport(
  db: Firestore,
  opts: {
    dateKey: string;
    to: string[];
    /** Sent again because the day changed after its first email. */
    updated?: boolean;
    settings?: ShopSettings;
  },
): Promise<{ empty: boolean }> {
  const built = await buildServerOwnerReport(db, { dateKey: opts.dateKey, settings: opts.settings });
  const pdfs = await htmlsToPdf(built.pages.map((p) => p.html));
  const mail = reportEmailContent({ shopName: built.shopName, pages: built.pages, updated: opts.updated, empty: built.empty });
  await sendMail({
    to: opts.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: built.pages.map((p, i) => ({ filename: p.fileName, content: pdfs[i]!, contentType: "application/pdf" })),
    fromName: built.shopName,
  });
  return { empty: built.empty };
}

export type DailyResult =
  | { status: "sent"; dateKey: string; to: string[]; empty: boolean }
  | { status: "skipped"; reason: string; dateKey?: string }
  | { status: "failed"; dateKey: string; error: string };

export async function runDailyOwnerReport(db: Firestore, now = new Date()): Promise<DailyResult> {
  const cfg = await readReportEmailSettings(db);
  if (!cfg.autoDaily) return { status: "skipped", reason: "off" };
  if (cfg.emails.length === 0) return { status: "skipped", reason: "no-recipients" };
  if (!mailerReady()) return { status: "skipped", reason: "mailer-not-configured" };

  const settings = await readShopSettings(db);
  const dateKey = lastClosedBusinessDay(now, businessDayHoursFromSettings(settings));
  const ref = db.collection(REPORT_EMAIL_LOG_COLLECTION).doc(dailyEmailId(dateKey));

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (d) {
      if (d.status === "sent") return false;
      if (d.status === "sending" && now.getTime() - Date.parse(String(d.startedAt)) < STALE_MS) return false;
      if (Number(d.attempts ?? 0) >= MAX_ATTEMPTS) return false;
    }
    tx.set(
      ref,
      {
        kind: "daily",
        dateKey,
        status: "sending",
        to: cfg.emails,
        startedAt: now.toISOString(),
        attempts: FieldValue.increment(1),
      },
      { merge: true },
    );
    return true;
  });
  if (!claimed) return { status: "skipped", reason: "already-handled", dateKey };

  try {
    // Fingerprint first: anything that lands while the PDF is made shows up as
    // a change. Only for the "(updated)" re-send — it can never stop the email.
    const signature = await safeSignature(db, dateKey, settings);
    const { empty } = await emailDayReport(db, { dateKey, to: cfg.emails, settings });
    await ref.set(
      {
        status: "sent",
        sentAt: new Date().toISOString(),
        ...(signature ? { signature } : {}),
        hours: hoursKey(settings),
        empty,
        error: FieldValue.delete(),
      },
      { merge: true },
    );
    return { status: "sent", dateKey, to: cfg.emails, empty };
  } catch (err) {
    const error = err instanceof MailerNotConfiguredError ? "not-configured" : err instanceof Error ? err.message : String(err);
    console.error("[owner-report] daily email", dateKey, err);
    await ref.set({ status: "failed", failedAt: new Date().toISOString(), error: error.slice(0, 300) }, { merge: true });
    return { status: "failed", dateKey, error };
  }
}

/** The day's fingerprint, or null when it can't be made (e.g. an index still building). */
async function safeSignature(db: Firestore, dateKey: string, settings: ShopSettings): Promise<string | null> {
  try {
    return await daySignature(db, dateKey, settings);
  } catch (err) {
    console.error("[owner-report] day fingerprint", dateKey, err);
    return null;
  }
}

export type UpdateResult = { status: "sent" | "failed"; dateKey: string; error?: string };

/**
 * The last week's emailed days, again if they changed since their email: data
 * an offline POS uploaded later, or a later change to that day. New shop hours
 * move sales between days without anything new — that only resets the
 * fingerprints, no "updated" emails.
 */
export async function runOwnerReportUpdates(db: Firestore, now = new Date()): Promise<UpdateResult[]> {
  const cfg = await readReportEmailSettings(db);
  if (!cfg.autoDaily || cfg.emails.length === 0 || !mailerReady()) return [];
  const settings = await readShopSettings(db);
  const last = lastClosedBusinessDay(now, businessDayHoursFromSettings(settings));
  const hours = hoursKey(settings);
  const results: UpdateResult[] = [];

  for (let i = 0; i < UPDATE_DAYS; i++) {
    const dateKey = shiftBusinessDateKey(last, -i);
    const ref = db.collection(REPORT_EMAIL_LOG_COLLECTION).doc(dailyEmailId(dateKey));
    // Sent, or an update that died half-way.
    const ready = (d: FirebaseFirestore.DocumentData | undefined) =>
      !!d &&
      (d.status === "sent" ||
        (d.status === "updating" && now.getTime() - Date.parse(String(d.updateStartedAt)) >= STALE_MS)) &&
      Number(d.updates ?? 0) < MAX_UPDATES &&
      Number(d.updateAttempts ?? 0) < MAX_ATTEMPTS;
    const first = (await ref.get()).data();
    if (!ready(first)) continue;
    const signature = await safeSignature(db, dateKey, settings);
    if (!signature) continue;
    if (first!.hours !== hours) {
      // Emailed before the hours were stamped (stamp them now), or the shop
      // hours changed since: the day's sales just moved — start comparing anew.
      const changed = typeof first!.hours === "string";
      await ref.set(changed ? { hours, signature } : { hours }, { merge: true });
      if (changed) continue;
    }
    const stored = typeof first!.signature === "string" && first!.signature.startsWith(DAY_SIGNATURE_VERSION) ? first!.signature : null;
    if (!stored) {
      // Sent without a (current-format) fingerprint — it couldn't be made then,
      // or an older version made it. Start comparing from now, unless the day
      // went out empty and has data now: that's the late upload to report.
      if (!(first!.empty === true && signatureHasData(signature))) {
        await ref.set({ signature }, { merge: true });
        continue;
      }
    } else if (signature === stored) continue;

    const claimed = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data();
      if (!ready(cur) || cur!.signature !== first!.signature) return false;
      tx.set(
        ref,
        { status: "updating", updateStartedAt: now.toISOString(), updateAttempts: FieldValue.increment(1) },
        { merge: true },
      );
      return true;
    });
    if (!claimed) continue;

    try {
      await emailDayReport(db, { dateKey, to: cfg.emails, updated: true, settings });
      await ref.set(
        {
          status: "sent",
          signature,
          hours,
          updates: FieldValue.increment(1),
          updateAttempts: 0,
          updatedSentAt: new Date().toISOString(),
          updateError: FieldValue.delete(),
        },
        { merge: true },
      );
      results.push({ status: "sent", dateKey });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error("[owner-report] updated email", dateKey, err);
      // Back to "sent" with the old fingerprint: the next hour tries again.
      await ref.set({ status: "sent", updateError: error.slice(0, 300) }, { merge: true });
      results.push({ status: "failed", dateKey, error });
    }
  }
  return results;
}
