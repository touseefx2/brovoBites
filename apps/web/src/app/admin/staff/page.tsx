"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  canDeactivateUser,
  canEditManagedUser,
  canManageOwners,
  isPrimaryOwner,
  type AppUser,
  type Branch,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { notifyActionFailed } from "@/lib/action";
import { useAction } from "@/components/ActionProvider";
import { ButtonSpinner, LoadError, PageSpinner } from "@/components/Loading";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import { fetchBranches, fetchUsers } from "@/lib/firestore";
import { useAuth } from "@/lib/auth-context";
import { getClientAuth } from "@/lib/firebase/client";
import { apiFetch } from "@/lib/http";

function titleCase(raw: string) {
  const s = raw.trim();
  if (!s) return "";
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export default function StaffPage() {
  const { t, locale } = useLocale();
  const { profile } = useAuth();
  const { runAction, busy: actionBusy } = useAction();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<AppUser | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  const me = profile as AppUser | null;
  const iAmPrimary = Boolean(
    me &&
      (canManageOwners(me) ||
        users.some((u) => u.uid === me.uid && isPrimaryOwner(u))),
  );

  const load = useCallback(async () => {
    setPageLoading(true);
    setLoadError(null);
    try {
      if (profile?.role === "owner") {
        const token = await getClientAuth().currentUser?.getIdToken();
        if (token) {
          await apiFetch("/api/admin/users", {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null);
        }
      }
      const [u, b] = await Promise.all([fetchUsers(), fetchBranches()]);
      u.sort((a, c) => {
        if (isPrimaryOwner(a) !== isPrimaryOwner(c)) return isPrimaryOwner(a) ? -1 : 1;
        if (a.role === "owner" && c.role !== "owner") return -1;
        if (c.role === "owner" && a.role !== "owner") return 1;
        return 0;
      });
      setUsers(u);
      setBranches(b);
    } catch (e) {
      setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
    } finally {
      setPageLoading(false);
    }
  }, [locale, t, profile?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  useRetryOnReconnect(Boolean(loadError) && !pageLoading, () => {
    void load();
  });

  const branchName = useMemo(() => {
    const m = new Map<string, string>();
    branches.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [branches]);

  async function toggleActive(u: AppUser) {
    if (!me || !canDeactivateUser(me, u)) {
      setActionError(t("primaryOwnerProtected"));
      setPendingToggle(null);
      return;
    }
    const nextActive = !u.isActive;
    setUsers((list) =>
      list.map((x) => (x.uid === u.uid ? { ...x, isActive: nextActive } : x)),
    );
    setBusyUid(u.uid);
    setPendingToggle(null);
    setActionError(null);
    const result = await runAction(
      async ({ signal }) => {
        const token = await getClientAuth().currentUser?.getIdToken();
        if (!token) throw new Error("Not logged in");
        const res = await apiFetch(
          "/api/admin/users",
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ uid: u.uid, isActive: nextActive }),
          },
          { signal },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed");
      },
      { label: t("pleaseWait"), silentFail: true },
    );
    if (!result.ok) {
      setUsers((list) =>
        list.map((x) => (x.uid === u.uid ? { ...x, isActive: u.isActive } : x)),
      );
      if (result.message !== t("errOffline")) {
        notifyActionFailed(result.message, setActionError);
      } else {
        setActionError(result.message);
      }
    }
    setBusyUid(null);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="admin-page-title">{t("staffTitle")}</h1>
          <p className="admin-page-sub">{t("staffHint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {iAmPrimary ? (
            <Link href="/admin/staff/new-owner" className="btn btn-ghost btn-sm min-h-11">
              {t("addOwner")}
            </Link>
          ) : null}
          <Link href="/admin/staff/new" className="btn btn-sm min-h-11">
            {t("addStaff")}
          </Link>
        </div>
      </div>

      {actionError ? <div className="toast-error mb-4">{actionError}</div> : null}

      {pageLoading ? <PageSpinner label={t("loading")} /> : null}

      {!pageLoading && loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} />
      ) : null}

      {!pageLoading && !loadError ? (
        <div className="space-y-3">
          {users.map((u) => {
            const name = titleCase(u.displayName || u.email.split("@")[0] || "");
            const roleLabel = isPrimaryOwner(u)
              ? t("roleMainOwner")
              : u.role === "owner"
                ? t("roleOwner")
                : t("roleStaff");
            const branchesLabel =
              u.role === "owner"
                ? t("allBranches")
                : u.branchIds.map((id) => branchName.get(id) || id).join(", ") || "—";
            const canEdit = me ? canEditManagedUser(me, u) : false;
            const canDisable = me ? canDeactivateUser(me, u) : false;
            return (
              <div
                key={u.uid}
                className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold capitalize text-[var(--ink)]">{name}</p>
                    <span className="rounded-md bg-[#f6e6d4] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--gold-deep)]">
                      {roleLabel}
                    </span>
                    {!u.isActive ? (
                      <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {t("inactive")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]" dir="ltr">
                    {u.email}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{branchesLabel}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {canEdit ? (
                    <Link
                      href={`/admin/staff/${u.uid}/edit`}
                      className="btn btn-ghost btn-sm min-h-11"
                    >
                      {t("edit")}
                    </Link>
                  ) : null}
                  {canDisable ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm min-h-11"
                      disabled={busyUid === u.uid || actionBusy}
                      onClick={() => setPendingToggle(u)}
                    >
                      {busyUid === u.uid ? <ButtonSpinner /> : null}
                      {u.isActive ? t("disable") : t("enable")}
                    </button>
                  ) : null}
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
            ? t("confirmDisableStaffTitle")
            : t("confirmEnableStaffTitle")
        }
        message={
          pendingToggle?.isActive
            ? pendingToggle.role === "owner"
              ? t("confirmDisableOwner")
              : t("confirmDisableStaff")
            : t("confirmEnableStaff")
        }
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={Boolean(busyUid)}
        danger={Boolean(pendingToggle?.isActive)}
        onCancel={() => {
          if (!busyUid) setPendingToggle(null);
        }}
        onConfirm={() => {
          if (pendingToggle) void toggleActive(pendingToggle);
        }}
      />
    </div>
  );
}
