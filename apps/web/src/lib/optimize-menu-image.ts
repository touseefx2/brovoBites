/**
 * CDN / display helpers for menu photos — keep quality high, only shrink width for retina cards.
 */

/** ImageKit on-the-fly resize (skips if already transformed or not ImageKit). */
export function optimizeMenuImageUrl(
  url: string,
  opts: { width: number; quality?: number },
): string {
  const src = (url || "").trim();
  if (!src) return src;
  if (!src.includes("ik.imagekit.io")) return src;
  if (/[?&]tr=/.test(src) || src.includes("/tr:")) return src;
  const q = opts.quality ?? 82;
  const sep = src.includes("?") ? "&" : "?";
  return `${src}${sep}tr=w-${Math.round(opts.width)},q-${q}`;
}
