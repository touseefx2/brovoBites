"use client";

import { RequireAuth } from "@/components/RequireAuth";

/** Menu list (showcase) is visible to owner + counter; edit routes nest under owner layouts. */
export default function MenuSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAuth roles={["owner", "counter"]}>{children}</RequireAuth>;
}
