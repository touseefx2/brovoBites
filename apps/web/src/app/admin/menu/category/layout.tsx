"use client";

import { RequireAuth } from "@/components/RequireAuth";

export default function OwnerMenuCategoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAuth roles={["owner"]}>{children}</RequireAuth>;
}
