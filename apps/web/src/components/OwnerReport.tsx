"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActivityLog, CashDrawerSession, Expense, InventoryItem, Order, StockMovement } from "@bravobites/domain";
import type { Unsubscribe } from "firebase/firestore";
import { useLocale } from "@/i18n/locale-context";
import { mergeActivityLogs } from "@/lib/activity-merge";
import { mapFirebaseError } from "@/lib/errors";
import { onActivityLogsInRange, onCashDrawersInRange, onInventorySnapshot, onStockMovementsSince } from "@/lib/firestore";
import { loadPublicMenu, peekPublicMenu } from "@/lib/menu-data";
import type { ReportCatalog } from "@/lib/owner-report";
import { readCachedPosCatalog } from "@/lib/pos-catalog";
import { usePendingStock, withPendingStock } from "@/lib/use-pending-stock";
import {
  applyPendingExpenseOps,
  applyPendingOrderOps,
  listActiveQueuedExpenses,
  listActiveQueuedMutations,
  listActiveQueuedOrders,
  listLocalActivityLogs,
  subscribeQueue,
  type QueuedExpense,
  type QueuedMutation,
  type QueuedOrder,
} from "@/lib/pos-queue";

/* ── Data: the period's change log + cash drawer (orders / expenses come from the caller) ── */

/**
 * Activity logs (orders + expenses) and drawer sessions of a period, live.
 * POS (`withLocal`) also merges this PC's own copy of every change, so an
 * edit made offline shows at once (marked "not synced yet").
 */
export function useOwnerReportExtras(opts: {
  branchIds: string[];
  /** Omit for "from the beginning". */
  sinceIso?: string;
  untilIso: string;
  fromKey: string | null;
  toKey: string;
  enabled: boolean;
  withLocal?: boolean;
}) {
  const { locale } = useLocale();
  const [cloud, setCloud] = useState<Record<string, ActivityLog[]>>({});
  const [drawerParts, setDrawerParts] = useState<Record<string, CashDrawerSession[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [drawerError, setDrawerError] = useState(false);
  const [local, setLocal] = useState<ActivityLog[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [stockItems, setStockItems] = useState<Record<string, InventoryItem[]>>({});
  const [stockMoves, setStockMoves] = useState<Record<string, StockMovement[]>>({});

  const branchKey = opts.branchIds.join(",");
  const { sinceIso, untilIso, fromKey, toKey, enabled } = opts;

  useEffect(() => {
    setCloud({});
    setDrawerParts({});
    setError(null);
    setDrawerError(false);
    if (!enabled || !branchKey) return;
    const unsubs: Unsubscribe[] = [];
    for (const branchId of branchKey.split(",")) {
      // Inventory logs feed the report's stock changes list (not its money timeline).
      for (const entityType of ["order", "expense", "inventory"] as const) {
        const key = `${branchId}:${entityType}`;
        unsubs.push(
          onActivityLogsInRange(
            { branchId, entityType, sinceIso, untilIso },
            (logs) => setCloud((p) => ({ ...p, [key]: logs })),
            (err) => {
              setCloud((p) => ({ ...p, [key]: p[key] ?? [] }));
              setError(mapFirebaseError(err, locale));
            },
          ),
        );
      }
      unsubs.push(
        onCashDrawersInRange(
          branchId,
          fromKey,
          toKey,
          (s) => setDrawerParts((p) => ({ ...p, [branchId]: s })),
          () => {
            setDrawerParts((p) => ({ ...p, [branchId]: p[branchId] ?? [] }));
            setDrawerError(true);
          },
        ),
      );
    }
    return () => unsubs.forEach((u) => u());
  }, [enabled, branchKey, sinceIso, untilIso, fromKey, toKey, locale]);

  // Stock: each branch's rows + every movement since the period began (the
  // day's opening count is worked back from the live count). Bounded
  // periods only — "all time" has no opening.
  useEffect(() => {
    setStockItems({});
    setStockMoves({});
    if (!enabled || !branchKey || !sinceIso) return;
    const unsubs: Unsubscribe[] = [];
    for (const branchId of branchKey.split(",")) {
      unsubs.push(
        onInventorySnapshot(
          branchId,
          (items) => setStockItems((p) => ({ ...p, [branchId]: items })),
          () => setStockItems((p) => ({ ...p, [branchId]: p[branchId] ?? [] })),
        ),
        onStockMovementsSince(
          branchId,
          sinceIso,
          (m) => setStockMoves((p) => ({ ...p, [branchId]: m })),
          () => setStockMoves((p) => ({ ...p, [branchId]: p[branchId] ?? [] })),
        ),
      );
    }
    return () => unsubs.forEach((u) => u());
  }, [enabled, branchKey, sinceIso]);

  useEffect(() => {
    if (!enabled || !opts.withLocal) {
      setLocal([]);
      setPendingIds(new Set());
      return;
    }
    let alive = true;
    const unsub = subscribeQueue(() => {
      void Promise.all([listLocalActivityLogs("order"), listLocalActivityLogs("expense")]).then(
        ([o, e]) => {
          if (!alive) return;
          setLocal([...o.logs, ...e.logs]);
          setPendingIds(new Set([...o.pendingIds, ...e.pendingIds]));
        },
      );
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [enabled, opts.withLocal]);

  const ids = branchKey ? branchKey.split(",") : [];
  const ready =
    enabled &&
    ids.length > 0 &&
    ids.every((b) => cloud[`${b}:order`] && cloud[`${b}:expense`] && drawerParts[b]);

  const logs = useMemo(() => {
    const allowed = new Set(branchKey.split(","));
    return mergeActivityLogs({
      cloud: Object.values(cloud).flat(),
      local,
      pendingIds,
      branchId: "all",
    }).filter((l) => allowed.has(l.branchId));
  }, [cloud, local, pendingIds, branchKey]);
  const drawers = useMemo(() => Object.values(drawerParts).flat(), [drawerParts]);
  const cloudStockItems = useMemo(() => Object.values(stockItems).flat(), [stockItems]);
  // POS PC: its sales not on the cloud yet count in Sold at once.
  const pendingStock = usePendingStock({ branchIds: ids, inventory: cloudStockItems, enabled: enabled && !!opts.withLocal });
  const stock = useMemo(() => {
    if (!ids.every((b) => stockItems[b] && stockMoves[b])) return null;
    return {
      items: withPendingStock(cloudStockItems, pendingStock.byItem),
      movements: [...Object.values(stockMoves).flat(), ...pendingStock.movements],
    };
    // ids follows branchKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockItems, cloudStockItems, stockMoves, pendingStock, branchKey]);

  return { logs, pendingIds, drawers, stock, ready, error, drawerError };
}

/**
 * A period's cloud orders + expenses with this PC's own not-yet-synced work
 * on top (sales, edits / cancels / refunds / deletes, expenses) — the same
 * merge the POS Day End Report does, so the admin page on the POS PC counts
 * them too. Re-read when the queue changes in this tab or the tab is focused
 * (a sale made in the POS tab).
 */
export function useWithLocalPending(opts: {
  branchIds: string[];
  orders: Order[];
  expenses: Expense[];
  enabled: boolean;
}): { orders: Order[]; expenses: Expense[] } {
  const [queued, setQueued] = useState<QueuedOrder[]>([]);
  const [mutations, setMutations] = useState<QueuedMutation[]>([]);
  const [expenseOps, setExpenseOps] = useState<QueuedExpense[]>([]);
  const branchKey = opts.branchIds.join(",");

  useEffect(() => {
    if (!opts.enabled || !branchKey) {
      setQueued([]);
      setMutations([]);
      setExpenseOps([]);
      return;
    }
    const branches = new Set(branchKey.split(","));
    let alive = true;
    const read = () =>
      void Promise.all([listActiveQueuedOrders(), listActiveQueuedMutations(), listActiveQueuedExpenses()])
        .then(([q, m, e]) => {
          if (!alive) return;
          setQueued(q.filter((x) => branches.has(x.branchId)));
          setMutations(m.filter((x) => branches.has(x.orderBefore.branchId)));
          setExpenseOps(e.filter((x) => branches.has(x.branchId)));
        })
        .catch(() => {});
    const unsub = subscribeQueue(read);
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      unsub();
      window.removeEventListener("focus", read);
    };
  }, [opts.enabled, branchKey]);

  const { orders, expenses } = opts;
  return useMemo(
    () => ({
      orders: applyPendingOrderOps(orders, queued, mutations).list,
      expenses: applyPendingExpenseOps(expenses, expenseOps).list,
    }),
    [orders, expenses, queued, mutations, expenseOps],
  );
}

/**
 * Menu categories + item names, to group item sales: the POS's offline copy
 * of the menu, else the menu this browser already keeps — no extra reads when
 * either is there. undefined while looking, null when there is none.
 */
export function useReportCatalog(enabled: boolean): ReportCatalog | null | undefined {
  const [catalog, setCatalog] = useState<ReportCatalog | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || catalog !== undefined) return;
    let alive = true;
    void (async () => {
      const pos = await readCachedPosCatalog().catch(() => null);
      const menu = pos ?? peekPublicMenu() ?? (await loadPublicMenu().catch(() => null));
      if (alive) setCatalog(menu ? { categories: menu.categories, products: menu.products } : null);
    })();
    return () => {
      alive = false;
    };
  }, [enabled, catalog]);
  return catalog;
}

export { OwnerReportView, type OwnerReportActionsInfo } from "@/components/OwnerReportScreen";
