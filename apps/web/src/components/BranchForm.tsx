"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Branch } from "@bravobites/domain";
import { branchMapsUrl } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { upsertBranch } from "@/lib/firestore";
import { useAction } from "@/components/ActionProvider";

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function parseCoord(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type BranchFormState = {
  id: string;
  name: string;
  phone: string;
  address: string;
  latitude: string;
  longitude: string;
  isActive: boolean;
  createdAt?: string;
};

export function emptyBranchForm(): BranchFormState {
  return {
    id: "",
    name: "",
    phone: "",
    address: "",
    latitude: "",
    longitude: "",
    isActive: true,
  };
}

export function branchToForm(b: Branch): BranchFormState {
  return {
    id: b.id,
    name: b.name,
    phone: b.phone,
    address: b.address,
    latitude: b.latitude == null || Number.isNaN(b.latitude) ? "" : String(b.latitude),
    longitude:
      b.longitude == null || Number.isNaN(b.longitude) ? "" : String(b.longitude),
    isActive: b.isActive,
    createdAt: b.createdAt,
  };
}

export function BranchForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial: BranchFormState;
}) {
  const { t } = useLocale();
  const { runAction, busy: actionBusy } = useAction();
  const router = useRouter();
  const [form, setForm] = useState<BranchFormState>(initial);
  const [error, setError] = useState<string | null>(null);

  const previewMaps = branchMapsUrl({
    name: form.name,
    address: form.address,
    latitude: parseCoord(form.latitude),
    longitude: parseCoord(form.longitude),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const lat = parseCoord(form.latitude);
    const lng = parseCoord(form.longitude);
    if ((form.latitude.trim() && lat == null) || (form.longitude.trim() && lng == null)) {
      setError("Latitude/Longitude must be valid numbers (e.g. 31.5204).");
      return;
    }
    if ((lat == null) !== (lng == null)) {
      setError("Enter both latitude and longitude, or leave both empty.");
      return;
    }

    const id =
      mode === "edit" ? form.id : slugify(form.name) || `branch-${Date.now()}`;

    const result = await runAction(
      (_ctx) =>
        upsertBranch({
          id,
          name: form.name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          latitude: lat,
          longitude: lng,
          isActive: form.isActive,
          createdAt: form.createdAt ?? new Date().toISOString(),
        }),
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
    router.push("/admin/branches");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gold-deep)]">
            {mode === "edit" ? t("editingBranch") : t("addNewBranch")}
          </p>
          <h1 className="text-2xl font-bold text-[var(--ink)]">
            {mode === "edit" ? form.name || t("editBranch") : t("addBranch")}
          </h1>
        </div>
        <Link href="/admin/branches" className="btn btn-ghost btn-sm">
          {t("backToBranches")}
        </Link>
      </div>

      {error ? <div className="toast-error mb-4">{error}</div> : null}

      <form onSubmit={onSubmit} className="card grid max-w-3xl gap-3 md:grid-cols-2">
        <label className="text-sm text-[var(--muted)]">
          {t("name")}
          <input
            className="input mt-1"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          {t("phone")}
          <input
            className="input mt-1"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="03XX-XXXXXXX"
            dir="ltr"
          />
        </label>

        <label className="text-sm text-[var(--muted)] md:col-span-2">
          {t("address")}
          <textarea
            className="input mt-1 min-h-[72px] resize-y"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="Shop #12, Main Road, Block A, Lahore"
          />
        </label>

        <div className="md:col-span-2 rounded-xl border border-dashed border-[var(--border)] bg-[#faf7f2] p-3">
          <p className="mb-2 text-sm font-semibold text-[var(--ink)]">{t("location")}</p>
          <p className="mb-3 text-xs text-[var(--muted)]" dir="ltr">
            {t("latLongHint")}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-[var(--muted)]">
              {t("latitude")}
              <input
                className="input mt-1"
                value={form.latitude}
                onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                placeholder="31.5204"
                dir="ltr"
                inputMode="decimal"
              />
            </label>
            <label className="text-sm text-[var(--muted)]">
              {t("longitude")}
              <input
                className="input mt-1"
                value={form.longitude}
                onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                placeholder="74.3587"
                dir="ltr"
                inputMode="decimal"
              />
            </label>
          </div>
          {previewMaps ? (
            <a
              href={previewMaps}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm mt-3 inline-flex"
              dir="ltr"
            >
              {t("openInMaps")} ↗
            </a>
          ) : (
            <p className="mt-3 text-xs text-[var(--muted)]">{t("mapsUnavailable")}</p>
          )}
        </div>

        <div className="md:col-span-2 flex flex-wrap gap-2">
          <button className="btn" type="submit" disabled={actionBusy}>
            {actionBusy ? t("saving") : mode === "edit" ? t("saveBranch") : t("addBranch")}
          </button>
          <Link href="/admin/branches" className="btn btn-ghost btn-sm self-center">
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
