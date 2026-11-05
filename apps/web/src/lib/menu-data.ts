import {
  DEFAULT_BRANCH_ID,
  DEFAULT_SETTINGS,
  type Category,
  type Product,
  type ShopSettings,
} from "@bravobites/domain";
import { apiFetch } from "@/lib/http";

/**
 * The public menu (settings + active categories + active products).
 *
 * Read from GET /api/public/menu (server Admin SDK, CDN-cached ~60s) — never
 * the Firestore web SDK on first load, so the public website ships without it.
 * "/" also renders it into the HTML (src/app/page.tsx). The web SDK is only
 * loaded as a fallback when that endpoint fails (e.g. server credentials
 * missing), see fetchViaFirestore().
 */
export type PublicMenuSnapshot = {
  branchId: string;
  settings: ShopSettings;
  categories: Category[];
  products: Product[];
  /** When this browser last got it (freshness window for refetches). */
  fetchedAt: number;
  /**
   * When the server read it from Firestore. A CDN copy can be older than what
   * this browser already shows (right after an admin edit): the older one never
   * replaces the newer. Missing in caches written before this field existed.
   */
  serverAt?: number;
};

export const PUBLIC_MENU_API = "/api/public/menu";

const STORAGE_KEY = "bravobites.public-menu.v1";
/** @deprecated migrated to localStorage — read once for upgrades */
const LEGACY_SESSION_KEY = "bravobites.public-menu.v1";
/**
 * Soft “fresh enough” window for opportunistic skips (focus / provider boot).
 * Screen visits always soft-revalidate via loadPublicMenu({ force: true }).
 */
export const MENU_FRESH_MS = 45_000;

let memory: PublicMenuSnapshot | null = null;
let inflight: Promise<PublicMenuSnapshot> | null = null;
/** Bumped on invalidate so in-flight fetches never write stale results. */
let cacheEpoch = 0;

function readStorage(): PublicMenuSnapshot | null {
  if (typeof window === "undefined") return null;
  const parse = (raw: string | null): PublicMenuSnapshot | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PublicMenuSnapshot;
      if (
        !parsed ||
        typeof parsed.fetchedAt !== "number" ||
        !Array.isArray(parsed.categories) ||
        !Array.isArray(parsed.products)
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };
  try {
    const fromLocal = parse(localStorage.getItem(STORAGE_KEY));
    if (fromLocal) return fromLocal;
    // One-time migrate from older sessionStorage cache
    const legacy = parse(sessionStorage.getItem(LEGACY_SESSION_KEY));
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
    // private mode / quota
  }
  return null;
}

function writeStorage(snap: PublicMenuSnapshot) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    // quota / private mode — memory cache still works
  }
}

/** Sync peek for instant UI (memory → localStorage). */
export function peekPublicMenu(): PublicMenuSnapshot | null {
  if (memory) return memory;
  const fromDisk = readStorage();
  if (fromDisk) {
    memory = fromDisk;
    return fromDisk;
  }
  return null;
}

export function isMenuFresh(snap: PublicMenuSnapshot | null, now = Date.now()): boolean {
  if (!snap) return false;
  // A server-rendered menu carries the server's clock: a device clock far
  // behind it (negative age) counts as stale rather than fresh forever.
  const age = now - snap.fetchedAt;
  return age > -MENU_FRESH_MS && age < MENU_FRESH_MS;
}

export const MENU_CACHE_EVENT = "bravobites:public-menu-invalidate";

/** localStorage ping so other tabs get a `storage` event (BroadcastChannel backup). */
const MENU_CROSS_TAB_KEY = "bravobites.public-menu.cross-tab";
const MENU_BROADCAST_NAME = "bravobites-public-menu";

/** This tab's last invalidation (the localStorage ping covers other tabs). */
let invalidatedAt = 0;
/**
 * After a menu edit on this browser, reads skip the CDN / server cache
 * (`?fresh=1` + no-store) for this long, so the editor never sees the old menu.
 */
const FRESH_AFTER_EDIT_MS = 5 * 60_000;

function lastInvalidatedAt(): number {
  let at = invalidatedAt;
  if (typeof window === "undefined") return at;
  try {
    at = Math.max(at, Number(localStorage.getItem(MENU_CROSS_TAB_KEY)) || 0);
  } catch {
    // private mode
  }
  return at;
}

/** True when this browser edited the menu recently (see FRESH_AFTER_EDIT_MS). */
export function menuEditedRecently(now = Date.now()): boolean {
  return now - lastInvalidatedAt() < FRESH_AFTER_EDIT_MS;
}

/**
 * Seed the cache with the server-rendered menu (no fetch). Never writes it
 * over a menu the server read later.
 */
export function primePublicMenu(snap: PublicMenuSnapshot) {
  if (isOlderOnServer(snap, peekPublicMenu())) return;
  // Read before the last edit on this browser: show it, but never cache it.
  if ((snap.serverAt ?? 0) < lastInvalidatedAt()) return;
  memory = snap;
  primed = snap;
  writeStorage(snap);
}

/** The server-rendered menu this page started from. */
let primed: PublicMenuSnapshot | null = null;

/**
 * `snap` is the menu the server rendered into this page and still under
 * MENU_FRESH_MS old: the CDN has nothing newer yet, so even a forced refresh
 * (the landing's on-mount one) can skip the request.
 */
export function isFreshServerMenu(snap: PublicMenuSnapshot | null): boolean {
  return snap != null && snap === primed && isMenuFresh(snap) && !menuEditedRecently();
}

/**
 * `a` was read from Firestore before `b`. Both times come from the server's
 * clock (a POS PC clock can be off by hours), so a cache without `serverAt`
 * never counts as newer.
 */
function isOlderOnServer(a: PublicMenuSnapshot, b: PublicMenuSnapshot | null): boolean {
  return a.serverAt != null && b?.serverAt != null && a.serverAt < b.serverAt;
}

export function invalidatePublicMenuCache() {
  memory = null;
  primed = null;
  inflight = null;
  cacheEpoch += 1;
  invalidatedAt = Date.now();
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // ignore
  }
  // Same-tab React providers
  window.dispatchEvent(new Event(MENU_CACHE_EVENT));
  // Cross-tab: BroadcastChannel (primary) + localStorage ping (fallback)
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(MENU_BROADCAST_NAME);
      bc.postMessage({ type: "invalidate", at: Date.now() });
      bc.close();
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(MENU_CROSS_TAB_KEY, String(Date.now()));
  } catch {
    // private mode / quota
  }
}

/**
 * Subscribe to menu cache invalidation (same tab + other tabs).
 * Always call the returned unsubscribe to avoid leaks.
 * Callbacks are coalesced (~80ms) so BC + storage + local event don't triple-fetch.
 */
export function subscribeMenuCacheInvalidation(
  onInvalidate: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onInvalidate();
    }, 80);
  };

  window.addEventListener(MENU_CACHE_EVENT, fire);

  let bc: BroadcastChannel | null = null;
  const onMessage = (ev: MessageEvent) => {
    if (ev?.data?.type === "invalidate") fire();
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(MENU_BROADCAST_NAME);
      bc.addEventListener("message", onMessage);
    }
  } catch {
    bc = null;
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key === MENU_CROSS_TAB_KEY && e.newValue) fire();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    if (timer != null) clearTimeout(timer);
    window.removeEventListener(MENU_CACHE_EVENT, fire);
    window.removeEventListener("storage", onStorage);
    if (bc) {
      try {
        bc.removeEventListener("message", onMessage);
        bc.close();
      } catch {
        // ignore
      }
      bc = null;
    }
  };
}

function isSnapshotLike(data: unknown): data is Omit<PublicMenuSnapshot, "fetchedAt"> {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.categories) &&
    Array.isArray(d.products) &&
    Boolean(d.settings && typeof d.settings === "object")
  );
}

/** The endpoint answered, but not with a menu (server error / misconfigured). */
class MenuApiError extends Error {
  constructor(readonly status: number) {
    super(`Public menu request failed (${status})`);
    this.name = "MenuApiError";
  }
}

async function fetchViaApi(fresh: boolean): Promise<Omit<PublicMenuSnapshot, "fetchedAt">> {
  // `fresh` answers are no-store end to end (server, CDN, browser); one fixed
  // URL keeps the service worker's small "apis" cache from filling with them.
  const url = fresh ? `${PUBLIC_MENU_API}?fresh=1` : PUBLIC_MENU_API;
  const res = await apiFetch(url, fresh ? { cache: "no-store" } : {}, { timeoutMs: 20_000 });
  if (!res.ok) throw new MenuApiError(res.status);
  const data: unknown = await res.json().catch(() => null);
  if (!isSnapshotLike(data)) throw new MenuApiError(res.status);
  return {
    branchId: typeof data.branchId === "string" && data.branchId ? data.branchId : DEFAULT_BRANCH_ID,
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    categories: data.categories,
    products: data.products,
    // Only the server clock may stamp serverAt — never the device clock.
    serverAt: typeof data.serverAt === "number" ? data.serverAt : undefined,
  };
}

/** Fallback only: the Firestore web SDK, loaded on demand (its own chunk). */
async function fetchViaFirestore(): Promise<Omit<PublicMenuSnapshot, "fetchedAt">> {
  const { fetchBranches, fetchCategories, fetchProducts, fetchSettings } = await import(
    "@/lib/firestore"
  );
  const [branchList, settings, categories, products] = await Promise.all([
    fetchBranches(),
    fetchSettings(),
    fetchCategories(),
    fetchProducts(),
  ]);
  return {
    branchId: branchList.find((b) => b.isActive)?.id || DEFAULT_BRANCH_ID,
    settings: settings ?? DEFAULT_SETTINGS,
    categories: categories.filter((c) => c.isActive),
    products: products.filter((p) => p.isActive),
    // Read in the browser: no server time to stamp. Without serverAt this snapshot
    // never outranks a server-read menu (see isOlderOnServer), so a fast device
    // clock cannot freeze it in the cache.
    serverAt: undefined,
  };
}

/**
 * Stale-while-revalidate loader:
 * - dedupes concurrent requests
 * - returns cached immediately via peekPublicMenu() in the UI layer
 * - force=true bypasses freshness short-circuit
 * - fresh=true (or a menu edit on this browser in the last few minutes)
 *   bypasses the CDN / server cache too
 */
export async function loadPublicMenu(options?: {
  force?: boolean;
  fresh?: boolean;
}): Promise<PublicMenuSnapshot> {
  const force = options?.force === true;
  const fresh = options?.fresh === true || menuEditedRecently();
  const cached = peekPublicMenu();

  // `force` skips the freshness check, but not a fresh server-rendered menu.
  if (cached && isMenuFresh(cached) && (!force || (!fresh && isFreshServerMenu(cached)))) {
    return cached;
  }

  if (inflight) return inflight;

  const epoch = cacheEpoch;
  const box: { current: Promise<PublicMenuSnapshot> | null } = { current: null };
  box.current = (async () => {
    let next: Omit<PublicMenuSnapshot, "fetchedAt">;
    try {
      next = await fetchViaApi(fresh);
    } catch (err) {
      // Offline / timeout: nothing else would answer either.
      if (!(err instanceof MenuApiError)) throw err;
      next = await fetchViaFirestore();
    }

    // Invalidated while in flight — drop this request and start a successor.
    if (epoch !== cacheEpoch) {
      if (inflight === box.current) inflight = null;
      return loadPublicMenu({ force: true });
    }

    const now = Date.now();
    const current = peekPublicMenu();
    const incoming: PublicMenuSnapshot = { ...next, fetchedAt: now };
    // An older CDN copy than the menu already shown (edited a moment ago):
    // keep the newer menu, just note that we checked.
    const snap: PublicMenuSnapshot =
      current && isOlderOnServer(incoming, current) ? { ...current, fetchedAt: now }
        : incoming;

    memory = snap;
    writeStorage(snap);
    return snap;
  })().finally(() => {
    if (inflight === box.current) inflight = null;
  });

  inflight = box.current;
  return box.current;
}
