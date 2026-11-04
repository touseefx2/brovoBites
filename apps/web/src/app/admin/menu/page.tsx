"use client";

import { MenuShowcase } from "@/components/MenuShowcase";
import { useAuth } from "@/lib/auth-context";

export default function MenuAdminPage() {
  const { profile } = useAuth();
  return <MenuShowcase manage={profile?.role === "owner"} />;
}
