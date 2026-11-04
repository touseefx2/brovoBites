"use client";

import { useEffect, useState } from "react";
import type { Expense } from "@bravobites/domain";
import { uncachedExpenseIds } from "@/lib/firestore";
import { listAllQueuedExpenses, subscribeQueue, syncedLocalExpenses } from "@/lib/pos-queue";

/**
 * Offline, an expense this PC already uploaded can be missing from the
 * Firestore cache (the upload doesn't put it there, and the net may drop
 * before it is read back). Fill those days from this PC's own synced copy —
 * only ids the cache knows nothing about, so a change the cache did see
 * (e.g. the owner deleted it) still wins. Online → nothing to fill; callers
 * listen with serverConfirm so `fromCache` turns false once the server answers,
 * and use the fill only while it is true.
 */
export function useSyncedExpenseFill(opts: {
  branchId: string;
  /** Business days (YYYY-MM-DD) on screen. */
  days: string[];
  cloud: Expense[];
  fromCache: boolean;
}): Expense[] {
  const [fill, setFill] = useState<Expense[]>([]);
  // A row that just synced leaves the pending list: look again at once.
  const [queueTick, setQueueTick] = useState(0);
  useEffect(() => subscribeQueue(() => setQueueTick((n) => n + 1)), []);
  const daysKey = opts.days.join(",");
  const cloudKey = opts.cloud.map((e) => e.id).join(",");
  const { branchId, fromCache } = opts;

  useEffect(() => {
    if (!fromCache) {
      setFill([]);
      return;
    }
    let alive = true;
    const days = new Set(daysKey.split(","));
    const inCloud = new Set(cloudKey.split(","));
    void (async () => {
      const ops = (await listAllQueuedExpenses()).filter((e) => e.branchId === branchId);
      const candidates = syncedLocalExpenses(ops).filter((e) => days.has(e.date) && !inCloud.has(e.id));
      const missing = new Set(candidates.length ? await uncachedExpenseIds(candidates.map((e) => e.id)) : []);
      if (alive) setFill(candidates.filter((e) => missing.has(e.id)));
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [fromCache, branchId, daysKey, cloudKey, queueTick]);

  return fill;
}
