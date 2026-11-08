import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import { POS_THEME_BOOT_SCRIPT } from "@/lib/pos-theme-script";
import { LANDING_BOOT_SCRIPT } from "@/lib/landing-boot-script";
import { SiteAnalytics } from "@/components/SiteAnalytics";
// Public website CSS only; staff routes add globals.css (StaffProviders).
import "./public.css";

/** Visitor analytics run on the customer menu build only, and only where the measurement
 *  id is set (LIVE customer Vercel project). POS / admin, DEV and local track nothing. */
const ANALYTICS_ID =
  process.env.NEXT_PUBLIC_CUSTOMER_MODE === "true"
    ? process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim() || undefined
    : undefined;

const notoUrdu = localFont({
  src: [
    {
      path: "../../public/fonts/naskh-arabic.woff2",
      weight: "400 700",
      style: "normal",
    },
  ],
  variable: "--font-ur",
  display: "swap",
  // Not preloaded: unicode-range already limits it to Urdu text, so the
  // browser fetches it only on pages that show Urdu (92KB off English pages).
  preload: false,
  adjustFontFallback: false,
  declarations: [
    // Urdu script only — English, digits, emails fall through to the system font.
    {
      prop: "unicode-range",
      value: "U+0600-06FF, U+0750-077F, U+08A0-08FF, U+200C-200F, U+FB50-FDFF, U+FE70-FEFF",
    },
  ],
});

const lilita = localFont({
  src: [{ path: "../../public/fonts/lilita-one-latin.woff2", weight: "400", style: "normal" }],
  variable: "--font-brand",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Brovo Bites",
  description: "Fresh, loaded & always crispy. — Burgers · Wings · Wraps · Salads",
  manifest: "/manifest.json",
  openGraph: {
    title: "Brovo Bites",
    description: "Fresh, loaded & always crispy. — Burgers · Wings · Wraps · Salads",
    siteName: "Brovo Bites",
    images: [
      {
        url: "https://ik.imagekit.io/elraggyoa/brovobites/static/menu/brovo/og-cover.9a98e187eb.jpg",
        width: 1288,
        height: 1110,
        alt: "Brovo Bites",
      },
    ],
    type: "website",
  },
  appleWebApp: {
    capable: true,
    // Dark bar with light status icons (suits the dark-brown brand). Not "black-translucent":
    // that draws the page under the status bar and the light POS/admin headers would hide the icons.
    statusBarStyle: "black",
    title: "Brovo Bites",
  },
  applicationName: "Brovo Bites",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  /* Browser / PWA chrome = logo background (DESIGN.md --bb-brown-900) */
  themeColor: "#190d09",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: POS_THEME_BOOT_SCRIPT + LANDING_BOOT_SCRIPT }} />
      </head>
      <body className={`${notoUrdu.variable} ${lilita.variable}`}>
        <Providers>{children}</Providers>
        {ANALYTICS_ID ? <SiteAnalytics measurementId={ANALYTICS_ID} /> : null}
      </body>
    </html>
  );
}
