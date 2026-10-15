"use client";
/** /keys/holdings: what you can claim, the keys you hold, the traders you subscribe to and what they paid you */
import Link from "next/link";
import { useConnectModal } from "@/components/connect-modal";
import { useAuth } from "@/hooks/use-auth";
import { useBusy, useKeys, useKeysActions } from "@/hooks/use-keys";
import { keyYearly } from "@/lib/keys";
import { fmtUsd } from "@/lib/format";
import { Empty, Icon } from "../ui";
import { Face, KeysState, ResetPreview, priceLabel } from "./parts";

export function KeysHoldings() {
  const data = useKeys();
  const actions = useKeysActions();
  const auth = useAuth();
  const connect = useConnectModal();
  const [claiming, runClaim] = useBusy();
  const demo = data.me;
  const live = data.mode === "live";
  const rows = Object.entries(demo.keys)
    .map(([handle, h]) => ({ t: data.byHandle(handle)!, h }))
    .filter((r) => r.t && r.h.qty > 0)
    .sort((a, b) => b.h.qty * b.t.key.price - a.h.qty * a.t.key.price);
  const value = rows.reduce((a, r) => a + r.h.qty * r.t.key.price, 0);
  const gain = rows.reduce((a, r) => a + r.h.qty * (r.t.key.price - r.h.avgCost), 0);
  const earned = rows.reduce((a, r) => a + r.h.earned, 0);
  const yearly = rows.reduce((a, r) => a + keyYearly(r.t.key.price, r.h.qty, r.t.key.yieldPct), 0);
  const blended = value > 0 ? (yearly / value) * 100 : 0;
  const subs = Object.entries(demo.subs).map(([handle, s]) => ({ t: data.byHandle(handle)!, s })).filter((r) => r.t);
  const monthly = subs.filter((r) => !r.s.cancelled).reduce((a, r) => a + r.t.sub.price, 0);

  if (live && !data.signedIn) {
    return (
      <KeysState
        title="Your keys and subscriptions"
        body="Sign in with your wallet to see the keys you hold, the fee share waiting for you and the traders you subscribe to."
        action={<button type="button" className="btn btn-primary btn-glow h-12 px-6 rounded-[14px]" onClick={() => (auth.isConnected ? auth.signIn() : connect.open())} disabled={auth.busy}>{auth.isConnected ? "Sign in" : "Connect wallet"}</button>}
      />
    );
  }

  return (
    <div className="space-y-16" data-testid="keys-holdings">
      {/* claim */}
      <section className="k-glow-panel !rounded-[34px] p-8 @3xl:p-12 flex flex-wrap items-center gap-8">
        <div className="flex-1 min-w-[280px]">
          <div className="text-[15px] text-fg-2">Ready to claim</div>
          <div className={`num k-display text-[64px] @3xl:text-[88px] font-semibold mt-3 ${demo.claimable > 0 ? "k-brand-glow" : "text-muted"}`} data-testid="holdings-claimable">{fmtUsd(demo.claimable)}</div>
          <div className="text-[15px] text-fg-2 mt-4">{demo.claimable > 0 ? `From the trading fees of ${rows.length === 1 ? "one trader's" : `${rows.length} traders'`} followers` : rows.length ? "All claimed. Fee flow keeps accruing as followers trade." : "Hold a trader's key to earn from their followers' trading."}</div>
        </div>
        <div className="flex flex-col gap-2.5 min-w-[240px]">
          <button type="button" className="btn btn-primary btn-glow h-[58px] px-10 rounded-[18px] text-[16px]" onClick={() => runClaim(actions.claim)} disabled={demo.claimable <= 0 || claiming} data-testid="holdings-claim">{claiming ? "Claiming…" : "Claim USDC"}</button>
          <span className="text-[13px] text-muted text-center">Paid in USDC to your Solana wallet</span>
        </div>
      </section>

      <section className="card grid grid-cols-2 @4xl:grid-cols-4 overflow-hidden !rounded-[24px] -mt-10">
        {[
          { v: fmtUsd(value, { compact: value >= 100_000 }), l: "value of your keys" },
          { v: fmtUsd(gain, { sign: true, compact: Math.abs(gain) >= 100_000 }), l: "unrealised gain", tone: gain >= 0 ? "text-up" : "text-down" },
          { v: fmtUsd(earned), l: "earned all time" },
          { v: `${blended.toFixed(1)}%`, l: "blended yield", tone: "text-brand" },
        ].map((s, i) => (
          <div key={s.l} className={`px-7 py-6 ${i % 2 ? "border-l border-[var(--hair)]" : ""} ${i > 1 ? "border-t border-[var(--hair)] @4xl:border-t-0" : ""} ${i === 2 ? "@4xl:border-l" : ""}`}>
            <div className={`num text-[26px] @3xl:text-[30px] font-semibold tracking-[-0.035em] ${s.tone ?? ""}`}>{s.v}</div>
            <div className="text-[13.5px] text-muted mt-1">{s.l}</div>
          </div>
        ))}
      </section>

      {/* keys */}
      <section>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="text-[32px] font-bold tracking-[-0.035em]">Your keys</h2>
          <Link href="/keys/market" className="text-[14.5px] font-semibold text-brand">Find more traders</Link>
        </div>
        {rows.length === 0 ? (
          <div className="mt-6"><Empty title="No keys yet" hint="Buy a key on any trader's page and it shows up here, earning from their followers' trading." /></div>
        ) : (
          <div className="grid @2xl:grid-cols-2 @5xl:grid-cols-3 gap-5 mt-6" data-testid="holdings-keys">
            {rows.map(({ t, h }) => {
              const g = h.qty * (t.key.price - h.avgCost);
              return (
                <Link key={t.handle} href={`/keys/${t.handle}`} className="k-holo theme-dark block h-[220px] hover:-translate-y-0.5 transition-transform" data-testid={`holding-${t.handle}`}>
                  <div className="k-holo-in p-6">
                    <div className="flex items-center justify-between relative">
                      <span className="k-holo-label">SOCIALLIQUID KEY</span>
                      <span className="num text-[14px] font-bold">×{h.qty}</span>
                    </div>
                    <div className="flex items-center gap-3 relative">
                      <Face who={t} size={46} square />
                      <span className="text-[20px] font-bold tracking-tight">{t.handle}</span>
                    </div>
                    <div className="flex items-end justify-between relative">
                      <div>
                        <div className="num text-[26px] font-semibold tracking-tight">{fmtUsd(h.qty * t.key.price)}</div>
                        <div className={`num text-[12.5px] ${g >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(g, { sign: true })} since you bought</div>
                      </div>
                      <div className="text-right">
                        <div className="num text-[16px] font-semibold text-brand">{fmtUsd(h.earned)}</div>
                        <div className="text-[11.5px] text-muted">earned</div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid @5xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-10 items-start">
        {/* subscriptions */}
        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[32px] font-bold tracking-[-0.035em]">Subscriptions</h2>
            {monthly > 0 && <span className="num text-[14px] text-muted">${monthly} a month</span>}
          </div>
          <div className="space-y-3 mt-6" data-testid="holdings-subs">
            {subs.length === 0 && <Empty title="No subscriptions" hint="Subscribe to a trader to get their calls before the entry." />}
            {subs.map(({ t, s }) => (
              <div key={t.handle} className="card !rounded-[22px] px-5 py-4 flex items-center gap-4">
                <Link href={`/keys/${t.handle}`} onClick={() => actions.markRead(t.handle)}><Face who={t} size={50} ring={t.live ? "live" : "off"} /></Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/keys/${t.handle}`} onClick={() => actions.markRead(t.handle)} className="text-[16px] font-bold hover:underline">{t.handle}</Link>
                  <div className="num text-[13px] text-muted mt-0.5">
                    {priceLabel(t.sub.price)}{t.sub.price > 0 ? " a month" : ""}
                    {t.sub.price > 0 && (live ? ` · ${s.cancelled ? "ends" : "paid to"} ${s.renews}` : ` · renews ${s.renews}`)}
                  </div>
                </div>
                {s.unread > 0 && <span className="pill pill-brand num">{s.unread} new</span>}
                {live && s.cancelled ? (
                  <button type="button" className="btn btn-sm" onClick={() => actions.subscribe(t)}>Renew</button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.unsubscribe(t)}>{t.sub.price > 0 ? "Cancel" : "Unfollow"}</button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* payouts */}
        <section>
          <h2 className="text-[32px] font-bold tracking-[-0.035em]">Payouts</h2>
          {demo.payouts.length === 0 && <div className="mt-6"><Empty title="No payouts yet" hint="Fee share you claim from your keys shows up here." /></div>}
          {demo.payouts.length > 0 && <div className="card !rounded-[22px] px-6 py-2 mt-6">
            {demo.payouts.map((p, i) => (
              <div key={i} className={`flex items-center gap-3.5 py-4 ${i ? "border-t border-[var(--row)]" : ""}`}>
                <span className="w-9 h-9 rounded-full bg-brand/12 text-brand inline-flex items-center justify-center shrink-0"><Icon.wallet /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] font-semibold">{p.from} key flow</div>
                  <div className="text-[12.5px] text-muted">{p.when}</div>
                </div>
                <span className="num text-[15.5px] font-semibold text-brand">+{fmtUsd(p.amount)}</span>
              </div>
            ))}
          </div>}
        </section>
      </div>

      <ResetPreview />
    </div>
  );
}
