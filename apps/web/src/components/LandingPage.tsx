"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  branchMapsUrl,
  DEFAULT_SETTINGS,
  defaultLandingPath,
  formatPkr,
  type Product,
  type UserRole,
} from "@bravobites/domain";
import { getAuthRoleHint, useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { usePublicMenu } from "@/lib/menu-context";
import { LanguageToggle } from "@/components/LanguageToggle";
import { BrandFullLogo, BrandLogo } from "@/components/Brand";
import { resolveProductImage, resolveCategoryImage } from "@/lib/menu-images";
import { MenuFoodLoader } from "@/components/MenuFoodLoader";
import { AtmosphereBg } from "@/components/AtmosphereBg";
import { MenuMediaImage } from "@/components/MenuMediaImage";
import { loadBranches, peekBranches, type PublicBranch } from "@/lib/branches-data";

/** Keep section titles clear of the fixed nav (+ small breathing gap). */
const NAV_SCROLL_GAP_PX = 12;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Ease in-out, a bit slower than the browser’s default smooth scroll. */
function smoothScrollToY(targetY: number, signal: { cancelled: boolean }) {
  const startY = window.scrollY;
  const diff = targetY - startY;
  if (Math.abs(diff) < 2) return Promise.resolve();

  if (prefersReducedMotion()) {
    window.scrollTo(0, targetY);
    return Promise.resolve();
  }

  // ~0.55px/ms base, clamped so short hops aren’t sluggish and long ones aren’t rushed
  const duration = Math.min(1100, Math.max(520, Math.abs(diff) * 0.55));
  const start = performance.now();

  return new Promise<void>((resolve) => {
    const step = (now: number) => {
      if (signal.cancelled) {
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      window.scrollTo(0, startY + diff * e);
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
  const el = document.getElementById(id);
  if (!el) return Promise.resolve();

  const nav = document.querySelector<HTMLElement>(".landing-nav");
  const navH = nav?.getBoundingClientRect().height ?? 72;
  const targetY = Math.max(
    0,
    window.scrollY + el.getBoundingClientRect().top - navH - NAV_SCROLL_GAP_PX,
  );

  if (id === "top") {
    return smoothScrollToY(0, signal ?? { cancelled: false });
  }
  return smoothScrollToY(targetY, signal ?? { cancelled: false });
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

export function LandingPage() {
  const { t, locale } = useLocale();
  const isCustomerMode = process.env.NEXT_PUBLIC_CUSTOMER_MODE === "true";
  const { profile, loading: authLoading, firebaseUser } = useAuth();
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
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesBootChecked, setBranchesBootChecked] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const catScrollLockRef = useRef(false);
  const scrollAnimRef = useRef<{ cancelled: boolean } | null>(null);

  const runLockedScroll = (id: string) => {
    if (scrollAnimRef.current) scrollAnimRef.current.cancelled = true;
    const signal = { cancelled: false };
    scrollAnimRef.current = signal;
    catScrollLockRef.current = true;
    void scrollLandingTargetIntoView(id, signal).then(() => {
      if (scrollAnimRef.current !== signal) return;
      catScrollLockRef.current = false;
    });
  };

  useEffect(() => {
    setRoleHint(getAuthRoleHint());
  }, []);

  useEffect(() => {
    if (profile?.role) setRoleHint(profile.role);
    else if (!authLoading && !firebaseUser) setRoleHint(null);
  }, [profile?.role, authLoading, firebaseUser]);

  useLayoutEffect(() => {
    const cached = peekBranches();
    if (cached) {
      setBranchesData(cached.branches);
      setBranchesLoading(false);
    }
    setBranchesBootChecked(true);
  }, []);

  useEffect(() => {
    // Every visit: keep session painting, force background refetch (no boot spinner).
    void refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / remount of landing only
  }, []);

  useEffect(() => {
    function softLoadBranches() {
      const hadCache = Boolean(peekBranches());
      if (!hadCache) setBranchesLoading(true);
      void loadBranches({ force: true })
        .then((snap) => {
          setBranchesData(snap.branches);
          setBranchesLoading(false);
        })
        .catch(() => {
          setBranchesLoading(false);
        });
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
    if (showBootLoader) return;
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
  }, [showBootLoader, grouped.length, locale]);

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

  // Keep the active category chip visible in the horizontal phone strip
  useEffect(() => {
    if (!activeCat) return;
    const link = document.querySelector<HTMLElement>(
      `.landing-cat-link[data-cat="${CSS.escape(activeCat)}"]`,
    );
    // Instant snap — smooth here caused a visible flash when spy passed neighbors
    link?.scrollIntoView({
      behavior: "auto",
      inline: "center",
      block: "nearest",
    });
  }, [activeCat]);

  // Honor /#menu (and category hashes) after data is paint-ready
  useEffect(() => {
    if (showBootLoader || !hasData) return;
    const hash = window.location.hash;
    if (!hash || hash === "#") return;
    const id = hash.slice(1);
    requestAnimationFrame(() => {
      runLockedScroll(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / data-ready only
  }, [showBootLoader, hasData, grouped.length]);

  // Scroll-triggered spring reveal (web + phone)
  useEffect(() => {
    if (showBootLoader) return;
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

    document.querySelectorAll<HTMLElement>(".landing-reveal:not(.is-in)").forEach(track);

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
    mutationObs.observe(document.body, { childList: true, subtree: true });

    return () => {
      intersectionObs.disconnect();
      mutationObs.disconnect();
    };
  }, [showBootLoader]);

  const shopName =
    locale === "ur" ? t("brand") : settings.shopName || "Bravo Bites";
  const slogan =
    locale === "ur"
      ? "اصیل ذائقہ، شاہی تجربہ"
      : settings.slogan || DEFAULT_SETTINGS.slogan;
  const softwareCompanyName = (
    settings.softwareCompanyName || DEFAULT_SETTINGS.softwareCompanyName
  ).trim();
  const softwareCompanyPhone = (
    settings.softwareCompanyPhone || DEFAULT_SETTINGS.softwareCompanyPhone
  ).trim();

  // Prefer live profile; while auth restores, keep last-known role so CTA stays Admin/POS (not Login).
  const effectiveRole: UserRole | null =
    profile?.role ?? (authLoading || firebaseUser ? roleHint : null);
  const authHref = effectiveRole ? defaultLandingPath(effectiveRole) : "/login";
  const authLabel = effectiveRole
    ? t("dashboard")
    : authLoading
      ? "…"
      : t("login");
  const authPending = authLoading && !effectiveRole;

  const showLoader =
    showBootLoader ||
    (!branchesBootChecked && branchesLoading) ||
    (branchesLoading && branchesData.length === 0);

  if (showLoader) {
    return (
      <div className="landing landing-boot" aria-busy="true">
        <MenuFoodLoader logoUrl={settings.logoUrl || undefined} />
      </div>
    );
  }

  if (error && !hasData) {
    return (
      <div className="landing landing-boot">
        <div className="landing-boot-error">
          <p className="toast-error inline-block">{error}</p>
          <button
            type="button"
            className="btn landing-cta"
            onClick={() => void refresh(true)}
          >
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="landing">
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
            aria-label={settings.shopName?.trim() || "Bravo Bites"}
            onClick={(e) => {
              e.preventDefault();
              setActiveCat("");
              history.replaceState(
                null,
                "",
                `${window.location.pathname}${window.location.search}`,
              );
              runLockedScroll("top");
            }}
          >
            <BrandLogo size="sm" />
          </a>

          <div className="landing-nav-divider" aria-hidden />

          <nav className="landing-cats" aria-label="Menu categories">
            {grouped.map(({ category }) => (
              <a
                key={category.id}
                href={`#menu-${category.id}`}
                data-cat={category.id}
                className={`landing-cat-link ${activeCat === category.id ? "is-active" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  const id = `menu-${category.id}`;
                  setActiveCat(category.id);
                  history.replaceState(null, "", `#${id}`);
                  runLockedScroll(id);
                  // Drop sticky :hover/:focus on phones so only one chip stays yellow
                  (e.currentTarget as HTMLElement).blur();
                }}
              >
                {category.name}
              </a>
            ))}
          </nav>

          <div className="landing-nav-actions">
            <LanguageToggle />
            {!isCustomerMode && (
              authPending ? (
                <span className="landing-login opacity-50" aria-hidden>
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

      <section id="top" className="landing-hero">
        <AtmosphereBg slides={settings.heroSlides} />
        <div className="landing-hero-scrim" />
        <div className="landing-hero-content">
          <p className="landing-eyebrow landing-hero-line">{settings.eyebrow || DEFAULT_SETTINGS.eyebrow}</p>
          <h1 className="landing-title landing-title-logo landing-hero-line">
            <BrandFullLogo alt={shopName} />
          </h1>
          <p className="landing-tagline landing-hero-line">{slogan}</p>
          <div className="landing-cta-row landing-hero-line">
            <a
              href="#menu"
              className="btn landing-cta"
              onClick={(e) => {
                e.preventDefault();
                history.replaceState(null, "", "#menu");
                runLockedScroll("menu");
              }}
            >
              {t("viewMenu")}
            </a>
            {(() => {
              const phone = settings.whatsappNumber.trim();
              if (!phone) return null;
              const cleaned = phone.replace(/[^+\d]/g, "");
              if (!cleaned) return null;
              const waNum = cleaned.startsWith("0") ? "92" + cleaned.slice(1) : cleaned;
              const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(
                locale === "ur" ? "السلام علیکم! میں آرڈر کرنا چاہتا/چاہتی ہوں۔" : "Hi! I would like to place an order."
              )}`;
              return (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn landing-cta landing-cta-order"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  {t("orderWhatsApp")}
                </a>
              );
            })()}
          </div>
        </div>
      </section>

      <section id="menu" className="landing-menu">
        <div className="landing-menu-head landing-reveal">
          <div className="landing-menu-head-copy">
            <p className="landing-section-eyebrow">{t("ourMenu")}</p>
            <h2 className="landing-section-title">{t("menuPrices")}</h2>
            <p className="landing-section-copy">{t("landingMenuHint")}</p>
          </div>
          <label className="landing-menu-search">
            <span className="sr-only">{t("searchMenu")}</span>
            <svg
              className="landing-menu-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
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

        {error ? (
          <div className="landing-status">
            <p className="toast-error inline-block">{error}</p>
          </div>
        ) : null}

        {!grouped.length ? (
          <p className="landing-status">
            {hasAnyProducts && menuQ ? t("noSearchResults") : t("emptyMenu")}
          </p>
        ) : (
          <div className="landing-sections">
            {grouped.map(({ category, items }, sectionIdx) => {
              const catImg = resolveCategoryImage(category.imageUrl, category.name);
              return (
              <section
                key={category.id}
                id={`menu-${category.id}`}
                className="landing-section"
              >
                <div className="landing-cat-header landing-reveal">
                  <div className="landing-cat-header-thumb">
                    <MenuMediaImage
                      src={catImg}
                      alt={category.name}
                      sizes="72px"
                      ikWidth={160}
                      quality={84}
                      priority={sectionIdx === 0}
                    />
                  </div>
                  <div className="landing-cat-header-text">
                    <h3>{category.name}</h3>
                    <span className="landing-cat-header-meta">
                      {items.length} {items.length === 1 ? "item" : "items"}
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
                    const eager = sectionIdx === 0 && idx < 6;
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
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
                            ikWidth={800}
                            quality={82}
                            priority={eager}
                          />
                        </div>
                        <div className="landing-item-body">
                          <div className="landing-item-top">
                            <h4>{product.name}</h4>
                            <PriceBlock product={product} fromLabel={t("from")} />
                          </div>
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
                          {product.type === "bundle" && product.dealItems.length ? (
                            <p className="landing-item-deal">
                              {product.dealItems
                                .map((d) =>
                                  d.qty > 1 ? `${d.qty}× ${d.label}` : d.label,
                                )
                                .join(" · ")}
                            </p>
                          ) : null}
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
      </section>

      <section id="branches" className="landing-branches">
        <div className="landing-menu-head landing-reveal">
          <p className="landing-section-eyebrow">{t("ourBranchesSubtitle")}</p>
          <h2 className="landing-section-title">{t("ourBranches")}</h2>
          <p className="landing-section-copy">{t("ourBranchesDesc")}</p>
        </div>

        <div className="landing-branches-grid">
          {branchesLoading ? (
            <>
              {[0, 1].map((i) => (
                <div key={i} className="landing-branch-card landing-branch-skeleton">
                  <div className="landing-branch-header">
                    <div className="landing-skel landing-skel-icon" />
                    <div className="landing-branch-info">
                      <div className="landing-skel landing-skel-title" />
                      <div className="landing-skel landing-skel-text" />
                    </div>
                  </div>
                  <div className="landing-skel landing-skel-addr" />
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
                    <div className="landing-skel landing-skel-badge" />
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.6rem" }}>
                      <div className="landing-skel landing-skel-avatar" />
                      <div style={{ flex: 1 }}>
                        <div className="landing-skel landing-skel-name" />
                        <div className="landing-skel landing-skel-sub" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            branchesData.map((branch, idx) => {
              const mapsUrl = branchMapsUrl(branch);
              return (
                <div
                  key={branch.id}
                  className="landing-branch-card landing-reveal"
                  style={{ "--reveal-delay": `${idx * 150}ms` } as React.CSSProperties}
                >
                  <div className="landing-branch-header">
                    <div className="landing-branch-icon" aria-hidden>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 21h18" />
                        <path d="M5 21V7l7-4 7 4v14" />
                        <path d="M9 21v-4h6v4" />
                        <path d="M10 10h1" />
                        <path d="M14 10h1" />
                      </svg>
                    </div>
                    <div className="landing-branch-info">
                      <h3 className="landing-branch-name">{branch.name}</h3>
                      {branch.phone && (
                        <p className="landing-branch-phone" dir="ltr">
                          <a href={`tel:${branch.phone.replace(/[^+\d]/g, "")}`} className="landing-phone-chip" aria-label="Call">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                            </svg>
                            <span>{branch.phone}</span>
                          </a>
                        </p>
                      )}
                    </div>
                  </div>

                  {branch.address && (
                    <div className="landing-branch-address">
                      {mapsUrl ? (
                        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="landing-branch-map-link">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          <span>{branch.address}</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="landing-branch-external" aria-hidden>
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </a>
                      ) : (
                        <p className="landing-branch-addr-text">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          <span>{branch.address}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {branch.staff.length > 0 && (
                    <div className="landing-branch-staff">
                      <p className="landing-branch-staff-label">
                        {t("counter")}
                      </p>
                      <ul className="landing-branch-staff-list">
                        {branch.staff.map((s, i) => (
                          <li key={i} className="landing-staff-item">
                            <div className="landing-staff-avatar" aria-hidden>
                              {(s.displayName || "?").charAt(0).toUpperCase()}
                            </div>
                            <p className="landing-staff-name">{s.displayName || "—"}</p>
                            <div className="landing-staff-actions">
                              {s.phone && (
                                <a href={`tel:${s.phone.replace(/[^+\d]/g, "")}`} className="landing-staff-chip" aria-label={`Call ${s.displayName}`} dir="ltr">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                                  </svg>
                                  <span>{s.phone}</span>
                                </a>
                              )}
                              {s.email && (
                                <a href={`mailto:${s.email}`} className="landing-staff-chip" aria-label={`Email ${s.displayName}`} dir="ltr">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="4" width="20" height="16" rx="2" />
                                    <path d="M22 7l-10 7L2 7" />
                                  </svg>
                                  <span>{s.email}</span>
                                </a>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-glow" aria-hidden />
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <BrandLogo size="md" />
            <div>
              <p className="landing-footer-name">{shopName}</p>
              <p className="landing-footer-slogan">{slogan}</p>
            </div>
          </div>
        </div>
        <div className="landing-copy-row">
          <p className="landing-copy">
            © {new Date().getFullYear()}{" "}
            {settings.copyrightName || DEFAULT_SETTINGS.copyrightName}
          </p>
          {(softwareCompanyName || softwareCompanyPhone) && (
            <p className="landing-software">
              {softwareCompanyName ? (
                <span className="landing-software-name">
                  Software by {softwareCompanyName}
                </span>
              ) : null}
              {softwareCompanyPhone ? (
                <span className="landing-software-phone" dir="ltr">
                  {softwareCompanyPhone}
                </span>
              ) : null}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
