import {TimeProvider} from '@/components/local-time';
import type { Metadata } from "next";
import "./globals.css";
import "./intelligence.css";

export const metadata: Metadata = {
  title: "Mnemba Tips | Football Intelligence",
  description: "Football fixtures, useful match insights, team and player profiles, and the stories behind the game.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><TimeProvider>{children}</TimeProvider></body></html>;
}
