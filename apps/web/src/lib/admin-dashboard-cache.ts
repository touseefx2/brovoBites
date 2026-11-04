import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Expense, Order, ShopSettings } from "@bravobites/domain";

const DB_NAME = "bravobites-admin-dashboard";
const DB_VERSION = 1;

/** Keep ~1.5 months so month-to-date charts work without unbounded growth. */
export const DASHBOARD_CACHE_DAYS = 45;

export type DashboardBranchRef = { id: string; name: string };

export type DashboardAllTime = { sales: number; orders: number };

/** This month's days before the live window, per branch — server totals. */
export type DashboardMonthClosed = { key: string; byBranch: Record<string, DashboardAllTime> };

export type DashboardCacheSnapshot = {
  /** Same as uid — one row per signed-in user on this PC. */
  uid: string;
  branches: DashboardBranchRef[];
  settings: ShopSettings | null;
  orders: Order[];
  expenses: Expense[];
  /** "All-time sales" card — server totals, so offline still shows the last value. */
  allTime?: DashboardAllTime | null;
  monthClosed?: DashboardMonthClosed | null;
  savedAt: string;
};

interface DashboardDb extends DBSchema {
  snapshots: {
    key: string;
    value: DashboardCacheSnapshot;
  };
}

let dbPromise: Promise<IDBPDatabase<DashboardDb>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<DashboardDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots", { keyPath: "uid" });
        }
      },
    });
  }
  return dbPromise;
}

function cutoffIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Trim history so IndexedDB stays small (replace, never forever-append). */
export function trimDashboardPayload(input: {
  orders: Order[];
  expenses: Expense[];
  days?: number;
  /** Start of what the dashboard shows — nothing older is worth caching. */
  sinceIso?: string;
}): { orders: Order[]; expenses: Expense[] } {
  const cut = input.sinceIso ?? cutoffIso(input.days ?? DASHBOARD_CACHE_DAYS);
  const orders = input.orders.filter((o) => (o.createdAt || "") >= cut);
  const expenses = input.expenses.filter((e) => {
    const key = (e.date || e.createdAt || "").slice(0, 10);
    if (!key) return false;
    return key >= cut.slice(0, 10);
  });
  return { orders, expenses };
}

export async function readDashboardCache(
  uid: string,
): Promise<DashboardCacheSnapshot | null> {
  if (!uid) return null;
  const db = await getDb();
  return (await db.get("snapshots", uid)) ?? null;
}

export async function writeDashboardCache(input: {
  uid: string;
  branches: DashboardBranchRef[];
  settings: ShopSettings | null;
  orders: Order[];
  expenses: Expense[];
  sinceIso?: string;
  allTime?: DashboardAllTime | null;
  monthClosed?: DashboardMonthClosed | null;
}): Promise<DashboardCacheSnapshot> {
  const trimmed = trimDashboardPayload({
    orders: input.orders,
    expenses: input.expenses,
    sinceIso: input.sinceIso,
  });
  const row: DashboardCacheSnapshot = {
    uid: input.uid,
    branches: input.branches,
    settings: input.settings,
    orders: trimmed.orders,
    expenses: trimmed.expenses,
    allTime: input.allTime ?? null,
    monthClosed: input.monthClosed ?? null,
    savedAt: new Date().toISOString(),
  };
  const db = await getDb();
  await db.put("snapshots", row);
  return row;
}

export async function clearDashboardCache(uid?: string | null): Promise<void> {
  const db = await getDb();
  if (uid) {
    await db.delete("snapshots", uid);
    return;
  }
  await db.clear("snapshots");
}
