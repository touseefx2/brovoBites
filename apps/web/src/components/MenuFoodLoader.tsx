"use client";

import { MENU_IMAGE } from "@/lib/menu-images";
import { DEFAULT_LOCAL_LOGO } from "@/components/Brand";
import { usePublicMenuOptional } from "@/lib/menu-context";

/** Orbiting food discs — sajji lives here (not in the center). */
const ORBIT = [
  { src: MENU_IMAGE.sajji, spoke: "menu-food-spoke-a" },
  { src: MENU_IMAGE.rice, spoke: "menu-food-spoke-b" },
  { src: MENU_IMAGE.burger, spoke: "menu-food-spoke-c" },
  { src: MENU_IMAGE.pizza, spoke: "menu-food-spoke-d" },
] as const;

export function MenuFoodLoader({
  label,
  logoUrl: logoOverride,
}: {
  label?: string;
  /** Brand logo for the center; falls back to settings / local `/logo.png` */
  logoUrl?: string;
}) {
  const ctx = usePublicMenuOptional();
  const remote = (logoOverride || ctx?.settings.logoUrl || "").trim();
  const centerSrc = remote || DEFAULT_LOCAL_LOGO;

  return (
    <div
      className="menu-food-loader"
      role="status"
      aria-live="polite"
      aria-label={label || "Loading"}
    >
      <div className="menu-food-loader-stage" aria-hidden>
        <span className="menu-food-loader-glow" />
        <span className="menu-food-loader-ring" />
        <span className="menu-food-loader-ring menu-food-loader-ring-outer" />
        <span className="menu-food-loader-spark menu-food-loader-spark-1" />
        <span className="menu-food-loader-spark menu-food-loader-spark-2" />
        <span className="menu-food-loader-spark menu-food-loader-spark-3" />
        <span className="menu-food-loader-spark menu-food-loader-spark-4" />

        <div className="menu-food-loader-orbit">
          {ORBIT.map((item) => (
            <div key={item.spoke} className={`menu-food-spoke ${item.spoke}`}>
              <div className="menu-food-loader-orb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.src} alt="" />
              </div>
            </div>
          ))}
        </div>

        <div className="menu-food-loader-core">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={centerSrc}
            alt=""
            className="menu-food-loader-core-logo"
          />
        </div>
      </div>
      <p className="menu-food-loader-caption">Bravo Bites</p>
    </div>
  );
}
