"use client";

import { AuthProvider } from "@/lib/auth-context";
import { PublicMenuProvider } from "@/lib/menu-context";
import { SyncBanner } from "@/components/SyncBanner";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
// The full app stylesheet (POS, admin, login…), after the root layout's
// public.css — so staff screens keep globals.css's exact cascade.
import "@/app/globals.css";

/**
 * Staff routes only (/login, /admin, /pos, /activity): Firebase Auth, the POS
 * sync queue and outboxes, the update + sync strips, the menu context for the
 * logo / admin menu screens, and the staff CSS. Loaded as its own chunk by
 * <Providers>, so none of it ships with the public website.
 */
export function StaffProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppUpdateBanner />
      <SyncBanner />
      <PublicMenuProvider>{children}</PublicMenuProvider>
    </AuthProvider>
  );
}
