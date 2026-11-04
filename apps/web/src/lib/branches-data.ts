const STORAGE_KEY = "bravobites.public-branches.v1";
const LEGACY_SESSION_KEY = "bravobites.public-branches.v1";
const FRESH_MS = 60_000;

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

interface BranchesSnapshot {
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

function isFresh(snap: BranchesSnapshot | null): boolean {
  if (!snap) return false;
  return Date.now() - snap.fetchedAt < FRESH_MS;
}

export async function loadBranches(options?: { force?: boolean }): Promise<BranchesSnapshot> {
  const force = options?.force === true;
  const cached = peekBranches();

  if (!force && isFresh(cached) && cached) {
    return cached;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch("/api/public/branches-staff");
    const data = await res.json();
    const snap: BranchesSnapshot = {
      branches: Array.isArray(data.branches) ? data.branches : [],
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
