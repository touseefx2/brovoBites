"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { optimizeMenuImageUrl } from "@/lib/optimize-menu-image";

/** Last resort when a photo is missing: the brand badge (shown contained, not cropped). */
const BRAND_FALLBACK = "/logo.png";

/** How far ahead of the viewport a deferred photo mounts (and starts downloading). */
const NEAR_MARGIN = "320px 0px";

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
  /** Tried when `src` fails to load (e.g. a category photo not shipped yet). Then the brand badge. */
  fallbackSrc?: string;
  /**
   * Below-the-fold photos: render no <img> at all (server HTML included) until the slot
   * is within ~320px of the viewport. Native loading="lazy" would still fetch everything
   * inside Chrome's 1250–2500px lazy distance during page load, competing with the hero.
   */
  deferOffscreen?: boolean;
};

/* One shared IntersectionObserver for every deferred slot on the page. */
let nearObserver: IntersectionObserver | null = null;
const nearCallbacks = new Map<Element, () => void>();

function watchNear(el: Element, onNear: () => void) {
  if (typeof IntersectionObserver === "undefined") {
    onNear();
    return () => {};
  }
  if (!nearObserver) {
    nearObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const cb = nearCallbacks.get(entry.target);
          nearCallbacks.delete(entry.target);
          nearObserver?.unobserve(entry.target);
          cb?.();
        }
      },
      { rootMargin: NEAR_MARGIN },
    );
  }
  nearCallbacks.set(el, onNear);
  nearObserver.observe(el);
  return () => {
    nearCallbacks.delete(el);
    nearObserver?.unobserve(el);
  };
}

/**
 * Menu / landing photo: next/image + soft fade-in. Quality stays high (default 82).
 * Adds .menu-media-img, plus .is-loaded once loaded (CSS fades it in and stops the
 * shimmer). A broken photo falls back to `fallbackSrc`, then to the brand badge
 * (.is-fallback) so a card never stays an empty shimmer.
 */
export function MenuMediaImage({
  src,
  alt,
  sizes,
  priority = false,
  quality = 82,
  ikWidth = 800,
  className = "",
  fallbackSrc,
  deferOffscreen = false,
}: MenuMediaImageProps) {
  const [state, setState] = useState({ for: src, stage: 0, loaded: false });
  const [near, setNear] = useState(!deferOffscreen);
  const slotRef = useRef<HTMLSpanElement>(null);
  // A new photo (src prop changed): start over — derived state, no effect needed.
  if (state.for !== src) {
    setState({ for: src, stage: 0, loaded: false });
  }

  useEffect(() => {
    if (near) return;
    const el = slotRef.current;
    if (!el) return;
    return watchNear(el, () => setNear(true));
  }, [near]);

  if (!near) {
    // Same box as the fill image, so the observer sees where the photo will be.
    return (
      <span
        ref={slotRef}
        className="menu-media-slot"
        aria-hidden
        style={{ position: "absolute", inset: 0 }}
      />
    );
  }

  const candidates = [src, fallbackSrc, BRAND_FALLBACK].filter(
    (s, i, all): s is string => Boolean(s && s.trim()) && all.indexOf(s) === i,
  );
  const stage = Math.min(state.stage, candidates.length - 1);
  const current = candidates[stage] ?? BRAND_FALLBACK;
  const optimized = optimizeMenuImageUrl(current, { width: ikWidth, quality });

  return (
    <Image
      key={current}
      src={optimized}
      alt={alt}
      fill
      sizes={sizes}
      quality={quality}
      priority={priority}
      className={[
        "menu-media-img",
        state.loaded ? "is-loaded" : "",
        current === BRAND_FALLBACK ? "is-fallback" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onLoad={() => setState((s) => (s.loaded ? s : { ...s, loaded: true }))}
      onError={() =>
        setState((s) =>
          s.stage + 1 < candidates.length
            ? { ...s, stage: s.stage + 1, loaded: false }
            : { ...s, loaded: true },
        )
      }
    />
  );
}
