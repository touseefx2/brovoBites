import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Branch, Category, Product, ShopSettings } from "@bravobites/domain";
import {
  fetchBranches,
  fetchCategories,
  fetchProducts,
  fetchSettings,
} from "@/lib/firestore";

const DB_NAME = "bravobites-pos-catalog";
const DB_VERSION = 1;

export type PosCatalogSnapshot = {
  id: "catalog";
  branches: Branch[];
  categories: Category[];
  products: Product[];
  settings: ShopSettings;
  savedAt: string;
};

interface CatalogDb extends DBSchema {
  catalog: {
    key: string;
    value: PosCatalogSnapshot;
  };
}

let dbPromise: Promise<IDBPDatabase<CatalogDb>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<CatalogDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("catalog")) {
          db.createObjectStore("catalog", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function readCachedPosCatalog(): Promise<PosCatalogSnapshot | null> {
  const db = await getDb();
  return (await db.get("catalog", "catalog")) ?? null;
}

export async function writeCachedPosCatalog(
  snap: Omit<PosCatalogSnapshot, "id">,
): Promise<PosCatalogSnapshot> {
  const row: PosCatalogSnapshot = { id: "catalog", ...snap };
  const db = await getDb();
  await db.put("catalog", row);
  return row;
}

export async function clearPosCatalogCache(): Promise<void> {
  try {
    const db = await getDb();
    await db.clear("catalog");
  } catch {
    // Ignore — may fail if IDB is unavailable
  }
}

async function fetchCatalogFromNetwork(): Promise<PosCatalogSnapshot> {
  const [branches, categories, products, settings] = await Promise.all([
    fetchBranches(),
    fetchCategories(),
    fetchProducts(),
    fetchSettings(),
  ]);
  return writeCachedPosCatalog({
    branches,
    categories,
    products,
    settings,
    savedAt: new Date().toISOString(),
  });
}

export type PosCatalogBootstrap = {
  /** Show this in the UI immediately. */
  snapshot: PosCatalogSnapshot;
};

/**
 * Cache-first POS catalog:
 * - Cache hit → return cache now. No network refresh here: the POS's live
 *   listeners bring it up to date (a refresh would read the catalog twice).
 * - No cache + online → wait for network once, then cache.
 * - No cache + offline → throw (need net once).
 */
export async function bootstrapPosCatalog(): Promise<PosCatalogBootstrap> {
  const cached = await readCachedPosCatalog();
  if (cached) return { snapshot: cached };

  const online =
    typeof navigator === "undefined" ? true : navigator.onLine;
  if (!online) {
    throw new Error(
      "Connect once so this PC can load menu, tax, and branches. Then offline POS works.",
    );
  }

  const snapshot = await fetchCatalogFromNetwork();
  return { snapshot };
}
