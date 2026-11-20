import {TimeProvider} from '@/components/local-time';
import type { Metadata, Viewport } from "next";
import "./tokens.css";
import "./globals.css";
import "./intelligence.css";
import "./mnemba.css";

export const metadata: Metadata = {
  title: "Mnemba Tips | Football Intelligence",
  description: "Football fixtures, useful match insights, team and player profiles, and the stories behind the game.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

// viewport-fit=cover exposes env(safe-area-inset-*) for the mobile navigation.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b1b2e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head>
    <link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin=""/>
    <link rel="preload" href="/fonts/barlow-condensed-latin-700-normal.woff2" as="font" type="font/woff2" crossOrigin=""/>
  </head><body><TimeProvider>{children}</TimeProvider></body></html>;
}
