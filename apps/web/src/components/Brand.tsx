"use client";

import Image from "next/image";
import { useLocale } from "@/i18n/locale-context";
import { usePublicMenuOptional } from "@/lib/menu-context";

/** Bundled mark in `/public` — PNG so the circular badge keeps a transparent edge (JPEG baked a white fringe). */
export const DEFAULT_LOCAL_LOGO = "/logo.png";

export function BrandLogo({
  size = "md",
  className = "",
  logoOverride,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  logoOverride?: string;
}) {
  const px = size === "lg" ? 96 : size === "sm" ? 40 : 72;
  const ctx = usePublicMenuOptional();
  const remote = (logoOverride ?? ctx?.settings.logoUrl ?? "").trim();
  const src = remote || DEFAULT_LOCAL_LOGO;

  if (remote) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={remote}
        alt="Logo"
        width={px}
        height={px}
        className={`brand-mark ${size === "sm" ? "brand-mark-sm" : ""} ${className}`}
      />
    );
  }

  return (
    <Image
      src={src}
      alt="Bravo Bites"
      width={px}
      height={px}
      className={`brand-mark ${size === "sm" ? "brand-mark-sm" : ""} ${className}`}
      priority
    />
  );
}

export function BrandTitle({
  subtitle,
  align = "center",
}: {
  subtitle?: string;
  align?: "center" | "start";
}) {
  const { locale, t } = useLocale();
  const shopName =
    locale === "ur" ? t("brand") : "Bravo Bites";
  const tagline =
    subtitle ??
    (locale === "ur"
      ? "اصیل ذائقہ، شاہی تجربہ"
      : "Authentic Taste, Royal Experience");

  return (
    <div className={align === "center" ? "text-center" : "text-start"}>
      <h1 className="text-xl font-bold tracking-tight text-[var(--ink)] sm:mt-1 sm:text-3xl">
        {shopName}
      </h1>
      <p className="mt-1 text-xs text-[var(--muted)] sm:mt-2 sm:text-sm">{tagline}</p>
    </div>
  );
}
