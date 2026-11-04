"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Branch } from "@bravobites/domain";
import { branchMapsUrl } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { notifyActionFailed } from "@/lib/action";
import { useAction } from "@/components/ActionProvider";
import { ButtonSpinner, LoadError, PageSpinner } from "@/components/Loading";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import { fetchBranches, upsertBranch } from "@/lib/firestore";

function formatCoord(n: number) {
  return n.toFixed(5);
}

export default function BranchesPage() {
  const { t, locale } = useLocale();
  const { runAction, busy: actionBusy } = useAction();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Branch | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  const load = useCallback(async () => {
    setPageLoading(true);
    setLoadError(null);
    try {
      setBranches(await fetchBranches());
    } catch (e) {
      setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
    } finally {
      setPageLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useRetryOnReconnect(Boolean(loadError) && !pageLoading, () => {
    void load();
  });

  async function toggle(b: Branch) {
    const next = { ...b, isActive: !b.isActive };
    setBranches((list) => list.map((x) => (x.id === b.id ? next : x)));
    setBusyId(b.id);
    setPendingToggle(null);
    setActionError(null);
    const result = await runAction((_ctx) => upsertBranch(next), {
      label: t("pleaseWait"),
      silentFail: true,
    });
    if (!result.ok) {
      setBranches((list) => list.map((x) => (x.id === b.id ? b : x)));
      if (result.message !== t("errOffline")) {
        notifyActionFailed(result.message, setActionError);
      } else {
        setActionError(result.message);
      }
    }
    setBusyId(null);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--ink)] sm:text-2xl">{t("branches")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("newShopHint")}</p>
        </div>
        <Link href="/admin/branches/new" className="btn btn-sm">
          {t("addNewBranch")}
        </Link>
      </div>

      {actionError ? <div className="toast-error mb-4">{actionError}</div> : null}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        {t("yourBranches")}
      </h2>

      {pageLoading ? <PageSpinner label={t("loading")} /> : null}

      {!pageLoading && loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} />
      ) : null}

      {!pageLoading && !loadError ? (
        <div className="space-y-3">
          {branches.length === 0 ? (
            <div className="card text-sm text-[var(--muted)]">{t("noBranchesYet")}</div>
          ) : null}
          {branches.map((b) => {
            const maps = branchMapsUrl(b);
            return (
              <div
                key={b.id}
                className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[var(--ink)]">{b.name}</p>
                    {!b.isActive ? (
                      <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {t("inactive")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{b.address || "—"}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]" dir="ltr">
                    {b.phone || "—"}
                    {b.latitude != null && b.longitude != null
                      ? ` · ${formatCoord(b.latitude)}, ${formatCoord(b.longitude)}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {maps ? (
                    <a
                      href={maps}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                      dir="ltr"
                      title={t("openInMaps")}
                    >
                      {t("mapsShort")}
                    </a>
                  ) : null}
                  <Link href={`/admin/branches/${b.id}/edit`} className="btn btn-ghost btn-sm">
                    {t("edit")}
                  </Link>
                  <button
                    type="button"
                    className={`btn btn-sm ${b.isActive ? "btn-ghost" : ""}`}
                    disabled={busyId === b.id || actionBusy}
                    onClick={() => setPendingToggle(b)}
                  >
                    {busyId === b.id ? <ButtonSpinner /> : null}
                    {b.isActive ? t("deactivate") : t("activate")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingToggle)}
        title={
          pendingToggle?.isActive
            ? t("confirmDeactivateBranchTitle")
            : t("confirmActivateBranchTitle")
        }
        message={
          pendingToggle?.isActive
            ? t("confirmDeactivateBranch")
            : t("confirmActivateBranch")
        }
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={Boolean(busyId)}
        danger={Boolean(pendingToggle?.isActive)}
        onCancel={() => {
          if (!busyId) setPendingToggle(null);
        }}
        onConfirm={() => {
          if (pendingToggle) void toggle(pendingToggle);
        }}
      />
    </div>
  );
}
