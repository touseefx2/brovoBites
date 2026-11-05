"use client";

import { useCallback, useEffect, useState } from "react";
import type { Branch } from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { LoadError, PageSpinner } from "@/components/Loading";
import { SeeActivityLogLink } from "@/components/SeeActivityLogLink";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import { fetchBranches } from "@/lib/firestore";

export default function InventoryPage() {
  const { t, locale } = useLocale();
  const { profile, activeBranchId } = useAuth();
  const isOwner = profile?.role === "owner";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const b = await fetchBranches();
      // Owner: every branch. Staff: only the branches they work in.
      const allowed = isOwner
        ? b.filter((x) => x.isActive)
        : b.filter((x) => x.isActive && (profile?.branchIds ?? []).includes(x.id));
      setBranches(allowed);
      setBranchId((cur) =>
        cur && allowed.some((x) => x.id === cur)
          ? cur
          : activeBranchId && allowed.some((x) => x.id === activeBranchId)
            ? activeBranchId
            : allowed[0]?.id ?? "",
      );
    } catch (e) {
      setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [locale, t, isOwner, profile?.branchIds, activeBranchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRetryOnReconnect(Boolean(loadError) && !loading, () => void load());

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-5">
        <h1 className="admin-page-title">{t("inventory")}</h1>
        <p className="admin-page-sub max-w-2xl">
          {isOwner ? t("inventoryHint") : t("inventoryHintStaff")}
        </p>
      </div>

      {loading ? <PageSpinner label={t("loading")} /> : null}
      {!loading && loadError ? <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} /> : null}

      {!loading && !loadError && profile && branchId ? (
        <InventoryPanel
          key={branchId}
          branchId={branchId}
          user={profile}
          toolbarStart={
            branches.length > 1 ? (
              <span className="w-full sm:w-56">
              <select
                className="input min-h-11 text-sm"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                aria-label={t("branch")}
                dir="ltr"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              </span>
            ) : null
          }
          footer={<SeeActivityLogLink entityType="inventory" className="mt-2" />}
        />
      ) : null}
    </div>
  );
}
