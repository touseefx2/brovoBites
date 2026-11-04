"use client";

import { BranchForm, emptyBranchForm } from "@/components/BranchForm";

export default function NewBranchPage() {
  return <BranchForm mode="create" initial={emptyBranchForm()} />;
}
