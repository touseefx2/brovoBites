import { getClientAuth } from "@/lib/firebase/client";
import { inventoryWritesSettled, pingCloud } from "@/lib/firestore";
import { isQueueSyncing, kickSync, refreshQueueSnapshot } from "@/lib/pos-queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** offline: no internet. stock: hand stock changes haven't reached the cloud yet. */
export type LogoutBlock = { kind: "offline" } | { kind: "stock" };

/**
 * Can this PC reach the login service right now? Logging back in needs it.
 * The browser's "online" only means a network cable / Wi-Fi: with the router
 * up and the internet line down it still says online — so ask the sign-in
 * server itself (a token refresh, no Firestore read).
 */
async function loginReachable(timeoutMs = 6000): Promise<boolean> {
  const user = getClientAuth().currentUser;
  if (!user) return true;
  return Promise.race([
    user.getIdToken(true).then(
      () => true,
      () => false,
    ),
    sleep(timeoutMs).then(() => false),
  ]);
}

/**
 * Offline locks logout: logging back in needs the internet. Otherwise logout is
 * always allowed — anything not synced yet (`unsynced`) stays saved on this PC
 * and syncs at the next login here (same cashier or owner), under the name of
 * whoever made it. The dialog warns with the count.
 */
export async function checkLogout(): Promise<{ block: LogoutBlock | null; unsynced: number }> {
  const snap = await refreshQueueSnapshot();
  if (snap.pendingCount > 0) void kickSync({ retryFailed: true });
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { block: { kind: "offline" }, unsynced: snap.pendingCount };
  }
  if (!(await loginReachable())) {
    return { block: { kind: "offline" }, unsynced: snap.pendingCount };
  }
  return { block: null, unsynced: snap.pendingCount };
}

/**
 * Right before signing out (always online — offline locks logout): upload this
 * PC's waiting work while its author is still signed in, so it reaches the
 * cloud under their name and the next login — whoever it is — finds nothing
 * of theirs left. Gives up after `timeoutMs`; whatever is left stays on the
 * PC and uploads at that person's or an owner's next login. Returns how many
 * rows are still waiting.
 */
export async function syncBeforeLogout(timeoutMs = 30_000): Promise<number> {
  if ((await refreshQueueSnapshot()).pendingCount === 0) return 0;
  const deadline = Date.now() + timeoutMs;
  const pass = async () => {
    // Right after the line comes back the SDK still counts as offline for a
    // few seconds and every upload would fail at once: wait until the cloud
    // answers (a small read every ~1.5 s), then upload.
    while (Date.now() < deadline) {
      try {
        await pingCloud();
        break;
      } catch {
        await sleep(1500);
      }
    }
    // A pass already running (timer / online event): let it finish, then run ours.
    while (isQueueSyncing()) await sleep(500);
    await kickSync({ retryFailed: true, retryRefused: true });
  };
  await Promise.race([pass(), sleep(timeoutMs)]);
  return (await refreshQueueSnapshot()).pendingCount;
}

/**
 * Stock changes made by hand (receive, waste, recount, add, delete) and their
 * log lines wait in Firestore's own offline queue. Unlike sales, that queue
 * belongs to the signed-in person: after a logout only their next login would
 * send it. So logout waits until the server has answered every stock write
 * this page made — false (logout stays locked, try again) if it doesn't within
 * `timeoutMs`. (Receive / waste / recount also keep a copy any later login
 * here puts on — see stock-outbox.)
 */
export async function stockChangesUploaded(timeoutMs = 20_000): Promise<boolean> {
  return inventoryWritesSettled(timeoutMs);
}

/**
 * After sign-out, reload into /login: drops any sync pass that is still
 * waiting on the old session (it would otherwise block syncing until a
 * reload). The queue is in IndexedDB — nothing on this PC is lost.
 */
export function reloadToLogin(): void {
  if (typeof window !== "undefined") window.location.replace("/login");
}
