import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Locale } from "@/i18n/dictionaries";
import { getClientAuth } from "@/lib/firebase/client";
import { apiFetch } from "@/lib/http";

/**
 * "Email report" that works without internet: the report PDFs are kept on this
 * PC and emailed as soon as the internet is back (online event, a minute
 * timer, the next app start — whoever is signed in then). Each email has an
 * id the server remembers, so a retry after a lost answer never sends it twice.
 */

/** The report in one language: its PDF and the email's labels for it. */
export type OutboxPage = {
  locale: Locale;
  fileName: string;
  pdf: Blob;
  branchLabel?: string;
  periodLabel: string;
};

export type OutboxEmail = {
  id: string;
  queuedAt: number;
  queuedByName: string;
  /** One per language (English, Urdu). */
  pages: OutboxPage[];
  attempts: number;
  /** Not before this time (backs off while the server keeps saying no). */
  nextAt: number;
  lastCode?: string;
  lastError?: string;
};

/** Queued by an older app (one PDF in one language) — still sent. */
type LegacyOutboxEmail = Omit<OutboxEmail, "pages"> & {
  pages?: undefined;
  fileName: string;
  pdf: Blob;
  locale: Locale;
  branchLabel?: string;
  periodLabel: string;
};

function pagesOf(item: OutboxEmail | LegacyOutboxEmail): OutboxPage[] {
  if (item.pages) return item.pages;
  const { locale, fileName, pdf, branchLabel, periodLabel } = item;
  return [{ locale, fileName, pdf, branchLabel, periodLabel }];
}

export type SendResult =
  | { ok: true; to: string[] }
  | {
      ok: false;
      /** Server's reason (no_recipients, not_configured, …) or "network". */
      code: string;
      error: string;
      /** Worth trying again later (no internet, server down, not set up yet). */
      retry: boolean;
    };

interface OutboxDb extends DBSchema {
  emails: { key: string; value: OutboxEmail | LegacyOutboxEmail };
}

let dbPromise: Promise<IDBPDatabase<OutboxDb>> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OutboxDb>("bravobites-report-outbox", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("emails")) db.createObjectStore("emails", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

const listeners = new Set<(n: number) => void>();
async function emit() {
  const n = await countReportOutbox().catch(() => 0);
  for (const l of listeners) l(n);
}

/** How many report emails wait on this PC. Calls back now and on every change. */
export function subscribeReportOutbox(listener: (n: number) => void): () => void {
  listeners.add(listener);
  void countReportOutbox().then(listener, () => listener(0));
  return () => {
    listeners.delete(listener);
  };
}

export async function countReportOutbox(): Promise<number> {
  return (await getDb()).count("emails");
}

export async function queueReportEmail(
  item: Omit<OutboxEmail, "id" | "queuedAt" | "attempts" | "nextAt">,
): Promise<string> {
  const id = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await (await getDb()).put("emails", { ...item, id, queuedAt: Date.now(), attempts: 0, nextAt: 0 });
  void emit();
  return id;
}

export async function dropReportEmail(id: string): Promise<void> {
  await (await getDb()).delete("emails", id);
  void emit();
}

/** Posts one queued email. Network trouble / server down → retry later. */
async function post(item: OutboxEmail | LegacyOutboxEmail): Promise<SendResult> {
  try {
    const token = await getClientAuth().currentUser?.getIdToken();
    if (!token) return { ok: false, code: "signed_out", error: "Not signed in", retry: true };
    const form = new FormData();
    const pages = pagesOf(item);
    for (const p of pages) form.append("pdf", new File([p.pdf], p.fileName, { type: "application/pdf" }));
    form.append(
      "pages",
      JSON.stringify(pages.map((p) => ({ locale: p.locale, fileName: p.fileName, periodLabel: p.periodLabel, branchLabel: p.branchLabel }))),
    );
    form.append("outboxId", item.id);
    form.append("queuedAt", new Date(item.queuedAt).toISOString());
    form.append("queuedByName", item.queuedByName);
    const res = await apiFetch(
      "/api/admin/owner-report/email",
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
      { timeoutMs: 60_000 },
    );
    const data = (await res.json().catch(() => ({}))) as { to?: string[]; code?: string; error?: string };
    if (res.ok) return { ok: true, to: data.to ?? [] };
    const code = data.code ?? `http_${res.status}`;
    // A broken request or a PDF too big never gets better; anything else may.
    const retry = !(code === "bad_request" || code === "too_big");
    return { ok: false, code, error: data.error ?? res.statusText, retry };
  } catch (err) {
    return { ok: false, code: "network", error: err instanceof Error ? err.message : String(err), retry: true };
  }
}

async function settle(item: OutboxEmail | LegacyOutboxEmail, result: SendResult): Promise<void> {
  const db = await getDb();
  if (result.ok || !result.retry) {
    await db.delete("emails", item.id);
  } else {
    const attempts = item.attempts + 1;
    // No internet: try again soon. The server said no: back off up to an hour.
    const wait = result.code === "network" || result.code === "signed_out" ? 30_000 : Math.min(60, 2 ** attempts) * 60_000;
    await db.put("emails", { ...item, attempts, nextAt: Date.now() + wait, lastCode: result.code, lastError: result.error });
  }
  void emit();
}

/** One send at a time in this browser (POS and admin tabs share the outbox). */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks ? (locks.request("bravobites-report-outbox", fn) as Promise<T>) : fn();
}

/** Sends one queued email now (the "Email report" press) and tells how it went. */
export async function sendQueuedReportEmail(id: string): Promise<SendResult> {
  return withLock(async () => {
    const item = await (await getDb()).get("emails", id);
    if (!item) return { ok: true, to: [] }; // another tab just sent it
    const result = await post(item);
    await settle(item, result);
    return result;
  });
}

let flushing = false;

/** Sends every waiting email that's due (oldest first). Quiet: for the background. */
export async function flushReportOutbox(): Promise<void> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return;
  if (!getClientAuth().currentUser) return;
  flushing = true;
  try {
    await withLock(async () => {
      const db = await getDb();
      const due = (await db.getAll("emails")).filter((e) => e.nextAt <= Date.now()).sort((a, b) => a.queuedAt - b.queuedAt);
      for (const item of due) {
        const result = await post(item);
        await settle(item, result);
        if (!result.ok && result.code === "network") break; // still no internet
      }
    });
  } catch (err) {
    console.error("[report-outbox] flush", err);
  } finally {
    flushing = false;
  }
}

let stop: (() => void) | null = null;

/** While someone is signed in: send waiting emails now, when online, each minute. */
export function startReportOutbox(): void {
  if (stop || typeof window === "undefined") return;
  const onOnline = () => void flushReportOutbox();
  window.addEventListener("online", onOnline);
  const timer = setInterval(onOnline, 60_000);
  stop = () => {
    window.removeEventListener("online", onOnline);
    clearInterval(timer);
  };
  void flushReportOutbox();
}

export function stopReportOutbox(): void {
  stop?.();
  stop = null;
}
