"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Branch, StaffPermissions } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchBranches } from "@/lib/firestore";
import { getClientAuth } from "@/lib/firebase/client";
import { useAction } from "@/components/ActionProvider";
import { apiFetch } from "@/lib/http";

export default function NewStaffPage() {
  const { t } = useLocale();
  const { runAction, busy: actionBusy } = useAction();
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState("");
  const [permissions, setPermissions] = useState<StaffPermissions>({
    canAddExpenses: true,
    canDeleteExpenses: true,
    canApplyDiscount: true,
    canEditOrders: true,
    canCancelOrders: true,
    canManageInventory: true,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBranches()
      .then((b) => {
        const active = b.filter((x) => x.isActive);
        setBranches(active);
      })
      .catch((e) => setError(mapFirebaseError(e)));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await runAction(
      async ({ signal }) => {
        const token = await getClientAuth().currentUser?.getIdToken();
        if (!token) throw new Error("Not logged in");
        const res = await apiFetch(
          "/api/admin/users",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email,
              password,
              displayName: displayName.trim(),
              phone: phone.trim(),
              role: "counter",
              branchIds: [branchId],
              permissions,
            }),
          },
          { signal },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        return data;
      },
      { label: t("creating"), silentFail: true },
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="admin-page-eyebrow">
            {t("addStaff")}
          </p>
          <h1 className="admin-page-title">{t("createCounter")}</h1>
        </div>
        <Link href="/admin/staff" className="btn btn-ghost btn-sm">
          {t("backToStaff")}
        </Link>
      </div>

      {error ? <div className="toast-error mb-4">{error}</div> : null}

      <form onSubmit={onCreate} className="card grid max-w-2xl gap-3 md:grid-cols-2">
        <label className="text-sm text-[var(--muted)]">
          {t("name")}
          <input
            className="input mt-1"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          {t("branch")}
          <select
            className="input mt-1"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            required
          >
            <option value="" disabled>{t("selectBranch")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
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
        <label className="text-sm text-[var(--muted)]">
          {t("email")}
          <input
            className="input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            dir="ltr"
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          {t("password")}
          <input
            className="input mt-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            dir="ltr"
          />
        </label>
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
              <label key={p.key} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-white p-3 cursor-pointer hover:border-[var(--gold)]">
                <input
                  type="checkbox"
                  checked={permissions[p.key]}
                  onChange={(e) => setPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))}
                  className="h-4 w-4 accent-[var(--gold-deep)]"
                />
                <span className="text-sm text-[var(--ink)]">{t(p.label)}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-[var(--gold-deep)] hover:underline"
            onClick={() => setPermissions({ canAddExpenses: true, canDeleteExpenses: true, canApplyDiscount: true, canEditOrders: true, canCancelOrders: true, canManageInventory: true })}
          >
            {t("resetPermissions")}
          </button>
        </div>
        <div className="md:col-span-2 flex flex-wrap gap-2">
          <button className="btn" type="submit" disabled={actionBusy || !branchId}>
            {actionBusy ? t("creating") : t("createCounter")}
          </button>
          <Link href="/admin/staff" className="btn btn-ghost btn-sm self-center">
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
