import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// geist sans, self hosted. not preloaded: text paints in the system fallback and swaps, which keeps first paint off the font's critical path
const geist = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  preload: true,
  weight: "100 900",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: { default: "socialLiquid", template: "%s · socialLiquid" },
  description: "the first social trading platform for perps. post a thesis, open the position on hyperliquid, let everyone watch you hold or dump.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = { themeColor: "#050507", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geist.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
