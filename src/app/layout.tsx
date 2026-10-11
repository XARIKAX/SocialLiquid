import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { THEME_INIT } from "@/lib/theme";
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

// geist mono, for landing eyebrows and tickers. not preloaded: it only ever styles small labels
const geistMono = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
  weight: "100 900",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: { default: "socialLiquid", template: "%s · socialLiquid" },
  description: "the first social trading platform for perps. post a thesis, open the position on hyperliquid, let everyone watch you hold or dump.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = { themeColor: "#050507", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
