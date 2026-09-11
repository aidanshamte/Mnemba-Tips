import type { Metadata } from "next";
import "./globals.css";
import "./intelligence.css";

export const metadata: Metadata = {
  title: "PitchPredict AI Studio",
  description: "Open-data soccer and basketball intelligence with form, head-to-head analysis, projected lineups and transparent match probabilities.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
