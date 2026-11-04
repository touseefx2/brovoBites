"use client";

import { AuthProvider } from "@/lib/auth-context";
import { PublicMenuProvider } from "@/lib/menu-context";
import { LocaleProvider } from "@/i18n/locale-context";
import { SyncBanner } from "@/components/SyncBanner";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <AuthProvider>
        <AppUpdateBanner />
        <SyncBanner />
        <PublicMenuProvider>{children}</PublicMenuProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
