"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Category, DealLineItem, Product, ProductType, ProductVariation } from "@bravobites/domain";
import { SHARED_MENU_ID } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { fetchProducts, saveProduct } from "@/lib/firestore";
import { getImageUploadProvider, uploadProductImage, deleteUploadedImage } from "@/lib/storage";
import { mapFirebaseError } from "@/lib/errors";
import { useAction } from "@/components/ActionProvider";
import { ImageUploadField } from "@/components/ImageUpload";
import { isBundledPlaceholder } from "@/lib/menu-images";

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_SIZES: ProductVariation[] = [
  { id: "s", label: "S", price: 0 },
  { id: "m", label: "M", price: 0 },
  { id: "l", label: "L", price: 0 },
  { id: "xl", label: "XL", price: 0 },
];

/** Central menu — branchId arg ignored. */
export function emptyProduct(_branchId: string | undefined, categoryId: string): Product {
  return {
    id: newId("prod"),
    branchId: SHARED_MENU_ID,
    categoryId,
    name: "",
    type: "simple",
    basePrice: 0,
    variations: [],
    dealItems: [],
    imageUrl: "",
    compareAtPrice: null,
    isActive: true,
    sortOrder: Date.now(),
  };
}

export function ProductForm({
  mode,
  initial,
  categories,
}: {
  mode: "create" | "edit";
  initial: Product;
  categories: Category[];
}) {
  const { t } = useLocale();
  const { runAction, busy: actionBusy } = useAction();
  const router = useRouter();
  const [form, setForm] = useState<Product>(initial);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuProducts, setMenuProducts] = useState<Product[]>([]);

  const menuHref = "/admin/menu";

  useEffect(() => {
    let cancelled = false;
    void fetchProducts()
      .then((list) => {
        if (!cancelled) setMenuProducts(list);
      })
      .catch(() => {
        if (!cancelled) setMenuProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive || c.id === form.categoryId),
    [categories, form.categoryId],
  );

  /** Stockable components for deals — not other deals, not self. */
  const dealComponentOptions = useMemo(
    () =>
      menuProducts
        .filter((p) => p.type !== "bundle" && p.id !== form.id && p.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [menuProducts, form.id],
  );

  const dealOptionsByCategory = useMemo(() => {
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const groups = new Map<string, Product[]>();
    for (const p of dealComponentOptions) {
      const key = p.categoryId || "_other";
      const list = groups.get(key) ?? [];
      list.push(p);
      groups.set(key, list);
    }
    const ordered: { key: string; label: string; products: Product[] }[] = [];
    for (const c of categories) {
      const list = groups.get(c.id);
      if (list?.length) ordered.push({ key: c.id, label: c.name, products: list });
    }
    const orphan = groups.get("_other");
    if (orphan?.length) {
      ordered.push({ key: "_other", label: t("other"), products: orphan });
    }
    // Categories not in active list but referenced
    for (const [key, list] of groups) {
      if (key === "_other" || ordered.some((g) => g.key === key)) continue;
      ordered.push({ key, label: catName.get(key) || key, products: list });
    }
    return ordered;
  }, [dealComponentOptions, categories, t]);

  function setType(type: ProductType) {
    setForm((f) => ({
      ...f,
      type,
      variations:
        type === "sized"
          ? f.variations.length
            ? f.variations
            : DEFAULT_SIZES.map((v) => ({ ...v }))
          : [],
      dealItems: type === "bundle" ? f.dealItems : [],
      basePrice: type === "sized" ? 0 : f.basePrice,
    }));
  }

  function setDealProduct(idx: number, productId: string) {
    const p = dealComponentOptions.find((x) => x.id === productId);
    setForm((f) => {
      const dealItems = [...f.dealItems];
      const prev = dealItems[idx];
      if (!prev) return f;
      dealItems[idx] = {
        productId,
        label: p?.name ?? prev.label,
        qty: prev.qty,
      };
      return { ...f, dealItems };
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.categoryId) {
      setError("Select a category");
      return;
    }
    if (!form.name.trim()) {
      setError("Product name is required");
      return;
    }
    if (pendingImage && getImageUploadProvider() === "none") {
      setError(t("imageUploadNotConfigured"));
      return;
    }
    if (form.type === "bundle") {
      const linked = form.dealItems.filter((d) => d.productId);
      if (linked.length === 0) {
        setError(t("dealNeedsProducts"));
        return;
      }
    }

    const result = await runAction(
      async () => {
        const oldImageUrl = initial.imageUrl;
        let imageUrl = form.imageUrl;
        if (pendingImage) {
          try {
            imageUrl = await uploadProductImage(pendingImage, form.branchId);
          } catch (e) {
            throw e instanceof Error ? e : new Error(mapFirebaseError(e));
          }
        }
        const payload: Product = {
          ...form,
          imageUrl,
          name: form.name.trim(),
          basePrice: form.type === "sized" ? 0 : Number(form.basePrice) || 0,
          variations:
            form.type === "sized"
              ? form.variations.map((v) => ({
                  ...v,
                  label: v.label.trim() || v.id.toUpperCase(),
                  price: Number(v.price) || 0,
                }))
              : [],
          dealItems:
            form.type === "bundle"
              ? form.dealItems
                  .filter((d) => d.productId)
                  .map((d) => {
                    const p = menuProducts.find((x) => x.id === d.productId);
                    const line: DealLineItem = {
                      productId: d.productId!,
                      label: (p?.name || d.label).trim(),
                      qty: Math.max(1, Number(d.qty) || 1),
                    };
                    return line;
                  })
              : [],
        };
        await saveProduct(payload);
        if (oldImageUrl && oldImageUrl !== imageUrl) {
          void deleteUploadedImage(oldImageUrl);
        }
      },
      {
        label: t("saving"),
        silentFail: true,
      },
    );
    if (!result.ok) {
      const msg =
        result.message !== t("errOffline")
          ? result.message || mapFirebaseError(new Error(result.message))
          : result.message;
      setError(msg);
      if (result.message !== t("errOffline")) window.alert(msg);
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
            {mode === "edit" ? t("editProduct") : t("addMenuItem")}
          </p>
          <h1 className="admin-page-title break-words">
            {mode === "edit" ? form.name || t("editProduct") : t("addProduct")}
          </h1>
        </div>
        <Link href={menuHref} className="btn btn-ghost btn-sm">
          {t("backToMenu")}
        </Link>
      </div>

      {error ? <div className="toast-error mb-4">{error}</div> : null}

      {!activeCategories.length ? (
        <div className="card max-w-xl space-y-3">
          <p className="text-sm text-[var(--muted)]">{t("emptyMenu")}</p>
          <Link
            href="/admin/menu/category/new"
            className="btn btn-sm inline-flex"
          >
            {t("addCategory")}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card grid max-w-3xl gap-3 md:grid-cols-2">
          <label className="text-sm text-[var(--muted)] md:col-span-2">
            {t("productName")}
            <input
              className="input mt-1"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </label>

          <label className="text-sm text-[var(--muted)]">
            {t("category")}
            <select
              className="input mt-1"
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              required
            >
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-[var(--muted)]">
            {t("type")}
            <select
              className="input mt-1"
              value={form.type}
              onChange={(e) => setType(e.target.value as ProductType)}
            >
              <option value="simple">{t("simple")}</option>
              <option value="sized">{t("sized")}</option>
              <option value="bundle">{t("bundle")}</option>
            </select>
          </label>

          <ImageUploadField
            label={t("productImage")}
            hint={t("productImageHint")}
            remoteUrl={isBundledPlaceholder(form.imageUrl) ? "" : form.imageUrl}
            pendingFile={pendingImage}
            disabled={actionBusy}
            onPendingFile={setPendingImage}
            onClearRemote={() => setForm((f) => ({ ...f, imageUrl: "" }))}
          />

          {form.type === "bundle" ? (
            <label className="text-sm text-[var(--muted)] md:col-span-2">
              {t("compareAtPrice")}
              <input
                className="input mt-1"
                type="number"
                min={0}
                value={form.compareAtPrice ?? ""}
                placeholder={t("compareAtPriceHint")}
                dir="ltr"
                onChange={(e) => {
                  const raw = e.target.value;
                  setForm((f) => ({
                    ...f,
                    compareAtPrice: raw === "" ? null : Number(raw),
                  }));
                }}
              />
            </label>
          ) : null}

          {form.type !== "sized" ? (
            <label className="text-sm text-[var(--muted)] md:col-span-2">
              {t("price")}
              <input
                className="input mt-1"
                type="number"
                min={0}
                value={form.basePrice}
                onChange={(e) =>
                  setForm((f) => ({ ...f, basePrice: Number(e.target.value) }))
                }
                dir="ltr"
                required
              />
            </label>
          ) : null}

          {form.type === "sized" ? (
            <div className="md:col-span-2 space-y-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--bb-cream-100)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--ink)]">{t("variations")}</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      variations: [
                        ...f.variations,
                        { id: newId("v"), label: "", price: 0 },
                      ],
                    }))
                  }
                >
                  {t("addVariation")}
                </button>
              </div>
              {form.variations.map((v, idx) => (
                <div key={v.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    className="input"
                    placeholder={t("label")}
                    value={v.label}
                    onChange={(e) => {
                      const variations = [...form.variations];
                      variations[idx] = { ...v, label: e.target.value };
                      setForm((f) => ({ ...f, variations }));
                    }}
                  />
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder={t("price")}
                    value={v.price}
                    dir="ltr"
                    onChange={(e) => {
                      const variations = [...form.variations];
                      variations[idx] = { ...v, price: Number(e.target.value) };
                      setForm((f) => ({ ...f, variations }));
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        variations: f.variations.filter((_, i) => i !== idx),
                      }))
                    }
                    aria-label={t("remove")}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {form.type === "bundle" ? (
            <div className="md:col-span-2 space-y-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--bb-cream-100)] p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">{t("dealContents")}</p>
                  <p className="text-xs text-[var(--muted)]">{t("dealContentsHint")}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm shrink-0"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      dealItems: [
                        ...f.dealItems,
                        {
                          productId: dealComponentOptions[0]?.id,
                          label: dealComponentOptions[0]?.name ?? "",
                          qty: 1,
                        },
                      ],
                    }))
                  }
                  disabled={dealComponentOptions.length === 0}
                >
                  {t("addDealLine")}
                </button>
              </div>
              {dealComponentOptions.length === 0 ? (
                <p className="text-xs text-amber-800">{t("dealNoComponents")}</p>
              ) : null}
              {form.dealItems.map((d: DealLineItem, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem_auto]">
                  <select
                    className="input min-h-11 text-base sm:min-h-0 sm:text-sm"
                    value={d.productId ?? ""}
                    onChange={(e) => setDealProduct(idx, e.target.value)}
                    required
                  >
                    <option value="">{t("dealPickProduct")}</option>
                    {dealOptionsByCategory.map((g) => (
                      <optgroup key={g.key} label={g.label}>
                        {g.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <input
                    className="input min-h-11 text-base sm:min-h-0 sm:text-sm"
                    type="number"
                    min={1}
                    placeholder={t("qty")}
                    value={d.qty}
                    dir="ltr"
                    onChange={(e) => {
                      const dealItems = [...form.dealItems];
                      dealItems[idx] = { ...d, qty: Number(e.target.value) };
                      setForm((f) => ({ ...f, dealItems }));
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        dealItems: f.dealItems.filter((_, i) => i !== idx),
                      }))
                    }
                    aria-label={t("remove")}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="md:col-span-2 flex flex-wrap items-center gap-2 pt-1">
            <button className="btn" type="submit" disabled={actionBusy}>
              {actionBusy ? t("saving") : t("save")}
            </button>
            <Link href={menuHref} className="btn btn-ghost">
              {t("cancel")}
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
