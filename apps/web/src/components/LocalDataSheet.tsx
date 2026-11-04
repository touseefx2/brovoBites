"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useLocale } from "@/i18n/locale-context";
import {
  clearSyncedLocalCopy,
  countLocalRows,
  getLocalDataStats,
  subscribeQueue,
  UnsyncedLocalDataError,
  type LocalDataStats,
} from "@/lib/pos-queue";

/**
 * Guards against an accidental clear. It is NOT real security — anyone who
 * opens the browser dev tools can read it — and clearing only ever removes
 * rows that are already safely on the cloud.
 */
const LOCAL_CLEAR_PIN = "1122";

const NUM: CSSProperties = { fontFamily: "var(--font-en), system-ui, sans-serif" };

function when(ms: number | null) {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString("en-PK", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  });
}

/** True when the queue has nothing waiting and something is kept locally. */
export function useLocalDataClearable(): boolean {
  const [clearable, setClearable] = useState(false);
  useEffect(() => {
    let alive = true;
    const unsub = subscribeQueue((snap) => {
      if (snap.pendingCount > 0 || snap.failedCount > 0) {
        setClearable(false);
        return;
      }
      void countLocalRows().then((n) => {
        if (alive) setClearable(n > 0);
      });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return clearable;
}

/**
 * This PC's local copy of sales, order changes and expenses (kept after sync)
 * with a PIN-guarded clear that only works once everything has synced.
 */
export function LocalDataSheet({ onClose }: { onClose: () => void }) {
  const { t, locale } = useLocale();
  const [stats, setStats] = useState<LocalDataStats | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const unsub = subscribeQueue(() => {
      void getLocalDataStats().then((s) => {
        if (alive) setStats(s);
      });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const total = stats ? stats.sales.total + stats.changes.total + stats.expenses.total : 0;
  const waiting = stats
    ? stats.sales.pending + stats.sales.failed +
      stats.changes.pending + stats.changes.failed +
      stats.expenses.pending + stats.expenses.failed
    : 0;
  const canClear = Boolean(stats) && waiting === 0 && total > 0;

  async function confirmClear() {
    if (pin !== LOCAL_CLEAR_PIN) {
      setError(t("localDataWrongPin"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const n = await clearSyncedLocalCopy();
      setCleared(n);
      setPinOpen(false);
      setPin("");
      setStats(await getLocalDataStats());
    } catch (e) {
      setError(e instanceof UnsyncedLocalDataError ? t("localDataUnsynced") : String(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = stats
    ? [
        { label: t("localDataSales"), c: stats.sales },
        { label: t("localDataChanges"), c: stats.changes },
        { label: t("expenses"), c: stats.expenses },
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("localDataTitle")}
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-950/55 backdrop-blur-[2px]"
        aria-label={t("close")}
        onClick={onClose}
      />
      <div
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        style={locale === "ur" ? undefined : NUM}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 pb-3 pt-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--ink)]">{t("localDataTitle")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">
              {t("localDataHint")} {t("localDataAutoPrune")}
            </p>
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

        <div className="space-y-4 px-5 py-4">
          {!stats ? (
            <p className="py-6 text-center text-sm text-stone-500">{t("loading")}</p>
          ) : total === 0 ? (
            <p className="rounded-xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">
              {t("localDataEmpty")}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)]">
                {rows.map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="font-medium text-[var(--ink)]">{r.label}</span>
                    <span className="flex items-center gap-2 text-xs" style={NUM}>
                      <span className="text-base font-bold text-[var(--ink)]">{r.c.total}</span>
                      <span className="text-stone-500">
                        {r.c.total - r.c.pending - r.c.failed} {t("localDataSynced")}
                      </span>
                      {r.c.pending > 0 ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200">
                          {r.c.pending} {t("localDataPending")}
                        </span>
                      ) : null}
                      {r.c.failed > 0 ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700 ring-1 ring-red-200">
                          {r.c.failed} {t("localDataFailed")}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-stone-50 px-3 py-2">
                  <dt className="text-stone-500">{t("localDataOldest")}</dt>
                  <dd className="mt-0.5 font-semibold text-[var(--ink)]" style={NUM} dir="ltr">{when(stats.oldestAt)}</dd>
                </div>
                <div className="rounded-xl bg-stone-50 px-3 py-2">
                  <dt className="text-stone-500">{t("localDataLastSync")}</dt>
                  <dd className="mt-0.5 font-semibold text-[var(--ink)]" style={NUM} dir="ltr">{when(stats.lastSyncedAt)}</dd>
                </div>
              </dl>
            </>
          )}

          {cleared != null ? (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
              {t("localDataCleared").replace("{n}", String(cleared))}
            </p>
          ) : null}

          {stats && waiting > 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              {t("localDataUnsynced")}
            </p>
          ) : null}

          {canClear ? (
            pinOpen ? (
              <form
                className="space-y-2 rounded-2xl border border-red-200 bg-red-50/40 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirmClear();
                }}
              >
                <label className="block text-xs font-semibold text-stone-600" htmlFor="local-clear-pin">
                  {t("localDataPin")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="local-clear-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    autoFocus
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value);
                      setError(null);
                    }}
                    className="h-10 w-32 rounded-xl border border-[var(--border)] bg-white px-3 text-center text-lg tracking-[0.4em] outline-none focus:border-red-400"
                    style={NUM}
                    dir="ltr"
                  />
                  <button
                    type="submit"
                    disabled={busy || pin.length === 0}
                    className="h-10 flex-1 rounded-xl bg-red-600 px-4 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy ? t("loading") : t("localDataClear")}
                  </button>
                  <button
                    type="button"
                    className="h-10 rounded-xl px-3 text-sm font-semibold text-stone-600 hover:bg-stone-100"
                    onClick={() => {
                      setPinOpen(false);
                      setPin("");
                      setError(null);
                    }}
                  >
                    {t("cancel")}
                  </button>
                </div>
                {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPinOpen(true);
                  setCleared(null);
                }}
                className="h-11 w-full rounded-xl border border-red-200 bg-white text-sm font-bold text-red-700 transition hover:bg-red-50"
              >
                {t("localDataClear")}
              </button>
            )
          ) : null}

          <p className="text-[11px] leading-relaxed text-stone-500">{t("localDataKeeps")}</p>
        </div>
      </div>
    </div>
  );
}
