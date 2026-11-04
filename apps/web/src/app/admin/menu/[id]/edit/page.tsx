"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Category, Product } from "@bravobites/domain";
import { ProductForm } from "@/components/ProductForm";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchCategories, fetchProduct } from "@/lib/firestore";

export default function EditProductPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = decodeURIComponent(params.id);
    (async () => {
      try {
        const p = await fetchProduct(id);
        setProduct(p);
        if (!p) {
          setError("Product not found");
          return;
        }
        setCategories(await fetchCategories());
      } catch (e) {
        setError(mapFirebaseError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id]);

  if (loading) return <p className="text-sm text-[var(--muted)]">{t("loading")}</p>;
  if (error || !product) {
    return (
      <div>
        <div className="toast-error mb-4">{error || "Product not found"}</div>
        <Link href="/admin/menu" className="btn btn-ghost btn-sm">
          {t("backToMenu")}
        </Link>
      </div>
    );
  }

  return <ProductForm mode="edit" initial={product} categories={categories} />;
}
