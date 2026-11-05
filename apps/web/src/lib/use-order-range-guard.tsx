"use client";

import { useEffect, useState } from "react";
import { LoadError, PageSpinner } from "@/components/Loading";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { countOrdersInRange } from "@/lib/firestore";

/** Up to this many orders a period loads by itself (same as the owner report). */
export const AUTO_LOAD_ORDERS = 1500;

/**
 * A long period costs one read per order every time it loads ("All" = the
 * whole history). Count it first on the server (about one read per 1000
 * orders): small → load at once, big → wait for "Load". Short periods
 * (`small`) and offline (served from this PC's cache, no cost) load at once.
 */
export function useOrderRangeGuard(opts: {
  branchIds: string[];
  /** Omit for "from the beginning". */
  sinceIso?: string;
  /** Omit for "up to now". */
  untilIso?: string;
  small: boolean;
}) {
  const { locale } = useLocale();
  const branchKey = opts.branchIds.join(",");
  const key = `${branchKey}|${opts.sinceIso ?? "*"}|${opts.untilIso ?? "*"}`;
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [sized, setSized] = useState<{ key: string; n: number } | null>(null);
  const [approvedKey, setApprovedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const free = opts.small || !online || !branchKey;
  const { sinceIso, untilIso } = opts;
  useEffect(() => {
    setError(null);
    if (free || sized?.key === key) return;
    let alive = true;
    const until = untilIso ?? "9999-12-31T23:59:59.999Z";
    void Promise.all(branchKey.split(",").map((b) => countOrdersInRange(b, sinceIso, until)))
      .then((ns) => {
        if (!alive) return;
        const n = ns.reduce((s, x) => s + x, 0);
        setSized({ key, n });
        if (n <= AUTO_LOAD_ORDERS) setApprovedKey(key);
      })
      .catch((e) => {
        if (alive) setError(mapFirebaseError(e, locale));
      });
    return () => {
      alive = false;
    };
  }, [free, key, branchKey, sinceIso, untilIso, sized?.key, locale, reload]);

  const approved = free || approvedKey === key;
  return {
    approved,
    /** Orders in the period when it is big (waiting for "Load"). */
    bigCount: !approved && sized?.key === key && sized.n > AUTO_LOAD_ORDERS ? sized.n : null,
    error: approved ? null : error,
    approve: () => setApprovedKey(key),
    retry: () => setReload((n) => n + 1),
  };
}

/** What a page shows instead of its report while the guard waits. */
export function OrderRangeGuardNotice({ guard }: { guard: ReturnType<typeof useOrderRangeGuard> }) {
  const { t } = useLocale();
  if (guard.approved) return null;
  if (guard.error) {
    // The size check needs the server; the report itself can still come from
    // this PC's cache (line down) — let the user load it anyway.
    return (
      <div className="space-y-3">
        <LoadError message={`${t("orCountFailed")} ${guard.error}`} onRetry={guard.retry} retryLabel={t("retry")} />
        <button type="button" className="btn min-h-11" onClick={guard.approve}>
          {t("orLoadReport")}
        </button>
      </div>
    );
  }
  if (guard.bigCount == null) return <PageSpinner label={t("orCounting")} />;
  return (
    <section className="rounded-2xl border border-[#e7d0b8] bg-white p-5 shadow-sm" data-testid="big-period">
      <h2 className="text-lg font-bold text-[var(--ink)]">
        {t("orBigRangeTitle").replace("{n}", guard.bigCount.toLocaleString("en-PK"))}
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        {t("orBigRangeHint").replace("{reads}", Math.ceil(guard.bigCount * 1.1).toLocaleString("en-PK"))}
      </p>
      <button type="button" className="btn mt-4 min-h-11" onClick={guard.approve}>
        {t("orLoadReport")}
      </button>
    </section>
  );
}
