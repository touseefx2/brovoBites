"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Category } from "@bravobites/domain";
import { emptyProduct, ProductForm } from "@/components/ProductForm";
import { PageSpinner } from "@/components/Loading";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchCategories } from "@/lib/firestore";

function NewProductForm() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const preferredCategoryId = (searchParams.get("category") || "").trim();

  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setCategories(await fetchCategories());
      } catch (e) {
        setError(mapFirebaseError(e));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) return <PageSpinner label={t("loading")} />;
  if (error) return <div className="toast-error">{error}</div>;

  const fromQuery =
    preferredCategoryId && categories.some((c) => c.id === preferredCategoryId)
      ? preferredCategoryId
      : "";
  const categoryId =
    fromQuery ||
    categories.find((c) => c.isActive)?.id ||
    categories[0]?.id ||
    "";

  return (
    <ProductForm
      mode="create"
      initial={emptyProduct(undefined, categoryId)}
      categories={categories}
    />
  );
}

export default function NewProductPage() {
  const { t } = useLocale();
  return (
    <Suspense fallback={<PageSpinner label={t("loading")} />}>
      <NewProductForm />
    </Suspense>
  );
}
