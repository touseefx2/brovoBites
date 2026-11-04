import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { StockMovementType } from "@bravobites/domain";

/**
 * A copy of every hand stock change (receive / waste / recount) on this PC
 * until the server has it. Firestore's own offline queue belongs to the person
 * signed in, and drops a change the server refuses (e.g. that person was
 * disabled before the line came back) — this copy outlives both, so the next
 * permitted login here can still put it on (see redoWaitingStockChanges).
 *
 * Its own database: never touches the POS sales queue.
 */
export type StockOutboxEntry = {
  /** The stock movement's id — the same id when redone, so it lands once. */
  id: string;
  branchId: string;
  inventoryItemId: string;
  productId: string;
  productName: string;
  variationId?: string;
  movementType: Extract<StockMovementType, "purchase" | "waste" | "adjustment">;
  delta: number;
  notes: string;
  byUid: string;
  byName: string;
  /** When it was made (ISO). */
  at: string;
  log: { summary: string; detail: string };
  savedAt: number;
  /** Last redo that the server refused (ms) — wait before asking again. */
  refusedAt?: number;
};

interface StockOutboxDb extends DBSchema {
  changes: { key: string; value: StockOutboxEntry };
}

let dbPromise: Promise<IDBPDatabase<StockOutboxDb>> | null = null;

function getDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("No IndexedDB"));
  dbPromise ??= openDB<StockOutboxDb>("bravobites-stock-outbox", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("changes")) db.createObjectStore("changes", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function putStockOutbox(entry: StockOutboxEntry): Promise<void> {
  await (await getDb()).put("changes", entry);
}

export async function removeStockOutbox(id: string): Promise<void> {
  await (await getDb()).delete("changes", id);
}

export async function listStockOutbox(): Promise<StockOutboxEntry[]> {
  return (await getDb()).getAll("changes");
}
