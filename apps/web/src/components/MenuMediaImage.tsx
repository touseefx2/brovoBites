"use client";

import Image from "next/image";
import { useState } from "react";
import { optimizeMenuImageUrl } from "@/lib/optimize-menu-image";

type MenuMediaImageProps = {
  src: string;
  alt: string;
  /** CSS sizes attribute — match real display width for sharp + fast CDN resize */
  sizes: string;
  /** Prefer true for first-screen images only */
  priority?: boolean;
  /** next/image quality 1–100 — keep ≥80 so food photos stay clean */
  quality?: number;
  /** ImageKit width hint (2× typical CSS width). Ignored for local /menu paths. */
  ikWidth?: number;
  className?: string;
};

/**
 * Menu / landing photo: next/image + soft fade-in. Quality stays high (default 82).
 */
export function MenuMediaImage({
  src,
  alt,
  sizes,
  priority = false,
  quality = 82,
  ikWidth = 800,
  className = "",
}: MenuMediaImageProps) {
  const [loaded, setLoaded] = useState(false);
  const optimized = optimizeMenuImageUrl(src, { width: ikWidth, quality });

  return (
    <Image
      src={optimized}
      alt={alt}
      fill
      sizes={sizes}
      quality={quality}
      priority={priority}
      className={`menu-media-img ${loaded ? "is-loaded" : ""} ${className}`.trim()}
      onLoad={() => setLoaded(true)}
    />
  );
}
