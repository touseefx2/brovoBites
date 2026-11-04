"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { BranchGate } from "@/components/BranchGate";
import { AdminShell } from "@/components/AdminShell";
import { ActionProvider } from "@/components/ActionProvider";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth roles={["owner", "counter"]}>
      <BranchGate>
        <ActionProvider>
          <AdminShell>{children}</AdminShell>
        </ActionProvider>
      </BranchGate>
    </RequireAuth>
  );
}
