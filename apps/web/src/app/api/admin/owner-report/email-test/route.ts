import { NextRequest, NextResponse } from "next/server";
import { businessDayHoursFromSettings } from "@bravobites/domain";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireOwner } from "@/lib/require-owner";
import { lastClosedBusinessDay, REPORT_EMAIL_LOG_COLLECTION } from "@/lib/report-email";
import { emailDayReport, readReportEmailSettings } from "@/lib/server/daily-report";
import { mailerReady } from "@/lib/server/mailer";
import { readShopSettings } from "@/lib/server/owner-report-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Owner settings: is email (and the daily cron) switched on for this site? */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireOwner(req);
    if ("error" in gate && gate.error) return gate.error;
    return NextResponse.json({ mailer: mailerReady(), cron: Boolean(process.env.CRON_SECRET) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/**
 * "Send last day's report now": the same email the daily job sends (server
 * PDF), for the newest closed business day — to check it all works. Doesn't
 * count as that day's daily email.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireOwner(req);
    if ("error" in gate && gate.error) return gate.error;
    const db = getAdminDb();
    const cfg = await readReportEmailSettings(db);
    if (cfg.emails.length === 0) {
      return NextResponse.json({ error: "No report emails set", code: "no_recipients" }, { status: 409 });
    }
    if (!mailerReady()) {
      return NextResponse.json({ error: "Email not set up", code: "not_configured" }, { status: 503 });
    }
    const settings = await readShopSettings(db);
    const dateKey = lastClosedBusinessDay(new Date(), businessDayHoursFromSettings(settings));
    const logRef = db.collection(REPORT_EMAIL_LOG_COLLECTION).doc();
    const at = new Date().toISOString();
    try {
      await emailDayReport(db, { dateKey, to: cfg.emails });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await logRef.set({ kind: "test", status: "failed", dateKey, by: gate.uid, to: cfg.emails, at, error: error.slice(0, 300) });
      console.error("[owner-report] test email", err);
      return NextResponse.json({ error, code: "send_failed" }, { status: 502 });
    }
    await logRef.set({ kind: "test", status: "sent", dateKey, by: gate.uid, to: cfg.emails, at });
    return NextResponse.json({ ok: true, to: cfg.emails, dateKey });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
