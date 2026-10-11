import Link from "next/link";
import { Mark, Wordmark, vars } from "./parts";
import type { LandingData } from "./types";

type FooterLinkT = { label: string; href: string };
const COLS: { title: string; links: FooterLinkT[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Launch app", href: "/trade" },
      { label: "Leaderboard", href: "/leaderboard" },
      { label: "Tokens", href: "/tokens" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Receipts", href: "#receipts" },
      { label: "Terminal", href: "#terminal" },
      { label: "Builder codes", href: "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes" },
    ],
  },
  {
    title: "Social",
    links: [
      { label: "X / Twitter", href: "https://x.com" },
      { label: "Hyperliquid", href: "https://app.hyperliquid.xyz" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
    ],
  },
];

export function Footer({ d }: { d: LandingData }) {
  return (
    <footer id="footer" className="lp-footer" aria-label="Site footer">
      <FooterLight />

      <div className="lp-container lp-footer-inner">
        <div className="lp-footer-top">
          <div className="lp-footer-brand" data-reveal>
            <Link href="/" className="lp-footer-logo" aria-label="socialLiquid home">
              <Wordmark size={24} id="footer-mark" />
            </Link>
            <p className="lp-footer-tag">
              <span className="lp-lit">where traders show</span> <em className="lp-grad not-italic">their receipts.</em>
            </p>
            <span className="lp-footer-status">
              <span className="lp-live" aria-hidden />
              <span>Hyperliquid{d.testnet ? " testnet" : ""}</span>
              <span className="lp-footer-status-sep" aria-hidden>·</span>
              <span className="lp-footer-status-ok">operational</span>
            </span>
          </div>

          <nav className="lp-footer-cols" aria-label="Footer">
            {COLS.map((c, i) => (
              <div key={c.title} className="lp-footer-col" data-reveal style={vars({ "--d": `${0.08 + i * 0.07}s` })}>
                <p className="lp-footer-label lp-mono" id={`lp-footer-${c.title.toLowerCase()}`}>
                  {c.title}
                </p>
                <ul className="lp-footer-list" aria-labelledby={`lp-footer-${c.title.toLowerCase()}`}>
                  {c.links.map((l) => (
                    <li key={l.label}>
                      <FooterLink {...l} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="lp-footer-rule" aria-hidden>
          <span className="lp-footer-rule-line" />
        </div>

        <div className="lp-footer-legal" data-reveal="fade">
          <p className="lp-footer-copy">
            © 2026 socialLiquid. Not an exchange. <span className="lp-footer-copy-2">All trades execute on Hyperliquid.</span>
          </p>
          <div className="lp-footer-legal-end">
            <span className="lp-footer-built">
              <Mark size={15} id="footer-built" />
              Built on Hyperliquid
            </span>
            <a href="#" className="lp-footer-up" aria-label="Back to top">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </a>
          </div>
        </div>

        <Signature />
      </div>
    </footer>
  );
}

function FooterLink({ label, href }: FooterLinkT) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className="lp-footer-link">
        <span className="lp-footer-link-text">{label}</span>
      </Link>
    );
  }
  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="lp-footer-link">
        <span className="lp-footer-link-text">{label}</span>
        <svg className="lp-footer-ext" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <a href={href} className="lp-footer-link">
      <span className="lp-footer-link-text">{label}</span>
    </a>
  );
}

/** the light: the cta's horizon spilling over the edge, and a floor glow under the signature */
function FooterLight() {
  return (
    <>
      <div className="lp-footer-seam" aria-hidden />
      <div className="lp-footer-spill" aria-hidden />
      <div className="lp-footer-light" aria-hidden>
        <div className="lp-footer-floor" />
        <div className="lp-grain" />
      </div>
    </>
  );
}

/** the editorial signature: a giant wordmark, lit from above, dissolving into the floor */
function Signature() {
  const word = (
    <>
      social<span className="lp-footer-sig-liquid">Liquid</span>
    </>
  );
  return (
    <div className="lp-footer-sig-wrap" aria-hidden>
      <span className="lp-footer-sig-halo">
        <span>{word}</span>
      </span>
      <div className="lp-footer-sig">
        <span className="lp-footer-sig-fill">{word}</span>
        <span className="lp-footer-sig-rim">{word}</span>
        <span className="lp-footer-sig-window">
          <span className="lp-footer-sig-glint">{word}</span>
        </span>
      </div>
    </div>
  );
}
