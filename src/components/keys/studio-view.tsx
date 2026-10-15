"use client";
/** /keys/studio: the trader's side. one subscription, priced by them, with what it includes and how often they post */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@/components/connect-modal";
import { useAuth } from "@/hooks/use-auth";
import { useBusy, useKeys, useKeysActions } from "@/hooks/use-keys";
import { CADENCES, CREATOR_KEEP_PCT, KEYS_CONTRACT, OFFERS, POST_KINDS, SUB_PRICE_MAX, cadenceLabel, projectSubscribers, subMonthly, type Cadence, type OfferKey, type PostKind } from "@/lib/keys";
import type { KeysStudio as StudioData } from "@/lib/keys-model";
import { fmtNum, fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { Face, KeysState, ResetPreview, priceLabel, usdWhole } from "./parts";

const PRESETS = [0, 9, 29, 49, 99, 249];
const POST_LABEL: Record<PostKind, string> = { call: "Pre-trade call", exit: "Exit", lesson: "Lesson", loss: "Loss", note: "Note" };

export function KeysStudio() {
  const data = useKeys();
  const actions = useKeysActions();
  const auth = useAuth();
  const connect = useConnectModal();
  const [saving, runSave] = useBusy();
  const live = data.mode === "live";
  const stored = data.me.settings;
  const studio = data.me.studio;
  const viewer = data.me.viewer;
  const [price, setPrice] = useState(stored.price);
  const [offers, setOffers] = useState<OfferKey[]>(stored.offers);
  const [cadence, setCadence] = useState<Cadence>(stored.cadence);
  const [pinned, setPinned] = useState(stored.pinned ?? "");
  // the stored settings load after hydration (or after the api answers); follow them until the trader starts editing
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setPrice(stored.price);
    setOffers(stored.offers);
    setCadence(stored.cadence);
    setPinned(stored.pinned ?? "");
  }, [stored, touched]);

  const edit = <T,>(f: (v: T) => void) => (v: T) => {
    setTouched(true);
    f(v);
  };
  const toggle = (k: OfferKey) => edit(setOffers)(offers.includes(k) ? offers.filter((o) => o !== k) : [...offers, k]);

  const followers = viewer?.followers ?? 0;
  // the preview's sample trader converts unusually well; live, assume one follower in ten would pay $29
  const subs = projectSubscribers(price, followers, offers.length, live ? Math.max(1, Math.round(followers * 0.1)) : 420);
  const monthly = subMonthly(price, subs);
  const reach = followers ? Math.round((subs / followers) * 100) : 0;
  const dirty = price !== stored.price || cadence !== stored.cadence || offers.join() !== stored.offers.join() || (pinned || "") !== (stored.pinned || "") || !stored.saved;
  const included = OFFERS.filter((o) => offers.includes(o.key));
  const month = new Date().toLocaleDateString("en-GB", { month: "long" });
  // what other paid feeds charge, once there are enough of them to say
  const band = useMemo(() => {
    const p = data.traders.filter((t) => t.sub.price > 0 && t.address !== viewer?.address).map((t) => t.sub.price).sort((a, b) => a - b);
    return p.length >= 5 ? [p[Math.floor(p.length / 4)], p[Math.floor((p.length * 3) / 4)]] : null;
  }, [data.traders, viewer?.address]);

  if (live && !data.signedIn) {
    return (
      <KeysState
        title="Get paid for your calls"
        body="Sign in with the wallet you trade with. Your record is read from your Hyperliquid history, so there is nothing to prove."
        action={<button type="button" className="btn btn-primary btn-glow h-12 px-6 rounded-[14px]" onClick={() => (auth.isConnected ? auth.signIn() : connect.open())} disabled={auth.busy}>{auth.isConnected ? "Sign in" : "Connect wallet"}</button>}
      />
    );
  }
  const name = viewer?.handle ?? "you";

  return (
    <div className="space-y-6" data-testid="keys-studio">
      <section className="flex items-end justify-between gap-8 flex-wrap pt-4">
        <div>
          <div className="text-[15px] text-fg-2">Creator studio · {live ? name : `previewing as ${name}`}</div>
          <h1 className="k-display text-[46px] @3xl:text-[62px] font-bold mt-3">Price your calls.</h1>
          <p className="text-[17px] text-fg-2 mt-4 max-w-[560px] leading-relaxed">One subscription, priced by you. Charge more for fewer, closer followers — or less, or nothing, to reach more people. Change it whenever you like.</p>
        </div>
        <div className="k-glow-panel !rounded-[22px] px-6 py-5 flex items-center gap-6">
          <div>
            <div className="text-[13px] text-muted">Earned in {month}</div>
            <div className="num text-[32px] font-semibold tracking-[-0.04em]">{usdWhole(studio.earnedThisMonth)}</div>
          </div>
          {live && studio.isCreator ? (
            <Link href={`/keys/${encodeURIComponent(name)}`} className="btn btn-primary h-12 px-5 rounded-[14px]">View my page</Link>
          ) : (
            <span className="text-[12.5px] text-muted max-w-[150px] leading-snug">Subscribers pay you directly, in USDC on Hyperliquid</span>
          )}
        </div>
      </section>

      <div className="grid @5xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start pt-6">
        <main className="space-y-6 min-w-0">
          {/* price */}
          <section className="card !rounded-[28px] p-7 @3xl:p-9">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="studio-price" className="text-[16px] font-semibold">Monthly price</label>
              <span className="text-[13px] text-muted">You keep {CREATOR_KEEP_PCT}%</span>
            </div>
            <div className="flex items-baseline gap-2 mt-4">
              <span className="num k-display text-[72px] @3xl:text-[88px] font-semibold" data-testid="studio-price">{priceLabel(price)}</span>
              {price > 0 && <span className="text-[19px] text-muted">/ month</span>}
            </div>
            <input
              id="studio-price"
              type="range"
              className="slider mt-7"
              min={0}
              max={SUB_PRICE_MAX}
              step={1}
              value={price}
              onChange={(e) => edit(setPrice)(Number(e.target.value))}
              style={{ "--pct": `${(price / SUB_PRICE_MAX) * 100}%` } as React.CSSProperties}
              aria-valuetext={price > 0 ? `$${price} a month` : "Free"}
            />
            <div className="num flex justify-between text-[12px] text-muted mt-2"><span>Free</span><span>${SUB_PRICE_MAX}</span></div>
            <div className="flex flex-wrap gap-2 mt-5">
              {PRESETS.map((v) => (
                <button key={v} type="button" onClick={() => edit(setPrice)(v)} className={`btn h-10 px-4 rounded-full ${price === v ? "!border-brand/50 !text-brand-2 bg-brand/10" : ""}`} aria-pressed={price === v}>
                  {priceLabel(v)}
                </button>
              ))}
            </div>
            <p className="text-[14.5px] text-fg-2 mt-6 leading-relaxed">
              {live
                ? band
                  ? <>Most paid feeds here charge between <b className="text-fg">${band[0]} and ${band[1]}</b> a month. Higher prices mean fewer, more committed subscribers — and fewer people seeing your calls.</>
                  : <>Higher prices mean fewer, more committed subscribers — and fewer people seeing your calls. You can change it any time; people who already paid keep their month.</>
                : <>Traders with a record like yours mostly charge between <b className="text-fg">$19 and $59</b>. Higher prices mean fewer, more committed subscribers — and fewer people seeing your calls.</>}
            </p>
            <div className="grid @2xl:grid-cols-3 gap-3 mt-7">
              <div className="card-2 !rounded-[18px] px-5 py-4">
                <div className="text-[13px] text-muted">Expected subscribers</div>
                <div className="num text-[30px] font-semibold tracking-[-0.035em] mt-1" data-testid="studio-subs">{fmtNum(subs)}</div>
              </div>
              <div className="!rounded-[18px] px-5 py-4 bg-brand/8 ring-1 ring-brand/25">
                <div className="text-[13px] text-muted">You&apos;d earn a month</div>
                <div className="num text-[30px] font-semibold tracking-[-0.035em] mt-1 text-brand" data-testid="studio-monthly">{usdWhole(monthly)}</div>
              </div>
              <div className="card-2 !rounded-[18px] px-5 py-4">
                <div className="text-[13px] text-muted">Reach</div>
                <div className="num text-[30px] font-semibold tracking-[-0.035em] mt-1">{reach}%</div>
              </div>
            </div>
            <p className="text-[12px] text-muted mt-3">Estimated from your {fmtNum(followers)} {followers === 1 ? "follower" : "followers"} and what each offer adds. A guide, not a promise.</p>
          </section>

          {/* offers */}
          <section className="card !rounded-[28px] p-7 @3xl:p-9">
            <h2 className="text-[21px] font-bold tracking-tight">What subscribers get</h2>
            <p className="text-[14.5px] text-muted mt-1.5">Offer only what you will keep doing. Renewals follow consistency, not promises.</p>
            <div className="grid @2xl:grid-cols-2 gap-3 mt-6">
              {OFFERS.map((o) => {
                const on = offers.includes(o.key);
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(o.key)}
                    className={`text-left flex items-center gap-4 px-5 py-4 rounded-[18px] transition-colors ${on ? "bg-brand/8 ring-1 ring-brand/35" : "card-2"}`}
                    data-testid={`studio-offer-${o.key}`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold">{o.title}</span>
                      <span className="block text-[12.5px] text-muted mt-0.5">{o.detail}</span>
                    </span>
                    <span className={`relative w-11 h-[26px] rounded-full shrink-0 transition-colors ${on ? "bg-brand" : "bg-line-2"}`} aria-hidden="true">
                      <span className={`absolute top-[3px] w-5 h-5 rounded-full transition-all ${on ? "left-[21px] bg-[#04120e]" : "left-[3px] bg-muted"}`} />
                    </span>
                  </button>
                );
              })}
            </div>
            <h3 className="text-[15.5px] font-semibold mt-8">How often you&apos;ll post</h3>
            <div className="seg mt-3 flex-wrap" role="radiogroup" aria-label="Posting cadence">
              {CADENCES.map((c) => (
                <button key={c.key} type="button" role="radio" aria-checked={cadence === c.key} onClick={() => edit(setCadence)(c.key)} className={`seg-item inline-flex items-center h-9 px-4 text-[13px] ${cadence === c.key ? "seg-active" : ""}`}>
                  {c.label}
                </button>
              ))}
            </div>
            <label htmlFor="studio-pinned" className="block text-[15.5px] font-semibold mt-8">Pinned note</label>
            <p className="text-[13px] text-muted mt-1">The first thing on your page, free for everyone: how you trade, and what subscribers get.</p>
            <textarea
              id="studio-pinned"
              className="input !h-auto py-3 mt-3 !text-[14.5px] leading-relaxed resize-y min-h-[96px]"
              maxLength={500}
              value={pinned}
              onChange={(e) => edit(setPinned)(e.target.value)}
              placeholder="How I size: never more than 3% of the account at risk on one idea…"
            />
          </section>

          <Composer studio={studio} />
        </main>

        {/* preview */}
        <aside className="space-y-5 @5xl:sticky @5xl:top-16">
          <div className="text-[13px] font-semibold text-muted px-1">What subscribers see</div>
          <section className="k-glow-panel p-7" data-testid="studio-preview">
            {viewer && (
              <div className="flex items-center gap-3.5">
                <Face who={viewer} size={54} ring="live" />
                <div className="min-w-0">
                  <div className="text-[18px] font-bold truncate">{viewer.handle}</div>
                  {viewer.pnl30dPct !== null ? (
                    <div className="num text-[13px] text-up">+{viewer.pnl30dPct}% · 30 days</div>
                  ) : (
                    <div className={`num text-[13px] ${(viewer.pnl30d ?? 0) >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(viewer.pnl30d ?? 0, { compact: true, sign: true })} · 30 days</div>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-baseline gap-1.5 mt-6">
              <span className="num text-[52px] font-semibold tracking-[-0.05em] leading-none">{priceLabel(price)}</span>
              {price > 0 && <span className="text-[16px] text-muted">/ month</span>}
            </div>
            <ul className="mt-6 space-y-3">
              {(included.length ? included : [{ key: "none", title: "Your public calls, nothing extra" }]).map((o) => (
                <li key={o.key} className="flex items-center gap-3 text-[14.5px]">
                  <span className="w-8 h-8 rounded-[10px] bg-brand/10 text-brand inline-flex items-center justify-center shrink-0"><Icon.check /></span>
                  {o.title}
                </li>
              ))}
            </ul>
            <div className="card-2 !rounded-[13px] px-4 py-3 mt-5 text-[13.5px] text-fg-2">Posts <b className="text-fg">{cadenceLabel(cadence).toLowerCase()}</b></div>
            <div className="btn btn-primary w-full h-[52px] mt-5 rounded-[16px] text-[15px] pointer-events-none">{price > 0 ? `Subscribe · $${price} / month` : "Follow for free"}</div>
          </section>
          <button
            type="button"
            className={`btn w-full h-[52px] rounded-[16px] text-[15px] ${dirty ? "btn-primary btn-glow" : ""}`}
            onClick={() => runSave(async () => {
              await actions.saveStudio({ price, offers, cadence, pinned });
              setTouched(false);
            })}
            disabled={!dirty || saving || offers.length === 0}
            data-testid="studio-save"
          >
            {saving ? "Saving…" : dirty ? (live && !studio.isCreator ? "Publish my page" : "Save and publish") : <><Icon.check /> Published</>}
          </button>
          {offers.length === 0 && <p className="text-[12.5px] text-muted text-center -mt-2">Pick at least one thing subscribers get.</p>}
          <KeyCardPanel studio={studio} />
        </aside>
      </div>

      {(!live || studio.months.some((m) => m.sub + m.key + m.fee > 0)) && <EarningsChart months={studio.months} />}
      <ResetPreview />
    </div>
  );
}

/** the creator's own key: its numbers, or the button that lists it onchain */
function KeyCardPanel({ studio }: { studio: StudioData }) {
  const { mode } = useKeys();
  const actions = useKeysActions();
  const [busy, run] = useBusy();
  const live = mode === "live";
  const listed = !live || studio.listed;
  return (
    <section className="card !rounded-[22px] p-6" data-testid="studio-key">
      <div className="text-[15px] font-semibold">Your key</div>
      {listed ? (
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div><div className="num text-[19px] font-semibold">{fmtUsd(studio.key.price)}</div><div className="text-[12px] text-muted">price</div></div>
          <div><div className="num text-[19px] font-semibold">{studio.key.holders}</div><div className="text-[12px] text-muted">holders</div></div>
          <div><div className="num text-[19px] font-semibold text-brand">{fmtUsd(studio.key.raised, { compact: true })}</div><div className="text-[12px] text-muted">raised</div></div>
        </div>
      ) : !KEYS_CONTRACT ? (
        <p className="text-[13.5px] text-muted mt-2 leading-relaxed">Keys open soon. You will be able to list yours here.</p>
      ) : !studio.isCreator ? (
        <p className="text-[13.5px] text-muted mt-2 leading-relaxed">Publish your page first, then list your key.</p>
      ) : (
        <>
          <p className="text-[13.5px] text-muted mt-2 leading-relaxed">One signature on HyperEVM. You get 10% of every key sold, and your holders share in the fees your copiers pay.</p>
          <button type="button" className="btn btn-primary w-full h-12 mt-4 rounded-[14px]" onClick={() => run(actions.listKey)} disabled={busy} data-testid="studio-list-key">{busy ? "Working…" : "List my key"}</button>
        </>
      )}
    </section>
  );
}

/** write to subscribers: a call before the entry, an exit, a lesson, a loss broken down */
function Composer({ studio }: { studio: StudioData }) {
  const { mode } = useKeys();
  const actions = useKeysActions();
  const [busy, run] = useBusy();
  const [kind, setKind] = useState<PostKind>("call");
  const [text, setText] = useState("");
  const [coin, setCoin] = useState("");
  const [positionId, setPositionId] = useState("");
  const [subscribersOnly, setSubscribersOnly] = useState(true);
  const live = mode === "live";
  if (live && !studio.isCreator) return null;
  const positions = studio.positions ?? [];
  const send = () =>
    run(async () => {
      const ok = await actions.post({ kind, text: text.trim(), coin: coin.trim() || undefined, positionId: positionId || undefined, subscribersOnly });
      if (ok) {
        setText("");
        setCoin("");
        setPositionId("");
      }
    });
  return (
    <section className="card !rounded-[28px] p-7 @3xl:p-9" data-testid="studio-composer">
      <h2 className="text-[21px] font-bold tracking-tight">Post to subscribers</h2>
      <p className="text-[14.5px] text-muted mt-1.5">Everyone subscribed gets an alert the moment it goes up.</p>
      <div className="seg mt-5 flex-wrap" role="radiogroup" aria-label="Kind of post">
        {POST_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`seg-item inline-flex items-center h-9 px-4 text-[13px] ${kind === k ? "seg-active" : ""}`}>
            {POST_LABEL[k]}
          </button>
        ))}
      </div>
      <label htmlFor="post-text" className="sr-only">Post</label>
      <textarea
        id="post-text"
        className="input !h-auto py-3 mt-4 !text-[15px] leading-relaxed resize-y min-h-[120px]"
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === "call" ? "The setup, the entry, where you are wrong, and the first target." : "Write it the way you would explain it to a friend."}
        data-testid="post-text"
      />
      <div className="grid @2xl:grid-cols-[160px_minmax(0,1fr)] gap-3 mt-3">
        <label className="block">
          <span className="sr-only">Coin</span>
          <input className="input !h-11" value={coin} onChange={(e) => setCoin(e.target.value.toUpperCase())} maxLength={24} placeholder="Coin (BTC)" />
        </label>
        <label className="block">
          <span className="sr-only">Attach a position</span>
          <select className="input !h-11" value={positionId} onChange={(e) => setPositionId(e.target.value)} disabled={!positions.length}>
            <option value="">{positions.length ? "Attach one of your positions (optional)" : "No recent positions to attach"}</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>{p.label} · {p.open ? "open" : "closed"}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center justify-between gap-4 flex-wrap mt-5">
        <label className="inline-flex items-center gap-3 text-[14px] text-fg-2 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-[var(--color-brand)]" checked={!subscribersOnly} onChange={(e) => setSubscribersOnly(!e.target.checked)} />
          Free for everyone (a teaser)
        </label>
        <span className="flex items-center gap-4">
          <span className="num text-[12.5px] text-muted">{text.length}/1000</span>
          <button type="button" className="btn btn-primary h-12 px-6 rounded-[14px]" onClick={send} disabled={busy || !text.trim()} data-testid="post-send">{busy ? "Posting…" : "Post"}</button>
        </span>
      </div>
    </section>
  );
}

/** six months by source: three series, so a legend, 2px gaps between segments and a tooltip per month */
function EarningsChart({ months: data }: { months: StudioData["months"] }) {
  const [hover, setHover] = useState(-1);
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.sub + d.key + d.fee)) * 1.08;
  const PLOT = 220;
  const h = (v: number) => Math.max(4, (v / max) * PLOT);
  const series = [
    { k: "sub" as const, label: "Subscriptions", color: "var(--k-sub)" },
    { k: "key" as const, label: "Key sales", color: "var(--k-key)" },
    { k: "fee" as const, label: "Fee share", color: "var(--k-fee)" },
  ];
  const d = hover >= 0 ? data[hover] : null;
  const last = data[data.length - 1];
  return (
    <section className="card k-chart !rounded-[28px] p-7 @3xl:p-9" data-testid="studio-earnings">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-[21px] font-bold tracking-tight">Earnings, last six months</h2>
        <div className="flex gap-5 flex-wrap">
          {series.map((s) => (
            <span key={s.k} className="inline-flex items-center gap-2 text-[13px] text-fg-2"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      </div>
      <div className="relative mt-8">
        <div className="flex items-end gap-5 @3xl:gap-8" style={{ height: PLOT }} role="img" aria-label={`Monthly earnings from ${data[0].month} to ${last.month}: ${fmtUsd(last.sub + last.key + last.fee)} in ${last.month}`}>
          {data.map((m, i) => (
            <div key={m.month} className="flex-1 min-w-0 h-full flex flex-col justify-end transition-opacity" style={{ opacity: hover >= 0 && hover !== i ? 0.35 : 1 }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}>
              <div style={{ height: h(m.fee), background: "var(--k-fee)", borderRadius: "6px 6px 0 0", marginBottom: 2 }} />
              <div style={{ height: h(m.key), background: "var(--k-key)", marginBottom: 2 }} />
              <div style={{ height: h(m.sub), background: "var(--k-sub)", borderRadius: "0 0 6px 6px" }} />
            </div>
          ))}
        </div>
        <div className="flex gap-5 @3xl:gap-8 mt-3">
          {data.map((m, i) => (
            <span key={m.month} className={`flex-1 text-center text-[12.5px] ${hover === i ? "text-fg" : "text-muted"}`}>{m.month}</span>
          ))}
        </div>
        {d && (
          <div className="pop absolute top-0 w-[220px] px-4 py-3.5 pointer-events-none" style={{ left: `${((hover + 0.5) / data.length) * 100}%`, transform: hover > 3 ? "translateX(calc(-100% - 28px))" : "translateX(28px)" }}>
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-muted">{d.month}</span>
              <span className="num text-[15px] font-semibold">{fmtUsd(d.sub + d.key + d.fee)}</span>
            </div>
            <div className="h-px bg-[var(--hair)] my-2.5" />
            {series.map((s) => (
              <div key={s.k} className="flex items-center gap-2 text-[12.5px] mt-1.5">
                <span className="w-2 h-2 rounded-[3px]" style={{ background: s.color }} />
                <span className="flex-1 text-fg-2">{s.label}</span>
                <span className="num">{fmtUsd(d[s.k])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
