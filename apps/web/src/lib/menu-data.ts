import {
  DEFAULT_BRANCH_ID,
  DEFAULT_SETTINGS,
  type Category,
  type Product,
  type ShopSettings,
} from "@bravobites/domain";
import {
  fetchBranches,
  fetchCategories,
  fetchProducts,
  fetchSettings,
} from "@/lib/firestore";

export type PublicMenuSnapshot = {
  branchId: string;
  settings: ShopSettings;
  categories: Category[];
  products: Product[];
  fetchedAt: number;
};

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
  return now - snap.fetchedAt < MENU_FRESH_MS;
}

export const MENU_CACHE_EVENT = "bravobites:public-menu-invalidate";

/** localStorage ping so other tabs get a `storage` event (BroadcastChannel backup). */
const MENU_CROSS_TAB_KEY = "bravobites.public-menu.cross-tab";
const MENU_BROADCAST_NAME = "bravobites-public-menu";

export function invalidatePublicMenuCache() {
  memory = null;
  inflight = null;
  cacheEpoch += 1;
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

/**
 * Stale-while-revalidate loader:
 * - dedupes concurrent requests
 * - returns cached immediately via peekPublicMenu() in the UI layer
 * - force=true bypasses freshness short-circuit
 */
export async function loadPublicMenu(options?: {
  force?: boolean;
}): Promise<PublicMenuSnapshot> {
  const force = options?.force === true;
  const cached = peekPublicMenu();

  if (!force && isMenuFresh(cached) && cached) {
    return cached;
  }

  if (inflight) return inflight;

  const epoch = cacheEpoch;
  const box: { current: Promise<PublicMenuSnapshot> | null } = { current: null };
  box.current = (async () => {
    const [branchList, settings, categories, products] = await Promise.all([
      fetchBranches(),
      fetchSettings(),
      fetchCategories(),
      fetchProducts(),
    ]);

    // Invalidated while in flight — drop this request and start a successor.
    if (epoch !== cacheEpoch) {
      if (inflight === box.current) inflight = null;
      return loadPublicMenu({ force: true });
    }

    const branchId =
      branchList.find((b) => b.isActive)?.id || DEFAULT_BRANCH_ID;

    const snap: PublicMenuSnapshot = {
      branchId,
      settings: settings ?? DEFAULT_SETTINGS,
      categories: categories.filter((c) => c.isActive),
      products: products.filter((p) => p.isActive),
      fetchedAt: Date.now(),
    };

    memory = snap;
    writeStorage(snap);
    return snap;
  })().finally(() => {
    if (inflight === box.current) inflight = null;
  });

  inflight = box.current;
  return box.current;
}
