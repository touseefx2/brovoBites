import type { ImageLoaderProps } from "next/image";
import staticImages from "./static-images.imagekit.json";

/**
 * The one place that decides where a photo is resized — pass `cdnImageLoader` as the
 * `loader` of next/image (or getImageProps) for menu / hero photos.
 *
 * - Owner uploads (ImageKit URLs): ImageKit resizes them (`?tr=w-…,q-…`), once per
 *   width the browser asks for. Vercel never touches them.
 * - Bundled photos (/menu/… in public/): served from their ImageKit copies when
 *   scripts/sync-static-images.ts has put the current set on this ImageKit account.
 *   A photo changed since then (next.config.ts checks at build), or an account never
 *   synced, is resized by Vercel's optimizer as before.
 * - Anything else (Firebase Storage, logo, …): Vercel's optimizer as before.
 *
 * Vercel Hobby allows 5K image transformations a month; ImageKit's free plan has no
 * transformation cap (bandwidth is its limit), so photos belong there.
 *
 * Moving to another image CDN later:
 * - bundled photos are stored as neutral /menu/… paths (git is the source): change
 *   this file and upload them there instead of scripts/sync-static-images.ts;
 * - owner uploads are stored in Firestore as full ImageKit URLs (products, categories,
 *   settings.logoUrl / heroSlides, DEV + LIVE): copy the files, rewrite those URLs, and
 *   change api/upload-menu-image, api/delete-image and the ik.imagekit.io rules in
 *   next.config.ts. Until then the old URLs keep working as long as ImageKit does.
 */

const ENDPOINT = (process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT ?? "").trim().replace(/\/+$/, "");
const IMAGEKIT_HOST = "ik.imagekit.io";

type StaticImageMap = {
  version: string;
  files: Record<string, string>;
  endpoints: Record<string, string>;
};

const STATIC = staticImages as StaticImageMap;
/** This deploy's ImageKit account holds the current bundled photo set. */
const STATIC_ON_IMAGEKIT = Boolean(ENDPOINT) && STATIC.endpoints[ENDPOINT] === STATIC.version;
/** Bundled photos changed since the sync (set by next.config.ts at build) — their copy is old. */
const STALE_STATIC = new Set<string>(
  JSON.parse(process.env.NEXT_PUBLIC_STALE_STATIC_IMAGES || "[]") as string[],
);

function isImageKitUrl(src: string): boolean {
  if (ENDPOINT && src.startsWith(`${ENDPOINT}/`)) return true;
  try {
    return new URL(src).hostname === IMAGEKIT_HOST;
  } catch {
    return false;
  }
}

/** Full ImageKit URL of the original (no resize), or null when ImageKit does not serve it. */
function imageKitSource(src: string): string | null {
  if (isImageKitUrl(src)) return src;
  if (STATIC_ON_IMAGEKIT && !STALE_STATIC.has(src)) {
    const file = STATIC.files[src];
    if (file) return `${ENDPOINT}/${file}`;
  }
  return null;
}

/** True when `src` is loaded from ImageKit (cross-origin) — see `cdnCrossOrigin`. */
export function isServedByImageKit(src: string): boolean {
  return imageKitSource(src) !== null;
}

/**
 * `crossOrigin` for an image: ImageKit answers with CORS headers, so the service worker
 * can cache a readable copy (an opaque one costs ~7 MB of storage quota each in Chrome).
 */
export function cdnCrossOrigin(src: string): "anonymous" | undefined {
  return isServedByImageKit(src) ? "anonymous" : undefined;
}

/** The ImageKit origin photos come from, when there is one (landing page preconnect). */
export function imageCdnOrigin(): string | null {
  if (!ENDPOINT) return null;
  try {
    return new URL(ENDPOINT).origin;
  } catch {
    return null;
  }
}

/**
 * Resize on ImageKit: width `w`, quality `q`, never upscale (`c-at_max`), WebP/AVIF by
 * the browser's Accept header (`f-auto`). A path-style transform (/tr:…/) is kept as is.
 */
function imageKitResize(src: string, width: number, quality: number): string {
  if (src.includes("/tr:")) return src;
  const [base, query = ""] = src.split("#")[0].split("?");
  const params = query.split("&").filter((p) => p && !p.startsWith("tr="));
  params.unshift(`tr=w-${width},q-${quality},c-at_max,f-auto`);
  return `${base}?${params.join("&")}`;
}

/**
 * next/image loader. Qualities must be in `images.qualities` (next.config.ts): the
 * Vercel fallback path refuses any other value.
 */
export function cdnImageLoader({ src, width, quality }: ImageLoaderProps): string {
  const q = quality ?? 75;
  const ik = imageKitSource(src);
  if (ik) return imageKitResize(ik, width, q);
  // Same URL Next's default loader builds — Vercel's optimizer.
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${q}`;
}
