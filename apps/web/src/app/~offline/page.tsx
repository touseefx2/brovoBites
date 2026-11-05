"use client";

/**
 * PWA offline fallback (next-pwa `fallbacks.document`). Kept dependency-light:
 * plain <img> (no /_next/image round-trip while offline), CSS in styles/07-loader.css.
 */
import { useEffect } from "react";
import { useLocale } from "@/i18n/locale-context";

export default function OfflineFallback() {
  const { t } = useLocale();

  useEffect(() => {
    const handler = () => window.location.reload();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, []);

  return (
    <main className="offline-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-full.png"
        alt="Brovo Bites"
        width={720}
        height={835}
        className="offline-page-logo"
      />
      <h1 className="offline-page-title">{t("offlinePageTitle")}</h1>
      <p className="offline-page-text">{t("offlinePageBody")}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="offline-page-retry"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {t("retry")}
      </button>
    </main>
  );
}
