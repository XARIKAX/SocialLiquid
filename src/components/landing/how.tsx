import Link from "next/link";
import type { ReactNode } from "react";
import { Arrow, Check, Disc, SectionHead, vars } from "./parts";
import type { LandingData } from "./types";

/* =====================================================================
   how it works — a lit rail with three luminous nodes. each node opens
   onto a glass card holding a small, live-looking moment of the flow:
   connect, sign twice, trade and post. the trust row closes it out.
   ===================================================================== */

const DOCS = "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes";
/** an illustrative address, reused across the steps so the story reads as one wallet */
const ADDR = "0x7a3f4be2d81c6a09f5e3b7d24c1a8e60f2b9c91e";
const SHORT = "0x7a3f…c91e";
/** the handle that wallet claims in step 01 and posts under in step 03 (fictional) */
const HANDLE = "undertow";

export function How({ d }: { d: LandingData }) {
  return (
    <section id="how" className="lp-how" aria-labelledby="lp-how-title">
      <div className="lp-how-atmos" aria-hidden>
        <div className="lp-how-glow lp-how-glow-a" />
        <div className="lp-how-glow lp-how-glow-b" />
        <div className="lp-how-glow lp-how-glow-c" />
        <div className="lp-how-glow lp-how-glow-floor" />
        <div className="lp-grain" />
      </div>

      <div className="lp-container lp-how-grid">
        <div className="lp-how-aside">
          <div className="lp-how-sticky">
            <SectionHead
              align="left"
              id="lp-how-title"
              className="lp-how-head"
              eyebrow="How it works"
              title={
                <>
                  <span className="lp-how-line">No custody.</span> <span className="lp-how-line">No token.</span>{" "}
                  <em className="lp-grad not-italic lp-how-line">Just your receipts.</em>
                </>
              }
              lead="Three steps from wallet to receipt. Every order routes straight to Hyperliquid with our builder code on it."
            />
            <div data-reveal className="lp-how-ctas" style={vars({ "--d": "0.24s" })}>
              <Link href="/trade" className="lp-btn lp-btn-primary">
                Start trading <Arrow />
              </Link>
              <a href={DOCS} target="_blank" rel="noreferrer" className="lp-btn lp-btn-ghost lp-how-docs">
                How builder codes work <ExtArrow />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
            <dl data-reveal className="lp-how-stack" style={vars({ "--d": "0.32s" })}>
              <div className="lp-how-stack-i">
                <dt className="lp-how-stack-k lp-mono">Settles on</dt>
                <dd className="lp-how-stack-v">
                  <span className="lp-how-stack-dot" aria-hidden />
                  Hyperliquid L1
                </dd>
              </div>
              <div className="lp-how-stack-i">
                <dt className="lp-how-stack-k lp-mono">Funds from</dt>
                <dd className="lp-how-stack-v">
                  <span className="lp-how-stack-dot lp-how-stack-dot-blue" aria-hidden />
                  Arbitrum USDC
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="lp-how-timeline">
          <div className="lp-how-source" aria-hidden />
          <div className="lp-how-rail" data-reveal="fade" aria-hidden>
            <span className="lp-how-rail-line" />
            <span className="lp-how-rail-fill" />
            <span className="lp-how-rail-pulse" />
          </div>
          <ol className="lp-how-steps">
            <Step
              n="01"
              title="Connect and claim"
              meta={<><Ico><path d="M5 20.5V5.5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 5.5v15" /><path d="M3.5 20.5h12M5 10h9" /><path d="M14 8h1.6a1.9 1.9 0 0 1 1.9 1.9v5.4a1.35 1.35 0 0 0 2.7 0V8.6L17.7 6" /></Ico>No gas</>}
              body="Any EVM wallet. Sign one message to log in, then claim the handle your receipts will carry."
            >
              <ConnectVignette />
            </Step>
            <Step
              n="02"
              title="Approve once"
              meta={<><Ico><path d="M15.5 4.5 19.5 8.5 9 19H5v-4z" /><path d="m13 7 4 4" /><path d="M13 20h7" /></Ico>Never per trade</>}
              body="Two signatures: an agent wallet so you never sign per click, and a 0.1% max builder fee so our code rides your fills."
            >
              <ApproveVignette />
            </Step>
            <Step
              n="03"
              title="Trade and post"
              meta={<><Ico><path d="M4 16 9.5 10.5l3.5 3.5L20 7" /><path d="M15 7h5v5" /></Ico>Every trade</>}
              body="Deposit USDC from Arbitrum, then trade any order type up to each market's max leverage, TP and SL attached. Add a thesis if you dare."
            >
              <TradeVignette px={d.btc?.markPx} />
            </Step>
          </ol>
        </div>
      </div>

      <div className="lp-container lp-how-foot">
        <div data-reveal className="lp-how-fine" style={vars({ "--d": "0s" })}>
          <span className="lp-how-fine-rule" aria-hidden />
          <span id="lp-how-fine" className="lp-mono">
            The fine print, in large print
          </span>
          <span className="lp-how-fine-rule lp-how-fine-rule-r" aria-hidden />
        </div>
        <ul className="lp-how-trust" aria-labelledby="lp-how-fine">
          <Trust
            d="0.05s"
            tone="teal"
            title="Your main key stays in your wallet"
            body={"Orders are signed by an agent key we keep encrypted. It can trade for you. It\u00a0can't withdraw."}
            icon={
              <>
                <path d="M12 3.2 19 6v5.3c0 4.4-2.9 8-7 9.5-4.1-1.5-7-5.1-7-9.5V6z" />
                <circle cx="12" cy="10.8" r="2" />
                <path d="M12 12.8v3" />
              </>
            }
          />
          <Trust
            d="0.15s"
            tone="blue"
            title="No token, no pool, no contract"
            body="Nothing to rug. Your funds sit in your own Hyperliquid account, never in a contract of ours."
            icon={
              <>
                <path d="M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7z" />
                <path d="M4.5 7.7 12 12l7.5-4.3M12 12v8.5" />
                <path d="M3.5 3.5 20.5 20.5" className="lp-how-slash" />
              </>
            }
          />
          <Trust
            d="0.25s"
            tone="mint"
            title="0.05% builder fee per side"
            body="Hard-capped at 0.1% by your own signature, and visible on every fill."
            icon={
              <>
                <path d="M6.5 3.5h11v17l-2.75-1.8L12 20.5l-2.75-1.8L6.5 20.5z" />
                <path d="M14.5 8.5 9.5 14.5" />
                <circle cx="9.9" cy="8.9" r="1.1" />
                <circle cx="14.1" cy="14.1" r="1.1" />
              </>
            }
          />
        </ul>
      </div>
    </section>
  );
}

/* ---------- icons ---------- */
function Ico({ children, size = 14, sw = 1.8 }: { children: ReactNode; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function ExtArrow() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="lp-how-ext">
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

/* ---------- a step on the rail ---------- */
function Step({ n, title, body, meta, children }: { n: string; title: string; body: string; meta: ReactNode; children: ReactNode }) {
  return (
    <li className="lp-how-step" data-reveal>
      <div className="lp-how-node" aria-hidden>
        <span className="lp-how-orb">
          <span className="lp-how-orb-ring" />
          <span className="lp-mono lp-num">{n}</span>
        </span>
      </div>
      <span className="lp-how-port" aria-hidden />
      <div className="lp-how-card lp-glass lp-spot" data-spotlight>
        <div className="lp-how-card-head">
          <span className="lp-how-kicker lp-mono">Step {n}</span>
          <span className="lp-how-meta">{meta}</span>
        </div>
        <h3 className="lp-how-h3 lp-lit">{title}</h3>
        <p className="lp-how-body">{body}</p>
        <div className="lp-how-vig lp-glass-inner" data-reveal="fade" style={vars({ "--d": "0.18s" })} aria-hidden>
          {children}
        </div>
      </div>
    </li>
  );
}

function VigHead({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="lp-how-vig-head">
      <span className="lp-mono">{label}</span>
      {children}
    </div>
  );
}

/* ---------- 01 connect ---------- */
const WALLETS: { tone: string; glyph: ReactNode }[] = [
  {
    tone: "teal",
    glyph: (
      <>
        <ellipse cx="12" cy="12" rx="8.2" ry="3.9" transform="rotate(-28 12 12)" />
        <circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    tone: "blue",
    glyph: (
      <>
        <path d="M12 3.8 18.6 10 12 20.2 5.4 10z" fill="currentColor" fillOpacity="0.2" />
        <path d="M12 3.8 18.6 10 12 20.2 5.4 10z" />
        <path d="M5.4 10h13.2M12 3.8 9.4 10 12 20.2 14.6 10z" strokeOpacity="0.55" />
      </>
    ),
  },
  {
    tone: "slate",
    glyph: (
      <>
        <rect x="4.2" y="6.2" width="15.6" height="11.6" rx="3.2" fill="currentColor" fillOpacity="0.16" />
        <rect x="4.2" y="6.2" width="15.6" height="11.6" rx="3.2" />
        <path d="M13.6 10.6h6.2v3h-6.2a1.5 1.5 0 0 1 0-3z" fill="currentColor" fillOpacity="0.25" />
        <circle cx="15" cy="12.1" r="0.6" fill="currentColor" />
      </>
    ),
  },
];

function ConnectVignette() {
  return (
    <>
      <VigHead label="Connect a wallet">
        <span className="lp-pill lp-pill-neutral">Any EVM</span>
      </VigHead>
      <div className="lp-how-connect">
        <div className="lp-how-wallets">
          {WALLETS.map((w, i) => (
            <span key={w.tone} className={`lp-how-wtile lp-how-wtile-${w.tone}`} data-on={i === 0 ? "" : undefined}>
              <Ico size={22} sw={1.6}>
                {w.glyph}
              </Ico>
              {i === 0 && (
                <span className="lp-how-wtick">
                  <Check size={9} />
                </span>
              )}
            </span>
          ))}
          <span className="lp-how-wtile lp-how-wtile-more">
            <Ico size={18} sw={2.2}>
              <path d="M6.5 12h.01M12 12h.01M17.5 12h.01" />
            </Ico>
          </span>
        </div>
        <span className="lp-how-link">
          <span className="lp-how-link-run" />
        </span>
        <span className="lp-how-addr">
          <Disc a={ADDR} size={22} />
          <span className="lp-how-addr-a lp-mono lp-num">{SHORT}</span>
          <span className="lp-how-addr-state">
            <span className="lp-live lp-live-up" />
            Connected
          </span>
        </span>
      </div>
      <div className="lp-how-claim">
        <span className="lp-how-claim-k lp-mono">Handle</span>
        <span className="lp-how-claim-v">
          <span className="lp-how-claim-at">@</span>
          {HANDLE}
        </span>
        <span className="lp-pill lp-pill-brand lp-how-claimed">
          <Check size={10} /> Claimed
        </span>
      </div>
      <div className="lp-how-vig-foot">
        <span>
          <Ico size={13}>
            <path d="M3.5 17.5c2.2 0 3-6.5 5.2-6.5 1.9 0 .4 5 2.3 5 1.4 0 2.1-2.6 3.4-2.6.9 0 1.1 1.6 2.1 1.6.8 0 1.5-.7 2.1-1.4" />
            <path d="M3.5 20.5h17" />
          </Ico>
          Login signature, no permissions
        </span>
        <span className="lp-how-vig-foot-r">Same key signs on Hyperliquid</span>
      </div>
    </>
  );
}

/* ---------- 02 approve once ---------- */
function ApproveVignette() {
  return (
    <>
      <VigHead label="Signature requests">
        <span className="lp-pill lp-pill-brand">One time</span>
      </VigHead>
      <div className="lp-how-sigs">
        <Sig
          tone="teal"
          title="Approve agent wallet"
          sub={<><span>Kept encrypted</span><span>can trade, can&apos;t withdraw</span></>}
          d="0.55s"
          icon={
            <>
              <circle cx="8" cy="15.5" r="3.6" />
              <path d="m10.6 12.9 8.4-8.4M15.6 7.9l2.2 2.2M13.4 10.1l1.8 1.8" />
            </>
          }
        />
        <Sig
          tone="blue"
          title={
            <>
              Approve builder fee <span className="lp-how-cap lp-num">≤&nbsp;0.1%</span>
            </>
          }
          sub={<><span>Max rate</span><span>we charge 0.05% per side</span></>}
          d="1.05s"
          icon={
            <>
              <path d="M18.5 5.5 5.5 18.5" />
              <circle cx="7.4" cy="7.4" r="2.4" />
              <circle cx="16.6" cy="16.6" r="2.4" />
            </>
          }
        />
      </div>
      <div className="lp-how-vig-foot">
        <span className="lp-how-progress-k lp-num">
          <span className="lp-how-odo">
            <span className="lp-how-odo-col">
              <span>0</span>
              <span>1</span>
              <span>2</span>
            </span>
          </span>
          &nbsp;of 2 signed
        </span>
        <span className="lp-how-progress">
          <i />
        </span>
        <span className="lp-how-vig-foot-r">No pop-ups per trade</span>
      </div>
    </>
  );
}

function Sig({ tone, title, sub, icon, d }: { tone: string; title: ReactNode; sub: ReactNode; icon: ReactNode; d: string }) {
  return (
    <div className="lp-how-sig" style={vars({ "--cd": d })}>
      <span className={`lp-how-sig-ico lp-how-sig-ico-${tone}`}>
        <Ico size={17}>{icon}</Ico>
      </span>
      <span className="lp-how-sig-copy">
        <b>{title}</b>
        <small className="lp-how-sub">{sub}</small>
      </span>
      <span className="lp-how-sig-state">
        <span className="lp-how-check">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <circle className="lp-how-check-ring" cx="12" cy="12" r="10" pathLength={1} />
            <path className="lp-how-check-tick" d="m7.6 12.3 2.9 2.9 5.9-6.1" pathLength={1} />
          </svg>
        </span>
        <span className="lp-pill lp-pill-up lp-how-signed">Signed</span>
      </span>
    </div>
  );
}

/* ---------- 03 trade and post ---------- */
const grp = (v: number) => Math.round(v).toLocaleString("en-US");

function TradeVignette({ px }: { px?: number }) {
  // anchored to the live btc mark when we have it, a calm sample when we don't
  const entry = px && Number.isFinite(px) && px > 0 ? Math.round(px / 10) * 10 : 82_410;
  const tp = Math.round((entry * 1.045) / 50) * 50;
  // the stop sits on a round hundred so the thesis can quote it exactly (81,100 → "81.1k")
  const sl = Math.round((entry * 0.981) / 100) * 100;
  return (
    <>
      <div className="lp-how-order">
        <span className="lp-how-coin" aria-hidden>
          ₿
        </span>
        <span className="lp-how-order-t">
          <b><span className="lp-how-side">Long</span> BTC</b>
          <span className="lp-how-order-sep"> · </span>
          <span className="lp-how-order-amt lp-num">$100 · 5x</span>
          <small className="lp-mono">Market · BTC-USD</small>
        </span>
        <span className="lp-pill lp-pill-up lp-how-filled">
          <Check size={11} /> Filled
        </span>
      </div>
      <dl className="lp-how-grid4 lp-num">
        <div>
          <dt>Entry</dt>
          <dd>{grp(entry)}</dd>
        </div>
        <div>
          <dt>Take profit</dt>
          <dd className="lp-how-up">
            {grp(tp)} <small>+{(((tp - entry) / entry) * 100).toFixed(1)}%</small>
          </dd>
        </div>
        <div>
          <dt>Stop loss</dt>
          <dd className="lp-how-down">
            {grp(sl)} <small>−{(((entry - sl) / entry) * 100).toFixed(1)}%</small>
          </dd>
        </div>
        <div>
          <dt>Builder fee</dt>
          <dd>
            0.05% <small>/ side</small>
          </dd>
        </div>
      </dl>
      <div className="lp-how-thesis">
        <span className="lp-how-thesis-k lp-mono">Thesis</span>
        <p>
          Bought the retest of the breakout. No averaging down, I&apos;m out below <span className="lp-num">{(sl / 1000).toFixed(1)}k</span>.
        </p>
      </div>
      <div className="lp-how-posted">
        <span className="lp-pill lp-pill-brand lp-how-posted-pill">
          <span className="lp-live" /> Posted to feed
        </span>
        <span className="lp-how-posted-by">
          <Disc a={ADDR} size={16} />
          <span className="lp-how-posted-h">@{HANDLE}</span>
          <span className="lp-how-posted-ago">· just now</span>
        </span>
      </div>
    </>
  );
}

/* ---------- trust row ---------- */
function Trust({ title, body, icon, tone, d }: { title: string; body: string; icon: ReactNode; tone: "teal" | "blue" | "mint"; d: string }) {
  return (
    <li data-reveal className={`lp-how-trust-item lp-how-trust-${tone} lp-glass lp-spot`} data-spotlight style={vars({ "--d": d })}>
      <span className="lp-how-crown" aria-hidden />
      <span className={`lp-how-tile lp-how-tile-${tone}`} aria-hidden>
        <Ico size={24} sw={1.55}>
          {icon}
        </Ico>
      </span>
      <div className="lp-how-trust-copy">
        <h3 className="lp-how-trust-t">{title}</h3>
        <p className="lp-how-trust-b">{body}</p>
      </div>
    </li>
  );
}
