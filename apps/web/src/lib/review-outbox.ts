import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AppUser } from "@bravobites/domain";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { getClientAuth, getClientDb } from "@/lib/firebase/client";
import { subscribeQueue } from "@/lib/pos-queue";

/**
 * WhatsApp review sends. Opening WhatsApp tells us nothing back, so the press
 * only opens an "asked" row — the order's count goes up when staff answer
 * "yes, sent". Both survive a reload on this PC. A "yes" is counted on the
 * order even without internet or before an offline sale has synced (online
 * event, a 30s timer, the next app start). Each send carries its own id and
 * the order keeps the last one counted, so a lost reply, a retry or a reload
 * between the write and the local delete never counts one send twice.
 */

/** email: missing on rows saved before it was kept. */
type Sender = { uid: string; name: string; email?: string };

export type ReviewSend = Sender & {
  id: string;
  orderId: string;
  queuedAt: number;
  attempts: number;
  /** Not before this time (backs off while the server keeps saying no). */
  nextAt: number;
  lastCode?: string;
};

/** WhatsApp opened for this order; waiting for "sent?" yes / no. */
export type ReviewAsk = Sender & { orderId: string; at: number };

/** Order deleted / never synced / rules never allow it — stop after a week. */
const GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
/** Nobody answered within a day: nothing was counted, drop the question. */
const ASK_TTL_MS = 24 * 60 * 60 * 1000;

interface OutboxDb extends DBSchema {
  sends: { key: string; value: ReviewSend };
  asks: { key: string; value: ReviewAsk };
}

let dbPromise: Promise<IDBPDatabase<OutboxDb>> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OutboxDb>("bravobites-review-outbox", 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("sends")) db.createObjectStore("sends", { keyPath: "id" });
        if (!db.objectStoreNames.contains("asks")) db.createObjectStore("asks", { keyPath: "orderId" });
      },
    });
  }
  return dbPromise;
}

export type ReviewOutboxState = {
  /** Order id → "yes" answers still waiting to be counted on it. */
  pending: ReadonlyMap<string, number>;
  /** Orders whose "sent?" question is open. */
  asks: ReadonlyMap<string, ReviewAsk>;
};

let state: ReviewOutboxState = { pending: new Map(), asks: new Map() };
const listeners = new Set<(s: ReviewOutboxState) => void>();

// POS and admin tabs share the outbox: a change in one refreshes the others.
const channel =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("bravobites-review-outbox")
    : null;
channel?.addEventListener("message", () => void load());

async function load() {
  const db = await getDb().catch(() => null);
  if (!db) return; // no IndexedDB (private mode): nothing kept on this PC
  const [sends, asks] = await Promise.all([db.getAll("sends"), db.getAll("asks")]).catch(
    () => [[], []] as [ReviewSend[], ReviewAsk[]],
  );
  const pending = new Map<string, number>();
  for (const s of sends) pending.set(s.orderId, (pending.get(s.orderId) ?? 0) + 1);
  const open = new Map<string, ReviewAsk>();
  for (const a of asks) {
    if (Date.now() - a.at > ASK_TTL_MS) void db.delete("asks", a.orderId).catch(() => {});
    else open.set(a.orderId, a);
  }
  state = { pending, asks: open };
  for (const l of listeners) l(state);
}

async function changed() {
  await load();
  channel?.postMessage("changed");
}

/** Waiting counts and open questions. Calls back now and on every change. */
export function subscribeReviewOutbox(listener: (s: ReviewOutboxState) => void): () => void {
  if (listeners.size === 0) void load();
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

/** WhatsApp was opened for this order — ask "sent?" until someone answers. */
export async function askReviewSent(orderId: string, user: AppUser): Promise<void> {
  await (await getDb()).put("asks", {
    orderId,
    uid: user.uid,
    name: user.displayName || user.email,
    email: user.email,
    at: Date.now(),
  });
  await changed();
}

/**
 * "Yes" counts one send in the name of whoever answers (they confirm it went);
 * "no" counts nothing. False when another tab already answered.
 */
export async function answerReviewAsk(
  orderId: string,
  sent: boolean,
  user: AppUser,
): Promise<boolean> {
  const db = await getDb();
  // Check and answer in one transaction: two tabs can't both turn it into a send.
  const tx = db.transaction(["asks", "sends"], "readwrite");
  const asks = tx.objectStore("asks");
  if (!(await asks.get(orderId))) {
    await tx.done;
    await load();
    return false;
  }
  await asks.delete(orderId);
  if (sent) {
    await tx.objectStore("sends").put({
      id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      orderId,
      uid: user.uid,
      name: user.displayName || user.email,
      email: user.email,
      queuedAt: Date.now(),
      attempts: 0,
      nextAt: 0,
    });
  }
  await tx.done;
  await changed();
  if (sent) void flushReviewOutbox();
  return true;
}

type WriteResult = "ok" | "not_synced" | "retry";

/**
 * One send → the order's count +1 (the rules allow exactly one per write).
 * Rules: stamped with the signed-in uid; the name stays the sender's, so a
 * cashier's send still counts if someone else is signed in when it uploads.
 */
async function write(item: ReviewSend, uploaderUid: string): Promise<{ result: WriteResult; code?: string }> {
  try {
    const ref = doc(getClientDb(), "orders", item.orderId);
    const found = await runTransaction(getClientDb(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      // Already counted (reply lost, or reload before the local delete).
      if (snap.data().reviewLastSendId === item.id) return true;
      tx.update(ref, {
        reviewSentCount: Number(snap.data().reviewSentCount ?? 0) + 1,
        reviewSentAtServer: serverTimestamp(),
        reviewSentBy: uploaderUid,
        reviewSentByName: item.name,
        reviewSentByEmail: item.email ?? "",
        reviewLastSendId: item.id,
      });
      return true;
    });
    return { result: found ? "ok" : "not_synced", code: found ? undefined : "not_synced" };
  } catch (err) {
    return { result: "retry", code: (err as { code?: string }).code ?? "unknown" };
  }
}

async function settle(item: ReviewSend, result: WriteResult, code?: string): Promise<void> {
  const db = await getDb();
  if (result === "ok" || Date.now() - item.queuedAt > GIVE_UP_MS) {
    await db.delete("sends", item.id);
  } else {
    const attempts = item.attempts + 1;
    // Offline: soon. Sale not synced yet: every 30s for 5 min, then slowing
    // to 30 min (a deleted order costs a read each try) — the sale's own sync
    // also wakes it (startReviewOutbox). The server said no: up to an hour.
    const wait =
      code === "unavailable" || code === "failed-precondition"
        ? 30_000
        : result === "not_synced"
          ? attempts <= 10
            ? 30_000
            : Math.min(30 * 60_000, 30_000 * 2 ** Math.min(attempts - 10, 6))
          : Math.min(60, 2 ** attempts) * 60_000;
    await db.put("sends", { ...item, attempts, nextAt: Date.now() + wait, lastCode: code });
  }
}

/** One flush at a time in this browser (POS and admin tabs share the outbox). */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks ? (locks.request("bravobites-review-outbox", fn) as Promise<T>) : fn();
}

let flushing = false;
let again = false;
let againSaleSynced = false;

/**
 * Counts every waiting send that's due (oldest first). Quiet: for the
 * background. `saleSynced`: a sale just reached the cloud — sends still
 * waiting for their order go now, whatever their back-off.
 */
export async function flushReviewOutbox(saleSynced = false): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) return;
  // A "yes" during a flush is picked up right after it, not 30s later.
  if (flushing) {
    again = true;
    againSaleSynced ||= saleSynced;
    return;
  }
  const signedIn = getClientAuth().currentUser;
  if (!signedIn) return;
  flushing = true;
  let wrote = false;
  try {
    await withLock(async () => {
      const db = await getDb();
      const due = (await db.getAll("sends"))
        .filter((s) => s.nextAt <= Date.now() || (saleSynced && s.lastCode === "not_synced"))
        .sort((a, b) => a.queuedAt - b.queuedAt);
      for (const item of due) {
        const { result, code } = await write(item, signedIn.uid);
        await settle(item, result, code);
        wrote = true;
        if (code === "unavailable") break; // still no internet
      }
    });
  } catch (err) {
    console.error("[review-outbox] flush", err);
  } finally {
    flushing = false;
    if (wrote) void changed();
    if (again) {
      const force = againSaleSynced;
      again = false;
      againSaleSynced = false;
      void flushReviewOutbox(force);
    }
  }
}

let stop: (() => void) | null = null;

/** While someone is signed in: count waiting sends now, when online, every 30s. */
export function startReviewOutbox(): void {
  if (stop || typeof window === "undefined") return;
  const onOnline = () => void flushReviewOutbox();
  window.addEventListener("online", onOnline);
  const timer = setInterval(onOnline, 30_000);
  // A sale (or its edit) reached the cloud: a send waiting for it can go now.
  let waitingSales = 0;
  const unsubQueue = subscribeQueue((snap) => {
    if (snap.pendingCount < waitingSales) void flushReviewOutbox(true);
    waitingSales = snap.pendingCount;
  });
  stop = () => {
    window.removeEventListener("online", onOnline);
    clearInterval(timer);
    unsubQueue();
  };
  void flushReviewOutbox();
}

export function stopReviewOutbox(): void {
  stop?.();
  stop = null;
}
