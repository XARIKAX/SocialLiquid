"use client";
import Link from "next/link";
import { useScrolled } from "./motion";
import { Arrow, Wordmark } from "./parts";

const LINKS: [string, string][] = [
  ["Receipts", "#receipts"],
  ["Terminal", "#terminal"],
  ["How it works", "#how"],
  ["Leaderboard", "/leaderboard"],
];

export function Nav() {
  const scrolled = useScrolled();
  return (
    <header className="lp-nav" data-scrolled={scrolled ? "" : undefined}>
      <div className="lp-nav-inner">
        <Link href="/" className="lp-nav-logo" aria-label="socialLiquid home">
          <Wordmark id="nav-mark" />
        </Link>
        <nav className="lp-nav-links" aria-label="Primary">
          {LINKS.map(([l, h]) =>
            h.startsWith("/") ? (
              <Link key={l} href={h} className="lp-nav-link">{l}</Link>
            ) : (
              <a key={l} href={h} className="lp-nav-link">{l}</a>
            ),
          )}
        </nav>
        <div className="lp-nav-cta">
          <a href="https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes" target="_blank" rel="noreferrer" className="lp-nav-link hidden md:inline-flex">
            Builder codes
          </a>
          <Link href="/trade" className="lp-btn lp-btn-primary lp-btn-sm">
            Launch app <Arrow />
          </Link>
        </div>
      </div>
    </header>
  );
}
