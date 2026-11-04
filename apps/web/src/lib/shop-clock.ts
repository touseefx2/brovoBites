/**
 * Shop time for the POS: the PC clock, corrected by the app server
 * (/api/health) whenever it could be checked in this app run.
 *
 * Offline sales are stamped with this time plus a ClockStamp saying how far it
 * can be trusted; sync then fixes the stamp once the server time is known
 * (resolveSaleTime). A PC clock that is provably far behind blocks new sales.
 */

let offsetMs = 0;
let syncPromise: Promise<void> | null = null;
/** True once /api/health answered in this app run (offset is real). */
let measured = false;

/** PC clock this far off server time counts as wrong (warn the counter). */
const WRONG_CLOCK_MS = 2 * 60 * 1000;
/**
 * Offline and the PC clock is this far behind a server time it already saw
 * (dead CMOS battery after a power cut): sales would land on a wrong day, so
 * checkout stops until the clock is set. Smaller drift only warns.
 */
const BLOCK_CLOCK_MS = 10 * 60 * 1000;
/** A clock check gives up after this — the offset only needs a quick reply. */
const CLOCK_CHECK_TIMEOUT_MS = 10_000;
const listeners = new Set<() => void>();

/** Called after every clock check, so the POS warning updates at once. */
export function subscribeShopClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Latest server time ever seen on this PC — survives restarts. */
const LAST_SERVER_KEY = "bravobites.shopClock.lastServerMs";

function readLastServerMs(): number {
  try {
    return Number(localStorage.getItem(LAST_SERVER_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** How far the PC clock is provably behind (0 = not known to be behind). */
function provablyBehindMs(): number {
  const last = readLastServerMs();
  return last > 0 ? Math.max(0, last - Date.now()) : 0;
}

/**
 * Is the PC clock wrong? Online: measured offset vs server. Offline: the PC
 * clock is behind a server time this PC has already seen (e.g. dead CMOS
 * battery reset the date). A clock that is wrong but ahead can't be told
 * offline — sync clamps such sales (resolveSaleTime).
 */
export function isPcClockWrong(): boolean {
  dropOffsetIfPcClockChanged();
  if (measured) return Math.abs(offsetMs) > WRONG_CLOCK_MS;
  return provablyBehindMs() > WRONG_CLOCK_MS;
}

/**
 * New sales / expenses must wait: no server check this run and the PC clock
 * is far behind a server time already seen. Never true when the offset is
 * measured — then shop time is corrected anyway.
 */
export function pcClockBlocksSales(): boolean {
  dropOffsetIfPcClockChanged();
  return !measured && provablyBehindMs() > BLOCK_CLOCK_MS;
}

export class PcClockWrongError extends Error {
  constructor() {
    super("PC date/time is wrong — set it before saving sales");
    this.name = "PcClockWrongError";
  }
}

export function assertPcClockUsable(): void {
  if (pcClockBlocksSales()) throw new PcClockWrongError();
}

/** PC clock reading minus monotonic time — moves only when the clock is set. */
let clockBase = NaN;
const CLOCK_JUMP_MS = 30 * 1000;
/** Bumped on every PC clock change seen while the app runs. */
let clockEpoch = 0;
/** This app run. Stamps from another run can't be corrected later. */
const RUN_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

/** True when the PC clock was changed (or the PC slept) since the last look. */
function noteClockJump(): boolean {
  if (typeof performance === "undefined") return false;
  const base = Date.now() - performance.now();
  const jumped =
    Number.isFinite(clockBase) && Math.abs(base - clockBase) > CLOCK_JUMP_MS;
  clockBase = base;
  if (jumped) clockEpoch++;
  return jumped;
}

/**
 * Counter fixed the PC clock (as the warning asks) or the PC woke from sleep:
 * the measured offset no longer fits this clock, so applying it would push the
 * time wrong the other way. Fall back to the PC clock and re-check the server.
 */
function dropOffsetIfPcClockChanged(): void {
  if (!noteClockJump() || !measured) return;
  offsetMs = 0;
  measured = false;
  void syncShopClock();
}

export function shopNow(): Date {
  dropOffsetIfPcClockChanged();
  return new Date(Date.now() + offsetMs);
}

export function shopNowIso(): string {
  return shopNow().toISOString();
}

export function getShopClockOffsetMs(): number {
  return offsetMs;
}

/** The server clock was reached this run (so the PC clock's error is known). */
export function isShopClockMeasured(): boolean {
  return measured;
}

/** Saved with an offline sale: the raw PC time and whether it was server-checked. */
export interface ClockStamp {
  deviceMs: number;
  verified: boolean;
  runId: string;
  epoch: number;
}

/**
 * Where a synced sale's time came from — server: checked at sale; corrected:
 * PC time fixed by a later server check (same run, clock untouched); clamped:
 * PC clock was ahead, so set to sync time; device: PC clock only.
 */
export type SaleTimeSource = "server" | "corrected" | "clamped" | "device";

/** Shop time for a new sale, plus the stamp sync needs to fix it later. */
export function takeClockStamp(): { at: Date; stamp: ClockStamp } {
  dropOffsetIfPcClockChanged();
  const deviceMs = Date.now();
  return {
    at: new Date(deviceMs + offsetMs),
    stamp: { deviceMs, verified: measured, runId: RUN_ID, epoch: clockEpoch },
  };
}

/** Check the server once this run if not done yet. Sync calls it first. */
export async function ensureShopClock(): Promise<void> {
  dropOffsetIfPcClockChanged();
  if (!measured) await syncShopClock();
}

/**
 * Sale time to write to the cloud (call after ensureShopClock). A sale made
 * before the server could be checked gets PC time + the offset measured now —
 * exact while it is the same app run and the PC clock wasn't changed since.
 * A sale time in the future is impossible: clamped to now. Otherwise the PC
 * time is all there is (old rows have no stamp → source unknown).
 */
export function resolveSaleTime(
  savedAt: string,
  stamp: ClockStamp | undefined,
): { at: string; source?: SaleTimeSource } {
  dropOffsetIfPcClockChanged();
  let at = savedAt;
  let source: SaleTimeSource | undefined = stamp
    ? stamp.verified
      ? "server"
      : "device"
    : undefined;
  if (
    measured &&
    source === "device" &&
    stamp &&
    stamp.runId === RUN_ID &&
    stamp.epoch === clockEpoch
  ) {
    at = new Date(stamp.deviceMs + offsetMs).toISOString();
    source = "corrected";
  }
  const nowMs = Date.now() + offsetMs;
  if (measured && Date.parse(at) > nowMs + WRONG_CLOCK_MS) {
    at = new Date(nowMs).toISOString();
    source = "clamped";
  }
  return { at, source };
}

export async function syncShopClock(): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      if (noteClockJump()) {
        offsetMs = 0;
        measured = false;
      }
      const before = Date.now();
      // Unique URL: the PWA service worker caches /api/* — offline it would
      // replay an old {time} and make a correct PC clock look wrong.
      // Bounded (body too): every caller shares this promise, and the queue
      // sync waits on it — a reply that never comes must not freeze them all.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CLOCK_CHECK_TIMEOUT_MS);
      let after: number;
      let json: { time?: string };
      try {
        const res = await fetch(`/api/health?t=${before}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        after = Date.now();
        if (!res.ok) return;
        json = (await res.json()) as { time?: string };
      } finally {
        clearTimeout(timer);
      }
      const serverMs = Date.parse(String(json.time ?? ""));
      if (!Number.isFinite(serverMs)) return;
      // Clock changed while the request was out — before/after don't match.
      if (noteClockJump()) {
        offsetMs = 0;
        measured = false;
        return;
      }
      const mid = (before + after) / 2;
      offsetMs = serverMs - mid;
      measured = true;
      try {
        localStorage.setItem(
          LAST_SERVER_KEY,
          String(Math.max(readLastServerMs(), serverMs)),
        );
      } catch {
        // private mode / quota
      }
    } catch {
      // Keep previous offset (or 0) — offline: last offset still applies.
    } finally {
      syncPromise = null;
      for (const l of listeners) {
        try { l(); } catch { /* listener error */ }
      }
    }
  })();
  return syncPromise;
}
