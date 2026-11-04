"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { AppUser } from "@bravobites/domain";
import { formatOrderDateTime, formatOrderNumber, formatPkr } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import type { MessageKey } from "@/i18n/dictionaries";
import { listSyncIssues, subscribeQueue, type SyncIssue, type SyncIssueReason } from "@/lib/pos-queue";

const NUM: CSSProperties = { fontFamily: "var(--font-en), system-ui, sans-serif" };

const REASON_KEY: Record<SyncIssueReason, MessageKey> = {
  offline: "syncReasonOffline",
  queued: "syncReasonQueued",
  afterSale: "syncReasonAfterSale",
  ownerOnly: "syncReasonOwnerOnly",
  otherUser: "syncReasonOtherUser",
  timeLimit: "syncReasonTimeLimit",
  afterEarlier: "syncReasonAfterEarlier",
  retry: "syncReasonRetry",
  noAnswer: "syncReasonNoAnswer",
};

const ACTION_KEY: Record<NonNullable<SyncIssue["action"]>, MessageKey> = {
  create: "activityCreate",
  update: "activityUpdate",
  edit: "activityUpdate",
  cancel: "activityCancel",
  delete: "activityDelete",
  refund: "activityRefund",
};

/**
 * What is still waiting for the cloud on this PC, and why — opened from the
 * small sync pill in the Day End Report (no banner on the POS).
 */
export function SyncStatusSheet({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const { t, locale } = useLocale();
  const [issues, setIssues] = useState<SyncIssue[] | null>(null);

  useEffect(() => {
    let alive = true;
    const unsub = subscribeQueue(() => {
      void listSyncIssues(user, typeof navigator === "undefined" ? true : navigator.onLine)
        .then((list) => {
          if (alive) setIssues(list);
        })
        .catch((err) => {
          // Never leave the sheet on "Loading…".
          console.error("[sync-status]", err);
          if (alive) setIssues([]);
        });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [user]);

  const title = (i: SyncIssue) => {
    if (i.kind === "sale") return `${t("syncKindSale")} · #${formatOrderNumber(i.orderNumber ?? 0)}`;
    if (i.kind === "change") {
      return `${t(ACTION_KEY[i.action ?? "edit"])} · ${t("order")} #${formatOrderNumber(i.orderNumber ?? 0)}`;
    }
    return `${t("expenses")} · ${t(ACTION_KEY[i.action ?? "create"])}`;
  };

  const stateStyle: Record<SyncIssue["state"], string> = {
    failed: "bg-red-50 text-red-700 ring-red-200",
    uploading: "bg-sky-50 text-sky-700 ring-sky-200",
    waiting: "bg-amber-50 text-amber-800 ring-amber-200",
  };
  const stateLabel: Record<SyncIssue["state"], string> = {
    failed: t("syncStateFailed"),
    uploading: t("syncStateUploading"),
    waiting: t("syncStateWaiting"),
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("syncStatusTitle")}>
      <button type="button" className="absolute inset-0 bg-stone-950/55 backdrop-blur-[2px]" aria-label={t("close")} onClick={onClose} />
      <div
        className="relative z-10 flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        style={locale === "ur" ? undefined : NUM}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#f0e9dc] px-5 pb-3 pt-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--ink)]">{t("syncStatusTitle")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">{t("syncStatusHint")}</p>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"
            onClick={onClose}
            aria-label={t("close")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {issues == null ? (
            <p className="py-8 text-center text-sm text-stone-500">{t("loading")}</p>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <p className="text-sm font-semibold text-[var(--ink)]">{t("syncStatusAllDone")}</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {issues.map((i) => (
                <li key={i.id} className="rounded-2xl border border-[#f0e9dc] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[var(--ink)]">{title(i)}</p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        <span style={NUM} dir="ltr">{formatOrderDateTime(i.at)}</span>
                        {" · "}
                        <span className="capitalize">{i.by}</span>
                        {i.amount != null ? (
                          <>
                            {" · "}
                            <span style={NUM} dir="ltr">{formatPkr(i.amount)}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${stateStyle[i.state]}`}>
                      {stateLabel[i.state]}
                    </span>
                  </div>
                  <p className={`mt-2 text-xs leading-relaxed ${i.state === "failed" ? "font-semibold text-red-700" : "text-stone-600"}`}>
                    {t(REASON_KEY[i.reason])}
                  </p>
                  {i.reason === "retry" && i.error ? (
                    <p className="mt-1 text-[11px] text-stone-400">{i.error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
