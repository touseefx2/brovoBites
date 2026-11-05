"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  canEditManagedUser,
  isPrimaryOwner,
  type AppUser,
  type Branch,
  type StaffPermissions,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchBranches, fetchUsers } from "@/lib/firestore";
import { getClientAuth } from "@/lib/firebase/client";
import { useAction } from "@/components/ActionProvider";
import { PageSpinner } from "@/components/Loading";
import { apiFetch } from "@/lib/http";
import { useAuth } from "@/lib/auth-context";

export default function EditStaffPage() {
  const { t } = useLocale();
  const { profile } = useAuth();
  const { runAction, busy: actionBusy } = useAction();
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const [user, setUser] = useState<AppUser | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState("");
  const [password, setPassword] = useState("");
  const [permissions, setPermissions] = useState<StaffPermissions>({
    canAddExpenses: true,
    canDeleteExpenses: true,
    canApplyDiscount: true,
    canEditOrders: true,
    canCancelOrders: true,
    canManageInventory: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const isOwnerTarget = user?.role === "owner";
  const editingSelf = Boolean(profile && user && profile.uid === user.uid);
  const editingPrimarySelf = Boolean(user && isPrimaryOwner(user) && editingSelf);
  /** Password: co-owners + staff (and optional self). Not for primary self — name/phone only. */
  const showPasswordField = Boolean(user && !editingPrimarySelf);

  useEffect(() => {
    const uid = decodeURIComponent(params.uid);
    Promise.all([fetchUsers(), fetchBranches()])
      .then(([users, b]) => {
        const found = users.find((u) => u.uid === uid) ?? null;
        setUser(found);
        setBranches(b.filter((x) => x.isActive || found?.branchIds.includes(x.id)));
        if (!found) {
          setError("Staff not found");
          return;
        }
        const actor = profile as AppUser | null;
        if (!actor || !canEditManagedUser(actor, found)) {
          setForbidden(true);
          setError(t("primaryOwnerOnly"));
          return;
        }
        setDisplayName(found.displayName);
        setPhone(found.phone || "");
        setBranchId(found.branchIds[0] || b[0]?.id || "");
        if (found.permissions) {
          setPermissions(found.permissions);
        }
      })
      .catch((e) => setError(mapFirebaseError(e)))
      .finally(() => setLoading(false));
  }, [params.uid, profile, t]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    const result = await runAction(
      async ({ signal }) => {
        const token = await getClientAuth().currentUser?.getIdToken();
        if (!token) throw new Error("Not logged in");
        const payload: Record<string, unknown> = {
          uid: user.uid,
          displayName: displayName.trim(),
          phone: phone.trim(),
        };
        if (showPasswordField && password.trim()) {
          payload.password = password.trim();
        }
        if (user.role === "counter") {
          payload.branchIds = branchId ? [branchId] : [];
          payload.permissions = permissions;
        }
        const res = await apiFetch(
          "/api/admin/users",
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          },
          { signal },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        return data;
      },
      { label: t("saving"), silentFail: true },
    );
    if (!result.ok) {
      if (result.message !== t("errOffline")) {
        setError(result.message);
        window.alert(result.message);
      } else {
        setError(result.message);
      }
      return;
    }
    router.push("/admin/staff");
    router.refresh();
  }

  if (loading) {
    return <PageSpinner label={t("loading")} />;
  }

  if (error && (!user || forbidden)) {
    return (
      <div>
        <div className="toast-error mb-4">{error}</div>
        <Link href="/admin/staff" className="btn btn-ghost btn-sm">
          {t("backToStaff")}
        </Link>
      </div>
    );
  }

  if (!user) {
    return (
      <div>
        <div className="toast-error mb-4">{error || "Cannot edit"}</div>
        <Link href="/admin/staff" className="btn btn-ghost btn-sm">
          {t("backToStaff")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="admin-page-eyebrow">
            {editingPrimarySelf
              ? t("editProfile")
              : isOwnerTarget
                ? t("editOwner")
                : t("editStaff")}
          </p>
          <h1 className="admin-page-title">
            {displayName || user.email}
          </h1>
          <p className="mt-1 text-xs text-[var(--muted)]" dir="ltr">
            {user.email}
          </p>
        </div>
        <Link href="/admin/staff" className="btn btn-ghost btn-sm">
          {t("backToStaff")}
        </Link>
      </div>

      {error ? <div className="toast-error mb-4">{error}</div> : null}

      <form onSubmit={onSave} className="card grid max-w-2xl gap-3 md:grid-cols-2">
        <label className="text-sm text-[var(--muted)] md:col-span-2">
          {t("name")}
          <input
            className="input mt-1"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)] md:col-span-2">
          {t("phone")}
          <input
            className="input mt-1"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            placeholder="03XX-XXXXXXX"
          />
        </label>
        {!isOwnerTarget ? (
          <label className="text-sm text-[var(--muted)] md:col-span-2">
            {t("branch")}
            <select
              className="input mt-1"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              required
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {showPasswordField ? (
          <label className="text-sm text-[var(--muted)] md:col-span-2">
            {t("newPassword")}
            <input
              className="input mt-1"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              placeholder="••••••••"
              dir="ltr"
            />
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {t("leavePasswordBlank")}
            </span>
          </label>
        ) : null}
        {!isOwnerTarget ? (
          <div className="md:col-span-2 mt-2">
            <p className="mb-2 text-sm font-semibold text-[var(--ink)]">{t("permissions")}</p>
            <p className="mb-3 text-xs text-[var(--muted)]">{t("permissionsHint")}</p>
            <div className="space-y-2">
              {([
                { key: "canAddExpenses" as const, label: "permAddExpenses" as const },
                { key: "canDeleteExpenses" as const, label: "permDeleteExpenses" as const },
                { key: "canApplyDiscount" as const, label: "permApplyDiscount" as const },
                { key: "canEditOrders" as const, label: "permEditOrders" as const },
                { key: "canCancelOrders" as const, label: "permCancelOrders" as const },
                { key: "canManageInventory" as const, label: "permManageInventory" as const },
              ] as const).map((p) => (
                <label
                  key={p.key}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-white p-3 hover:border-[var(--gold)]"
                >
                  <input
                    type="checkbox"
                    checked={permissions[p.key]}
                    onChange={(e) =>
                      setPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[var(--gold-deep)]"
                  />
                  <span className="text-sm text-[var(--ink)]">{t(p.label)}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 text-xs text-[var(--gold-deep)] hover:underline"
              onClick={() =>
                setPermissions({
                  canAddExpenses: true,
                  canDeleteExpenses: true,
                  canApplyDiscount: true,
                  canEditOrders: true,
                  canCancelOrders: true,
                  canManageInventory: true,
                })
              }
            >
              {t("resetPermissions")}
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button className="btn min-h-11" type="submit" disabled={actionBusy}>
            {actionBusy ? t("saving") : t("save")}
          </button>
          <Link href="/admin/staff" className="btn btn-ghost btn-sm self-center">
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
