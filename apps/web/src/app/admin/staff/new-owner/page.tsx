"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  canManageOwners,
  type AppUser,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { getClientAuth } from "@/lib/firebase/client";
import { useAction } from "@/components/ActionProvider";
import { apiFetch } from "@/lib/http";

export default function NewOwnerPage() {
  const { t } = useLocale();
  const { profile } = useAuth();
  const { runAction, busy: actionBusy } = useAction();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const allowed = profile ? canManageOwners(profile as AppUser) : false;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!allowed) {
      setError(t("primaryOwnerOnly"));
      return;
    }
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
              role: "owner",
              branchIds: [],
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
      setError(result.message);
      if (result.message !== t("errOffline")) {
        window.alert(result.message);
      }
      return;
    }
    router.push("/admin/staff");
    router.refresh();
  }

  if (profile && !allowed) {
    return (
      <div>
        <p className="toast-error">{t("primaryOwnerOnly")}</p>
        <Link href="/admin/staff" className="btn btn-ghost btn-sm mt-4">
          {t("backToStaff")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gold-deep)]">
            {t("addOwner")}
          </p>
          <h1 className="text-xl font-bold text-[var(--ink)] sm:text-2xl">
            {t("createOwner")}
          </h1>
          <p className="mt-1 max-w-lg text-sm text-[var(--muted)]">{t("createOwnerHint")}</p>
        </div>
        <Link href="/admin/staff" className="btn btn-ghost btn-sm">
          {t("backToStaff")}
        </Link>
      </div>

      {error ? <div className="toast-error mb-4">{error}</div> : null}

      <form onSubmit={onCreate} className="card grid max-w-2xl gap-3 sm:grid-cols-2">
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
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button className="btn min-h-11" type="submit" disabled={actionBusy}>
            {actionBusy ? t("creating") : t("createOwner")}
          </button>
          <Link href="/admin/staff" className="btn btn-ghost btn-sm self-center">
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
