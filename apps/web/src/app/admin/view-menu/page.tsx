"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageSpinner } from "@/components/Loading";
import { useLocale } from "@/i18n/locale-context";

/** Legacy route — merged into /admin/menu (showcase + owner edit). */
export default function AdminViewMenuRedirect() {
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => {
    router.replace("/admin/menu");
  }, [router]);

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <PageSpinner label={t("loading")} />
    </div>
  );
}
