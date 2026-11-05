"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Category } from "@bravobites/domain";
import { SHARED_MENU_ID } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { saveCategory } from "@/lib/firestore";
import { getImageUploadProvider, uploadCategoryImage, deleteUploadedImage } from "@/lib/storage";
import { useAction } from "@/components/ActionProvider";
import { isBundledPlaceholder } from "@/lib/menu-images";
import { ImageUploadField } from "@/components/ImageUpload";

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Central menu — every category lives in the shared menu. */
export function emptyCategory(): Category {
  return {
    id: newId("cat"),
    branchId: SHARED_MENU_ID,
    name: "",
    imageUrl: "",
    sortOrder: Date.now(),
    isActive: true,
  };
}

export function CategoryForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial: Category;
}) {
  const { t } = useLocale();
  const { runAction, busy: actionBusy } = useAction();
  const router = useRouter();
  const [form, setForm] = useState<Category>(initial);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const menuHref = "/admin/menu";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pendingImage && getImageUploadProvider() === "none") {
      setError(t("imageUploadNotConfigured"));
      return;
    }
    const result = await runAction(
      async () => {
        const oldImageUrl = initial.imageUrl;
        let imageUrl = form.imageUrl;
        if (pendingImage) {
          imageUrl = await uploadCategoryImage(pendingImage, form.branchId);
        }
        await saveCategory({
          ...form,
          imageUrl,
          name: form.name.trim(),
        });
        if (oldImageUrl && oldImageUrl !== imageUrl) {
          void deleteUploadedImage(oldImageUrl);
        }
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
    setPendingImage(null);
    router.push(menuHref);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="admin-page-eyebrow">
            {mode === "edit" ? t("editCategory") : t("addCategory")}
          </p>
          <h1 className="admin-page-title break-words">
            {mode === "edit" ? form.name || t("editCategory") : t("addCategory")}
          </h1>
        </div>
        <Link href={menuHref} className="btn btn-ghost btn-sm">
          {t("backToMenu")}
        </Link>
      </div>

      {error ? <div className="toast-error mb-4">{error}</div> : null}

      <form onSubmit={onSubmit} className="card grid max-w-xl gap-3">
        <label className="text-sm text-[var(--muted)]">
          {t("categoryName")}
          <input
            className="input mt-1"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </label>
        <ImageUploadField
          label={t("categoryImage")}
          hint={t("categoryImageHint")}
          remoteUrl={isBundledPlaceholder(form.imageUrl) ? "" : form.imageUrl}
          pendingFile={pendingImage}
          disabled={actionBusy}
          onPendingFile={setPendingImage}
          onClearRemote={() => setForm((f) => ({ ...f, imageUrl: "" }))}
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button className="btn" type="submit" disabled={actionBusy}>
            {actionBusy ? t("saving") : t("save")}
          </button>
          <Link href={menuHref} className="btn btn-ghost">
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
