import path from "node:path";
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

// Changes every build so the precached app pages are re-fetched with the new
// build's service worker (their HTML points at that build's chunks).
const PAGE_REVISION = Date.now().toString(36);
const isCustomerBuild = process.env.NEXT_PUBLIC_CUSTOMER_MODE === "true";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  // Default true reloads the page whenever the network returns — on a POS that
  // wipes a half-built cart / open checkout. The app already re-syncs and
  // refreshes images & catalog itself on reconnect.
  reloadOnOnline: false,
  // Clock check must never be answered from cache (stale time → false
  // "PC clock is wrong" banner and wrong shop time while offline).
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    // A new deploy must never take over a running POS by itself: it would
    // delete the old build's cached chunks under an open cart. The new worker
    // waits until the page finds a quiet moment and reloads into it (no cart,
    // nothing typed or open — src/lib/app-update.ts), the user taps "Update",
    // or the app is closed.
    // The customer menu has no cart and no banner — it updates itself.
    skipWaiting: isCustomerBuild,
    // POS / login HTML ships inside each build's service worker, so the page
    // and its chunks always come from the same build — offline, after a PC
    // restart, or after the new version activates. Keep in step with
    // OFFLINE_SAFE_PATHS in src/lib/app-update.ts.
    additionalManifestEntries: isCustomerBuild
      ? []
      : [
          { url: "/pos", revision: PAGE_REVISION },
          { url: "/login", revision: PAGE_REVISION },
        ],
    runtimeCaching: [
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && url.pathname === "/api/health",
        handler: "NetworkOnly",
        options: { cacheName: "clock-health" },
      },
      {
        // POS must open offline after a PC restart however long ago it was last
        // online. The default "pages" cache rejects pages older than 24h (by
        // their Date header) and shows the "You are offline" page instead.
        urlPattern: ({ request, url, sameOrigin }) =>
          sameOrigin &&
          request.mode === "navigate" &&
          !url.pathname.startsWith("/api/"),
        handler: "NetworkFirst",
        options: {
          cacheName: "pages-nav",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 32 },
        },
      },
      {
        // next-pwa's default "cross-origin" cache, minus Firestore. Its live
        // listen channel is a long-hanging GET: routed through the worker it
        // keeps the old worker busy, and Chrome never activates a waiting
        // update while that lasts. Firestore keeps its own offline cache.
        urlPattern: ({ sameOrigin, url }) =>
          !sameOrigin && url.hostname !== "firestore.googleapis.com",
        handler: "NetworkFirst",
        options: {
          cacheName: "cross-origin",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 32, maxAgeSeconds: 3600 },
        },
      },
    ],
  },
  fallbacks: {
    document: "/~offline",
  },
});

const nextConfig: NextConfig = {
  // Dev runs on Turbopack, which ignores next-pwa's webpack hook (PWA is off
  // in dev anyway). Declaring it silences the "Webpack is configured" warning;
  // it needs a real value (an empty object doesn't count), so pin the root
  // Next would infer anyway — the monorepo root, where pnpm-lock.yaml lives.
  turbopack: { root: path.join(__dirname, "../..") },
  // Server-only: the daily owner-report email (Chromium prints its PDF).
  serverExternalPackages: ["firebase-admin", "puppeteer-core", "@sparticuz/chromium-min", "nodemailer"],
  transpilePackages: ["@bravobites/domain"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "ik.imagekit.io",
      },
    ],
  },
};

export default withPWA(nextConfig);
