"use client";
/** /keys/[handle]: a trader's page. the record is free, the calls are behind their subscription, the key is for sale */
import Link from "next/link";
import { useState } from "react";
import { keysDemo, useKeysDemo } from "@/hooks/use-keys-demo";
import { HOLDER_SHARE, KEY_SUPPLY_CAP, cadenceLabel, keyBuy, keyYearly, offerTitle, OFFERS, CREATOR_SHARE } from "@/lib/keys";
import { traderByHandle, type DemoCall, type DemoTrader } from "@/lib/keys-demo";
import { fmtNum, fmtPx, fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { Face, KeyCard, PriceChart, ResetPreview, Stepper, Verified, priceLabel, sidePill } from "./parts";

export function KeysTrader({ handle }: { handle: string }) {
  const t = traderByHandle(handle)!;
  const demo = useKeysDemo();
  const subscribed = !!demo.subs[t.handle];
  const free = t.sub.price === 0;
  const unlocked = subscribed || free;
  const subscribe = () => (subscribed ? keysDemo.unsubscribe(t.handle) : keysDemo.subscribe(t.handle, t.sub.price));
  const held = demo.keys[t.handle]?.qty ?? 0;

  return (
    <div data-testid={`keys-trader-${t.handle}`}>
      {/* banner + identity */}
      <div className="k-banner h-[180px] @3xl:h-[240px] rounded-[26px]" style={{ "--a": t.colors[0], "--b": t.colors[1] } as React.CSSProperties} />
      <section className="flex items-end gap-6 flex-wrap px-2 @3xl:px-6">
        <div className="-mt-16 @3xl:-mt-20 shrink-0">
          <Face who={t} size={132} ring={t.live ? "live" : "off"} live={!!t.live} className="@3xl:!w-[152px] @3xl:!h-[152px]" />
        </div>
        <div className="flex-1 min-w-[260px] pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[36px] @3xl:text-[46px] font-bold tracking-[-0.045em] leading-none">{t.handle}</h1>
            <Verified size={26} />
          </div>
          <p className="text-[16px] text-fg-2 mt-3 max-w-[620px] leading-relaxed">{t.bio}</p>
          <p className="num text-[13px] text-muted mt-2">{t.wallet} · trading on Hyperliquid since {t.since} · {fmtNum(t.followers)} followers</p>
        </div>
        <div className="flex gap-2.5 pb-2">
          <button type="button" className="btn h-12 px-5 rounded-[14px] text-[14.5px]">Follow</button>
          {!free && (
            <button type="button" onClick={subscribe} className={`btn h-12 px-6 rounded-[14px] text-[14.5px] ${subscribed ? "" : "btn-primary btn-glow"}`} data-testid="trader-subscribe-top">
              {subscribed ? <><Icon.check /> Subscribed</> : `Subscribe · $${t.sub.price}/mo`}
            </button>
          )}
        </div>
      </section>

      {/* record */}
      <section className="card grid grid-cols-3 @5xl:grid-cols-6 overflow-hidden !rounded-[24px] mt-9">
        {[
          { v: fmtUsd(t.pnl30d, { compact: true, sign: true }), l: "30-day PnL", tone: t.pnl30d >= 0 ? "text-up" : "text-down" },
          { v: fmtUsd(t.pnlAllTime, { compact: true, sign: true }), l: "All time", tone: t.pnlAllTime >= 0 ? "text-up" : "text-down" },
          { v: `${t.winRate}%`, l: "Win rate" },
          { v: `${t.maxDrawdown}%`, l: "Max drawdown", tone: "text-down" },
          { v: fmtNum(t.sub.subscribers), l: free ? "Following free" : "Subscribers" },
          { v: fmtNum(t.key.holders), l: "Key holders" },
        ].map((s, i) => (
          <div key={s.l} className={`px-6 py-5 ${i % 3 ? "border-l border-[var(--hair)]" : ""} ${i >= 3 ? "border-t border-[var(--hair)] @5xl:border-t-0 @5xl:border-l" : ""}`}>
            <div className={`num text-[24px] @3xl:text-[27px] font-semibold tracking-[-0.035em] ${s.tone ?? ""}`}>{s.v}</div>
            <div className="text-[13px] text-muted mt-1">{s.l}</div>
          </div>
        ))}
      </section>

      <div className="grid @5xl:grid-cols-[minmax(0,1fr)_380px] gap-6 mt-8 items-start">
        {/* subscription + key: first on phones, right column on wide screens */}
        <aside className="space-y-5 @5xl:order-2">
          <SubscriptionCard t={t} subscribed={subscribed} onToggle={subscribe} />
          <KeyPanel t={t} held={held} />
        </aside>

        <main className="space-y-4 min-w-0 @5xl:order-1">
          {t.live && <LivePosition t={t} />}

          <article className="card !rounded-[24px] p-6">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
              <Icon.star /> Pinned · free for everyone
            </div>
            <p className="mt-3 text-[17px] leading-relaxed">{t.sub.pinned}</p>
          </article>

          <div className="relative">
            <div className="space-y-4">
              {t.calls.map((c, i) => (
                <CallCard key={i} c={c} locked={!unlocked} />
              ))}
            </div>
            {!unlocked && (
              <div className="k-veil absolute inset-0 rounded-[24px] flex items-start justify-center pt-16 px-4" data-testid="trader-paywall">
                <div className="k-glow-panel w-full max-w-[420px] text-center px-8 py-9">
                  <span className="w-14 h-14 rounded-full bg-brand/12 text-brand ring-1 ring-brand/35 inline-flex items-center justify-center"><Icon.lock className="w-6 h-6" /></span>
                  <h2 className="text-[23px] font-bold tracking-tight mt-4">{t.calls.length} calls this month</h2>
                  <p className="text-[15px] text-fg-2 mt-2 leading-relaxed">Subscribers see every call {t.sub.leadTime ? t.sub.leadTime : "as it happens"}, plus {t.sub.offers.filter((o) => o !== "calls").map((o) => offerTitle(o).toLowerCase()).join(", ") || "the reasoning behind each one"}.</p>
                  <button type="button" onClick={subscribe} className="btn btn-primary btn-glow w-full h-[52px] mt-6 rounded-[15px] text-[15.5px]" data-testid="trader-subscribe-paywall">Subscribe · ${t.sub.price} / month</button>
                  <p className="text-[12.5px] text-muted mt-3">Cancel any time · paid in USDC</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <ResetPreview />
    </div>
  );
}

function SubscriptionCard({ t, subscribed, onToggle }: { t: DemoTrader; subscribed: boolean; onToggle: () => void }) {
  const free = t.sub.price === 0;
  const demo = useKeysDemo();
  const renews = demo.subs[t.handle]?.renews;
  return (
    <section className="k-glow-panel p-7" data-testid="trader-sub-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-semibold text-brand-2">{free ? "Free feed" : "Subscription"}</span>
        <span className="text-[12px] text-muted">Price set by {t.handle}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-3">
        <span className="num text-[56px] font-semibold tracking-[-0.05em] leading-none">{priceLabel(t.sub.price)}</span>
        {!free && <span className="text-[16px] text-muted">/ month</span>}
      </div>
      <ul className="mt-6 space-y-3.5">
        {OFFERS.filter((o) => t.sub.offers.includes(o.key)).map((o) => (
          <li key={o.key} className="flex gap-3">
            <span className="w-9 h-9 rounded-[11px] bg-brand/10 text-brand inline-flex items-center justify-center shrink-0"><Icon.check /></span>
            <span>
              <span className="block text-[15px] font-semibold">{o.title}</span>
              <span className="block text-[13px] text-muted">{o.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-3 gap-2 mt-6">
        <div className="card-2 !rounded-[13px] px-3 py-2.5">
          <div className="text-[12.5px] font-semibold leading-tight">{cadenceLabel(t.sub.cadence)}</div>
          <div className="text-[11.5px] text-muted mt-1">posting</div>
        </div>
        <div className="card-2 !rounded-[13px] px-3 py-2.5">
          <div className="text-[12.5px] font-semibold leading-tight">{t.sub.leadTime ?? "On fill"}</div>
          <div className="text-[11.5px] text-muted mt-1">lead time</div>
        </div>
        <div className="card-2 !rounded-[13px] px-3 py-2.5">
          <div className="num text-[15px] font-semibold">{t.sub.renewRate}%</div>
          <div className="text-[11.5px] text-muted mt-1">renew</div>
        </div>
      </div>
      {free ? (
        <div className="card-2 !rounded-[15px] mt-6 h-[52px] flex items-center justify-center gap-2 text-[14.5px] text-fg-2"><Icon.check /> Everything here is free to read</div>
      ) : (
        <button type="button" onClick={onToggle} className={`btn w-full h-[54px] mt-6 rounded-[16px] text-[15.5px] ${subscribed ? "" : "btn-primary btn-glow"}`} data-testid="trader-subscribe">
          {subscribed ? `Subscribed · renews ${renews ?? ""}` : `Subscribe · $${t.sub.price} / month`}
        </button>
      )}
      <p className="text-[12.5px] text-muted text-center mt-3">
        {subscribed ? "Press again to cancel." : free ? `${t.handle} has chosen not to charge.` : `Cancel any time · USDC · ${Math.round(CREATOR_SHARE * 100)}% goes to ${t.handle}`}
      </p>
    </section>
  );
}

function KeyPanel({ t, held }: { t: DemoTrader; held: number }) {
  const [qty, setQty] = useState(3);
  const cost = keyBuy(t.key.price, qty);
  const yearly = keyYearly(t.key.price, qty, t.key.yieldPct);
  return (
    <section id="key" className="card !rounded-[28px] p-7 scroll-mt-20" data-testid="trader-key">
      <KeyCard t={t} size="md" serial={`#${fmtNum(t.key.minted + 1)}`} />
      <div className="mt-6">
        <PriceChart data={t.key.history} height={110} label={`${t.handle} key price over 30 days, from ${fmtUsd(t.key.history[0])} to ${fmtUsd(t.key.price)}`} />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-5">
        <div>
          <div className="num text-[18px] font-semibold text-brand">{t.key.yieldPct}%</div>
          <div className="text-[12px] text-muted">holder yield</div>
        </div>
        <div>
          <div className="num text-[18px] font-semibold">{fmtNum(t.key.holders)}</div>
          <div className="text-[12px] text-muted">holders</div>
        </div>
        <div>
          <div className="num text-[18px] font-semibold">{fmtNum(t.key.minted)}</div>
          <div className="text-[12px] text-muted">of {fmtNum(KEY_SUPPLY_CAP)} minted</div>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-6">
        <Stepper value={qty} onChange={setQty} label="Keys to buy" />
        <button type="button" className="btn flex-1 h-[52px] rounded-[14px] text-[14.5px] !bg-fg !text-bg !border-transparent hover:opacity-90" onClick={() => keysDemo.buy(t.handle, qty, t.key.price)} data-testid="trader-buy-key">
          Buy {qty} · {fmtUsd(cost.total)}
        </button>
      </div>
      <p className="text-[12.5px] text-muted mt-4 leading-relaxed">
        Holders split {Math.round(HOLDER_SHARE * 100)}% of the trading fees {t.handle}&apos;s followers generate — about <b className="num text-fg-2">{fmtUsd(yearly)}</b> a year for {qty} {qty === 1 ? "key" : "keys"} at today&apos;s flow. Price includes a 4% fee. A key does not include the private feed.
      </p>
      {held > 0 && (
        <div className="card-2 !rounded-[14px] mt-4 px-4 py-3 flex items-center justify-between text-[13.5px]">
          <span className="text-fg-2">You hold <b className="num text-fg">{held}</b></span>
          <Link href="/keys/holdings" className="text-brand font-semibold">Holdings</Link>
        </div>
      )}
    </section>
  );
}

function LivePosition({ t }: { t: DemoTrader }) {
  const p = t.live!;
  const pct = ((p.mark - p.entry) / p.entry) * (p.side === "LONG" ? 100 : -100);
  return (
    <article className="k-up-panel !rounded-[24px] p-6" data-testid="trader-live">
      <div className="flex items-center gap-2.5 text-[13.5px] font-semibold text-up"><span className="live-dot w-2 h-2 rounded-full bg-up" /> Trading right now</div>
      <div className="flex items-end justify-between gap-5 flex-wrap mt-4">
        <div>
          <div className="flex items-center gap-3">
            <span className={`pill ${sidePill(p.side)} num !h-7 !px-3 !text-[13px]`}>{p.side} {p.leverage}x</span>
            <span className="text-[28px] font-bold tracking-tight">{p.coin}</span>
          </div>
          <div className="num flex gap-5 flex-wrap mt-4 text-[13.5px] text-muted">
            <span>Size <b className="text-fg">{fmtUsd(p.size, { compact: true })}</b></span>
            <span>Entry <b className="text-fg">{fmtPx(p.entry)}</b></span>
            <span>Mark <b className="text-fg">{fmtPx(p.mark)}</b></span>
            <span>Liq <b className="text-down">{fmtPx(p.liq)}</b></span>
          </div>
        </div>
        <div className="text-right">
          <div className={`num text-[40px] font-semibold tracking-[-0.04em] leading-none ${p.pnl >= 0 ? "text-up glow-up" : "text-down"}`}>{fmtUsd(p.pnl, { compact: true, sign: true })}</div>
          <div className={`num text-[13.5px] mt-2 ${pct >= 0 ? "text-up" : "text-down"}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}% · opened {p.opened}</div>
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap mt-5 pt-5 border-t border-[var(--hair)]">
        <Link href={`/m/${encodeURIComponent(p.coin)}`} className="btn btn-up h-11 px-5 rounded-[13px] text-[14px]">Take this trade</Link>
        <span className="text-[13.5px] text-muted"><b className="num text-fg">{fmtNum(p.copiers)}</b> people took it</span>
      </div>
    </article>
  );
}

const KIND: Record<DemoCall["kind"], { label: string; cls: string }> = {
  call: { label: "Pre-trade call", cls: "pill-brand" },
  exit: { label: "Exit", cls: "pill-neutral" },
  lesson: { label: "Lesson", cls: "pill-thesis" },
  loss: { label: "Loss", cls: "pill-down" },
};

function CallCard({ c, locked }: { c: DemoCall; locked: boolean }) {
  return (
    <article className="card !rounded-[24px] p-6" aria-hidden={locked}>
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className={`pill ${KIND[c.kind].cls}`}>{KIND[c.kind].label}</span>
        <span className="text-muted">{c.when}</span>
      </div>
      <p className={`mt-3.5 text-[16.5px] leading-relaxed ${locked ? "k-locked" : ""}`}>{c.text}</p>
      {c.position && (
        <div className={`card-2 !rounded-[14px] mt-4 px-4 py-3 flex items-center gap-3 ${locked ? "k-locked" : ""}`}>
          <span className={`pill ${sidePill(c.position.label)} num`}>{c.position.label}</span>
          <span className="flex-1" />
          <span className={`num text-[15.5px] font-semibold ${c.position.pnl >= 0 ? "text-up" : "text-down"}`}>
            {fmtUsd(c.position.pnl, { compact: true, sign: true })} · {c.position.open ? "open" : "closed"}
          </span>
        </div>
      )}
    </article>
  );
}
