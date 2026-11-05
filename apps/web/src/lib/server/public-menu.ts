import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { DEFAULT_BRANCH_ID, DEFAULT_SETTINGS } from "@bravobites/domain";
import { getAdminDb } from "@/lib/firebase/admin";
import { asCategory, asProduct, parseShopSettings } from "@/lib/firestore-parse";
import type { PublicMenuSnapshot } from "@/lib/menu-data";
import type { BranchesSnapshot, PublicBranch, PublicStaff } from "@/lib/branches-data";

/**
 * The public website's data, read with the Admin SDK (no Firestore web SDK in
 * the browser) and kept in Next's data cache for a minute: "/" renders it into
 * its HTML (ISR) and GET /api/public/menu serves it to the browser.
 */

/** Revalidate window for "/" and the cached menu / branches reads. */
export const PUBLIC_DATA_REVALIDATE_S = 60;
/**
 * Hard limit on how old the menu / branches a visitor gets can be. Next's data
 * cache answers a stale entry at once and refreshes it in the background, so
 * after a quiet spell (or an admin edit on the staff site, whose revalidateTag
 * never reaches the separate customer deployment) the first visitor would get
 * a menu of any age (old prices, hidden items) for the whole visit. Past this
 * age it is read from Firestore on the spot — at most about one read per
 * window per server instance.
 */
export const PUBLIC_DATA_MAX_AGE_MS = PUBLIC_DATA_REVALIDATE_S * 2000;
/** CDN header for the cached public JSON routes (menu, branches). */
export const PUBLIC_DATA_CACHE_CONTROL = `public, max-age=0, s-maxage=${PUBLIC_DATA_REVALIDATE_S}, stale-while-revalidate=${PUBLIC_DATA_REVALIDATE_S}`;
export const PUBLIC_MENU_TAG = "public-menu";
export const PUBLIC_BRANCHES_TAG = "public-branches";

/**
 * A build / revalidation must not hang on an unreachable Firestore. The build
 * gets longer: a cold Admin SDK connection under a busy build can take seconds,
 * and giving up there ships "/" without its menu until the first revalidation.
 */
const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";
const READ_TIMEOUT_MS = IS_BUILD ? 30_000 : 15_000;

/**
 * A failed read while rendering "/". At build (and in dev) the page renders
 * without the data and the browser loads it. When a live deployment
 * revalidates, throwing keeps the last good page (Next serves it and retries
 * on a later request) instead of caching an empty menu for a minute.
 */
function renderFallback(label: string, err: unknown): null {
  const message = err instanceof Error ? err.message : String(err);
  if (process.env.NODE_ENV === "production" && !IS_BUILD) {
    throw new Error(`[${label}] server read failed: ${message}`);
  }
  console.warn(`[${label}] server read failed:`, message);
  return null;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out`)), READ_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Plain JSON only (no Firestore Timestamps) — safe for RSC props and caches. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Same result the browser used to build from the web SDK (src/lib/menu-data.ts). */
async function readPublicMenuFromFirestore(): Promise<PublicMenuSnapshot> {
  const db = getAdminDb();
  const [branches, settings, categories, products] = await withTimeout(
    Promise.all([
      db.collection("branches").get(),
      db.collection("settings").limit(1).get(),
      db.collection("categories").get(),
      db.collection("products").get(),
    ]),
    "public menu",
  );
  const now = Date.now();
  const firstSettings = settings.docs[0];
  return plain({
    branchId:
      branches.docs.find((d) => d.data().isActive !== false)?.id || DEFAULT_BRANCH_ID,
    settings: firstSettings ? parseShopSettings(firstSettings.data()) : DEFAULT_SETTINGS,
    categories: categories.docs
      .map((d) => asCategory(d.id, d.data()))
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    products: products.docs
      .map((d) => asProduct(d.id, d.data()))
      .filter((p) => p.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    fetchedAt: now,
    serverAt: now,
  });
}

const readPublicMenuCached = unstable_cache(readPublicMenuFromFirestore, ["public-menu-v1"], {
  revalidate: PUBLIC_DATA_REVALIDATE_S,
  tags: [PUBLIC_MENU_TAG],
});

function isTooOld(readAt: number | undefined): boolean {
  return Date.now() - (readAt ?? 0) > PUBLIC_DATA_MAX_AGE_MS;
}

/** One Firestore read at a time per instance (a burst of visitors shares it). */
function shared<T>(read: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    inflight ??= read().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

const readPublicMenuNow = shared(readPublicMenuFromFirestore);

/**
 * Cached menu, never older than PUBLIC_DATA_MAX_AGE_MS (see there). Throws
 * when Firestore can't be read and nothing is cached; a failed on-the-spot
 * read falls back to the cached copy. `revalidate` (route handlers only — not
 * allowed while rendering) also refreshes the cache and "/" when the menu
 * changed.
 */
export async function getPublicMenu(options?: { revalidate?: boolean }): Promise<PublicMenuSnapshot> {
  const cached = await readPublicMenuCached();
  if (!isTooOld(cached.serverAt)) return cached;
  try {
    const fresh = await readPublicMenuNow();
    if (options?.revalidate && !sameMenu(fresh, cached)) revalidateTag(PUBLIC_MENU_TAG);
    return fresh;
  } catch (err) {
    console.warn("[public-menu] fresh read failed, serving cache:", err instanceof Error ? err.message : err);
    return cached;
  }
}

function sameMenu(a: PublicMenuSnapshot, b: PublicMenuSnapshot): boolean {
  const key = (s: PublicMenuSnapshot) =>
    JSON.stringify([s.branchId, s.settings, s.categories, s.products]);
  return key(a) === key(b);
}

/**
 * Straight from Firestore (after an admin edit). When it differs from the
 * cached copy, the cache and "/" are refreshed for everyone on this deployment.
 */
export async function getPublicMenuFresh(): Promise<PublicMenuSnapshot> {
  const [fresh, cached] = await Promise.all([
    // Never a shared read: one that started before the admin's save would miss it.
    readPublicMenuFromFirestore(),
    readPublicMenuCached().catch(() => null),
  ]);
  if (!cached || !sameMenu(fresh, cached)) revalidateTag(PUBLIC_MENU_TAG);
  return fresh;
}

/** For rendering "/": see renderFallback() when Firestore can't be read. */
export async function getPublicMenuForPage(): Promise<PublicMenuSnapshot | null> {
  try {
    return await getPublicMenu();
  } catch (err) {
    return renderFallback("public-menu", err);
  }
}

/* ───────────────────────── branches ───────────────────────── */

/** Active branches + their active counter staff (same data as /api/public/branches-staff). */
async function readPublicBranchesFromFirestore(): Promise<BranchesSnapshot> {
  const db = getAdminDb();
  const [branchesSnap, usersSnap] = await withTimeout(
    Promise.all([
      db.collection("branches").where("isActive", "==", true).get(),
      db.collection("users").where("role", "==", "counter").where("isActive", "==", true).get(),
    ]),
    "public branches",
  );

  const staffByBranch = new Map<string, PublicStaff[]>();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const branchIds: string[] = Array.isArray(data.branchIds) ? data.branchIds : [];
    const entry: PublicStaff = {
      displayName: String(data.displayName ?? ""),
      phone: String(data.phone ?? ""),
      // The public route never shares staff emails.
      email: "",
    };
    for (const bid of branchIds) {
      const list = staffByBranch.get(bid) ?? [];
      list.push(entry);
      staffByBranch.set(bid, list);
    }
  }

  const coord = (v: unknown) =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  const branches: PublicBranch[] = branchesSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      name: String(d.name ?? ""),
      phone: String(d.phone ?? ""),
      address: String(d.address ?? ""),
      latitude: coord(d.latitude),
      longitude: coord(d.longitude),
      staff: staffByBranch.get(doc.id) ?? [],
    };
  });
  return plain({ branches, fetchedAt: Date.now() });
}

const readPublicBranchesCached = unstable_cache(
  readPublicBranchesFromFirestore,
  ["public-branches-v1"],
  { revalidate: PUBLIC_DATA_REVALIDATE_S, tags: [PUBLIC_BRANCHES_TAG] },
);

const readPublicBranchesNow = shared(readPublicBranchesFromFirestore);

/**
 * Cached branches + counter staff, never older than PUBLIC_DATA_MAX_AGE_MS
 * (GET /api/public/branches and "/"). Throws when Firestore can't be read
 * and nothing is cached.
 */
export async function getPublicBranches(): Promise<BranchesSnapshot> {
  const cached = await readPublicBranchesCached();
  if (!isTooOld(cached.fetchedAt)) return cached;
  try {
    return await readPublicBranchesNow();
  } catch (err) {
    console.warn("[public-branches] fresh read failed, serving cache:", err instanceof Error ? err.message : err);
    return cached;
  }
}

/** For rendering "/": see renderFallback() when Firestore can't be read. */
export async function getPublicBranchesForPage(): Promise<BranchesSnapshot | null> {
  try {
    return await getPublicBranches();
  } catch (err) {
    return renderFallback("public-branches", err);
  }
}
