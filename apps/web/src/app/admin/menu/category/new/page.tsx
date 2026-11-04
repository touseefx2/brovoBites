"use client";

import { CategoryForm, emptyCategory } from "@/components/CategoryForm";

export default function NewCategoryPage() {
  return <CategoryForm mode="create" initial={emptyCategory()} />;
}
