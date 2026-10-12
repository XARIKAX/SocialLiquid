import Link from "next/link";
import { NavMenu, NavScrollFlag } from "./motion";
import { Arrow, Wordmark } from "./parts";

const LINKS: [string, string][] = [
  ["Receipts", "#receipts"],
  ["Terminal", "#terminal"],
  ["How it works", "#how"],
  ["Leaderboard", "/leaderboard"],
];
const BUILDER: [string, string] = ["Builder codes", "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes"];

/** server-rendered; only the scroll flag and the phone menu hydrate */
export function Nav() {
  return (
    <header className="lp-nav">
      <NavScrollFlag />
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
          <a href={BUILDER[1]} target="_blank" rel="noreferrer" className="lp-nav-link lp-nav-ext">
            {BUILDER[0]}
            <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <NavMenu links={LINKS} external={BUILDER} />
          <Link href="/trade" className="lp-btn lp-btn-primary lp-btn-sm">
            Launch app <Arrow />
          </Link>
        </div>
      </div>
    </header>
  );
}
