"use client";
/** /keys/[handle]: a trader's page. the record is free, the calls are for whoever holds their key, the key is for sale */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBusy, useKeys, useKeysActions, useKeysTrader, type PayWith } from "@/hooks/use-keys";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { keysToast } from "@/hooks/use-keys-toast";
import { api } from "@/lib/client";
import { HOLDER_SHARE, KEY_PROTOCOL_FEE, KEY_SUPPLY_CAP, KEY_TRADER_CUT, KEYS_PROGRAM, cadenceLabel, keyBuy, keySell, keyYearly, offerTitle, OFFERS } from "@/lib/keys";
import type { KeysCall, KeysTrader as Trader } from "@/lib/keys-model";
import { fmtNum, fmtPx, fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { Face, KeyCard, KeysState, PriceChart, ResetPreview, Stepper, Verified, pctOrDash, priceLabel, sidePill } from "./parts";

/** what a locked post shows under the blur: the real text never reaches the browser */
const LOCKED_TEXT = "Entry, invalidation and targets are in this post, with the reasoning behind the size. Hold a key to read it.";

export function KeysTrader({ handle }: { handle: string }) {
  const { t, loading, missing } = useKeysTrader(handle);
  if (loading) return <KeysState title="Loading…" />;
  if (!t || missing) return <KeysState title="No trader here" body="Nobody on keys goes by that name." action={<Link href="/keys/market" className="btn h-12 px-6 rounded-[14px]">Browse traders</Link>} />;
  return <TraderPage t={t} />;
}

function TraderPage({ t }: { t: Trader }) {
  const data = useKeys();
  const actions = useKeysActions();
  const [buyBusy, runBuy] = useBusy();
  const [payWith, setPayWith] = useState<PayWith>("USDC");
  const live = data.mode === "live";
  const own = live && !!data.me.viewer?.address && data.me.viewer.address === t.address;
  const held = data.me.keys[t.handle]?.qty ?? 0;
  const unread = data.me.keys[t.handle]?.unread ?? 0;
  // live, the server decides what this viewer may read (it checks the chain); the preview unlocks on the keys held here
  const unlocked = live ? !t.calls.some((c) => c.locked) : held > 0;
  const lockedCount = t.calls.filter((c) => c.locked).length;
  const canBuy = t.key.listed && (!live || !!KEYS_PROGRAM) && t.key.minted < KEY_SUPPLY_CAP;
  const one = keyBuy(t.key.minted, 1, t.key.start);
  /** one key is all it takes to unlock the feed */
  const buyOne = () => runBuy(() => actions.buy(t, 1, payWith));
  const { markRead } = actions;

  // a holder looking at the page has read what is new
  useEffect(() => {
    if (held > 0 && unread > 0) markRead(t.handle);
  }, [held, unread, t.handle, markRead]);

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
            <h1 className="text-[36px] @3xl:text-[46px] font-bold tracking-[-0.045em] leading-none break-all">{t.handle}</h1>
            <Verified size={26} />
          </div>
          {t.bio && <p className="text-[16px] text-fg-2 mt-3 max-w-[620px] leading-relaxed">{t.bio}</p>}
          <p className="num text-[13px] text-muted mt-2">{t.wallet} · trading on Hyperliquid since {t.since} · {fmtNum(t.followers)} {t.followers === 1 ? "follower" : "followers"}</p>
        </div>
        <div className="flex gap-2.5 pb-2">
          {own ? (
            <Link href="/keys/studio" className="btn btn-primary h-12 px-6 rounded-[14px] text-[14.5px]">Post to holders</Link>
          ) : (
            <>
              <FollowButton t={t} />
              {held > 0 ? (
                <span className="btn h-12 px-6 rounded-[14px] text-[14.5px] pointer-events-none" data-testid="trader-holder"><Icon.check /> Holder · {held} {held === 1 ? "key" : "keys"}</span>
              ) : canBuy ? (
                <button type="button" onClick={buyOne} disabled={buyBusy} className="btn btn-primary btn-glow h-12 px-6 rounded-[14px] text-[14.5px]" data-testid="trader-buy-top">
                  {buyBusy ? "Working…" : `Buy key · ${fmtUsd(one.total)}`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </section>

      {/* record */}
      <section className="card grid grid-cols-3 @5xl:grid-cols-6 overflow-hidden !rounded-[24px] mt-9">
        {[
          { v: fmtUsd(t.pnl30d, { compact: true, sign: true }), l: "30-day PnL", tone: t.pnl30d >= 0 ? "text-up" : "text-down" },
          { v: fmtUsd(t.pnlAllTime, { compact: true, sign: true }), l: "All time", tone: t.pnlAllTime >= 0 ? "text-up" : "text-down" },
          { v: pctOrDash(t.winRate), l: "Win rate" },
          { v: pctOrDash(t.maxDrawdown), l: "Max drawdown", tone: t.maxDrawdown ? "text-down" : "" },
          { v: t.key.listed ? fmtUsd(t.key.price) : "—", l: "Key price" },
          { v: fmtNum(t.key.holders), l: "Key holders" },
        ].map((s, i) => (
          <div key={s.l} className={`px-6 py-5 ${i % 3 ? "border-l border-[var(--hair)]" : ""} ${i >= 3 ? "border-t border-[var(--hair)] @5xl:border-t-0 @5xl:border-l" : ""}`}>
            <div className={`num text-[24px] @3xl:text-[27px] font-semibold tracking-[-0.035em] ${s.tone ?? ""}`}>{s.v}</div>
            <div className="text-[13px] text-muted mt-1">{s.l}</div>
          </div>
        ))}
      </section>

      <div className="grid @5xl:grid-cols-[minmax(0,1fr)_380px] gap-6 mt-8 items-start">
        {/* what the key unlocks + the key itself: first on phones, right column on wide screens */}
        <aside className="space-y-5 @5xl:order-2">
          <AccessCard t={t} held={held} own={own} canBuy={canBuy} price={one.total} busy={buyBusy} onBuy={buyOne} />
          <KeyPanel t={t} held={held} own={own} payWith={payWith} setPayWith={setPayWith} />
        </aside>

        <main className="space-y-4 min-w-0 @5xl:order-1">
          {t.live && <LivePosition t={t} own={own} />}

          {t.feed.pinned && (
            <article className="card !rounded-[24px] p-6">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
                <Icon.star /> Pinned · free for everyone
              </div>
              <p className="mt-3 text-[17px] leading-relaxed whitespace-pre-line">{t.feed.pinned}</p>
            </article>
          )}

          {t.calls.length === 0 && (
            <div className="card !rounded-[24px] p-8 text-center">
              <div className="text-[17px] font-semibold">{own ? "Nothing posted yet" : `${t.handle} has not posted yet`}</div>
              <p className="text-[14px] text-muted mt-1.5">{own ? "Post your first call from the studio. Every key holder gets an alert." : "Key holders get an alert the moment the first call goes up."}</p>
            </div>
          )}

          <div className="relative">
            <div className="space-y-4">
              {t.calls.map((c, i) => (
                <CallCard key={c.id ?? i} c={c} locked={live ? !!c.locked : !unlocked} />
              ))}
            </div>
            {!unlocked && t.calls.length > 0 && (
              <div className="k-veil absolute inset-0 rounded-[24px] flex items-start justify-center pt-16 px-4" data-testid="trader-paywall">
                <div className="k-glow-panel w-full max-w-[420px] text-center px-8 py-9">
                  <span className="w-14 h-14 rounded-full bg-brand/12 text-brand ring-1 ring-brand/35 inline-flex items-center justify-center"><Icon.lock className="w-6 h-6" /></span>
                  <h2 className="text-[23px] font-bold tracking-tight mt-4">{live ? `${lockedCount} ${lockedCount === 1 ? "post" : "posts"} for key holders` : `${t.calls.length} calls this month`}</h2>
                  <p className="text-[15px] text-fg-2 mt-2 leading-relaxed">Hold one {t.handle} key and you see every call {t.feed.leadTime ? t.feed.leadTime : "as it happens"}, plus {t.feed.offers.filter((o) => o !== "calls").map((o) => offerTitle(o).toLowerCase()).join(", ") || "the reasoning behind each one"}.</p>
                  {canBuy ? (
                    <button type="button" onClick={buyOne} disabled={buyBusy} className="btn btn-primary btn-glow w-full h-[52px] mt-6 rounded-[15px] text-[15.5px]" data-testid="trader-buy-paywall">{buyBusy ? "Working…" : `Buy 1 key · ${fmtUsd(one.total)}`}</button>
                  ) : (
                    <div className="card-2 !rounded-[15px] mt-6 h-[52px] flex items-center justify-center text-[14.5px] text-fg-2">{t.key.listed ? "All keys are out" : "Key not listed yet"}</div>
                  )}
                  <p className="text-[12.5px] text-muted mt-3">No monthly fee · sell the key back any time</p>
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

/** follow for the social feed; separate from holding the key, which is what unlocks the private feed */
function FollowButton({ t }: { t: Trader }) {
  const data = useKeys();
  const auth = useAuth();
  const qc = useQueryClient();
  const live = data.mode === "live";
  const q = useQuery({ queryKey: ["follows"], queryFn: () => api<{ addresses: string[] }>("/api/follow"), enabled: live && auth.signedIn, staleTime: 30_000 });
  const [busy, run] = useBusy();
  const following = !!t.address && !!q.data?.addresses.includes(t.address);
  const toggle = () =>
    run(async () => {
      if (!live || !t.address) return keysToast(`Following ${t.handle}. In the live version their trades show up in your feed.`);
      if (!auth.signedIn) return keysToast("Sign in first to follow traders.", "error");
      try {
        await api("/api/follow", { method: "POST", json: { address: t.address, follow: !following } });
        await qc.invalidateQueries({ queryKey: ["follows"] });
        qc.invalidateQueries({ queryKey: ["keys"] });
      } catch (e) {
        keysToast((e as Error).message, "error");
      }
    });
  return (
    <button type="button" className="btn h-12 px-5 rounded-[14px] text-[14.5px]" onClick={toggle} disabled={busy}>
      {following ? <><Icon.check /> Following</> : "Follow"}
    </button>
  );
}

/** what holding the key gets you: the trader's feed, for as long as you hold it */
function AccessCard({ t, held, own, canBuy, price, busy, onBuy }: { t: Trader; held: number; own: boolean; canBuy: boolean; price: number; busy: boolean; onBuy: () => void }) {
  const { mode } = useKeys();
  const live = mode === "live";
  const note = own
    ? "This is your feed. Change what is included in the studio."
    : held > 0
      ? "Unlocked for as long as you hold a key. New posts alert you."
      : `No subscription: one key is the pass. ${Math.round(KEY_TRADER_CUT * 100)}% of every key sold goes to ${t.handle}.`;
  return (
    <section className="k-glow-panel p-7" data-testid="trader-access">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-semibold text-brand-2">{held > 0 ? "Unlocked" : "A key unlocks the feed"}</span>
        <span className="text-[12px] text-muted">Started at {priceLabel(t.key.start)}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-3">
        <span className="num text-[56px] font-semibold tracking-[-0.05em] leading-none">{held > 0 ? held : 1}</span>
        <span className="text-[16px] text-muted">{held > 0 ? (held === 1 ? "key held" : "keys held") : "key to get in"}</span>
      </div>
      {t.feed.offers.length > 0 && (
        <ul className="mt-6 space-y-3.5">
          {OFFERS.filter((o) => t.feed.offers.includes(o.key)).map((o) => (
            <li key={o.key} className="flex gap-3">
              <span className="w-9 h-9 rounded-[11px] bg-brand/10 text-brand inline-flex items-center justify-center shrink-0"><Icon.check /></span>
              <span>
                <span className="block text-[15px] font-semibold">{o.title}</span>
                <span className="block text-[13px] text-muted">{o.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-3 gap-2 mt-6">
        <div className="card-2 !rounded-[13px] px-3 py-2.5">
          <div className="text-[12.5px] font-semibold leading-tight">{cadenceLabel(t.feed.cadence)}</div>
          <div className="text-[11.5px] text-muted mt-1">posting</div>
        </div>
        <div className="card-2 !rounded-[13px] px-3 py-2.5">
          <div className="text-[12.5px] font-semibold leading-tight">{t.feed.leadTime ?? (live ? "—" : "On fill")}</div>
          <div className="text-[11.5px] text-muted mt-1">lead time</div>
        </div>
        <div className="card-2 !rounded-[13px] px-3 py-2.5">
          <div className="num text-[15px] font-semibold">{fmtNum(t.key.holders)}</div>
          <div className="text-[11.5px] text-muted mt-1">holders</div>
        </div>
      </div>
      {own ? (
        <Link href="/keys/studio" className="btn w-full h-[54px] mt-6 rounded-[16px] text-[15.5px]">Open studio</Link>
      ) : held > 0 ? (
        <div className="card-2 !rounded-[15px] mt-6 h-[52px] flex items-center justify-center gap-2 text-[14.5px] text-fg-2"><Icon.check /> You can read everything here</div>
      ) : canBuy ? (
        <button type="button" onClick={onBuy} disabled={busy} className="btn btn-primary btn-glow w-full h-[54px] mt-6 rounded-[16px] text-[15.5px]" data-testid="trader-buy-access">
          {busy ? "Working…" : `Buy 1 key · ${fmtUsd(price)}`}
        </button>
      ) : (
        <div className="card-2 !rounded-[15px] mt-6 h-[52px] flex items-center justify-center text-[14.5px] text-fg-2">{t.key.listed ? "All keys are out" : `${t.handle} has not listed a key yet`}</div>
      )}
      <p className="text-[12.5px] text-muted text-center mt-3">{note}</p>
    </section>
  );
}

function KeyPanel({ t, held, own, payWith, setPayWith }: { t: Trader; held: number; own: boolean; payWith: PayWith; setPayWith: (p: PayWith) => void }) {
  const { mode } = useKeys();
  const actions = useKeysActions();
  const live = mode === "live";
  const room = KEY_SUPPLY_CAP - t.key.minted;
  const [qty, setQty] = useState(Math.min(3, Math.max(1, room)));
  const [sellQty, setSellQty] = useState(1);
  const solana = useSolanaWallet();
  const [busy, run] = useBusy();
  const cost = keyBuy(t.key.minted, qty, t.key.start);
  const back = keySell(t.key.minted, Math.min(sellQty, held), t.key.start);
  const yearly = keyYearly(t.key.price, qty, t.key.yieldPct);
  const launched = !live || !!KEYS_PROGRAM;
  return (
    <section id="key" className="card !rounded-[28px] p-7 scroll-mt-20" data-testid="trader-key">
      <KeyCard t={t} size="md" serial={t.key.listed ? `#${fmtNum(t.key.minted + 1)}` : undefined} />
      {t.key.listed && launched ? (
        <>
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
          {live && room > 0 && (
            <div className="flex items-center justify-between gap-3 mt-6">
              <div className="seg" role="radiogroup" aria-label="Pay with">
                {(["USDC", "SOL"] as const).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={payWith === p} onClick={() => setPayWith(p)} className={`seg-item inline-flex items-center h-8 px-3.5 text-[13px] ${payWith === p ? "seg-active" : ""}`} data-testid={`pay-${p}`}>
                    Pay with {p}
                  </button>
                ))}
              </div>
              {solana.address && <span className="num text-[12px] text-muted truncate" title={`${solana.name ?? "Solana wallet"} ${solana.address}`}>{solana.address.slice(0, 4)}…{solana.address.slice(-4)}</span>}
            </div>
          )}
          {room > 0 ? (
            <div className={`flex items-center gap-3 ${live ? "mt-3" : "mt-6"}`}>
              <Stepper value={qty} onChange={setQty} max={Math.min(50, room)} label="Keys to buy" />
              <button type="button" className="btn flex-1 h-[52px] rounded-[14px] text-[14.5px] !bg-fg !text-bg !border-transparent hover:opacity-90" onClick={() => run(() => actions.buy(t, qty, payWith))} disabled={busy} data-testid="trader-buy-key">
                {busy ? "Working…" : `Buy ${qty} · ${fmtUsd(cost.total)}`}
              </button>
            </div>
          ) : (
            <div className="card-2 !rounded-[14px] mt-6 px-4 py-3 text-[14px] text-fg-2">All {fmtNum(KEY_SUPPLY_CAP)} keys are out. Buy from a holder when one sells.</div>
          )}
          <p className="text-[12.5px] text-muted mt-4 leading-relaxed">
            Holders split {Math.round(HOLDER_SHARE * 100)}% of the trading fees {t.handle}&apos;s followers generate — about <b className="num text-fg-2">{fmtUsd(yearly)}</b> a year for {qty} {qty === 1 ? "key" : "keys"} at today&apos;s flow. Of the price, {Math.round(KEY_TRADER_CUT * 100)}% goes to {t.handle} and the rest backs your keys, so you can always sell them back; a {Math.round(KEY_PROTOCOL_FEE * 100)}% fee applies each way. Any key you hold unlocks {t.handle}&apos;s feed.
            {live && (payWith === "SOL" ? " Keys trade in USDC on Solana: your SOL is swapped to USDC through Jupiter in the same transaction." : " Keys trade in USDC on Solana.")}
          </p>
          {held > 0 && (
            <div className="card-2 !rounded-[14px] mt-4 px-4 py-3">
              <div className="flex items-center justify-between text-[13.5px]">
                <span className="text-fg-2">You hold <b className="num text-fg">{held}</b></span>
                <Link href="/keys/holdings" className="text-brand font-semibold">Holdings</Link>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <Stepper value={Math.min(sellQty, held)} onChange={setSellQty} max={held} label="Keys to sell" />
                <button type="button" className="btn flex-1 h-11 rounded-[12px] text-[13.5px]" onClick={() => run(() => actions.sell(t, Math.min(sellQty, held)))} disabled={busy} data-testid="trader-sell-key">
                  Sell · {fmtUsd(back.net)}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="mt-6">
          <p className="text-[14px] text-fg-2 leading-relaxed">
            {!launched
              ? "Keys open soon. When they do, each trader's key unlocks their feed and trades on a public price curve, and holders share in the fees their followers pay."
              : own
                ? `List your key and it becomes the pass to your feed. You get ${Math.round(KEY_TRADER_CUT * 100)}% of every key sold, and your holders earn ${Math.round(HOLDER_SHARE * 100)}% of the fees your copiers pay. Set the starting price in the studio.`
                : `${t.handle} has not listed a key yet.`}
          </p>
          {own && launched && (
            <button type="button" className="btn btn-primary btn-glow w-full h-[52px] mt-5 rounded-[14px]" onClick={() => run(actions.listKey)} disabled={busy} data-testid="trader-list-key">
              {busy ? "Working…" : "List my key"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function LivePosition({ t, own }: { t: Trader; own: boolean }) {
  const p = t.live!;
  const pct = p.entry ? ((p.mark - p.entry) / p.entry) * (p.side === "LONG" ? 100 : -100) : 0;
  // a copy that carries the position id credits this trader, and their key holders, with the fees it pays
  const href = p.id && t.address
    ? `/m/${encodeURIComponent(p.coin)}?${new URLSearchParams({ copy: p.id, from: t.address, side: p.side, lev: String(p.leverage), name: t.handle })}`
    : `/m/${encodeURIComponent(p.coin)}`;
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
            {p.liq !== null && <span>Liq <b className="text-down">{fmtPx(p.liq)}</b></span>}
          </div>
        </div>
        <div className="text-right">
          <div className={`num text-[40px] font-semibold tracking-[-0.04em] leading-none ${p.pnl >= 0 ? "text-up glow-up" : "text-down"}`}>{fmtUsd(p.pnl, { compact: true, sign: true })}</div>
          <div className={`num text-[13.5px] mt-2 ${pct >= 0 ? "text-up" : "text-down"}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}% · opened {p.opened}</div>
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap mt-5 pt-5 border-t border-[var(--hair)]">
        {!own && <Link href={href} className="btn btn-up h-11 px-5 rounded-[13px] text-[14px]">Take this trade</Link>}
        <span className="text-[13.5px] text-muted"><b className="num text-fg">{fmtNum(p.copiers)}</b> {p.copiers === 1 ? "person" : "people"} took it</span>
      </div>
    </article>
  );
}

const KIND: Record<KeysCall["kind"], { label: string; cls: string }> = {
  call: { label: "Pre-trade call", cls: "pill-brand" },
  exit: { label: "Exit", cls: "pill-neutral" },
  lesson: { label: "Lesson", cls: "pill-thesis" },
  loss: { label: "Loss", cls: "pill-down" },
  note: { label: "Note", cls: "pill-neutral" },
};

function CallCard({ c, locked }: { c: KeysCall; locked: boolean }) {
  return (
    <article className="card !rounded-[24px] p-6" aria-hidden={locked}>
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className={`pill ${KIND[c.kind].cls}`}>{KIND[c.kind].label}</span>
        {c.coin && !locked && <span className="pill pill-neutral num">{c.coin}</span>}
        <span className="text-muted">{c.when}</span>
      </div>
      <p className={`mt-3.5 text-[16.5px] leading-relaxed whitespace-pre-line ${locked ? "k-locked" : ""}`}>{c.text || LOCKED_TEXT}</p>
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
