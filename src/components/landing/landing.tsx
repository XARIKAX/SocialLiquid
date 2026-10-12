import Image from "next/image";
import Link from "next/link";
import type { FeedItem } from "@/lib/queries";
import { fmtPx, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import { Icon } from "../icons";
import { Reveal } from "./reveal";

type BoardRow = { rank: number; address: string; name: string | null; pnl30d: number; accountValue: number };

type Props = {
  heroVideo?: boolean;
  stats: { markets: number; volume24h: number; traders: number };
  btc: { markPx: number; change24h: number; volume24h: number; openInterestUsd: number; funding: number; maxLeverage: number } | null;
  candles: number[];
  items: FeedItem[];
  traders: { address: string; displayName: string | null }[];
  board: BoardRow[];
};

export function Landing(p: Props) {
  return (
    <div className="theme-dark bg-bg text-fg">
      <Nav />
      <Hero video={!!p.heroVideo} />
      <Product stats={p.stats} />
      <Bento items={p.items} board={p.board} />
      <Reveal><Receipts /></Reveal>
      <Reveal><HowItWorks /></Reveal>
      <Orbit traders={p.traders} count={p.stats.traders} />
      <Footer />
    </div>
  );
}

/* ---------- nav ---------- */
function Nav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30 h-16 flex items-center px-5 md:px-8">
      <Link href="/" className="inline-flex items-center gap-1.5 font-semibold tracking-[-0.03em] text-[20px]">
        <span className="text-brand"><Icon.drop /></span>
        <span>social<span className="text-brand">Liquid</span></span>
      </Link>
      <nav className="ml-auto flex items-center gap-1">
        <Link href="/trade" className="btn btn-ghost h-9 hidden sm:inline-flex">Trade</Link>
        <Link href="/leaderboard" className="btn btn-ghost h-9 hidden sm:inline-flex">Leaderboard</Link>
        <a href="#how" className="btn btn-ghost h-9 hidden md:inline-flex">How it works</a>
        <Link href="/trade" className="btn h-9 px-4 ml-1 bg-white text-black border-white hover:bg-white/90 font-semibold">Launch app</Link>
      </nav>
    </header>
  );
}

/* ---------- hero: the whole first screen ---------- */
function Hero({ video }: { video: boolean }) {
  return (
    <section className="hero relative min-h-[100svh] overflow-hidden bg-[#03090b] flex flex-col">
      {/* the school following one glowing fish. a video loop when one is present, otherwise the still with a slow drift */}
      <div className="hero-media" aria-hidden>
        {video ? (
          <video className="hero-img" autoPlay muted loop playsInline preload="auto" poster="/landing/hero.webp">
            <source src="/landing/hero.webm" type="video/webm" />
            <source src="/landing/hero.mp4" type="video/mp4" />
          </video>
        ) : (
          <picture>
            <source media="(max-width: 640px)" srcSet="/landing/hero-sm.webp" type="image/webp" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/hero.webp" alt="" width={1376} height={768} loading="eager" fetchPriority="high" decoding="async" className="hero-img hero-drift" />
          </picture>
        )}
      </div>
      <div className="hero-rays" aria-hidden />
      <div className="hero-motes" aria-hidden />
      <div className="hero-shade" aria-hidden />

      <div className="relative z-10 flex-1 w-full max-w-[1180px] mx-auto px-5 md:px-8 pt-28 md:pt-36 pb-32">
        <div className="max-w-[640px]">
          <div className="mono-label text-brand hero-in" style={{ ["--i" as string]: 0 }}>Live on Hyperliquid mainnet</div>
          <h1 className="wordmark wordmark-left mt-4 hero-in" style={{ ["--i" as string]: 1 }}>
            social<span className="wordmark-liquid">Liquid</span>
          </h1>
          <p className="mt-4 text-[clamp(22px,2.6vw,34px)] font-medium tracking-[-0.03em] text-fg hero-in" style={{ ["--i" as string]: 2 }}>the social layer for Hyperliquid.</p>
          <p className="mt-3 max-w-[520px] text-[clamp(15px,1.3vw,18px)] text-fg-2/90 leading-snug hero-in" style={{ ["--i" as string]: 3 }}>
            Follow the best traders on Hyperliquid, see every position the second it opens, and trade alongside them.
          </p>
          <div className="mt-8 flex items-center gap-3 flex-wrap hero-in" style={{ ["--i" as string]: 4 }}>
            <Link href="/trade" className="btn btn-primary h-12 px-7 text-[15px] rounded-xl shadow-[0_0_50px_-10px_rgb(77_227_193/0.7)]">Start trading</Link>
            <Link href="/leaderboard" className="btn h-12 px-7 text-[15px] rounded-xl glass">See the leaderboard</Link>
          </div>
        </div>
      </div>

      <a href="#product" className="scroll-cue" aria-label="scroll to the product">
        <span className="text-[10px] tracking-[0.22em] uppercase text-fg-2/70">the terminal</span>
        <span className="scroll-cue-chevron" />
      </a>
    </section>
  );
}

function FloatCard({ it, className, tilt, dur, delay }: { it: FeedItem; className: string; tilt: string; dur: string; delay: string }) {
  const p = it.payload as { side?: string; sizeUsd?: number; leverage?: number; entryPx?: number; realisedPnl?: number };
  const side = it.position?.side ?? p.side ?? "LONG";
  const closed = it.type === "CLOSED" || it.type === "LIQUIDATED";
  const name = it.user?.handle ?? it.user?.displayName ?? shortAddr(it.address);
  return (
    <div className={`float-card p-3.5 ${className}`} style={{ ["--tilt" as string]: tilt, ["--dur" as string]: dur, ["--delay" as string]: delay }}>
      <div className="flex items-center gap-2">
        <Dot a={it.address} size={26} />
        <span className="font-semibold text-[13px] truncate">{name}</span>
        <span className={`pill ${closed ? (it.type === "LIQUIDATED" ? "pill-liq" : "pill-neutral") : side === "LONG" ? "pill-up" : "pill-down"}`}>{closed ? (it.type === "LIQUIDATED" ? "Liquidated" : "Closed") : side === "LONG" ? "Long" : "Short"}</span>
        <span className="ml-auto text-dim num text-[10px]">{timeAgo(it.time)}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2 num text-[13px]">
        <span className="w-6 h-6 rounded-full bg-panel-3 inline-flex items-center justify-center text-[10px] font-bold">{it.coin.slice(0, 1)}</span>
        <span className="font-semibold">{it.coin}</span>
        {p.sizeUsd !== undefined && <span className="text-fg-2">{fmtUsd(p.sizeUsd, { compact: true })}</span>}
        {p.leverage !== undefined && <span className="pill pill-neutral">{p.leverage}x</span>}
        {closed && p.realisedPnl !== undefined ? (
          <span className={`ml-auto font-semibold ${p.realisedPnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(p.realisedPnl, { sign: true })}</span>
        ) : p.entryPx !== undefined ? (
          <span className="ml-auto text-dim">at {fmtPx(p.entryPx)}</span>
        ) : null}
      </div>
      {it.thesis && <p className="mt-2 text-[12px] text-fg-2 line-clamp-2 leading-snug">{it.thesis.text}</p>}
    </div>
  );
}

/* ---------- product shot ---------- */
function Product({ stats }: { stats: Props["stats"] }) {
  return (
    <section id="product" className="relative px-4 md:px-8 pt-20 md:pt-28 pb-20 overflow-hidden section-seam">
      <div className="absolute inset-x-0 top-[20%] h-[70%] bg-[radial-gradient(55%_55%_at_50%_45%,rgb(77_227_193/0.12),transparent_70%)] pointer-events-none" />
      <Reveal className="relative mx-auto max-w-[1180px] text-center mb-10 md:mb-14">
        <h2 className="h-display">the terminal</h2>
        <p className="mt-3 text-[clamp(16px,1.5vw,20px)] text-muted">Hyperliquid&apos;s full order book and leverage, with the feed, theses and the leaderboard beside the chart.</p>
      </Reveal>
      <div className="relative mx-auto max-w-[1180px]">
        <Reveal className="monitor-wrap">
          <div className="monitor">
            <Image src="/landing/terminal.webp" width={1440} height={900} alt="the socialLiquid terminal: live feed, chart, order book and ticket" sizes="(max-width: 1240px) 100vw, 1180px" unoptimized />
          </div>
          <div className="monitor-stand hidden md:block" />
        </Reveal>
        <Reveal className="phone-wrap hidden md:block" delay={220}>
          <div className="phone">
            <Image src="/landing/phone.webp" width={390} height={844} alt="socialLiquid on mobile" sizes="230px" unoptimized />
          </div>
        </Reveal>
      </div>
      <dl className="relative mt-14 md:mt-20 flex items-center gap-x-10 gap-y-3 flex-wrap justify-center text-sm text-muted num">
        <Stat v={String(stats.markets)} k="perp markets" />
        <Stat v={fmtUsd(stats.volume24h, { compact: true })} k="24h volume on Hyperliquid" />
        <Stat v={stats.traders.toLocaleString("en-US")} k="traders tracked" />
        <Stat v="0.05%" k="builder fee per side" />
      </dl>
    </section>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="sr-only">{k}</dt>
      <dd className="text-fg font-semibold text-[17px]">{v}</dd>
      <span className="font-sans">{k}</span>
    </div>
  );
}

/* ---------- bento: leaderboard / feed / alerts with live visuals ---------- */
function Bento({ items, board }: { items: FeedItem[]; board: BoardRow[] }) {
  const opens = items.filter((i) => i.type === "LONG" || i.type === "SHORT").slice(0, 2);
  return (
    <section id="features" className="px-5 md:px-8 py-24 max-w-[1180px] mx-auto">
      <Reveal>
        <h2 className="h-display">never miss a move</h2>
        <p className="mt-3 text-[clamp(17px,1.6vw,22px)] text-muted">the social layer every Hyperliquid trader needed</p>
      </Reveal>
      <div className="grid md:grid-cols-3 gap-4 mt-12">
        <Reveal delay={0}><Feature label="Leaderboard" title="follow the traders who actually win" body="Hyperliquid's own top 10 by 30-day PnL, mirrored to the cent, plus our rankings from on-chain fills.">
          <div className="bento-visual mt-6">
            {(board.length ? board : []).slice(0, 4).map((r) => (
              <div key={r.rank} className="flex items-center gap-2.5 px-3 h-11 border-b border-line/60 last:border-0 text-[13px]">
                <span className={`num w-4 ${r.rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>{r.rank}</span>
                <Dot a={r.address} size={24} />
                <span className="font-medium truncate">{r.name ?? shortAddr(r.address)}</span>
                <span className="ml-auto num font-semibold text-up">{fmtUsd(r.pnl30d, { sign: true, compact: true })}</span>
              </div>
            ))}
            {board.length === 0 && <div className="p-4 text-dim text-xs">Hyperliquid&apos;s top traders land here.</div>}
          </div>
        </Feature></Reveal>
        <Reveal delay={120}><Feature label="Feed" title="every long, short and liquidation, live" body="Positions are mirrored straight from chain for every tracked trader. Nothing is self-reported.">
          <div className="bento-visual mt-6 text-[12px]">
            {opens.map((it) => (
              <MiniCard key={it.id} it={it} />
            ))}
            {opens.length === 0 && <div className="p-4 text-dim text-xs">Live positions from tracked traders land here.</div>}
          </div>
        </Feature></Reveal>
        <Reveal delay={240}><Feature label="Alerts" title="know the moment the best are buying" body="Follow a trader and their opens, closes and liquidations reach you the second they hit chain.">
          <div className="mt-6 space-y-2">
            {items.filter((i) => i.position).slice(0, 2).map((it, i) => {
              const p = it.payload as { side?: string; sizeUsd?: number; leverage?: number };
              const name = it.user?.handle ?? it.user?.displayName ?? shortAddr(it.address);
              return (
                <div key={it.id} className="toast-in glass rounded-xl p-3 flex items-center gap-2.5 text-[12px]" style={{ ["--delay" as string]: `${i * 0.25}s` }}>
                  <Dot a={it.address} size={28} />
                  <span className="min-w-0 leading-tight">
                    <span className="block font-semibold truncate">{name} {it.type === "CLOSED" ? "closed" : it.type === "LIQUIDATED" ? "got liquidated on" : "opened"} {it.coin}</span>
                    <span className="block text-dim num">{p.side === "SHORT" ? "Short" : "Long"} {p.leverage ? `${p.leverage}x` : ""}{p.sizeUsd ? ` · ${fmtUsd(p.sizeUsd, { compact: true })}` : ""} · just now</span>
                  </span>
                  <span className="ml-auto text-brand"><Icon.bell /></span>
                </div>
              );
            })}
            {items.length === 0 && <div className="bento-visual p-4 text-dim text-xs">Alerts show up here.</div>}
          </div>
        </Feature></Reveal>
      </div>
    </section>
  );
}

function Feature({ label, title, body, children }: { label: string; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="card p-6 md:p-7 flex flex-col h-full">
      <div className="feature-label">{label}</div>
      <h3 className="text-[clamp(22px,2.2vw,28px)] font-medium tracking-[-0.03em] leading-tight mt-3 text-balance">{title}</h3>
      <p className="text-muted mt-3 leading-snug">{body}</p>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function MiniCard({ it }: { it: FeedItem }) {
  const p = it.payload as { side?: string; sizeUsd?: number; leverage?: number; entryPx?: number; realisedPnl?: number };
  const tag: Record<string, [string, string]> = { LONG: ["Long", "pill-up"], SHORT: ["Short", "pill-down"], THESIS: ["Thesis", "pill-thesis"], CLOSED: ["Closed", "pill-neutral"], LIQUIDATED: ["Liquidated", "pill-liq"] };
  const [label, cls] = tag[it.type] ?? ["", "pill-neutral"];
  const closed = it.type === "CLOSED" || it.type === "LIQUIDATED";
  return (
    <div className="px-3 py-2.5 border-b border-line/70 last:border-0">
      <div className="flex items-center gap-2">
        <Dot a={it.address} size={22} />
        <span className="font-semibold truncate">{it.user?.handle ?? it.user?.displayName ?? shortAddr(it.address)}</span>
        <span className={`pill ${cls}`}>{label}</span>
        <span className="ml-auto text-dim num text-[10px]">{timeAgo(it.time)}</span>
      </div>
      <div className="pl-[30px] mt-1 flex items-center gap-1.5 num">
        <span className="font-semibold">{it.coin}</span>
        {p.sizeUsd !== undefined && <span>{fmtUsd(p.sizeUsd, { compact: true })}</span>}
        {p.entryPx !== undefined && <><span className="text-dim">at</span><span className="text-fg-2">{fmtPx(p.entryPx)}</span></>}
        {p.leverage !== undefined && <span className="pill pill-neutral">{p.leverage}x</span>}
        {closed && p.realisedPnl !== undefined && <span className={`ml-auto font-semibold ${p.realisedPnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(p.realisedPnl, { sign: true })}</span>}
      </div>
      {it.thesis && <p className="pl-[30px] mt-1 text-fg-2 line-clamp-2">{it.thesis.text}</p>}
    </div>
  );
}

function Dot({ a, size = 20 }: { a: string; size?: number }) {
  const h1 = parseInt(a.slice(2, 8), 16) % 360;
  const h2 = (h1 + 60) % 360;
  return <span className="rounded-full shrink-0 inline-block" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h1} 72% 62%), hsl(${h2} 70% 42%))` }} />;
}

/* ---------- receipts ---------- */
function Receipts() {
  return (
    <section id="receipts" className="px-5 md:px-8 pb-24 max-w-[1180px] mx-auto">
      <div className="card p-6 md:p-10 grid lg:grid-cols-[1fr_380px] gap-8 items-center overflow-hidden relative">
        <div className="absolute -right-24 -top-24 w-[420px] h-[420px] rounded-full bg-[radial-gradient(circle,rgb(107_147_255/0.14),transparent_65%)] pointer-events-none" />
        <div className="relative">
          <div className="feature-label">Thesis · receipts</div>
          <h3 className="text-[clamp(26px,3vw,40px)] font-medium tracking-[-0.035em] leading-tight mt-3">say why. put the position behind it. let everyone watch.</h3>
          <p className="text-muted mt-3 max-w-[560px] leading-snug">A thesis is 280 characters bound to a live position. It carries the PnL while it is open and gets an outcome the moment it closes: held, profit, loss, liquidated, or dumped inside an hour. The outcome comes from on-chain fills, never from the trader.</p>
          <div className="flex flex-wrap gap-2 mt-5">
            <span className="pill pill-brand h-7 px-2.5 text-xs">Holding</span>
            <span className="pill pill-up h-7 px-2.5 text-xs">Closed in profit</span>
            <span className="pill pill-down h-7 px-2.5 text-xs">Closed at loss</span>
            <span className="pill pill-liq h-7 px-2.5 text-xs">Liquidated</span>
            <span className="pill pill-warn h-7 px-2.5 text-xs">Dumped &lt; 1h</span>
          </div>
        </div>
        <div className="relative card-2 p-4 text-[13px]">
          <div className="flex items-center gap-2">
            <Dot a="0x7f3a9c2e1b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a" size={28} />
            <span className="font-semibold">rangetrader</span>
            <span className="pill pill-thesis">Thesis</span>
            <span className="ml-auto pill pill-up">Closed in profit</span>
          </div>
          <p className="mt-3 leading-snug">Funding flipped negative while price reclaimed the weekly open. Shorts are paying me to hold the breakout. Target 118k, invalidation below 108.4k.</p>
          <div className="mt-3 flex items-center gap-2 num text-[12px] text-muted">
            <span className="w-5 h-5 rounded-full bg-[#f7931a] text-black inline-flex items-center justify-center text-[10px] font-bold">₿</span>
            <span className="text-fg font-semibold">BTC</span>
            <span className="pill pill-up">Long</span>
            <span>10x · $42K</span>
            <span className="ml-auto text-up font-semibold">+$3,816 · ▲ 9.1%</span>
          </div>
          <div className="mt-3 h-px bg-line" />
          <div className="mt-2.5 flex items-center gap-3 text-[11px] text-dim">
            <span className="inline-flex items-center gap-1"><Icon.heart /> 128</span>
            <span>held 2d 6h</span>
            <span className="ml-auto">receipt from chain</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- how it works ---------- */
function HowItWorks() {
  const steps = [
    ["Connect", "Any EVM wallet. Hyperliquid uses the same address, so your balance and positions are already there."],
    ["Approve once", "Two signatures: a trading agent so you never sign per click, and a 0.05% builder fee. Neither can withdraw."],
    ["Trade and post", "Market, limit, stop, TP/SL, scale and TWAP at Hyperliquid's full leverage. Deposit USDC from Arbitrum without leaving the page."],
  ];
  return (
    <section id="how" className="px-5 md:px-8 pb-24 max-w-[1180px] mx-auto">
      <div className="card p-6 md:p-10 grid lg:grid-cols-[320px_1fr] gap-10">
        <div>
          <div className="feature-label">How it works</div>
          <h2 className="text-[clamp(28px,3vw,40px)] font-medium tracking-[-0.035em] leading-tight mt-3">no custody. no contracts. just your receipts.</h2>
          <p className="text-muted mt-3">Every order routes to Hyperliquid with our builder code. We never hold your main key, and there is no token, pool or custom contract anywhere in the stack.</p>
          <Link href="/trade" className="btn btn-primary h-11 px-6 mt-6">Launch app</Link>
        </div>
        <ol className="grid sm:grid-cols-3 gap-3">
          {steps.map(([t, b], i) => (
            <li key={t} className="card-2 p-5">
              <span className="w-7 h-7 rounded-full bg-brand/15 text-brand num text-xs font-semibold inline-flex items-center justify-center">{i + 1}</span>
              <h3 className="font-semibold text-[15px] mt-4">{t}</h3>
              <p className="text-muted text-[13px] mt-1.5 leading-snug">{b}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- orbit cta ---------- */
function Orbit({ traders, count }: { traders: { address: string; displayName: string | null }[]; count: number }) {
  const ring1 = traders.slice(0, 5);
  const ring2 = traders.slice(5, 11);
  return (
    <section className="relative overflow-hidden px-5 py-28 md:py-40 bg-[radial-gradient(70%_80%_at_50%_50%,#121634_0%,#0a0b16_55%,#050507_100%)]">
      <div className="crowd" />
      <div className="stars opacity-40" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-[min(92vw,760px)] aspect-square">
          <div className="ring w-[52%] h-[52%]" />
          <div className="ring w-[78%] h-[78%]" />
          <div className="ring w-[100%] h-[100%]" />
          <div className="orbit" style={{ ["--dur" as string]: "70s" }}>
            {ring1.map((t, i) => (
              <span key={t.address} className="orbit-item" style={{ ["--a" as string]: `${(i / Math.max(1, ring1.length)) * 360}deg`, ["--r" as string]: "calc(min(92vw, 760px) * 0.39)" }}>
                <Dot a={t.address} size={34} />
              </span>
            ))}
          </div>
          <div className="orbit orbit-r" style={{ ["--dur" as string]: "110s" }}>
            {ring2.map((t, i) => (
              <span key={t.address} className="orbit-item" style={{ ["--a" as string]: `${(i / Math.max(1, ring2.length)) * 360 + 20}deg`, ["--r" as string]: "calc(min(92vw, 760px) * 0.5)" }}>
                <Dot a={t.address} size={44} />
              </span>
            ))}
          </div>
          <span className="absolute left-1/2 bottom-[-22px] -translate-x-1/2 w-11 h-11 rounded-full bg-brand text-black inline-flex items-center justify-center shadow-[0_0_40px_rgb(77_227_193/0.6)]"><Icon.drop /></span>
        </div>
      </div>
      <div className="relative z-10 text-center max-w-[720px] mx-auto">
        <h2 className="text-[clamp(34px,5vw,60px)] font-medium tracking-[-0.04em] leading-[1.02]">follow the best.<br />trade alongside them.</h2>
        <p className="mt-5 text-[clamp(15px,1.5vw,20px)] text-muted">join {count.toLocaleString("en-US")} {count === 1 ? "trader" : "traders"} making their name on socialLiquid</p>
        <div className="mt-8 flex items-center gap-3 justify-center flex-wrap">
          <Link href="/trade" className="btn btn-primary h-12 px-7 text-[15px] rounded-xl">Start trading</Link>
          <Link href="/leaderboard" className="btn h-12 px-7 text-[15px] rounded-xl glass">See the leaderboard</Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- footer ---------- */
function Footer() {
  const cols: [string, [string, string][]][] = [
    ["About", [["How it works", "#how"], ["Receipts", "#receipts"], ["Builder codes", "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes"]]],
    ["Social", [["X / Twitter", "https://x.com"], ["Hyperliquid", "https://app.hyperliquid.xyz"]]],
    ["Legal", [["Privacy", "#"], ["Terms", "#"]]],
  ];
  return (
    <footer className="px-5 md:px-8 py-16 border-t border-line">
      <div className="max-w-[1180px] mx-auto grid md:grid-cols-[1fr_auto] gap-10">
        <div>
          <div className="inline-flex items-center gap-1.5 font-semibold tracking-[-0.03em] text-[26px]"><span className="text-brand"><Icon.drop /></span><span>social<span className="text-brand">Liquid</span></span></div>
          <p className="text-muted mt-1">the social layer for Hyperliquid.</p>
          <p className="text-dim text-xs mt-6">© 2026 socialLiquid. Not an exchange. All trades execute on Hyperliquid.</p>
        </div>
        <div className="grid grid-cols-3 gap-10">
          {cols.map(([h, links]) => (
            <div key={h}>
              <div className="text-[11px] tracking-[0.18em] uppercase text-dim mb-3">{h}</div>
              <ul className="space-y-2 text-[13px]">
                {links.map(([l, href]) => (
                  <li key={l}>
                    <a href={href} className="text-fg-2 hover:text-fg" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
