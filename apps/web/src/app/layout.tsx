import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import { POS_THEME_BOOT_SCRIPT } from "@/lib/pos-theme-script";
import "./globals.css";

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
  adjustFontFallback: false,
  declarations: [
    // Urdu script only — English, digits, emails fall through to the system font.
    {
      prop: "unicode-range",
      value: "U+0600-06FF, U+0750-077F, U+08A0-08FF, U+200C-200F, U+FB50-FDFF, U+FE70-FEFF",
    },
  ],
});

export const metadata: Metadata = {
  title: "Bravo Bites",
  description: "Authentic Taste, Royal Experience — Sajji, Pizza, Burgers & Combo Deals",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bravo Bites",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: POS_THEME_BOOT_SCRIPT }} />
      </head>
      <body className={notoUrdu.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
