import Link from "next/link";
import { Mark, Wordmark, vars } from "./parts";
import { FooterTop } from "./footer-top";
import type { LandingData } from "./types";

type FooterLinkT = { label: string; href: string };
const HL_DOCS = "https://hyperliquid.gitbook.io/hyperliquid-docs";
/* product routes, on-page explainers, and the venue underneath. no placeholder links:
   legal pages and the brand's X account get a column when they exist */
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
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { label: "Hyperliquid app", href: "https://app.hyperliquid.xyz" },
      { label: "Hyperliquid docs", href: HL_DOCS },
      { label: "Builder codes", href: `${HL_DOCS}/trading/builder-codes` },
    ],
  },
];

export function Footer({ d }: { d: LandingData }) {
  // same signal the tape uses: no markets back from hyperliquid means the feed is down
  const up = d.stats.markets > 0;
  return (
    <footer id="footer" className="lp-footer" aria-label="Site footer">
      <FooterLight />

      <div className="lp-container lp-footer-inner">
        <div className="lp-footer-top">
          <div className="lp-footer-brand" data-reveal>
            <Link href="/" className="lp-footer-logo" aria-label="socialLiquid home">
              <Wordmark size={24} />
            </Link>
            <p className="lp-footer-tag">
              <span className="lp-lit">The social layer</span> <em className="lp-grad not-italic">for perpetual markets.</em>
            </p>
            <span className={up ? "lp-footer-status" : "lp-footer-status lp-footer-status-down"}>
              <span className={up ? "lp-live" : "lp-footer-status-idle"} aria-hidden />
              <span>Hyperliquid mainnet</span>
              <span className="lp-footer-status-sep" aria-hidden>·</span>
              <span className={up ? "lp-footer-status-ok" : "lp-footer-status-warn"}>{up ? "operational" : "reconnecting"}</span>
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
          <div className="lp-footer-fine">
            <p className="lp-footer-copy">
              © {new Date().getUTCFullYear()} socialLiquid. Not an exchange. <span className="lp-footer-copy-2">All trades execute on Hyperliquid.</span>
            </p>
            <p className="lp-footer-risk">
              Perps are leveraged. You can lose your whole margin, fast. <span className="lp-footer-risk-2">Nothing here is financial advice.</span>
            </p>
          </div>
          <div className="lp-footer-legal-end">
            <span className="lp-footer-built">
              <Mark size={16} />
              Built on Hyperliquid
            </span>
            <FooterTop />
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
