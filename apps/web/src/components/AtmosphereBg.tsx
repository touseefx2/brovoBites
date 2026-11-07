"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getImageProps } from "next/image";
import { cdnCrossOrigin, cdnImageLoader } from "@/lib/image-cdn";
import { FOOD_HERO_SLIDES, HERO_SLIDES, type HeroSlide } from "@/lib/menu-images";

/**
 * Default hero / atmosphere photos (bundled Brovo Bites food shots). Owner-set
 * `settings.heroSlides` always win. Kept as a named export for callers that
 * want the same set (login, branch picker).
 */
export const ATMOSPHERE_SLIDES: readonly string[] = HERO_SLIDES;

/** Food shots + their phone crops (branch picker / login default). */
const FOOD_SLIDES: readonly HeroSlide[] = FOOD_HERO_SLIDES;

const HOLD_MS = 3000;
/** Art direction: the wide crop on landscape screens from this width up, the tall crop otherwise. */
const WIDE_MEDIA = "(min-width: 768px) and (min-aspect-ratio: 1/1)";
const PHOTO_QUALITY = 75;
/**
 * `sizes` for object-fit: cover — on screens narrower than the photo the HEIGHT decides
 * the rendered width. 3:2 wide crop: max(100vw, 150vh). 3:4 tall crop: max(100vw, 75vh).
 * A 3:2 photo with no tall crop (owner uploads) on a phone would need 150vh; 75vh — the
 * tall crop's budget — keeps a DPR-3 phone at w=1920 instead of the full 3840 original.
 */
const SIZES_WIDE = "(max-aspect-ratio: 3/2) 150vh, 100vw";
const SIZES_TALL = "(max-aspect-ratio: 3/4) 75vh, 100vw";
const SIZES_WIDE_ONLY = "(max-width: 767px) 75vh, (max-aspect-ratio: 3/2) 150vh, 100vw";

type AtmosphereBgProps = {
  className?: string;
  /** First slide gets fetchpriority=high (pages where the photo IS the first paint). */
  priority?: boolean;
  /** Owner uploads (settings.heroSlides) — always win over `defaultSlides`. */
  slides?: string[];
  /** Bundled photos when the owner set none. Default: the food-only ATMOSPHERE_SLIDES. */
  defaultSlides?: readonly HeroSlide[];
  /** false = paint only the brand backdrop and fetch nothing yet (the landing loads photos after its intro). */
  load?: boolean;
  /** Called once, when the first slide has loaded. */
  onReady?: () => void;
  /**
   * How many slides (from the first) to download as soon as `load` is on, before the show
   * runs — the landing keeps its intro up until they are in. The rest still load one ahead.
   */
  preloadCount?: number;
  /** Called when the first `preloadCount` slides have loaded or failed (each slide list once). */
  onPreloaded?: () => void;
  /** false = hold still (no cycle, no zoom) — e.g. while the landing intro still covers it. */
  play?: boolean;
};

function addTo(set: Set<number>, i: number) {
  if (set.has(i)) return set;
  const next = new Set(set);
  next.add(i);
  return next;
}

/**
 * Full-bleed photo slideshow (Ken Burns zoom + dissolve). Sits on the logo's
 * dark radial background, so a missing / failed photo just shows the brand
 * backdrop instead of a broken image (data-state="empty" when none load).
 *
 * Fast by design: a slide is only mounted (= downloaded) when it is up next, so a
 * visit fetches one photo, not the whole set; phones get the tall crop and desktops
 * the wide one (<picture>); the cycle and the CSS zoom pause while the slideshow is
 * off screen or the tab is hidden (.is-paused).
 *
 * Slide classes (.atmosphere-slide, .is-active, .is-prev, .is-instant, .is-hidden)
 * are styled in 05-landing.css.
 */
export function AtmosphereBg({
  className = "",
  priority = true,
  slides,
  defaultSlides = FOOD_SLIDES,
  load = true,
  onReady,
  preloadCount = 1,
  onPreloaded,
  play = true,
}: AtmosphereBgProps) {
  const activeSlides = useMemo<readonly HeroSlide[]>(
    () => (slides && slides.length > 0 ? slides.map((src) => ({ src })) : defaultSlides),
    [slides, defaultSlides],
  );
  const slidesKey = activeSlides.map((s) => s.src).join("|");
  const count = activeSlides.length;

  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [cycle, setCycle] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [loadedSet, setLoadedSet] = useState<Set<number>>(() => new Set());
  const [failedSet, setFailedSet] = useState<Set<number>>(() => new Set());
  /** Slides that have been mounted (downloaded) so far — they stay mounted. */
  const [mountedSet, setMountedSet] = useState<Set<number>>(() => new Set());
  /** The hold time is over; advance as soon as the next slide has loaded. */
  const [due, setDue] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [trackedKey, setTrackedKey] = useState(slidesKey);
  const rootRef = useRef<HTMLDivElement>(null);

  // New slide list (settings arrived / changed): start over — derived state, no effect.
  const listChanged = trackedKey !== slidesKey;
  if (listChanged) {
    setTrackedKey(slidesKey);
    setIndex(0);
    setPrev(null);
    setCycle(0);
    setLoadedSet(new Set());
    setFailedSet(new Set());
    setMountedSet(new Set());
    setDue(false);
  }

  const usableCount = count - failedSet.size;
  const anyReady = loadedSet.size > 0;
  const paused = offscreen || tabHidden || !play;

  /** Next slide after `from` that has not failed (or `from` itself when none). */
  const nextUsable = useCallback(
    (from: number) => {
      for (let step = 1; step <= count; step++) {
        const candidate = (from + step) % count;
        if (!failedSet.has(candidate)) return candidate;
      }
      return from;
    },
    [count, failedSet],
  );
  const upNext = nextUsable(index);

  // Mount the current slide (and the first `preloadCount`); once it has loaded AND the
  // show is running, the one after it (lazy, one ahead — nothing else downloads while an
  // intro still covers the photos).
  if (!listChanged && load && count > 0) {
    let want = addTo(mountedSet, index);
    for (let i = 0; i < Math.min(preloadCount, count); i++) want = addTo(want, i);
    if (loadedSet.has(index) && play && usableCount > 1 && !reduceMotion) {
      want = addTo(want, upNext);
    }
    if (want !== mountedSet) setMountedSet(want);
  }

  const handleLoad = useCallback((i: number) => {
    setLoadedSet((s) => addTo(s, i));
  }, []);

  const handleError = useCallback((i: number) => {
    setFailedSet((s) => addTo(s, i));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Pause the cycle + Ken Burns while off screen or in a background tab.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting));
    io.observe(el);
    const syncVisibility = () => setTabHidden(document.visibilityState === "hidden");
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  // If the current slide failed to load, jump to the next usable one.
  useEffect(() => {
    if (!failedSet.has(index) || usableCount <= 0) return;
    setIndex(nextUsable(index));
  }, [failedSet, index, usableCount, nextUsable]);

  // Hold the current slide, then mark the next one as due. (A boolean dep: the next
  // slide finishing its download must not restart the hold.)
  const currentLoaded = loadedSet.has(index);
  useEffect(() => {
    if (paused || reduceMotion || usableCount <= 1 || !currentLoaded) return;
    const id = window.setTimeout(() => setDue(true), HOLD_MS);
    return () => window.clearTimeout(id);
  }, [paused, reduceMotion, usableCount, currentLoaded, index]);

  // Advance only once the next photo is ready (never dissolve into an empty frame).
  useEffect(() => {
    if (!due || paused || upNext === index || !loadedSet.has(upNext)) return;
    setDue(false);
    setPrev(index);
    setIndex(upNext);
    setCycle((c) => c + 1);
  }, [due, paused, upNext, index, loadedSet]);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  useEffect(() => {
    if (anyReady) onReadyRef.current?.();
  }, [anyReady]);

  const onPreloadedRef = useRef(onPreloaded);
  useEffect(() => {
    onPreloadedRef.current = onPreloaded;
  }, [onPreloaded]);
  const preloadTarget = Math.min(preloadCount, count);
  let preloadedSettled = 0;
  for (let i = 0; i < preloadTarget; i++) {
    if (loadedSet.has(i) || failedSet.has(i)) preloadedSettled++;
  }
  const preloaded = !listChanged && preloadTarget > 0 && preloadedSettled >= preloadTarget;
  useEffect(() => {
    if (preloaded) onPreloadedRef.current?.();
  }, [preloaded, slidesKey]);

  const firstPaint = cycle === 0;
  const state = usableCount <= 0 ? "empty" : anyReady ? "ready" : load ? "loading" : "idle";

  return (
    <div
      ref={rootRef}
      className={`atmosphere-bg${paused ? " is-paused" : ""} ${className}`.trim()}
      aria-hidden
      data-state={state}
    >
      {activeSlides.map((slide, i) => {
        if (!load || !mountedSet.has(i)) return null;
        const failed = failedSet.has(i);
        const isActive = i === index && !failed;
        const isPrev = i === prev && !firstPaint && !reduceMotion && !failed;
        const isHidden = !isActive && !isPrev;

        const slideClass = [
          "atmosphere-slide",
          isActive ? "is-active" : "",
          isPrev ? "is-prev" : "",
          isActive && (firstPaint || reduceMotion) ? "is-instant" : "",
          isHidden ? "is-hidden" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const common = {
          alt: "",
          fill: true,
          quality: PHOTO_QUALITY,
          loader: cdnImageLoader,
          // Both crops of a slide live on the same CDN (both bundled, or one upload).
          crossOrigin: cdnCrossOrigin(slide.src),
        } as const;
        const first = i === 0 && priority;
        const wide = getImageProps({ ...common, src: slide.src, sizes: SIZES_WIDE }).props;
        const img = slide.tall
          ? getImageProps({ ...common, src: slide.tall, sizes: SIZES_TALL, priority: first }).props
          : getImageProps({ ...common, src: slide.src, sizes: SIZES_WIDE_ONLY, priority: first })
              .props;

        return (
          <picture key={slide.src}>
            {slide.tall ? (
              <source media={WIDE_MEDIA} srcSet={wide.srcSet} sizes={wide.sizes} />
            ) : null}
            {/* eslint-disable-next-line jsx-a11y/alt-text -- next/image getImageProps inside <picture> (art direction); alt="" comes in the spread props */}
            <img
              {...img}
              loading="eager"
              fetchPriority={first ? "high" : "low"}
              className={slideClass}
              ref={(el) => {
                // Cached photo can finish before React attaches onLoad.
                if (el?.complete && el.naturalWidth > 0) handleLoad(i);
              }}
              onLoad={() => handleLoad(i)}
              onError={() => handleError(i)}
            />
          </picture>
        );
      })}
    </div>
  );
}
