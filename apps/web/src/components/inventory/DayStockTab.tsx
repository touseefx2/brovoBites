"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActivityLog, InventoryItem, StockMovement } from "@bravobites/domain";
import { summarizeStockDay } from "@bravobites/domain";
import { StockSection } from "@/components/OwnerReportScreen";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { onActivityLogsInRange, onInventorySnapshot, onStockMovementsSince } from "@/lib/firestore";
import { stockLogLines } from "@/lib/owner-report";
import { usePendingStock, withPendingStock } from "@/lib/use-pending-stock";

const NO_ITEMS: InventoryItem[] = [];

/**
 * Day End Report → Inventory: the day's stock (opening, in, sold, left) and
 * who changed it by hand — the owner report's Stock section for one branch
 * and one shop day. Live, and from the cache when offline.
 */
export function DayStockTab({ branchId, fromIso, toIso }: { branchId: string; fromIso: string; toIso: string }) {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [moves, setMoves] = useState<StockMovement[] | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    setMoves(null);
    setLogs([]);
    setError(null);
    const fail = (err: Error) => setError(mapFirebaseError(err, locale));
    const unsubs = [
      onInventorySnapshot(branchId, setItems, (err) => {
        setItems([]);
        fail(err);
      }),
      // Every movement from the day's start up to now: the opening is worked back from the live count.
      onStockMovementsSince(branchId, fromIso, setMoves, (err) => {
        setMoves([]);
        fail(err);
      }),
      onActivityLogsInRange({ branchId, entityType: "inventory", sinceIso: fromIso, untilIso: toIso }, (l) => setLogs(l), fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [branchId, fromIso, toIso, locale]);

  // This PC's sales not on the cloud yet: in Sold (and Left) at once.
  const pending = usePendingStock({ branchIds: [branchId], inventory: items ?? NO_ITEMS });
  const rows = useMemo(
    () =>
      items && moves
        ? summarizeStockDay({
            items: withPendingStock(items, pending.byItem),
            movements: [...moves, ...pending.movements],
            fromIso,
            toIso,
          })
        : null,
    [items, moves, pending, fromIso, toIso],
  );
  const log = useMemo(() => stockLogLines(logs, fromIso, toIso), [logs, fromIso, toIso]);

  if (!rows) return <p className="py-16 text-center text-sm text-stone-600">{t("loading")}</p>;
  return (
    <div className="space-y-3">
      {error ? <div className="toast-error">{error}</div> : null}
      <StockSection rows={rows} log={log} multiDay={false} />
    </div>
  );
}
