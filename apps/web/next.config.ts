import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

// Changes every build so the precached app pages are re-fetched with the new
// build's service worker (their HTML points at that build's chunks).
const PAGE_REVISION = Date.now().toString(36);
const isCustomerBuild = process.env.NEXT_PUBLIC_CUSTOMER_MODE === "true";

/**
 * Bundled photos whose ImageKit copy is out of date: the file in public/ changed (or
 * is gone) since scripts/sync-static-images.ts last ran. Each copy's name carries the
 * hash of the content it was made from; a mismatch sends that photo back to Vercel's
 * optimizer (src/lib/image-cdn.ts), so the new photo shows instead of the old copy.
 */
function staleStaticImages(): string[] {
  const manifestPath = path.join(__dirname, "src/lib/static-images.imagekit.json");
  if (!existsSync(manifestPath)) return [];
  const { files } = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    files: Record<string, string>;
  };
  const stale = Object.entries(files)
    .filter(([src, copy]) => {
      const file = path.join(__dirname, "public", src);
      if (!existsSync(file)) return true;
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10);
      return !copy.endsWith(`.${hash}${path.extname(src).toLowerCase()}`);
    })
    .map(([src]) => src);
  if (stale.length) {
    console.warn(
      `[images] ${stale.length} bundled photo(s) changed since the last ImageKit sync — ` +
        "served by Vercel until you run: pnpm --filter web images:sync\n  " +
        stale.join("\n  "),
    );
  }
  return stale;
}

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  // Staff: every screen opened by client-side navigation (and its chunks) is
  // cached for offline use. The customer menu is one page: nothing to cache
  // ahead, and no hidden second download of "/" (start-url cache) on a
  // shopper's first visit — the "pages-nav" runtime cache below keeps "/".
  cacheOnFrontEndNav: !isCustomerBuild,
  aggressiveFrontEndNavCaching: !isCustomerBuild,
  cacheStartUrl: !isCustomerBuild,
  dynamicStartUrl: !isCustomerBuild,
  // Default true reloads the page whenever the network returns — on a POS that
  // wipes a half-built cart / open checkout. The app already re-syncs and
  // refreshes images & catalog itself on reconnect.
  reloadOnOnline: false,
  // Clock check must never be answered from cache (stale time → false
  // "PC clock is wrong" banner and wrong shop time while offline).
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    // Customer build: precache nothing. By default the worker downloads every
    // chunk of the build on a shopper's first visit (~1.3 MB gzip: Firebase
    // Auth, Firestore, POS queue, admin screens, PDF / chart libraries) — data
    // a phone pays for and bandwidth the hero photos need. Repeat visits are
    // served by next-pwa's runtime caches (JS, CSS, fonts, images, "/").
    // Staff build: the full precache — the POS must open offline.
    ...(isCustomerBuild ? { exclude: [/./] } : {}),
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
        // Menu / hero photos from ImageKit (owner uploads + bundled photos, see
        // src/lib/image-cdn.ts). Every URL is one fixed file at one size (uploads
        // get unique names, bundled copies carry a content hash), so a stored copy
        // is served at once and refreshed in the background — the POS keeps its
        // product photos offline. Status 0: the POS loads uploads with plain <img>
        // (no CORS) — opaque responses must be cacheable too.
        urlPattern: ({ url }) => url.hostname === "ik.imagekit.io",
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "imagekit-images",
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 30 * 24 * 60 * 60,
            purgeOnQuotaError: true,
          },
          cacheableResponse: { statuses: [0, 200] },
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
  // Staff build only: /~offline is a client page whose JS the customer worker no
  // longer precaches (exclude above), so there it would show Next's error screen.
  // Shoppers offline get the browser's own offline page instead.
  // `false` (not undefined) is the only value that stops next-pwa from picking
  // up app/~offline by itself; its typings don't list it, hence the cast.
  fallbacks: isCustomerBuild
    ? (false as unknown as { document?: string })
    : { document: "/~offline" },
});

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_STALE_STATIC_IMAGES: JSON.stringify(staleStaticImages()),
  },
  // Default ".next". A separate dir lets a local production build / perf check
  // or the e2e dev server run next to `pnpm dev` without sharing its cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Dev runs on Turbopack, which ignores next-pwa's webpack hook (PWA is off
  // in dev anyway). Declaring it silences the "Webpack is configured" warning;
  // it needs a real value (an empty object doesn't count), so pin the root
  // Next would infer anyway — the monorepo root, where pnpm-lock.yaml lives.
  turbopack: { root: path.join(__dirname, "../..") },
  // Server-only: the daily owner-report email (Chromium prints its PDF).
  serverExternalPackages: ["firebase-admin", "puppeteer-core", "@sparticuz/chromium-min", "nodemailer"],
  transpilePackages: ["@bravobites/domain"],
  // Bundled photos / logo / icons are served with `max-age=0` by default, so
  // every revisit re-asks for each one, and /_next/image copies of them only
  // live 60s. A week in the browser (a changed file still shows up: after a
  // week, or in the background through stale-while-revalidate); the
  // optimised /_next/image copies inherit the same max-age.
  async headers() {
    const longCache = [
      { key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" },
    ];
    return [
      { source: "/menu/:path*", headers: longCache },
      { source: "/logo.png", headers: longCache },
      { source: "/logo-full.png", headers: longCache },
      { source: "/icon-:size.png", headers: longCache },
    ];
  },
  webpack(config) {
    // The domain package is plain functions and constants, but its barrel
    // (src/index.ts) has no "sideEffects" flag, so every page bundled all of
    // it — inventory and shop-day code on the public website. Flagged here,
    // a page only gets the modules it imports from.
    config.module.rules.push({
      test: /[\\/]packages[\\/]domain[\\/]src[\\/][^\\/]+\.ts$/,
      sideEffects: false,
    });
    return config;
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Every `quality` used with next/image (75 = the default when none is
    // given). Production refuses any other value with a 400.
    // Photos and logos are resized on ImageKit (src/lib/image-cdn.ts); this
    // optimizer is only the fallback, with the same 75 / 80. 82 and 84: an admin tab still
    // running the build before Nov 2026 asks for them — drop them once every
    // staff PC has updated. A value nobody requests costs nothing.
    qualities: [75, 80, 82, 84],
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
