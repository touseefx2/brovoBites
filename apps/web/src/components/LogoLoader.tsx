"use client";

/**
 * Brovo Bites brand loader — docs/DESIGN.md §4 "Loader".
 * Dark radial logo background, the BB badge with a rotating mustard arc, a gentle
 * "bite" bounce, cheese drips falling from the logo's drip, the BROVO BITES wordmark
 * and an i18n caption. CSS-only animation (transform/opacity) in styles/07-loader.css;
 * static under prefers-reduced-motion.
 *
 * API (keep stable — LandingPage and RequireAuth use it):
 *   <LogoLoader />                         full-screen, label = t("loading")
 *   <LogoLoader label="…" />               custom caption (also the aria-label)
 *   <LogoLoader fullScreen={false} />      inline block (fills its container, min-height 40vh)
 *
 * Deliberately NOT `.spinner`: admin-smoke counts `.spinner` elements.
 */
import { DEFAULT_LOCAL_LOGO } from "@/components/Brand";
import { useLocale } from "@/i18n/locale-context";
import { usePublicMenuOptional } from "@/lib/menu-context";

/** Teardrop (12 × 17): round bottom, pointed top. */
const DRIP_PATH = "M6 0C6 0 0 7.2 0 11a6 6 0 0 0 12 0C12 7.2 6 0 6 0Z";
const DRIPS = [
  { id: "a", small: false },
  { id: "b", small: true },
  { id: "c", small: false },
  { id: "d", small: true },
] as const;

export function LogoLoader({
  label,
  fullScreen = true,
  className = "",
}: {
  label?: string;
  fullScreen?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const ctx = usePublicMenuOptional();
  const remote = (ctx?.settings.logoUrl ?? "").trim();
  const caption = label || t("loading");

  return (
    <div
      className={`logo-loader ${fullScreen ? "logo-loader--full" : "logo-loader--inline"} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={caption}
    >
      <div className="logo-loader-stage" aria-hidden="true">
        <span className="logo-loader-glow" />
        <span className="logo-loader-track" />
        <span className="logo-loader-spin">
          <span className="logo-loader-arc" />
          <span className="logo-loader-head" />
        </span>
        <span className="logo-loader-bite">
          {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>: no /_next/image round-trip on first paint / offline */}
          <img
            src={remote || DEFAULT_LOCAL_LOGO}
            alt=""
            width={168}
            height={168}
            decoding="async"
            fetchPriority="high"
            draggable={false}
            className={`logo-loader-badge${remote ? " logo-loader-badge--remote" : ""}`}
          />
        </span>
        {DRIPS.map((d) => (
          <svg
            key={d.id}
            className={`logo-loader-drip logo-loader-drip--${d.id}${d.small ? " logo-loader-drip--sm" : ""}`}
            viewBox="0 0 12 17"
            focusable="false"
          >
            <path d={DRIP_PATH} />
            <ellipse className="logo-loader-drip-shine" cx="3.9" cy="11.6" rx="1.2" ry="1.9" />
          </svg>
        ))}
      </div>
      {/* The logo lettering — a brand mark, so it stays Latin in Urdu too. */}
      <p className="logo-loader-wordmark" aria-hidden="true" lang="en" dir="ltr">
        BROVO BITES
      </p>
      <p className="logo-loader-caption">{caption}</p>
    </div>
  );
}
