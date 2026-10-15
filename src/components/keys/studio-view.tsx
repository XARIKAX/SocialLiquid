"use client";
/** /keys/studio: the trader's side. one subscription, priced by them, with what it includes and how often they post */
import { useEffect, useState } from "react";
import { keysDemo, useKeysDemo } from "@/hooks/use-keys-demo";
import { CADENCES, CREATOR_SHARE, OFFERS, SUB_PRICE_MAX, cadenceLabel, projectSubscribers, subMonthly, type Cadence, type OfferKey } from "@/lib/keys";
import { DEMO_STUDIO, DEMO_VIEWER } from "@/lib/keys-demo";
import { fmtNum, fmtUsd } from "@/lib/format";
import { Icon } from "../ui";
import { Face, ResetPreview, priceLabel, usdWhole } from "./parts";

const PRESETS = [0, 9, 29, 49, 99, 249];

export function KeysStudio() {
  const demo = useKeysDemo();
  const [price, setPrice] = useState(demo.studio.price);
  const [offers, setOffers] = useState<OfferKey[]>(demo.studio.offers);
  const [cadence, setCadence] = useState<Cadence>(demo.studio.cadence);
  // the stored settings load after hydration; follow them until the trader starts editing
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setPrice(demo.studio.price);
    setOffers(demo.studio.offers);
    setCadence(demo.studio.cadence);
  }, [demo.studio, touched]);

  const edit = <T,>(f: (v: T) => void) => (v: T) => {
    setTouched(true);
    f(v);
  };
  const toggle = (k: OfferKey) => edit(setOffers)(offers.includes(k) ? offers.filter((o) => o !== k) : [...offers, k]);

  const subs = projectSubscribers(price, DEMO_VIEWER.followers, offers.length, 420);
  const monthly = subMonthly(price, subs);
  const reach = Math.round((subs / DEMO_VIEWER.followers) * 100);
  const dirty = price !== demo.studio.price || cadence !== demo.studio.cadence || offers.join() !== demo.studio.offers.join() || !demo.studio.saved;
  const included = OFFERS.filter((o) => offers.includes(o.key));

  return (
    <div className="space-y-6" data-testid="keys-studio">
      <section className="flex items-end justify-between gap-8 flex-wrap pt-4">
        <div>
          <div className="text-[15px] text-fg-2">Creator studio · previewing as {DEMO_VIEWER.handle}</div>
          <h1 className="k-display text-[46px] @3xl:text-[62px] font-bold mt-3">Price your calls.</h1>
          <p className="text-[17px] text-fg-2 mt-4 max-w-[560px] leading-relaxed">One subscription, priced by you. Charge more for fewer, closer followers — or less, or nothing, to reach more people. Change it whenever you like.</p>
        </div>
        <div className="k-glow-panel !rounded-[22px] px-6 py-5 flex items-center gap-6">
          <div>
            <div className="text-[13px] text-muted">Earned in October</div>
            <div className="num text-[32px] font-semibold tracking-[-0.04em]">{usdWhole(DEMO_STUDIO.earnedThisMonth)}</div>
          </div>
          <button type="button" className="btn btn-primary h-12 px-5 rounded-[14px]" onClick={() => keysDemo.notify("Withdrawals land in your Hyperliquid balance in the live version.")}>Withdraw</button>
        </div>
      </section>

      <div className="grid @5xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start pt-6">
        <main className="space-y-6 min-w-0">
          {/* price */}
          <section className="card !rounded-[28px] p-7 @3xl:p-9">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="studio-price" className="text-[16px] font-semibold">Monthly price</label>
              <span className="text-[13px] text-muted">You keep {Math.round(CREATOR_SHARE * 100)}%</span>
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
              Traders with a record like yours mostly charge between <b className="text-fg">$19 and $59</b>. Higher prices mean fewer, more committed subscribers — and fewer people seeing your calls.
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
            <p className="text-[12px] text-muted mt-3">Estimated from your {fmtNum(DEMO_VIEWER.followers)} followers, your 30-day record and what each offer adds. A guide, not a promise.</p>
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
          </section>
        </main>

        {/* preview */}
        <aside className="space-y-5 @5xl:sticky @5xl:top-16">
          <div className="text-[13px] font-semibold text-muted px-1">What subscribers see</div>
          <section className="k-glow-panel p-7" data-testid="studio-preview">
            <div className="flex items-center gap-3.5">
              <Face who={DEMO_VIEWER} size={54} ring="live" />
              <div>
                <div className="text-[18px] font-bold">{DEMO_VIEWER.handle}</div>
                <div className="num text-[13px] text-up">+{DEMO_VIEWER.pnl30dPct}% · 30 days</div>
              </div>
            </div>
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
          <button type="button" className={`btn w-full h-[52px] rounded-[16px] text-[15px] ${dirty ? "btn-primary btn-glow" : ""}`} onClick={() => keysDemo.saveStudio({ price, offers, cadence })} disabled={!dirty} data-testid="studio-save">
            {dirty ? "Save and publish" : <><Icon.check /> Published</>}
          </button>
          <section className="card !rounded-[22px] p-6">
            <div className="text-[15px] font-semibold">Your key</div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div><div className="num text-[19px] font-semibold">{fmtUsd(DEMO_STUDIO.key.price)}</div><div className="text-[12px] text-muted">price</div></div>
              <div><div className="num text-[19px] font-semibold">{DEMO_STUDIO.key.holders}</div><div className="text-[12px] text-muted">holders</div></div>
              <div><div className="num text-[19px] font-semibold text-brand">{fmtUsd(DEMO_STUDIO.key.raised, { compact: true })}</div><div className="text-[12px] text-muted">raised</div></div>
            </div>
          </section>
        </aside>
      </div>

      <EarningsChart />
      <ResetPreview />
    </div>
  );
}

/** six months by source: three series, so a legend, 2px gaps between segments and a tooltip per month */
function EarningsChart() {
  const [hover, setHover] = useState(-1);
  const data = DEMO_STUDIO.months;
  const max = Math.max(...data.map((d) => d.sub + d.key + d.fee)) * 1.08;
  const PLOT = 220;
  const h = (v: number) => Math.max(4, (v / max) * PLOT);
  const series = [
    { k: "sub" as const, label: "Subscriptions", color: "var(--k-sub)" },
    { k: "key" as const, label: "Key sales", color: "var(--k-key)" },
    { k: "fee" as const, label: "Fee share", color: "var(--k-fee)" },
  ];
  const d = hover >= 0 ? data[hover] : null;
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
        <div className="flex items-end gap-5 @3xl:gap-8" style={{ height: PLOT }} role="img" aria-label={`Monthly earnings from ${data[0].month} to ${data[data.length - 1].month}, rising to ${fmtUsd(data[data.length - 1].sub + data[data.length - 1].key + data[data.length - 1].fee)}`}>
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
