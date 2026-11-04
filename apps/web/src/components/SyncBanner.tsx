"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  subscribeQueue,
  retryFailedQueued,
  type QueueSnapshot,
} from "@/lib/pos-queue";
import { useLocale } from "@/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";

const EMPTY: QueueSnapshot = {
  pendingCount: 0,
  failedCount: 0,
  expensePendingCount: 0,
  syncing: false,
  lastError: null,
  counterReady: true,
  notReadyReason: null,
};

function RetryIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : undefined}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** Thin strip at the very top while POS sales / expenses wait for the cloud. */
export function SyncBanner() {
  const { profile } = useAuth();
  const { t } = useLocale();
  const [snap, setSnap] = useState<QueueSnapshot>(EMPTY);
  const pathname = usePathname();

  useEffect(() => {
    if (!profile) return;
    return subscribeQueue(setSnap);
  }, [profile]);

  if (!profile) return null;
  // POS: sync stays silent in the background (auto-retries every minute and on
  // reconnect); unsynced rows carry a yellow dot instead.
  if (pathname?.startsWith("/pos")) return null;
  if (snap.pendingCount === 0 && snap.failedCount === 0) return null;

  const hasFailed = snap.failedCount > 0;

  return (
    <div
      role="status"
      className={`flex h-4 shrink-0 items-center justify-center gap-1 px-2 text-[10px] font-medium leading-none ${
        hasFailed ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
      }`}
    >
      {hasFailed ? null : (
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-current opacity-70" />
      )}
      <span className="truncate">
        {hasFailed
          ? t("syncFailedBanner").replace("{n}", String(snap.failedCount))
          : t("syncPendingBanner").replace("{n}", String(snap.pendingCount))}
      </span>
      {hasFailed ? (
        <button
          type="button"
          className="-my-1 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-red-200 disabled:opacity-60"
          disabled={snap.syncing}
          onClick={() => void retryFailedQueued()}
          aria-label={t("syncRetry")}
          title={t("syncRetry")}
        >
          <RetryIcon spinning={snap.syncing} />
        </button>
      ) : snap.syncing ? (
        <span className="opacity-70" aria-label={t("syncingNow")}>
          <RetryIcon spinning />
        </span>
      ) : null}
    </div>
  );
}
