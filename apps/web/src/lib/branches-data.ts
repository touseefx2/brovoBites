const STORAGE_KEY = "bravobites.public-branches.v1";
const LEGACY_SESSION_KEY = "bravobites.public-branches.v1";
const FRESH_MS = 60_000;
/** Server data cache + CDN (src/app/api/public/branches/route.ts) — no Firestore read per visit. */
const BRANCHES_API = "/api/public/branches";

export interface PublicStaff {
  displayName: string;
  phone: string;
  email: string;
}

export interface PublicBranch {
  id: string;
  name: string;
  phone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  staff: PublicStaff[];
}

export interface BranchesSnapshot {
  branches: PublicBranch[];
  fetchedAt: number;
}

let memory: BranchesSnapshot | null = null;
let inflight: Promise<BranchesSnapshot> | null = null;

function parseSnap(raw: string | null): BranchesSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BranchesSnapshot;
    if (!parsed || !Array.isArray(parsed.branches) || typeof parsed.fetchedAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readStorage(): BranchesSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const fromLocal = parseSnap(localStorage.getItem(STORAGE_KEY));
    if (fromLocal) return fromLocal;
    const legacy = parseSnap(sessionStorage.getItem(LEGACY_SESSION_KEY));
    if (legacy) {
      writeStorage(legacy);
      try {
        sessionStorage.removeItem(LEGACY_SESSION_KEY);
      } catch {
        // ignore
      }
      return legacy;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeStorage(snap: BranchesSnapshot) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    // ignore
  }
}

export function peekBranches(): BranchesSnapshot | null {
  if (memory) return memory;
  const fromDisk = readStorage();
  if (fromDisk) {
    memory = fromDisk;
    return fromDisk;
  }
  return null;
}

/**
 * Seed with the branches rendered into "/" (src/app/page.tsx), so the landing
 * paints them without waiting on /api/public/branches. Memory only — a later
 * fetch is what gets stored. While this server read is under a minute old the
 * landing's forced refetch is skipped (see loadBranches). Same data on the
 * server render and the hydrating client render.
 */
export function primeBranches(snap: BranchesSnapshot | null) {
  // Exactly this render's server data (null too), on both sides.
  primed = snap;
  if (!snap) return;
  // Server: always the latest render's data (public, same for everyone).
  // Browser: only on first load — after that memory holds a real fetch.
  if (typeof window !== "undefined" && memory) return;
  memory = snap;
}

let primed: BranchesSnapshot | null = null;

/**
 * The server-rendered branches, if "/" had them — never localStorage, so it is
 * safe in a useState initializer (server HTML === first client render).
 */
export function peekServerBranches(): BranchesSnapshot | null {
  return primed;
}

function isFresh(snap: BranchesSnapshot | null): boolean {
  if (!snap) return false;
  // A server-primed time comes from the server's clock: a phone clock far
  // behind it (negative age) counts as stale rather than fresh forever.
  const age = Date.now() - snap.fetchedAt;
  return age > -FRESH_MS && age < FRESH_MS;
}

/**
 * `force` skips the freshness check — except for branches the server rendered
 * into this page less than a minute ago (nothing newer to fetch yet).
 */
export async function loadBranches(options?: { force?: boolean }): Promise<BranchesSnapshot> {
  const force = options?.force === true;
  const cached = peekBranches();

  if (cached && isFresh(cached) && (!force || cached === primed)) {
    return cached;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    // Below the fold and already painted from cache / the server: never
    // compete with the first screen's requests.
    const res = await fetch(BRANCHES_API, cached ? { priority: "low" } : {});
    if (!res.ok) throw new Error(`Branches request failed (${res.status})`);
    const data = (await res.json()) as Partial<BranchesSnapshot> | null;
    const snap: BranchesSnapshot = {
      branches: Array.isArray(data?.branches) ? data.branches : [],
      fetchedAt: Date.now(),
    };
    memory = snap;
    writeStorage(snap);
    return snap;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
