"use client";

import { RequireAuth } from "@/components/RequireAuth";

/** Owner-only section inside the shared admin shell (staff can use menu + orders). */
export default function OwnerAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAuth roles={["owner"]}>{children}</RequireAuth>;
}
