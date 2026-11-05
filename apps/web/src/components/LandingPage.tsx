"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { preload } from "react-dom";
import {
  branchMapsUrl,
  DEFAULT_SETTINGS,
  defaultLandingPath,
  formatPkr,
  type Product,
  type UserRole,
} from "@bravobites/domain";
import { getAuthRoleHint } from "@/lib/auth-hint";
import { useAuthOptional } from "@/lib/auth-optional";
import { useLocale } from "@/i18n/locale-context";
import { usePublicMenu } from "@/lib/menu-context";
import { isCustomerMode } from "@/lib/customer-mode";
import { LanguageToggle } from "@/components/LanguageToggle";
import { BrandLogo, DEFAULT_LOCAL_LOGO, DEFAULT_LOCAL_LOGO_FULL } from "@/components/Brand";
import {
  LANDING_HERO_SLIDES,
  resolveProductImage,
  resolveCategoryImage,
} from "@/lib/menu-images";
import { AtmosphereBg } from "@/components/AtmosphereBg";
import { LogoLoader } from "@/components/LogoLoader";
import { LANDING_BOOT_SEEN_ATTR, LANDING_BOOT_SEEN_KEY } from "@/lib/landing-boot-script";
import { MenuMediaImage } from "@/components/MenuMediaImage";
import { loadBranches, peekBranches, type PublicBranch } from "@/lib/branches-data";

/** Keep section titles clear of the fixed nav (+ small breathing gap). */
const NAV_SCROLL_GAP_PX = 12;

/** Slogans inherited from the previous shop — replaced by the Brovo Bites line. */
const LEGACY_SLOGANS: ReadonlySet<string> = new Set([
  "Authentic Taste, Royal Experience",
  "اصیل ذائقہ، شاہی تجربہ",
]);

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Ease in-out, a bit slower than the browser’s default smooth scroll. The target is
 * re-measured every frame, so photos / sections that finish loading mid-flight (and
 * change the page height above the target) can't make the jump land short.
 */
function smoothScrollTo(getTargetY: () => number | null, signal: { cancelled: boolean }) {
  const startY = window.scrollY;
  const firstTarget = getTargetY();
  if (firstTarget == null || Math.abs(firstTarget - startY) < 2) return Promise.resolve();

  if (prefersReducedMotion()) {
    window.scrollTo(0, firstTarget);
    return Promise.resolve();
  }

  // ~0.55px/ms base, clamped so short hops aren’t sluggish and long ones aren’t rushed
  const duration = Math.min(1100, Math.max(520, Math.abs(firstTarget - startY) * 0.55));
  const start = performance.now();

  return new Promise<void>((resolve) => {
    const step = (now: number) => {
      if (signal.cancelled) {
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const target = getTargetY() ?? firstTarget;
      window.scrollTo(0, startY + (target - startY) * e);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function scrollLandingTargetIntoView(
  id: string,
  signal?: { cancelled: boolean },
) {
  if (!document.getElementById(id)) return Promise.resolve();

  const targetY = () => {
    if (id === "top") return 0;
    const el = document.getElementById(id);
    if (!el) return null;
    const nav = document.querySelector<HTMLElement>(".landing-nav");
    const navH = nav?.getBoundingClientRect().height ?? 72;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    return Math.min(
      Math.max(0, maxY),
      Math.max(0, window.scrollY + el.getBoundingClientRect().top - navH - NAV_SCROLL_GAP_PX),
    );
  };
  return smoothScrollTo(targetY, signal ?? { cancelled: false });
}

/** wa.me link with a ready-made order message, or null when no number is set. */
function buildWhatsAppUrl(raw: string | undefined, locale: string): string | null {
  const phone = (raw ?? "").trim();
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const waNum = cleaned.startsWith("0") ? "92" + cleaned.slice(1) : cleaned;
  const message =
    locale === "ur"
      ? "السلام علیکم! میں آرڈر کرنا چاہتا/چاہتی ہوں۔"
      : "Hi! I would like to place an order.";
  return `https://wa.me/${waNum}?text=${encodeURIComponent(message)}`;
}

function telHref(phone: string) {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="landing-wa-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function PhoneIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function PinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function ArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`landing-arrow ${className}`.trim()}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function PriceBlock({ product, fromLabel }: { product: Product; fromLabel: string }) {
  if (
    product.compareAtPrice != null &&
    product.compareAtPrice > product.basePrice
  ) {
    return (
      <div className="landing-price-stack" dir="ltr">
        <span className="landing-was">{formatPkr(product.compareAtPrice)}</span>
        <span className="landing-price-badge">{formatPkr(product.basePrice)}</span>
      </div>
    );
  }

  if (product.type === "sized" && product.variations.length) {
    const prices = product.variations.map((v) => v.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return (
      <div className="landing-price-stack" dir="ltr">
        <span className="landing-price-badge">
          {min === max ? formatPkr(min) : `${fromLabel} ${formatPkr(min)}`}
        </span>
      </div>
    );
  }

  return (
    <div className="landing-price-stack" dir="ltr">
      <span className="landing-price-badge">{formatPkr(product.basePrice)}</span>
    </div>
  );
}

function matchesMenuQuery(product: Product, q: string, categoryName = "") {
  if (!q) return true;
  if (categoryName.toLowerCase().includes(q)) return true;
  const hay = [
    product.name,
    ...product.variations.map((v) => v.label),
    ...product.dealItems.map((d) => d.label),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/* ───────────── Hero: brand intro (big badge + falling cheese) → photo slideshow ───────────── */

/** Start fetching the hero photos this long after navigation start (after the badge has painted). */
const HERO_PHOTOS_ARM_MS = 800;
/** …but first give the shop settings (owner hero photos) up to this long to arrive. */
const HERO_PHOTOS_WAIT_SETTINGS_MS = 4000;
/**
 * The intro (badge + falling sauce) stays on screen at least this long from when it becomes
 * visible — on every visit and every reload, even when the photos are cached.
 */
const HERO_INTRO_MIN_MS = 2000;
/** The intro waits for this many photos (the first ones of the show); the rest load one ahead as it plays. */
const HERO_PRELOAD_PHOTOS = 2;
/**
 * On a slow connection the intro gives up waiting for all of them after this long on screen
 * and crossfades as soon as one photo is in.
 */
const HERO_INTRO_MAX_MS = 12000;
/** Crossfade length — keep in step with .landing-hero-* transitions in 05-landing.css. */
const HERO_INTRO_FADE_MS = 1000;

type HeroPhase = "intro" | "fade" | "photos";

/**
 * Data Saver on, or a 2G-class connection (Chromium's Network Information API; other
 * browsers → false): the intro waits for the first photo only.
 */
function prefersLightHero(): boolean {
  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  return Boolean(conn?.saveData) || /(^|-)2g$/.test(conn?.effectiveType ?? "");
}

/** Teardrop (12 × 17): pointed top, round bottom — same shape as the LogoLoader drips. */
const HERO_DROP_PATH = "M6 0C6 0 0 7.2 0 11a6 6 0 0 0 12 0C12 7.2 6 0 6 0Z";
/** a + b: the logo's long drip (big drop + small trailing drop), c: the right-hand drip. */
const HERO_DROPS = ["a", "b", "c"] as const;

type LandingHeroProps = {
  eyebrow: string;
  shopName: string;
  /** Urdu name shown under the Latin lockup (null in English). */
  localName: string | null;
  slogan: string;
  viewMenuLabel: string;
  orderLabel: string;
  waUrl: string | null;
  /** settings.heroSlides — owner uploads win over the bundled photos. */
  heroSlides?: string[];
  /** Shop settings are known (or failed), so the right hero photos can load. */
  settingsReady: boolean;
  /** performance.now() when the boot loader started lifting (the intro is visible from then); null while it covers the page. */
  introStartAt: number | null;
  onViewMenu: () => void;
};

/**
 * Server-rendered under the boot loader: the dark logo background with the big BB badge
 * (preloaded, fetchpriority=high) and mustard drips falling from its cheese drip, copy
 * anchored bottom-start. The first two hero photos start downloading from ~0.8s; the intro
 * stays until they are ready AND it has been on screen ≥2s, then crossfades into the
 * slideshow, which fetches the rest one ahead (Data Saver / 2G: first photo only).
 * Once per page load.
 * Memoised: scroll-spy / search renders of the page don't touch it.
 */
const LandingHero = memo(function LandingHero({
  eyebrow,
  shopName,
  localName,
  slogan,
  viewMenuLabel,
  orderLabel,
  waUrl,
  heroSlides,
  settingsReady,
  introStartAt,
  onViewMenu,
}: LandingHeroProps) {
  const heroRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<HeroPhase>("intro");
  const [armed, setArmed] = useState(false);
  const [stopWaiting, setStopWaiting] = useState(false);
  /** At least one photo is in / the first HERO_PRELOAD_PHOTOS are in (or failed). */
  const [firstReady, setFirstReady] = useState(false);
  const [preloaded, setPreloaded] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  /** Data Saver / 2G — set after hydration (the server can't know), long before the photos arm. */
  const [lightHero, setLightHero] = useState(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    setLightHero(prefersLightHero());
    const timers = timersRef.current;
    const now = performance.now();
    timers.push(
      window.setTimeout(() => setArmed(true), Math.max(0, HERO_PHOTOS_ARM_MS - now)),
      window.setTimeout(() => setStopWaiting(true), Math.max(0, HERO_PHOTOS_WAIT_SETTINGS_MS - now)),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);

  // Pause the drips while the hero is scrolled away — a data attribute, no React render.
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) delete el.dataset.paused;
      else el.dataset.paused = "";
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onPhotoReady = useCallback(() => setFirstReady(true), []);
  const onPreloaded = useCallback(() => setPreloaded(true), []);

  // Slow connection: stop waiting for the first photos after HERO_INTRO_MAX_MS on screen.
  useEffect(() => {
    if (introStartAt == null) return;
    const id = window.setTimeout(
      () => setGaveUp(true),
      Math.max(0, introStartAt + HERO_INTRO_MAX_MS - performance.now()),
    );
    return () => window.clearTimeout(id);
  }, [introStartAt]);

  // Crossfade once the first photos are in (none at all → the intro simply stays) and the
  // intro has had its 2s on screen.
  const photosReady = firstReady && (preloaded || gaveUp || lightHero);
  const started = phase !== "intro";
  useEffect(() => {
    if (started || introStartAt == null || !photosReady) return;
    const timers = timersRef.current;
    const id = window.setTimeout(
      () => {
        setPhase("fade");
        timers.push(window.setTimeout(() => setPhase("photos"), HERO_INTRO_FADE_MS));
      },
      Math.max(0, introStartAt + HERO_INTRO_MIN_MS - performance.now()),
    );
    return () => window.clearTimeout(id);
  }, [started, introStartAt, photosReady]);

  const loadPhotos = armed && (settingsReady || stopWaiting);

  // The badge is the LCP image: <link rel=preload fetchpriority=high> in the server HTML.
  preload(DEFAULT_LOCAL_LOGO, { as: "image", fetchPriority: "high" });

  return (
    <section id="top" ref={heroRef} className="landing-hero" data-phase={phase}>
      <div className="landing-hero-photos">
        <AtmosphereBg
          slides={heroSlides}
          defaultSlides={LANDING_HERO_SLIDES}
          priority={false}
          load={loadPhotos}
          preloadCount={lightHero ? 1 : HERO_PRELOAD_PHOTOS}
          onReady={onPhotoReady}
          onPreloaded={onPreloaded}
          play={phase !== "intro"}
        />
      </div>
      <div className="landing-hero-scrim" aria-hidden />
      <div className="landing-hero-intro" aria-hidden />
      <div className="landing-hero-inner">
        <div className="landing-hero-stage" aria-hidden>
          <div className="landing-hero-mark">
            <Image
              src={DEFAULT_LOCAL_LOGO}
              alt=""
              width={512}
              height={512}
              unoptimized
              loading="eager"
              fetchPriority="high"
              draggable={false}
              className="landing-hero-badge"
            />
            {phase !== "photos"
              ? HERO_DROPS.map((id) => (
                  <svg
                    key={id}
                    className={`landing-hero-drop landing-hero-drop--${id}`}
                    viewBox="0 0 12 17"
                    focusable="false"
                  >
                    <path d={HERO_DROP_PATH} />
                    <ellipse className="landing-hero-drop-shine" cx="3.9" cy="11.6" rx="1.2" ry="1.9" />
                  </svg>
                ))
              : null}
          </div>
        </div>
        <div className="landing-hero-content">
          <p className="landing-eyebrow landing-hero-line">{eyebrow}</p>
          <h1 className="landing-title landing-hero-line">
            <span className="landing-title-name" lang="en" dir="ltr">
              {shopName}
            </span>
            {localName ? (
              <>
                {" "}
                <span className="landing-title-local">{localName}</span>
              </>
            ) : null}
          </h1>
          <p className="landing-tagline landing-hero-line">{slogan}</p>
          <div className="landing-cta-row landing-hero-line">
            <a
              href="#menu"
              className="btn landing-cta"
              onClick={(e) => {
                e.preventDefault();
                onViewMenu();
              }}
            >
              {viewMenuLabel}
              <ArrowIcon />
            </a>
            {waUrl ? (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn landing-cta landing-cta-order"
              >
                <WhatsAppIcon size={20} />
                {orderLabel}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
});

/* ───────────── Boot loader: the full-screen LogoLoader, once per browser session ───────────── */

/** The boot loader stays at least this long after navigation start — even when everything is cached. */
const BOOT_MIN_MS = 1500;
/** …and never longer than this (slow / failing network: the page shows its skeleton / retry). */
const BOOT_MAX_MS = 10000;
/** Fade-out — keep in step with .landing-boot-loader in 07-loader.css. */
const BOOT_FADE_MS = 450;

type BootPhase = "on" | "exit" | "off";

/**
 * Set once the boot loader has run (or was skipped) in this page load: coming back to "/"
 * in-app skips it. Module state is per browser tab; never set on the server (effects only).
 * Across reloads, sessionStorage (LANDING_BOOT_SEEN_KEY) does the same for the session.
 */
let landingBootDone = false;

/** Fonts + logo decoded, so the landing paints complete when the loader lifts. */
function waitForBootAssets(logoUrl: string): Promise<unknown> {
  const decode = (src: string) => {
    const img = new window.Image();
    img.src = src;
    return img.decode();
  };
  return Promise.allSettled([
    document.fonts?.ready,
    decode(DEFAULT_LOCAL_LOGO),
    logoUrl ? decode(logoUrl) : null,
  ]);
}

/** Menu placeholders while the first menu load is in flight (header + hero already painted). */
function MenuSkeleton({ label }: { label: string }) {
  return (
    <div className="landing-skeleton" role="status" aria-live="polite" aria-label={label}>
      <ul className="landing-tiles landing-skeleton-tiles" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="landing-tile-cell">
            <span className="landing-tile landing-skeleton-tile" />
          </li>
        ))}
      </ul>
      <div className="landing-skeleton-head" aria-hidden>
        <span className="landing-skeleton-thumb" />
        <span className="landing-skeleton-bars">
          <span className="landing-skeleton-bar" />
          <span className="landing-skeleton-bar is-short" />
        </span>
      </div>
      <div className="landing-grid" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="landing-skeleton-card">
            <span className="landing-skeleton-media" />
            <span className="landing-skeleton-bar" />
            <span className="landing-skeleton-bar is-price" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingPage() {
  const { t, locale } = useLocale();
  const envCustomerMode = process.env.NEXT_PUBLIC_CUSTOMER_MODE === "true";
  const [customerHost, setCustomerHost] = useState(false);
  const hideStaffLinks = envCustomerMode || customerHost;
  // No AuthProvider (Firebase Auth) on the public website; staff who opened
  // the landing from the app still get their live session.
  const auth = useAuthOptional();
  const hasAuth = auth !== null;
  const profile = auth?.profile ?? null;
  const authLoading = auth?.loading ?? false;
  const firebaseUser = auth?.firebaseUser ?? null;
  const {
    settings,
    categories,
    products,
    showBootLoader,
    error,
    hasData,
    status,
    refresh,
  } = usePublicMenu();
  const [scrolled, setScrolled] = useState(false);
  const [activeCat, setActiveCat] = useState<string>("");
  const [menuQuery, setMenuQuery] = useState("");
  const [roleHint, setRoleHint] = useState<UserRole | null>(null);
  const [branchesData, setBranchesData] = useState<PublicBranch[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // State (callback ref) so the fade effect re-binds whenever the strip mounts
  const [catsEl, setCatsEl] = useState<HTMLElement | null>(null);
  const catScrollLockRef = useRef(false);
  const scrollAnimRef = useRef<{ cancelled: boolean } | null>(null);
  /** Hash from the first load (#menu-…, #branches) — honoured once its target exists. */
  const pendingHashRef = useRef<string | null>(null);
  const [boot, setBoot] = useState<BootPhase>(() => (landingBootDone ? "off" : "on"));
  /** When the hero intro became visible (boot loader lifting) — performance.now(). */
  const [introStartAt, setIntroStartAt] = useState<number | null>(() =>
    landingBootDone ? 0 : null,
  );
  const [bootAssetsReady, setBootAssetsReady] = useState(false);
  const menuSettled = hasData || Boolean(error);

  // Refs + setState only, so these stay stable (the memoised hero keeps its props).
  const runLockedScroll = useCallback((id: string) => {
    if (scrollAnimRef.current) scrollAnimRef.current.cancelled = true;
    const signal = { cancelled: false };
    scrollAnimRef.current = signal;
    catScrollLockRef.current = true;
    void scrollLandingTargetIntoView(id, signal).then(() => {
      if (scrollAnimRef.current !== signal) return;
      catScrollLockRef.current = false;
    });
  }, []);

  /** In-page jump (category chip / tile / footer link): keeps the hash, eased scroll. */
  const jumpTo = useCallback(
    (id: string, opts?: { keepHash?: boolean; catId?: string }) => {
      if (opts?.catId !== undefined) setActiveCat(opts.catId);
      if (opts?.keepHash === false) {
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      } else {
        history.replaceState(null, "", `#${id}`);
      }
      runLockedScroll(id);
    },
    [runLockedScroll],
  );
  const jumpToMenu = useCallback(() => jumpTo("menu"), [jumpTo]);

  useEffect(() => {
    setRoleHint(getAuthRoleHint());
    // Customer-menu domains hide staff links even when the build env flag is missing.
    setCustomerHost(isCustomerMode(window.location.host));
  }, []);

  useEffect(() => {
    if (profile?.role) setRoleHint(profile.role);
    else if (hasAuth && !authLoading && !firebaseUser) setRoleHint(null);
  }, [hasAuth, profile?.role, authLoading, firebaseUser]);

  useLayoutEffect(() => {
    const cached = peekBranches();
    if (cached) setBranchesData(cached.branches);
    // Remember a deep link (#menu-…, #branches) until its section has rendered.
    const hash = window.location.hash.slice(1);
    if (hash) pendingHashRef.current = hash;
  }, []);

  // Already shown this session (the <head> script flagged <html>, and CSS kept the server's
  // loader hidden): drop it before the first hydrated paint.
  useLayoutEffect(() => {
    if (landingBootDone || !document.documentElement.hasAttribute(LANDING_BOOT_SEEN_ATTR)) return;
    landingBootDone = true;
    setIntroStartAt(performance.now());
    setBoot("off");
  }, []);

  // Boot loader: up until the menu is in (server HTML or network, or it failed) and the
  // fonts + logo are decoded, and for at least BOOT_MIN_MS — capped at BOOT_MAX_MS.
  useEffect(() => {
    if (boot !== "on") return;
    let alive = true;
    void waitForBootAssets((settings.logoUrl ?? "").trim()).then(() => {
      if (alive) setBootAssetsReady(true);
    });
    return () => {
      alive = false;
    };
    // Once, when the loader starts (the logo URL comes with the server's menu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (boot !== "on") return;
    const until = menuSettled && bootAssetsReady ? BOOT_MIN_MS : BOOT_MAX_MS;
    const id = window.setTimeout(() => {
      landingBootDone = true;
      try {
        sessionStorage.setItem(LANDING_BOOT_SEEN_KEY, "1");
      } catch {
        // Storage blocked (private mode): the loader just shows again on the next reload.
      }
      setIntroStartAt(performance.now());
      setBoot("exit");
    }, Math.max(0, until - performance.now()));
    return () => window.clearTimeout(id);
  }, [boot, menuSettled, bootAssetsReady]);

  useEffect(() => {
    if (boot !== "exit") return;
    const id = window.setTimeout(() => setBoot("off"), BOOT_FADE_MS);
    return () => window.clearTimeout(id);
  }, [boot]);

  // No scrolling the page behind the loader (set after hydration, so a page whose JS
  // never runs still scrolls).
  useEffect(() => {
    if (boot === "off") return;
    const root = document.documentElement;
    root.classList.add("landing-booting");
    return () => root.classList.remove("landing-booting");
  }, [boot]);

  useEffect(() => {
    // Every visit: keep session painting, force background refetch (no boot spinner).
    void refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / remount of landing only
  }, []);

  useEffect(() => {
    // Below the fold — never blocks the first paint; the section appears when loaded.
    function softLoadBranches() {
      void loadBranches({ force: true })
        .then((snap) => setBranchesData(snap.branches))
        .catch(() => {});
    }

    softLoadBranches();
    window.addEventListener("online", softLoadBranches);
    return () => window.removeEventListener("online", softLoadBranches);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const menuQ = menuQuery.trim().toLowerCase();

  const grouped = useMemo(() => {
    return categories
      .map((cat) => ({
        category: cat,
        items: products
          .filter((p) => p.categoryId === cat.id)
          .filter((p) => matchesMenuQuery(p, menuQ, cat.name))
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((g) => g.items.length > 0);
  }, [categories, products, menuQ]);

  const hasAnyProducts = useMemo(
    () => products.length > 0,
    [products.length],
  );

  // Measure fixed nav (taller on phone when cats wrap) for scroll-margin / hash jumps
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const syncOffset = () => {
      const h = Math.ceil(nav.getBoundingClientRect().height) + NAV_SCROLL_GAP_PX;
      document.documentElement.style.setProperty("--landing-nav-offset", `${h}px`);
    };

    syncOffset();
    const ro = new ResizeObserver(syncOffset);
    ro.observe(nav);
    window.addEventListener("resize", syncOffset, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncOffset);
      document.documentElement.style.removeProperty("--landing-nav-offset");
    };
  }, [grouped.length, locale]);

  useEffect(() => {
    if (!grouped.length) return;

    let raf = 0;
    const pickActive = () => {
      if (catScrollLockRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (catScrollLockRef.current) return;
        const navH = navRef.current?.getBoundingClientRect().height ?? 72;
        const menu = document.getElementById("menu");
        const menuTop = menu?.getBoundingClientRect().top ?? Infinity;

        // Hero / above menu — clear category chip
        if (menuTop > navH + 24) {
          setActiveCat((prev) => (prev === "" ? prev : ""));
          if (window.location.hash.startsWith("#menu-")) {
            history.replaceState(
              null,
              "",
              `${window.location.pathname}${window.location.search}`,
            );
          }
          return;
        }

        // Active = last section whose title has passed just under the fixed nav
        const probeY = navH + 16;
        let current = "";
        for (const g of grouped) {
          const el = document.getElementById(`menu-${g.category.id}`);
          if (!el) continue;
          if (el.getBoundingClientRect().top <= probeY) {
            current = g.category.id;
          }
        }
        setActiveCat((prev) => (prev === current ? prev : current));
      });
    };

    pickActive();
    window.addEventListener("scroll", pickActive, { passive: true });
    window.addEventListener("resize", pickActive, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", pickActive);
      window.removeEventListener("resize", pickActive);
    };
  }, [grouped]);

  // Edge fade on the category strip while it overflows (data-overflow = start | end | both)
  useEffect(() => {
    const strip = catsEl;
    if (!strip) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = strip.scrollWidth - strip.clientWidth;
        let state = "";
        if (max > 1) {
          // RTL scrollLeft runs 0 → negative in modern browsers
          const pos = Math.abs(strip.scrollLeft);
          const atStart = pos <= 1;
          const atEnd = pos >= max - 1;
          state = atStart ? "end" : atEnd ? "start" : "both";
        }
        if (state) strip.dataset.overflow = state;
        else delete strip.dataset.overflow;
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(strip);
    // Links change width when the web font loads, without resizing the strip itself
    for (const link of Array.from(strip.children)) ro.observe(link);
    strip.addEventListener("scroll", sync, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      strip.removeEventListener("scroll", sync);
    };
  }, [catsEl, grouped.length, locale]);

  // Keep the active category chip visible in the horizontal chip strip
  useEffect(() => {
    if (!activeCat) return;
    const link = document.querySelector<HTMLElement>(
      `.landing-cat-link[data-cat="${CSS.escape(activeCat)}"]`,
    );
    const strip = link?.parentElement;
    if (!link || !strip || strip.scrollWidth <= strip.clientWidth) return;
    // Scroll only the strip (never the page) — instant, smooth flashed neighbours.
    const linkBox = link.getBoundingClientRect();
    const stripBox = strip.getBoundingClientRect();
    const delta =
      linkBox.left + linkBox.width / 2 - (stripBox.left + stripBox.width / 2);
    strip.scrollBy({ left: delta, behavior: "auto" });
  }, [activeCat]);

  // Honour a deep link (/#menu-…, /#branches) once, as soon as its section exists with
  // real content (the page itself paints before the menu / branches arrive).
  useEffect(() => {
    const id = pendingHashRef.current;
    if (!id) return;
    const contentReady = id === "top" || id === "menu" || hasData || Boolean(error);
    if (!contentReady || !document.getElementById(id)) return;
    pendingHashRef.current = null;
    const raf = requestAnimationFrame(() => runLockedScroll(id));
    return () => cancelAnimationFrame(raf);
  }, [hasData, error, grouped.length, branchesData.length, runLockedScroll]);

  // Scroll-triggered reveal (web + phone)
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const intersectionObs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          intersectionObs.unobserve(entry.target);
        }
      },
      { threshold: 0.04, rootMargin: "18% 0px -4% 0px" },
    );

    const track = (el: HTMLElement) => {
      if (reduce) {
        el.classList.add("is-in");
      } else {
        intersectionObs.observe(el);
      }
    };

    root.querySelectorAll<HTMLElement>(".landing-reveal:not(.is-in)").forEach(track);

    // Scoped to the landing root: menu / branches mount after the first paint.
    const mutationObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains("landing-reveal") && !node.classList.contains("is-in")) {
            track(node);
          }
          node.querySelectorAll<HTMLElement>(".landing-reveal:not(.is-in)").forEach(track);
        }
      }
    });
    mutationObs.observe(root, { childList: true, subtree: true });

    return () => {
      intersectionObs.disconnect();
      mutationObs.disconnect();
    };
  }, []);

  // The logo lockup stays Latin (Lilita) in both languages, like the POS / admin / loader.
  const shopName = settings.shopName?.trim() || "Brovo Bites";
  const settingsSlogan = (settings.slogan || "").trim();
  const slogan =
    !settingsSlogan ||
    settingsSlogan === DEFAULT_SETTINGS.slogan ||
    LEGACY_SLOGANS.has(settingsSlogan)
      ? t("landingSloganBrovo")
      : settingsSlogan;
  const settingsEyebrow = (settings.eyebrow || "").trim();
  const eyebrow =
    locale === "ur"
      ? !settingsEyebrow || settingsEyebrow === DEFAULT_SETTINGS.eyebrow
        ? t("landingHeroEyebrow")
        : settingsEyebrow
      : settingsEyebrow || DEFAULT_SETTINGS.eyebrow;
  const softwareCompanyName = (
    settings.softwareCompanyName || DEFAULT_SETTINGS.softwareCompanyName
  ).trim();
  const softwareCompanyPhone = (
    settings.softwareCompanyPhone || DEFAULT_SETTINGS.softwareCompanyPhone
  ).trim();
  const copyrightName = settings.copyrightName || DEFAULT_SETTINGS.copyrightName;
  const waUrl = buildWhatsAppUrl(settings.whatsappNumber, locale);

  const itemCountLabel = (n: number) =>
    n === 1 ? t("landingItemCountOne") : t("landingItemCount").replace("{n}", String(n));

  // Prefer live profile; while auth restores, keep last-known role so CTA stays Admin/POS (not Login).
  const effectiveRole: UserRole | null =
    profile?.role ?? (!hasAuth || authLoading || firebaseUser ? roleHint : null);
  const authHref = effectiveRole ? defaultLandingPath(effectiveRole) : "/login";
  const authLabel = effectiveRole
    ? t("dashboard")
    : authLoading
      ? "…"
      : t("login");
  const authPending = authLoading && !effectiveRole;

  // The boot loader covers the page while it loads; if the menu is still missing when it
  // lifts (slow / failed network), only the menu area waits (skeleton / retry).
  const menuPending = !hasData && (showBootLoader || status === "loading");
  const menuFailed = !hasData && !menuPending && Boolean(error);

  const year = new Date().getFullYear();

  return (
    <div className="landing" ref={rootRef} data-boot={boot}>
      {boot !== "off" ? (
        <LogoLoader
          className={`landing-boot-loader${boot === "exit" ? " is-exiting" : ""}`}
        />
      ) : null}
      {status === "revalidating" ? (
        <div className="landing-revalidate" aria-hidden />
      ) : null}

      <header
        ref={navRef}
        className={`landing-nav ${scrolled ? "landing-nav-solid" : ""}`}
      >
        <div className="landing-nav-inner">
          <a
            href="#top"
            className="landing-brand"
            aria-label={settings.shopName?.trim() || "Brovo Bites"}
            onClick={(e) => {
              e.preventDefault();
              jumpTo("top", { keepHash: false, catId: "" });
            }}
          >
            {/* Badge alone (owner: no wordmark); the link keeps the shop name as its label. */}
            <BrandLogo size="sm" />
          </a>

          <nav
            ref={setCatsEl}
            className="landing-cats"
            aria-label={t("landingNavCategories")}
          >
            {grouped.map(({ category }) => (
              <a
                key={category.id}
                href={`#menu-${category.id}`}
                data-cat={category.id}
                aria-current={activeCat === category.id ? "true" : undefined}
                className={`landing-cat-link ${activeCat === category.id ? "is-active" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  jumpTo(`menu-${category.id}`, { catId: category.id });
                  // Drop sticky :hover/:focus on phones so only one chip stays highlighted
                  (e.currentTarget as HTMLElement).blur();
                }}
              >
                {category.name}
              </a>
            ))}
          </nav>

          <div className="landing-nav-actions">
            <LanguageToggle />
            {!hideStaffLinks && (
              authPending ? (
                <span className="landing-login is-pending" aria-hidden>
                  …
                </span>
              ) : (
                <Link href={authHref} className="landing-login">
                  {authLabel}
                </Link>
              )
            )}
          </div>
        </div>
      </header>

      <LandingHero
        eyebrow={eyebrow}
        shopName={shopName}
        localName={locale === "ur" ? t("brand") : null}
        slogan={slogan}
        viewMenuLabel={t("viewMenu")}
        orderLabel={t("orderWhatsApp")}
        waUrl={waUrl}
        heroSlides={settings.heroSlides}
        settingsReady={menuSettled}
        introStartAt={introStartAt}
        onViewMenu={jumpToMenu}
      />

      <section id="menu" className="landing-menu" aria-busy={menuPending || undefined}>
        <div className="landing-drip" aria-hidden />
        <div className="landing-container">
          <div className="landing-menu-head landing-reveal">
            <div className="landing-menu-head-copy">
              <p className="landing-section-eyebrow">{t("ourMenu")}</p>
              <h2 className="landing-section-title">{t("landingExploreTitle")}</h2>
              <p className="landing-section-copy">{t("landingExploreHint")}</p>
            </div>
            <label className="landing-menu-search">
              <span className="sr-only">{t("searchMenu")}</span>
              <svg
                className="landing-menu-search-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3-3" />
              </svg>
              <input
                type="search"
                value={menuQuery}
                onChange={(e) => setMenuQuery(e.target.value)}
                placeholder={t("searchMenu")}
                autoComplete="off"
                enterKeyHint="search"
                className="landing-menu-search-input"
              />
            </label>
          </div>

          {menuPending ? <MenuSkeleton label={t("landingMenuLoading")} /> : null}

          {menuFailed ? (
            <div className="landing-boot-error landing-menu-error" role="alert">
              <p className="toast-error inline-block">{error}</p>
              <button
                type="button"
                className="btn landing-cta"
                onClick={() => void refresh(true)}
              >
                {t("retry")}
              </button>
            </div>
          ) : null}

          {grouped.length ? (
            <ul className="landing-tiles">
              {grouped.map(({ category, items }, i) => {
                const first = items[0];
                return (
                  <li key={category.id} className="landing-tile-cell">
                    <a
                      href={`#menu-${category.id}`}
                      className="landing-tile landing-reveal"
                      style={{ "--reveal-delay": `${Math.min(i, 6) * 60}ms` } as CSSProperties}
                      onClick={(e) => {
                        e.preventDefault();
                        jumpTo(`menu-${category.id}`, { catId: category.id });
                      }}
                    >
                      <span className="landing-tile-media">
                        <MenuMediaImage
                          src={resolveCategoryImage(category.imageUrl, category.name)}
                          fallbackSrc={
                            first
                              ? resolveProductImage(first.imageUrl, first.name, category.name)
                              : undefined
                          }
                          alt=""
                          sizes="(max-width: 639px) 42vw, (max-width: 1023px) 26vw, 180px"
                          quality={80}
                          deferOffscreen
                          shimmer
                        />
                      </span>
                      <span className="landing-tile-name">{category.name}</span>
                      <span className="landing-tile-count">{itemCountLabel(items.length)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {hasData && error ? (
            <div className="landing-status">
              <p className="toast-error inline-block">{error}</p>
            </div>
          ) : null}

          {!hasData ? null : !grouped.length ? (
            <p className="landing-status">
              {hasAnyProducts && menuQ ? t("noSearchResults") : t("landingMenuSoon")}
            </p>
          ) : (
            <div className="landing-sections">
              {grouped.map(({ category, items }) => {
                const catImg = resolveCategoryImage(category.imageUrl, category.name);
                const first = items[0];
                return (
                  <section
                    key={category.id}
                    id={`menu-${category.id}`}
                    className="landing-section"
                    aria-labelledby={`menu-${category.id}-title`}
                  >
                    <div className="landing-cat-header landing-reveal">
                      <div className="landing-cat-header-thumb">
                        <MenuMediaImage
                          src={catImg}
                          fallbackSrc={
                            first
                              ? resolveProductImage(first.imageUrl, first.name, category.name)
                              : undefined
                          }
                          alt=""
                          sizes="72px"
                          quality={80}
                          deferOffscreen
                          shimmer
                        />
                      </div>
                      <div className="landing-cat-header-text">
                        <h3 id={`menu-${category.id}-title`}>{category.name}</h3>
                        <span className="landing-cat-header-meta">
                          {itemCountLabel(items.length)}
                        </span>
                      </div>
                      <span className="landing-cat-header-line" aria-hidden />
                    </div>
                    <div className="landing-grid">
                      {items.map((product, idx) => {
                        const src = resolveProductImage(
                          product.imageUrl,
                          product.name,
                          category.name,
                        );
                        return (
                          <article
                            key={product.id}
                            className="landing-item landing-reveal"
                            style={
                              {
                                "--reveal-delay": `${Math.min(idx % 4, 3) * 70}ms`,
                              } as CSSProperties
                            }
                          >
                            <div className="landing-item-media">
                              <MenuMediaImage
                                src={src}
                                alt={product.name}
                                // Below the 100svh hero → always lazy; widths match the 2 / 3 / 4-column grid.
                                sizes="(max-width: 767px) 50vw, (max-width: 1099px) 33vw, 300px"
                                quality={80}
                                deferOffscreen
                                shimmer
                              />
                            </div>
                            <div className="landing-item-body">
                              <h4 className="landing-item-name">{product.name}</h4>
                              {product.type === "bundle" && product.dealItems.length ? (
                                <p className="landing-item-deal">
                                  {product.dealItems
                                    .map((d) =>
                                      d.qty > 1 ? `${d.qty}× ${d.label}` : d.label,
                                    )
                                    .join(" · ")}
                                </p>
                              ) : null}
                              {product.type === "sized" && product.variations.length ? (
                                <ul className="landing-size-row" dir="ltr">
                                  {product.variations.map((v) => (
                                    <li key={v.id} className="landing-size-chip">
                                      <span className="landing-size-label">{v.label}</span>
                                      <span className="landing-size-price">
                                        {formatPkr(v.price)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              <div className="landing-item-foot">
                                <PriceBlock product={product} fromLabel={t("from")} />
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {waUrl ? (
        <section className="landing-order-band" aria-labelledby="landing-order-title">
          <div className="landing-drip" aria-hidden />
          <div className="landing-container landing-order-inner landing-reveal">
            <div className="landing-order-copy">
              <h2 id="landing-order-title" className="landing-order-title">
                {t("landingOrderTitle")}
              </h2>
              <p className="landing-order-hint">{t("landingOrderHint")}</p>
            </div>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="landing-order-btn"
            >
              <WhatsAppIcon size={22} />
              {t("orderWhatsApp")}
            </a>
          </div>
        </section>
      ) : null}

      {branchesData.length > 0 ? (
        <section id="branches" className="landing-branches">
          <div className="landing-container landing-branches-layout">
            <div className="landing-menu-head landing-branches-head landing-reveal">
              <p className="landing-section-eyebrow">{t("ourBranchesSubtitle")}</p>
              <h2 className="landing-section-title">{t("ourBranches")}</h2>
              <p className="landing-section-copy">{t("ourBranchesDesc")}</p>
            </div>

            <div className="landing-branches-grid">
              {branchesData.map((branch, idx) => {
                const mapsUrl = branchMapsUrl(branch);
                return (
                  <div
                    key={branch.id}
                    className="landing-branch-card landing-reveal"
                    style={{ "--reveal-delay": `${idx * 120}ms` } as CSSProperties}
                  >
                    <div className="landing-branch-header">
                      <div className="landing-branch-icon" aria-hidden>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 9l1.6-5h14.8L21 9" />
                          <path d="M3 9h18v1.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
                          <path d="M5 13.5V21h14v-7.5" />
                          <path d="M10 21v-4h4v4" />
                        </svg>
                      </div>
                      <div className="landing-branch-info">
                        <h3 className="landing-branch-name">{branch.name}</h3>
                        {branch.phone ? (
                          <p className="landing-branch-phone" dir="ltr">
                            <a
                              href={telHref(branch.phone)}
                              className="landing-phone-chip"
                              aria-label={t("landingCall")}
                            >
                              <PhoneIcon size={15} />
                              <span>{branch.phone}</span>
                            </a>
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {branch.address ? (
                      <div className="landing-branch-address">
                        {mapsUrl ? (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="landing-branch-map-link"
                          >
                            <PinIcon size={18} />
                            <span className="landing-branch-addr-label">{branch.address}</span>
                            <span className="landing-branch-directions">
                              {t("landingDirections")}
                              <ArrowIcon />
                            </span>
                          </a>
                        ) : (
                          <p className="landing-branch-addr-text">
                            <PinIcon size={18} />
                            <span>{branch.address}</span>
                          </p>
                        )}
                      </div>
                    ) : null}

                    {branch.staff.length > 0 ? (
                      <div className="landing-branch-staff">
                        <p className="landing-branch-staff-label">{t("counter")}</p>
                        <ul className="landing-branch-staff-list">
                          {branch.staff.map((s, i) => (
                            <li key={i} className="landing-staff-item">
                              <div className="landing-staff-avatar" aria-hidden>
                                {(s.displayName || "?").charAt(0).toUpperCase()}
                              </div>
                              <p className="landing-staff-name">{s.displayName || "—"}</p>
                              <div className="landing-staff-actions">
                                {s.phone ? (
                                  <a
                                    href={telHref(s.phone)}
                                    className="landing-staff-chip"
                                    aria-label={t("landingCallName").replace("{name}", s.displayName)}
                                    dir="ltr"
                                  >
                                    <PhoneIcon size={13} />
                                    <span>{s.phone}</span>
                                  </a>
                                ) : null}
                                {s.email ? (
                                  <a
                                    href={`mailto:${s.email}`}
                                    className="landing-staff-chip"
                                    aria-label={t("landingEmailName").replace("{name}", s.displayName)}
                                    dir="ltr"
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                      <rect x="2" y="4" width="20" height="16" rx="2" />
                                      <path d="M22 7l-10 7L2 7" />
                                    </svg>
                                    <span>{s.email}</span>
                                  </a>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <footer className="landing-footer">
        <div className="landing-container landing-footer-grid">
          <div className="landing-footer-brand">
            {/* Far below the fold: lazy, sized for its 128px box (Brand's BrandFullLogo is
                `priority`, which would preload a 1920w copy against the hero badge). */}
            <Image
              src={DEFAULT_LOCAL_LOGO_FULL}
              alt={shopName}
              width={720}
              height={835}
              sizes="120px"
              className="brand-full-logo"
            />
            <p className="landing-footer-slogan">{slogan}</p>
            {waUrl ? (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="landing-nav-order landing-footer-order"
              >
                <WhatsAppIcon size={18} />
                <span>{t("orderWhatsApp")}</span>
              </a>
            ) : null}
          </div>

          {grouped.length ? (
            <nav className="landing-footer-col" aria-label={t("ourMenu")}>
              <p className="landing-footer-heading">{t("ourMenu")}</p>
              <ul className="landing-footer-links">
                {grouped.map(({ category }) => (
                  <li key={category.id}>
                    <a
                      href={`#menu-${category.id}`}
                      className="landing-footer-link"
                      onClick={(e) => {
                        e.preventDefault();
                        jumpTo(`menu-${category.id}`, { catId: category.id });
                      }}
                    >
                      {category.name}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {branchesData.length ? (
            <div className="landing-footer-col">
              <p className="landing-footer-heading">{t("ourBranches")}</p>
              <ul className="landing-footer-links">
                {branchesData.map((branch) => (
                  <li key={branch.id} className="landing-footer-branch">
                    <a
                      href="#branches"
                      className="landing-footer-link"
                      onClick={(e) => {
                        e.preventDefault();
                        jumpTo("branches");
                      }}
                    >
                      {branch.name}
                    </a>
                    {branch.phone ? (
                      <a
                        href={telHref(branch.phone)}
                        className="landing-footer-link landing-footer-phone"
                        dir="ltr"
                      >
                        <PhoneIcon size={14} />
                        {branch.phone}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="landing-container">
          <div className="landing-copy-row">
            <p className="landing-copy">
              <bdi>© {year} {copyrightName}.</bdi> {t("landingRights")}
            </p>
            {softwareCompanyName || softwareCompanyPhone ? (
              <p className="landing-software">
                {softwareCompanyName ? (
                  <span className="landing-software-name">
                    {t("landingSoftwareBy").replace("{name}", softwareCompanyName)}
                  </span>
                ) : null}
                {softwareCompanyPhone ? (
                  <a
                    href={telHref(softwareCompanyPhone)}
                    className="landing-software-phone"
                    dir="ltr"
                  >
                    {softwareCompanyPhone}
                  </a>
                ) : null}
              </p>
            ) : null}
            <a
              href="#top"
              className="landing-backtop"
              onClick={(e) => {
                e.preventDefault();
                jumpTo("top", { keepHash: false, catId: "" });
              }}
            >
              <ArrowIcon className="landing-arrow-up" />
              {t("landingBackToTop")}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
