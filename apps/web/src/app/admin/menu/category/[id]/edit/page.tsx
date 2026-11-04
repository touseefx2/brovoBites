"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Category } from "@bravobites/domain";
import { CategoryForm } from "@/components/CategoryForm";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchCategory } from "@/lib/firestore";

export default function EditCategoryPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const [category, setCategory] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = decodeURIComponent(params.id);
    fetchCategory(id)
      .then((c) => {
        setCategory(c);
        if (!c) setError("Category not found");
      })
      .catch((e) => setError(mapFirebaseError(e)))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <p className="text-sm text-[var(--muted)]">{t("loading")}</p>;
  if (error || !category) {
    return (
      <div>
        <div className="toast-error mb-4">{error || "Category not found"}</div>
        <Link href="/admin/menu" className="btn btn-ghost btn-sm">
          {t("backToMenu")}
        </Link>
      </div>
    );
  }

  return <CategoryForm mode="edit" initial={category} />;
}
