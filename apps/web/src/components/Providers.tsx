"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { LocaleProvider } from "@/i18n/locale-context";

/**
 * Auth, POS sync and the update / sync strips — a separate chunk, loaded only
 * on staff routes, so the public website never downloads Firebase Auth or the
 * POS queue. Server-rendered on those routes (its chunk ships with their HTML).
 */
const StaffProviders = dynamic(() =>
  import("@/components/StaffProviders").then((m) => m.StaffProviders),
);

const STAFF_ROUTES = ["/login", "/admin", "/pos", "/activity"];

function isStaffRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return STAFF_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Root providers. The public website ("/") gets the locale only — its menu
 * provider comes with the page (src/app/page.tsx, server data).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onStaffRoute = isStaffRoute(pathname);
  // Once a staff screen has loaded, keep the session, sync and strips for the
  // rest of the visit — e.g. admin → landing → admin stays signed in and
  // never remounts AuthProvider.
  const [staffLoaded, setStaffLoaded] = useState(onStaffRoute);
  if (onStaffRoute && !staffLoaded) setStaffLoaded(true);

  return (
    <LocaleProvider>
      {onStaffRoute || staffLoaded ? <StaffProviders>{children}</StaffProviders> : children}
    </LocaleProvider>
  );
}
