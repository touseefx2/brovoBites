import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { runDailyOwnerReport, runOwnerReportUpdates } from "@/lib/server/daily-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel Cron (vercel.json), once in every hour: emails the newest closed
 * business day's owner report if it hasn't gone yet, and an "updated" one
 * for a recent day that changed after its email. Vercel sends
 * "Authorization: Bearer $CRON_SECRET"; without that env var nothing runs.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = getAdminDb();
    const daily = await runDailyOwnerReport(db);
    const updates = await runOwnerReportUpdates(db);
    const failed = daily.status === "failed" || updates.some((u) => u.status === "failed");
    return NextResponse.json({ daily, updates }, { status: failed ? 500 : 200 });
  } catch (err) {
    console.error("[owner-report] cron", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
