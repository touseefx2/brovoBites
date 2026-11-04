"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Branch } from "@bravobites/domain";
import { BranchForm, branchToForm } from "@/components/BranchForm";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchBranches } from "@/lib/firestore";

export default function EditBranchPage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = decodeURIComponent(params.id);
    fetchBranches()
      .then((list) => {
        const found = list.find((b) => b.id === id) ?? null;
        setBranch(found);
        if (!found) setError("Branch not found");
      })
      .catch((e) => setError(mapFirebaseError(e)))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">{t("loading")}</p>;
  }

  if (error || !branch) {
    return (
      <div>
        <div className="toast-error mb-4">{error || "Branch not found"}</div>
        <Link href="/admin/branches" className="btn btn-ghost btn-sm">
          {t("backToBranches")}
        </Link>
      </div>
    );
  }

  return <BranchForm mode="edit" initial={branchToForm(branch)} />;
}
