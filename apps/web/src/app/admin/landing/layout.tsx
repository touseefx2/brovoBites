"use client";

import { RequireAuth } from "@/components/RequireAuth";

export default function OwnerLandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAuth roles={["owner"]}>{children}</RequireAuth>;
}
