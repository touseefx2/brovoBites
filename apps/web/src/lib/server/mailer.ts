import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

/**
 * Sends the owner report by email through a Gmail account (SMTP with an
 * "app password"): SMTP_USER + SMTP_PASS in the server env. Free, and it can
 * write to any address (Gmail allows ~500 emails a day).
 *
 * Tests: REPORT_EMAIL_OUTBOX=<folder> writes each email there instead.
 */

export type MailAttachment = { filename: string; content: Buffer; contentType: string };

export type Mail = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
  /** Shown as the sender's name ("Brovo Bites <shop@gmail.com>"). */
  fromName: string;
};

export function mailerReady(): boolean {
  return Boolean(process.env.REPORT_EMAIL_OUTBOX || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

export class MailerNotConfiguredError extends Error {
  constructor() {
    super("Email is not set up on the server (SMTP_USER / SMTP_PASS)");
    this.name = "MailerNotConfiguredError";
  }
}

/** Emails from the dev Firebase project (brovodev) are marked DEV; live ones are untouched. */
function isDevProject(): boolean {
  const project = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
  return project.endsWith("dev");
}

export async function sendMail(mail: Mail): Promise<void> {
  const outbox = process.env.REPORT_EMAIL_OUTBOX;
  if (outbox) {
    await mkdir(outbox, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    for (const a of mail.attachments) await writeFile(path.join(outbox, `${stamp}-${a.filename}`), a.content);
    await writeFile(
      path.join(outbox, `${stamp}.json`),
      JSON.stringify(
        { ...mail, attachments: mail.attachments.map((a) => ({ filename: a.filename, size: a.content.length, file: `${stamp}-${a.filename}` })) },
        null,
        2,
      ),
    );
    return;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new MailerNotConfiguredError();
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass: pass.replace(/\s+/g, "") },
  });
  const name = mail.fromName.replace(/[\r\n<>"]/g, " ").trim() || "Owner report";
  const dev = isDevProject();
  await transport.sendMail({
    from: { name: dev ? `DEV · ${name}` : name, address: user },
    to: mail.to,
    subject: dev ? `[DEV] ${mail.subject}` : mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Gmail turns addresses / numbers into links ("F-13, Golra" → Maps). An
 * invisible zero-width non-joiner after each digit and comma stops it.
 */
function noAutoLink(s: string): string {
  return escapeHtml(s).replace(/([0-9,])/g, "$1&zwnj;");
}

/** One language's lines of the email. */
export type ReportEmailPart = {
  dir: "ltr" | "rtl";
  title: string;
  branchLabel?: string;
  periodLabel: string;
  /** One extra sentence (an updated report, a day with no data yet). */
  note?: string;
  /** "Attached: 2 PDFs — English and Urdu." in this language. */
  attached?: string;
};

/**
 * The email itself says only which report it is — shop, then per language
 * (English, then Urdu, right to left): "Owner report", branch, period, a
 * one-line note when needed. The report is in the PDFs.
 */
export function reportEmailBody(o: { shopName: string; parts: ReportEmailPart[] }): { text: string; html: string } {
  const text = [
    o.shopName.toUpperCase(),
    ...o.parts.map((p) => [p.title, p.branchLabel, p.periodLabel, p.note && `\n${p.note}`, p.attached && `\n${p.attached}`].filter(Boolean).join("\n")),
  ].join("\n\n");
  const line = (body: string, style = "") => `<div style="${style}">${body}</div>`;
  const parts = o.parts
    .map(
      (p, i) => `<div dir="${p.dir}" style="text-align:${p.dir === "rtl" ? "right" : "left"};${i > 0 ? "margin-top:14px;padding-top:14px;border-top:1px solid #f0dcc6;" : ""}">
${line(escapeHtml(p.title), "font-weight:700")}
${p.branchLabel ? line(noAutoLink(p.branchLabel)) : ""}
${line(noAutoLink(p.periodLabel), "font-style:italic")}
${p.note ? line(escapeHtml(p.note), "margin-top:8px;color:#92400e") : ""}
${p.attached ? line(escapeHtml(p.attached), "margin-top:8px;color:#7a5a4c;font-size:13px") : ""}
</div>`,
    )
    .join("\n");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="format-detection" content="telephone=no,address=no,email=no,date=no"></head>
<body style="margin:0;padding:16px;background:#fff4e8">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7d0b8;border-radius:12px;padding:18px 20px;font-family:Segoe UI,Roboto,Arial,'Noto Naskh Arabic',sans-serif;font-size:15px;line-height:1.6;color:#2a140e">
${line(escapeHtml(o.shopName.toUpperCase()), "font-weight:700;margin-bottom:10px")}
${parts}
</div></body></html>`;
  return { text, html };
}
