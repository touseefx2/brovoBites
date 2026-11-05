import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";

/**
 * Visitor analytics for the public menu site: Google Analytics 4 (the Firebase project's
 * web stream, so it shows in Firebase console → Analytics) + Vercel Web Analytics.
 *
 * The root layout renders this only on the customer build, and only when
 * NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID is set (LIVE customer Vercel project): the POS /
 * admin, DEV and local builds track nothing.
 *
 * Speed: gtag.js (~100 KB) loads with `lazyOnload` — after the page has loaded, while the
 * browser is idle — so it never competes with the hero / first paint. Vercel's script is
 * ~1 KB, cookieless and deferred. Both count client-side route changes as page views.
 */
export function SiteAnalytics({ measurementId }: { measurementId: string }) {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
        strategy="lazyOnload"
      />
      <Script id="ga4-init" strategy="lazyOnload">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config",${JSON.stringify(measurementId)});`}
      </Script>
      <Analytics />
    </>
  );
}
