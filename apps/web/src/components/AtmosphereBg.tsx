"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { optimizeMenuImageUrl } from "@/lib/optimize-menu-image";

export const ATMOSPHERE_SLIDES = [
  "/menu/hero.jpg",
  "/menu/atmosphere/sajji-rice.jpg",
  "/menu/atmosphere/rice.jpg",
  "/menu/atmosphere/pizza.jpg",
  "/menu/atmosphere/burger.jpg",
  "/menu/atmosphere/sandwich.jpg",
  "/menu/atmosphere/pasta.jpg",
  "/menu/atmosphere/wings.jpg",
] as const;

const HOLD_MS = 3500;

type AtmosphereBgProps = {
  className?: string;
  priority?: boolean;
  slides?: string[];
};

export function AtmosphereBg({ className = "", priority = true, slides }: AtmosphereBgProps) {
  const activeSlides = slides && slides.length > 0 ? slides : (ATMOSPHERE_SLIDES as unknown as string[]);

  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [cycle, setCycle] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [loadedSet, setLoadedSet] = useState<Set<number>>(() => new Set());
  /** Start slideshow as soon as the first slide is ready — don't wait for every slide. */
  const firstReady = loadedSet.has(0);

  const handleLoad = useCallback((i: number) => {
    setLoadedSet((s) => {
      if (s.has(i)) return s;
      const next = new Set(s);
      next.add(i);
      return next;
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setIndex(0);
    setPrev(null);
    setCycle(0);
    setLoadedSet(new Set());
  }, [activeSlides.length]);

  useEffect(() => {
    if (reduceMotion || activeSlides.length <= 1 || !firstReady) return;
    const id = window.setInterval(() => {
      setIndex((current) => {
        setPrev(current);
        setCycle((c) => c + 1);
        return (current + 1) % activeSlides.length;
      });
    }, HOLD_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion, activeSlides.length, firstReady]);

  const firstPaint = cycle === 0;

  return (
    <div className={`atmosphere-bg ${className}`.trim()} aria-hidden>
      {activeSlides.map((src, i) => {
        const isActive = i === index;
        const isPrev = i === prev && !firstPaint && !reduceMotion;
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

        const remote = /^https?:\/\//i.test(src);
        const imageSrc = remote
          ? optimizeMenuImageUrl(src, { width: 1920, quality: 85 })
          : src;

        return (
          <Image
            key={src}
            src={imageSrc}
            alt=""
            fill
            priority={i === 0 && priority}
            quality={85}
            sizes="100vw"
            className={slideClass}
            onLoad={() => handleLoad(i)}
          />
        );
      })}
    </div>
  );
}
