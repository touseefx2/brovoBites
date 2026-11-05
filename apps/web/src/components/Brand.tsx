"use client";

import Image from "next/image";
import { cdnCrossOrigin, cdnImageLoader } from "@/lib/image-cdn";
import { useLocale } from "@/i18n/locale-context";
import { usePublicMenuOptional } from "@/lib/menu-context";

/** Bundled mark in `/public` — PNG so the circular badge keeps a transparent edge (JPEG baked a white fringe). */
export const DEFAULT_LOCAL_LOGO = "/logo.png";
/** Full logo: the round mark with the shop name under it. Light lettering — dark backgrounds only. */
export const DEFAULT_LOCAL_LOGO_FULL = "/logo-full.png";

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
      loader={cdnImageLoader}
      crossOrigin={cdnCrossOrigin(src)}
      alt="Brovo Bites"
      width={px}
      height={px}
      className={`brand-mark ${size === "sm" ? "brand-mark-sm" : ""} ${className}`}
      priority
    />
  );
}

export function BrandFullLogo({
  alt = "Brovo Bites",
  className = "",
}: {
  alt?: string;
  className?: string;
}) {
  return (
    <Image
      src={DEFAULT_LOCAL_LOGO_FULL}
      loader={cdnImageLoader}
      crossOrigin={cdnCrossOrigin(DEFAULT_LOCAL_LOGO_FULL)}
      alt={alt}
      width={720}
      height={835}
      className={`brand-full-logo ${className}`}
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
    locale === "ur" ? t("brand") : "Brovo Bites";
  const tagline = subtitle ?? t("landingSloganDefault");

  return (
    <div className={align === "center" ? "text-center" : "text-start"}>
      <h1 className="brand-title text-xl sm:mt-1 sm:text-3xl">{shopName}</h1>
      <p className="brand-tagline mt-1 text-xs sm:mt-2 sm:text-sm">{tagline}</p>
    </div>
  );
}
