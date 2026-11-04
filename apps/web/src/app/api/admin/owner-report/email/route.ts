import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireActiveUser } from "@/lib/require-owner";
import { EMAIL_PDF_MAX_BYTES, REPORT_EMAIL_LOG_COLLECTION } from "@/lib/report-email";
import { readReportEmailSettings } from "@/lib/server/daily-report";
import { mailerReady, sendMail } from "@/lib/server/mailer";
import { readShopSettings, reportEmailContent, serverT } from "@/lib/server/owner-report-server";
import type { Locale } from "@/i18n/dictionaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Email report" on the owner report (owner or counter staff): the PDFs made
 * on that PC (English and Urdu) go to the owner's report emails. The recipients are read
 * here, from the owner-only settings — the caller can't choose them.
 *
 * The PC sends it straight away or later from its outbox (pressed offline);
 * its id makes a repeat of the same email a no-op.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireActiveUser(req);
    if ("error" in gate && gate.error) return gate.error;

    const db = getAdminDb();
    const cfg = await readReportEmailSettings(db);
    if (cfg.emails.length === 0) {
      return NextResponse.json({ error: "No report emails set", code: "no_recipients" }, { status: 409 });
    }
    if (!mailerReady()) {
      return NextResponse.json({ error: "Email not set up", code: "not_configured" }, { status: 503 });
    }

    const form = await req.formData();
    const clean = (v: FormDataEntryValue | null | undefined, max: number) => String(v ?? "").replace(/\r/g, "").slice(0, max);
    const oneLine = (v: unknown, max: number) => clean(typeof v === "string" ? v : "", max).replace(/\n/g, " ").trim();
    const safeName = (v: unknown) => (oneLine(v, 120).replace(/[^\w.\-]/g, "_") || "Owner-Report").replace(/(\.pdf)?$/i, ".pdf");

    // One PDF per language, in the order of `pages` (English, Urdu). An email
    // queued by an older app has a single PDF and its labels as plain fields.
    type Page = { locale: Locale; fileName: string; periodLabel: string; branchLabel?: string };
    let pages: Page[];
    try {
      const raw = form.get("pages");
      const list = raw ? (JSON.parse(String(raw)) as Record<string, unknown>[]) : null;
      pages = (list ?? [{ locale: form.get("locale"), fileName: form.get("fileName"), periodLabel: form.get("periodLabel"), branchLabel: form.get("branchLabel") }])
        .slice(0, 4)
        .map((p) => ({
          locale: p.locale === "ur" ? "ur" : "en",
          fileName: safeName(p.fileName),
          periodLabel: oneLine(p.periodLabel, 200),
          branchLabel: oneLine(p.branchLabel, 200) || undefined,
        }));
    } catch {
      return NextResponse.json({ error: "Bad pages", code: "bad_request" }, { status: 400 });
    }
    const files = form.getAll("pdf");
    if (files.length === 0 || files.length !== pages.length || !files.every((f) => f instanceof Blob && f.size > 0)) {
      return NextResponse.json({ error: "PDF missing", code: "bad_request" }, { status: 400 });
    }
    if ((files as Blob[]).reduce((n, f) => n + f.size, 0) > EMAIL_PDF_MAX_BYTES) {
      return NextResponse.json({ error: "PDF too big", code: "too_big" }, { status: 413 });
    }
    const contents = await Promise.all((files as Blob[]).map(async (f) => Buffer.from(await f.arrayBuffer())));
    if (contents.some((c) => c.subarray(0, 5).toString("latin1") !== "%PDF-")) {
      return NextResponse.json({ error: "Not a PDF", code: "bad_request" }, { status: 400 });
    }
    const settings = await readShopSettings(db);
    const shopName = settings.shopName || serverT("en")("brand");
    const mail = reportEmailContent({ shopName, pages });
    const fileName = pages.map((p) => p.fileName).join(", ");

    // Staff see where it went, not the owner's full addresses.
    const shown = (to: string[]) => (gate.role === "owner" ? to : to.map((e) => e.replace(/^(.{2})[^@]*/, "$1***")));
    const outboxId = clean(form.get("outboxId"), 60);
    const logRef = /^rep_[a-z0-9_]{6,50}$/.test(outboxId)
      ? db.collection(REPORT_EMAIL_LOG_COLLECTION).doc(`manual_${outboxId}`)
      : db.collection(REPORT_EMAIL_LOG_COLLECTION).doc();
    const at = new Date().toISOString();
    const queued = {
      ...(form.get("queuedAt") ? { queuedAt: clean(form.get("queuedAt"), 40) } : {}),
      ...(form.get("queuedByName") ? { queuedByName: clean(form.get("queuedByName"), 120) } : {}),
    };
    // Already sent (the PC missed the answer) → done; being sent right now → later.
    const claim = await db.runTransaction(async (tx) => {
      const prev = (await tx.get(logRef)).data();
      if (prev?.status === "sent") return { done: (prev.to as string[]) ?? cfg.emails };
      if (prev?.status === "sending" && Date.now() - Date.parse(String(prev.at)) < 5 * 60_000) return { busy: true };
      tx.set(logRef, { kind: "manual", status: "sending", by: gate.uid, byName: gate.name, to: cfg.emails, at, fileName, ...queued });
      return {};
    });
    if ("done" in claim && claim.done) return NextResponse.json({ ok: true, to: shown(claim.done) });
    if ("busy" in claim) return NextResponse.json({ error: "Being sent", code: "in_progress" }, { status: 409 });
    try {
      await sendMail({
        to: cfg.emails,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: pages.map((p, i) => ({ filename: p.fileName, content: contents[i]!, contentType: "application/pdf" })),
        fromName: shopName,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await logRef.set({ status: "failed", error: error.slice(0, 300) }, { merge: true });
      console.error("[owner-report] email", err);
      return NextResponse.json({ error, code: "send_failed" }, { status: 502 });
    }
    await logRef.set({ status: "sent", sentAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true, to: shown(cfg.emails) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
