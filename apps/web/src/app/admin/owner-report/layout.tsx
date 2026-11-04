"use client";

import { RequireAuth } from "@/components/RequireAuth";

export default function OwnerReportLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth roles={["owner", "counter"]}>{children}</RequireAuth>;
}
