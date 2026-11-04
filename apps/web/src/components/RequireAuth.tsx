"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";

export function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: UserRole[];
}) {
  const { profile, loading, firebaseUser } = useAuth();
  const { t } = useLocale();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser || !profile) {
      router.replace("/login");
      return;
    }
    if (roles && !roles.includes(profile.role)) {
      router.replace(profile.role === "owner" ? "/admin" : "/admin/menu");
    }
  }, [loading, firebaseUser, profile, roles, router]);

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        {t("loading")}
      </div>
    );
  }

  if (roles && !roles.includes(profile.role)) return null;

  return <>{children}</>;
}
