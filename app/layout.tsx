import {TimeProvider} from '@/components/local-time';
import type { Metadata, Viewport } from "next";
import "./tokens.css";
import "./globals.css";
import "./intelligence.css";
import "./mnemba.css";

export const metadata: Metadata = {
  title: "Mnemba Tips | Football Intelligence",
  description: "Football fixtures, useful match insights, team and player profiles, and the stories behind the game.",
  // Canonical public origin, so Open Graph and Twitter image URLs are absolute.
  metadataBase: new URL("https://aidanshamte.me"),
  manifest: "/manifest.webmanifest",
  // Approved Mnemba Tips logo: compact emblem for icons (scripts/brand/build-logo-assets.mjs).
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48" }, { url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" }, { url: "/brand/icon-192.png", type: "image/png", sizes: "192x192" }],
    shortcut: "/favicon.ico",
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "Mnemba Tips",
    title: "Mnemba Tips | Football Intelligence",
    description: "Football fixtures, useful match insights, team and player profiles, and the stories behind the game.",
    images: [{ url: "/brand/mnemba-tips-social-1200x630.png", width: 1200, height: 630, alt: "Mnemba Tips logo" }],
  },
  twitter: { card: "summary_large_image", images: ["/brand/mnemba-tips-social-1200x630.png"] },
};

// viewport-fit=cover exposes env(safe-area-inset-*) for the mobile navigation.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b1b2e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head>
    <link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin=""/>
    <link rel="preload" href="/fonts/barlow-condensed-latin-700-normal.woff2" as="font" type="font/woff2" crossOrigin=""/>
  </head><body><TimeProvider>{children}</TimeProvider></body></html>;
}
