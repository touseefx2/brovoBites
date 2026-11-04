"use client";

import { useEffect, useMemo, useState } from "react";
import type { InventoryItem, Order, OrderItem, Product, StockMovement } from "@bravobites/domain";
import { isFullyRefunded } from "@bravobites/domain";
import { amendStockLines, isTrackedAfter, stockLinesForLocal } from "@/lib/firestore";
import { readCachedPosCatalog } from "@/lib/pos-catalog";
import {
  listActiveQueuedMutations,
  listActiveQueuedOrders,
  subscribeQueue,
  type QueuedMutation,
  type QueuedOrder,
} from "@/lib/pos-queue";

/**
 * Stock this PC has moved but the cloud hasn't yet: a POS sale is saved here
 * first and takes its stock off only when it syncs. Until then its lines show
 * as local "sale" movements (and a cancel / edit / full refund made offline
 * as "restock" / "sale"), so counts and the day's Sold move at once.
 *
 * Same rules as the sync step: an edit moves only what changed, a cancel of a
 * refunded order gives nothing back, and a row added to stock after the sale
 * is left alone. Once the sync writes the real movement the queue row is
 * marked synced and drops out here — the cloud numbers take over.
 */
export function usePendingStock(opts: { branchIds: string[]; inventory: InventoryItem[]; enabled?: boolean }) {
  const { inventory, enabled = true } = opts;
  const branchKey = opts.branchIds.join(",");
  const [orders, setOrders] = useState<QueuedOrder[]>([]);
  const [mutations, setMutations] = useState<QueuedMutation[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (!enabled || !branchKey) {
      setOrders([]);
      setMutations([]);
      return;
    }
    const branches = new Set(branchKey.split(","));
    let alive = true;
    const read = () =>
      void Promise.all([listActiveQueuedOrders(), listActiveQueuedMutations()])
        .then(([q, m]) => {
          if (!alive) return;
          setOrders(q.filter((x) => branches.has(x.branchId) && x.stockStatus !== "synced"));
          setMutations(m.filter((x) => x.outcome !== "dropped" && branches.has(x.orderBefore.branchId)));
        })
        .catch(() => {});
    const unsub = subscribeQueue(read);
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      unsub();
      window.removeEventListener("focus", read);
    };
  }, [enabled, branchKey]);

  const busy = orders.length > 0 || mutations.length > 0;
  useEffect(() => {
    // The menu is only needed to open deals into their items: the POS's own
    // saved copy (local, no extra Firestore listener). Plain items and sizes
    // match without it.
    if (!busy) return;
    let alive = true;
    void readCachedPosCatalog()
      .then((c) => {
        if (alive && c) setProducts(c.products);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [busy]);

  return useMemo(() => {
    const movements: StockMovement[] = [];
    if (!busy || inventory.length === 0) return { movements, byItem: new Map<string, number>() };

    const add = (o: Pick<Order, "branchId" | "createdAt">, items: OrderItem[], sign: 1 | -1, at: string, key: string, by: { uid: string; name: string }) => {
      const rows = inventory.filter((i) => i.branchId === o.branchId && !isTrackedAfter(i.createdAt, o.createdAt));
      for (const { inv, line } of stockLinesForLocal(items, products, rows)) {
        movements.push({
          id: `local:${key}:${inv.id}`,
          branchId: inv.branchId,
          inventoryItemId: inv.id,
          productId: inv.productId,
          productName: inv.productName,
          ...(inv.variationId ? { variationId: inv.variationId } : {}),
          movementType: sign < 0 ? "sale" : "restock",
          quantity: line.qty,
          previousStock: 0,
          newStock: 0,
          delta: sign * line.qty,
          notes: "",
          createdBy: by.uid,
          createdByName: by.name,
          createdAt: at,
        });
      }
    };

    // A queued sale is a completed sale; its own cancel / edit comes as a mutation below.
    for (const q of orders) {
      add(q, q.items, -1, q.createdAt, q.clientId, { uid: q.createdBy, name: q.createdByName });
    }
    for (const m of mutations) {
      const at = m.occurredAt ?? new Date(m.enqueuedAt).toISOString();
      const by = { uid: m.user.uid, name: m.user.displayName || m.user.email };
      const { orderBefore: before, orderAfter: after } = m;
      if (before.status === "cancelled") continue;
      if (m.kind === "cancel" || m.kind === "delete") {
        if (!m.skipStockRestore && !isFullyRefunded(before)) add(before, before.items, 1, at, m.mutationId, by);
      } else if (m.kind === "refund") {
        if (isFullyRefunded(after) && !isFullyRefunded(before)) add(before, before.items, 1, at, m.mutationId, by);
      } else if (m.kind === "edit") {
        const { toDeduct, toRestock } = amendStockLines(before.items, after.items);
        add(before, toRestock, 1, at, `${m.mutationId}_r`, by);
        add(before, toDeduct, -1, at, `${m.mutationId}_d`, by);
      }
    }

    const byItem = new Map<string, number>();
    for (const mv of movements) byItem.set(mv.inventoryItemId, (byItem.get(mv.inventoryItemId) ?? 0) + (mv.delta ?? 0));
    return { movements, byItem };
  }, [busy, orders, mutations, products, inventory]);
}

/** Stock rows with this PC's not-yet-synced moves applied (marked as waiting). */
export function withPendingStock(items: InventoryItem[], byItem: Map<string, number>): InventoryItem[] {
  if (byItem.size === 0) return items;
  return items.map((i) => {
    const d = byItem.get(i.id);
    return d ? { ...i, currentStock: i.currentStock + d, pendingSync: true } : i;
  });
}
