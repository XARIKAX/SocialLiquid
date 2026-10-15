"use client";
/** /keys: the front door. who is live, who is trending, what they are posting, and the pitch to creators */
import Link from "next/link";
import { useKeysDemo } from "@/hooks/use-keys-demo";
import { DEMO_FEED, DEMO_PLATFORM, DEMO_TRADERS, traderByHandle, type DemoTrader } from "@/lib/keys-demo";
import { fmtNum, fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { Face, KeyCard, ResetPreview, Verified, priceLabel, sidePill, usdBig } from "./parts";

export function KeysHub() {
  const demo = useKeysDemo();
  const whale = DEMO_TRADERS[0];
  const live = DEMO_TRADERS.filter((t) => t.live);
  const trending = ["basedwhale", "memewitch", "nyx"].map((h) => traderByHandle(h)!);
  return (
    <div className="space-y-20 @3xl:space-y-24" data-testid="keys-hub">
      {/* hero */}
      <section className="relative grid @4xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] gap-10 items-center pt-8 @3xl:pt-12">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 w-[620px] h-[460px] rounded-full opacity-70" style={{ background: "radial-gradient(closest-side, rgb(77 227 193 / calc(0.16 * var(--glow))), transparent)" }} />
        <div className="relative min-w-0">
          <span className="inline-flex items-center gap-2.5 pl-3 pr-4 h-9 rounded-full card-2 text-[13.5px] text-fg-2">
            <span className="live-dot w-2 h-2 rounded-full bg-up" />
            <span><b className="num text-fg">{fmtNum(DEMO_PLATFORM.live)}</b> traders in a position right now</span>
          </span>
          <h1 className="k-display mt-6 text-[44px] @3xl:text-[60px] @6xl:text-[72px] font-bold">
            Follow the traders
            <br />
            who are <span className="k-brand-glow">actually up.</span>
          </h1>
          <p className="mt-6 text-[17px] @3xl:text-[19px] leading-relaxed text-fg-2 max-w-[540px]">
            Every position verified onchain. Subscribe to a trader&apos;s private calls, own a share of them with a key, and trade alongside them on Hyperliquid — in one place.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/keys/market" className="btn btn-primary btn-glow h-14 px-7 text-[15.5px] rounded-[16px]" data-testid="hub-explore">
              Explore traders <Icon.right />
            </Link>
            <Link href="/keys/studio" className="btn h-14 px-6 text-[15.5px] rounded-[16px]">Get paid for your calls</Link>
          </div>
          <div className="flex items-center gap-3 mt-8">
            <span className="flex -space-x-2.5">
              {DEMO_TRADERS.slice(0, 4).map((t) => (
                <span key={t.handle} className="rounded-full ring-2 ring-bg"><Face who={t} size={32} /></span>
              ))}
            </span>
            <span className="text-[14px] text-muted">
              <b className="num text-fg">{fmtNum(DEMO_PLATFORM.traders)}</b> verified traders · <b className="num text-fg">{fmtUsd(DEMO_PLATFORM.paidToCreators, { compact: true })}</b> paid to creators
            </span>
          </div>
          <KeyCard t={whale} size="md" className="mt-10 max-w-[380px] @4xl:hidden" />
        </div>

        {/* floating widgets */}
        <div className="relative h-[560px] hidden @4xl:block" aria-hidden="true">
          <div className="absolute left-[12%] top-[13%] w-[min(380px,82%)] -rotate-[7deg]">
            <div className="k-float"><KeyCard t={whale} size="lg" /></div>
          </div>
          <div className="absolute right-0 top-[2%] w-[300px] k-glass rounded-[20px] p-4 flex items-center gap-3">
            <Face who={traderByHandle("kairos")!} size={40} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px]"><b>kairos</b> <span className="text-muted">opened a position</span></div>
              <div className="num text-[12.5px] mt-0.5"><span className="text-up font-semibold">LONG HYPE 10x</span> <span className="text-muted">· $2.4M</span></div>
            </div>
            <span className="text-[11.5px] text-muted">now</span>
          </div>
          <div className="absolute left-0 bottom-[2%] w-[280px] rotate-[4deg] k-glass rounded-[22px] p-5">
            <div className="flex items-center gap-3">
              <Face who={traderByHandle("memewitch")!} size={42} />
              <div>
                <div className="text-[15px] font-bold">memewitch</div>
                <div className="num text-[12px] text-muted">9,840 subscribers</div>
              </div>
            </div>
            <div className="flex items-baseline gap-1 mt-4"><span className="num text-[32px] font-semibold tracking-tight">$19</span><span className="text-[13.5px] text-muted">/ month</span></div>
            <div className="btn btn-primary w-full h-11 mt-3 rounded-[12px] text-[14px]">Subscribe</div>
          </div>
          <div className="absolute right-[2%] bottom-[22%] k-glass rounded-full pl-2.5 pr-4 py-2.5 flex items-center gap-2.5" style={{ borderColor: "rgb(77 227 193 / 0.3)" }}>
            <span className="w-8 h-8 rounded-full bg-brand/15 text-brand inline-flex items-center justify-center"><Icon.wallet /></span>
            <span className="text-[13.5px]"><b className="num text-brand">+$84.20</b> <span className="text-fg-2">key payout</span></span>
          </div>
        </div>
      </section>

      {/* live now */}
      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[24px] font-bold tracking-tight flex items-center gap-3"><span className="live-dot w-2.5 h-2.5 rounded-full bg-up" /> Live now</h2>
          <Link href="/keys/market" className="text-[14px] text-muted hover:text-fg">See everyone trading</Link>
        </div>
        <div className="flex gap-6 mt-6 overflow-x-auto pb-3 pt-1 px-1 -mx-1" data-testid="hub-live">
          {DEMO_TRADERS.map((t) => (
            <Link key={t.handle} href={`/keys/${t.handle}`} className="flex flex-col items-center gap-2.5 w-[96px] shrink-0 group">
              <Face who={t} size={84} ring={t.live ? "live" : "off"} live={!!t.live} className="transition-transform group-hover:scale-[1.04]" />
              <span className="text-[13.5px] font-semibold mt-1 truncate max-w-full">{t.handle}</span>
              <span className={`num text-[11.5px] font-semibold ${t.live ? (t.live.side === "LONG" ? "text-up" : "text-down") : "text-muted"}`}>
                {t.live ? `${t.live.side} ${t.live.coin} ${t.live.leverage}x` : "Flat"}
              </span>
            </Link>
          ))}
        </div>
        <p className="sr-only">{live.length} of {DEMO_TRADERS.length} traders are in a position.</p>
      </section>

      {/* numbers */}
      <section className="card grid grid-cols-2 @4xl:grid-cols-4 overflow-hidden !rounded-[26px]">
        {[
          { v: usdBig(DEMO_PLATFORM.routed), l: "routed to Hyperliquid" },
          { v: fmtNum(DEMO_PLATFORM.traders), l: "traders with a verified record" },
          { v: fmtUsd(DEMO_PLATFORM.paidToCreators, { compact: true }), l: "paid to creators", brand: true },
          { v: "0", l: "screenshots. Every PnL is read from chain" },
        ].map((s, i) => (
          <div key={s.l} className={`p-7 @3xl:p-8 ${i % 2 ? "border-l border-[var(--hair)]" : ""} ${i > 1 ? "border-t border-[var(--hair)] @4xl:border-t-0" : ""} ${i === 2 ? "@4xl:border-l" : ""}`}>
            <div className={`num text-[32px] @3xl:text-[38px] font-semibold tracking-[-0.04em] ${s.brand ? "text-brand" : ""}`}>{s.v}</div>
            <div className="text-[14px] text-muted mt-1.5">{s.l}</div>
          </div>
        ))}
      </section>

      {/* trending */}
      <section>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[34px] @3xl:text-[42px] font-bold tracking-[-0.04em]">Trending traders</h2>
            <p className="text-[16px] text-muted mt-2">Ranked by verified 30-day performance. Every trader sets their own price.</p>
          </div>
          <Link href="/keys/market" className="text-[14.5px] font-semibold text-brand">View all keys</Link>
        </div>
        <div className="grid @2xl:grid-cols-2 @5xl:grid-cols-3 gap-5 mt-8">
          {trending.map((t) => (
            <TrendingCard key={t.handle} t={t} subscribed={!!demo.subs[t.handle]} />
          ))}
        </div>
      </section>

      {/* feed */}
      <section>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-[34px] @3xl:text-[42px] font-bold tracking-[-0.04em]">From the feed</h2>
          <span className="text-[14px] text-muted">Subscriber calls unlock when you subscribe</span>
        </div>
        <div className="grid @3xl:grid-cols-2 gap-4 mt-8">
          {DEMO_FEED.map((p) => {
            const t = traderByHandle(p.handle)!;
            return <FeedPost key={p.handle + p.when} t={t} post={p} unlocked={!p.locked || !!demo.subs[p.handle]} />;
          })}
        </div>
      </section>

      {/* creators */}
      <section className="k-glow-panel p-8 @3xl:p-14 grid @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-10 items-center">
        <div>
          <h2 className="k-display text-[40px] @3xl:text-[56px] font-bold">Get paid for<br />being right.</h2>
          <p className="mt-5 text-[17px] leading-relaxed text-fg-2 max-w-[500px]">Charge what you want for your calls — or nothing at all. Sell keys in yourself. Earn every time a follower trades on your call.</p>
          <Link href="/keys/studio" className="btn btn-primary btn-glow h-14 px-7 mt-8 text-[15.5px] rounded-[16px]">Open creator studio</Link>
        </div>
        <div className="space-y-3">
          {[
            { v: "$0–$500", l: "a month — you set the price" },
            { v: "90%", l: "of every subscription is yours", brand: true },
            { v: "Daily", l: "payouts in USDC" },
          ].map((r) => (
            <div key={r.l} className="card-2 !rounded-[18px] px-6 py-5 flex items-center gap-5">
              <span className={`num text-[26px] font-semibold tracking-tight min-w-[118px] ${r.brand ? "text-brand" : ""}`}>{r.v}</span>
              <span className="text-[14.5px] text-fg-2">{r.l}</span>
            </div>
          ))}
        </div>
      </section>

      <ResetPreview />
    </div>
  );
}

function TrendingCard({ t, subscribed }: { t: DemoTrader; subscribed: boolean }) {
  return (
    <article className="card overflow-hidden !rounded-[26px]" data-testid={`trending-${t.handle}`}>
      <div className="k-banner h-[112px]" style={{ "--a": t.colors[0], "--b": t.colors[1] } as React.CSSProperties} />
      <div className="px-6 pb-6 -mt-11">
        <Face who={t} size={86} ring={t.live ? "live" : "off"} live={!!t.live} />
        <div className="flex items-center gap-2 mt-3">
          <h3 className="text-[21px] font-bold tracking-tight">{t.handle}</h3>
          <Verified />
        </div>
        <p className="text-[13.5px] text-muted mt-0.5">{t.style}</p>
        <div className="flex items-baseline gap-2.5 mt-5">
          <span className={`num text-[34px] font-semibold tracking-[-0.04em] ${t.pnl30d >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(t.pnl30d, { compact: true, sign: true })}</span>
          <span className="text-[13px] text-muted">30 days</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mt-5">
          <div className="card-2 !rounded-[14px] px-4 py-3">
            <div className="text-[12px] text-muted">Key</div>
            <div className="num text-[18px] font-semibold mt-0.5">{fmtUsd(t.key.price)}</div>
            <div className={`num text-[12px] ${t.key.change24h >= 0 ? "text-up" : "text-down"}`}>{t.key.change24h >= 0 ? "+" : ""}{t.key.change24h}% today</div>
          </div>
          <div className="card-2 !rounded-[14px] px-4 py-3">
            <div className="text-[12px] text-muted">Subscription</div>
            <div className="num text-[18px] font-semibold mt-0.5">{priceLabel(t.sub.price)}{t.sub.price > 0 && <span className="text-[12.5px] text-muted">/mo</span>}</div>
            <div className="num text-[12px] text-muted">{fmtNum(t.sub.subscribers)} subscribers</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mt-4">
          <Link href={`/keys/${t.handle}`} className="btn btn-primary h-12 rounded-[14px] text-[14px]">{subscribed ? "Subscribed" : "Subscribe"}</Link>
          <Link href={`/keys/${t.handle}#key`} className="btn h-12 rounded-[14px] text-[14px]"><Icon.key /> Buy key</Link>
        </div>
      </div>
    </article>
  );
}

function FeedPost({ t, post, unlocked }: { t: DemoTrader; post: (typeof DEMO_FEED)[number]; unlocked: boolean }) {
  const pos = t.live;
  const locked = !unlocked;
  return (
    <article className="card !rounded-[24px] p-6 relative overflow-hidden" data-testid={`feed-post-${t.handle}`}>
      <div className="flex items-center gap-3">
        <Link href={`/keys/${t.handle}`}><Face who={t} size={44} /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/keys/${t.handle}`} className="text-[15px] font-bold hover:underline">{t.handle}</Link>
            <span className={`pill ${t.pnl30d >= 0 ? "pill-up" : "pill-down"} num`}>{fmtUsd(t.pnl30d, { compact: true, sign: true })}</span>
          </div>
          <div className="text-[12.5px] text-muted">{post.when}</div>
        </div>
        {post.locked && <span className={`pill ${locked ? "pill-warn" : "pill-brand"}`}>{locked ? "Subscribers" : "Unlocked"}</span>}
      </div>
      <p className={`mt-4 text-[16px] leading-relaxed text-fg ${locked ? "k-locked" : ""}`} aria-hidden={locked}>{post.text}</p>
      {pos && (
        <div className={`card-2 !rounded-[14px] mt-4 px-4 py-3 flex items-center gap-3 ${locked ? "k-locked" : ""}`} aria-hidden={locked}>
          <span className={`pill ${sidePill(pos.side)} num`}>{pos.side} {pos.coin} {pos.leverage}x</span>
          <span className="num text-[13.5px] text-fg-2">{fmtUsd(pos.size, { compact: true })}</span>
          <span className="flex-1" />
          <span className={`num text-[16px] font-semibold ${pos.pnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(pos.pnl, { compact: true, sign: true })}</span>
        </div>
      )}
      <div className="flex items-center gap-5 mt-4 text-[13px] text-muted">
        <span><b className="num text-fg-2">{post.likes}</b> likes</span>
        <span><b className="num text-fg-2">{post.replies}</b> replies</span>
        <span className="flex-1" />
        <span><b className="num text-brand">{fmtNum(post.copied)}</b> took this trade</span>
      </div>
      {locked && (
        <div className="k-veil absolute inset-x-0 bottom-0 top-[76px] flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="w-12 h-12 rounded-full bg-warn/10 text-warn inline-flex items-center justify-center ring-1 ring-warn/30"><Icon.lock /></span>
          <span className="text-[15px] font-semibold">Pre-trade call for subscribers</span>
          <Link href={`/keys/${t.handle}`} className="btn btn-primary h-11 px-5 rounded-[13px]">Unlock for {priceLabel(t.sub.price)}{t.sub.price > 0 ? "/mo" : ""}</Link>
        </div>
      )}
    </article>
  );
}
