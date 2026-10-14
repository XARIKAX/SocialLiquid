"use client";
/** one screen for your own account: value, cash, pnl by window, equity curve, positions, orders, fills, copies, theses */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-me";
import { useMids, livePnl } from "@/hooks/use-market";
import { useAccountFills, useOpenOrders, useMyTheses } from "@/hooks/use-account";
import { api } from "@/lib/client";
import { fmtPx, fmtUsd, timeAgo, userLabel } from "@/lib/format";
import { cashTotal, spotRows, fmtQty } from "@/lib/spot";
import { Avatar, CoinIcon, Empty, Icon, OutcomePill, Pnl, Skeleton, TraderLink } from "../ui";
import { Sparkline, type Profile } from "../trader/profile";
import { openFunds } from "../trade/funds";
import { openConvert } from "../trade/convert";
import { useConnectModal } from "../connect-modal";

type Range = "24H" | "7D" | "30D" | "ALL";
const RANGE_KEY = { "24H": "day", "7D": "week", "30D": "month", ALL: "allTime" } as const;

export function PortfolioView() {
  const { address, isConnected, signedIn, signIn, busy, me } = useAuth();
  const connect = useConnectModal();
  const bal = useBalance(signedIn ? address : null);
  const mids = useMids();
  const prof = useQuery({ queryKey: ["trader", address?.toLowerCase()], queryFn: () => api<Profile>(`/api/trader/${address}`), enabled: !!signedIn && !!address, refetchInterval: 10_000 });
  const fills = useAccountFills();
  const orders = useOpenOrders();
  const theses = useMyTheses(!!signedIn);
  const [range, setRange] = useState<Range>("7D");
  const p = prof.data;
  const hlWin = p?.hl?.[RANGE_KEY[range]] ?? null;
  const series = useMemo(() => {
    if (hlWin) return hlWin.curve;
    if (!p) return [];
    const rangeMs = range === "24H" ? 86_400_000 : range === "7D" ? 7 * 86_400_000 : range === "30D" ? 30 * 86_400_000 : Infinity;
    const since = Date.now() - rangeMs;
    let acc = 0;
    return p.pnlSeries.filter((x) => x.t >= since).map((x) => ({ t: x.t, v: (acc += x.pnl) }));
  }, [hlWin, p, range]);
  const rangePnl = hlWin ? hlWin.pnl : (series.at(-1)?.v ?? 0);

  if (!signedIn) {
    return (
      <div className="max-w-3xl pb-3">
        <h1 className="text-[22px] font-semibold tracking-tight mb-3">Portfolio</h1>
        <div className="card p-6 text-center">
          <div className="text-[15px] font-semibold">Your Hyperliquid account, in one place</div>
          <p className="text-sm text-muted mt-1 max-w-md mx-auto">Balance, open PnL, equity curve, positions, orders, fills, who you copied and who copied you. Connect and sign in to see yours.</p>
          <button className="btn btn-primary h-10 px-5 mt-4" onClick={isConnected ? signIn : connect.open} disabled={busy}>{isConnected ? (busy ? "Check your wallet…" : "Sign in") : "Connect wallet"}</button>
        </div>
      </div>
    );
  }

  const positions = (bal.data?.positions ?? []).filter((x) => x.szi !== 0);
  const openPnl = positions.reduce((a, x) => a + (livePnl({ side: x.szi > 0 ? "LONG" : "SHORT", size: Math.abs(x.szi), entryPx: x.entryPx }, mids.data?.[x.coin] ? Number(mids.data[x.coin]) : undefined) ?? x.unrealizedPnl), 0);
  const spot = spotRows(bal.data?.spot, mids.data).filter((r) => r.name !== "USDC");
  const spotUsd = spot.reduce((a, r) => a + (r.usd ?? 0), 0);
  const total = (bal.data?.accountValue ?? 0) + spotUsd + (bal.data ? cashTotal(bal.data) - bal.data.withdrawable : 0);
  const win = (k: keyof NonNullable<Profile["hl"]>) => p?.hl?.[k]?.pnl ?? null;
  const handle = me?.user?.handle;

  return (
    <div className="space-y-3 pb-3 max-w-6xl" data-testid="portfolio">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-[22px] font-semibold tracking-tight">Portfolio</h1>
        {handle && <Link href={`/t/${handle}`} className="text-xs text-brand hover:underline">Public profile →</Link>}
        <span className="ml-auto flex items-center gap-2">
          <button className="btn h-9 px-3" onClick={() => openFunds("deposit")}>Deposit</button>
          <button className="btn h-9 px-3" onClick={() => openFunds("withdraw")}>Withdraw</button>
        </span>
      </div>

      {/* headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3" data-testid="portfolio-stats">
        <Stat label="Portfolio value" value={bal.data ? fmtUsd(total) : "…"} big />
        <Stat label="Cash" value={bal.data ? fmtUsd(cashTotal(bal.data)) : "…"} sub={bal.data && bal.data.withdrawable < cashTotal(bal.data) ? "incl. spot USDC" : undefined} />
        <Stat label="Open PnL" value={<Pnl value={bal.data ? openPnl : null} className="font-semibold" />} sub={`${positions.length} open`} />
        <Stat label="24H PnL" value={<Pnl value={win("day")} className="font-semibold" />} />
        <Stat label="7D PnL" value={<Pnl value={win("week")} className="font-semibold" />} />
        <Stat label="30D PnL" value={<Pnl value={win("month")} className="font-semibold" />} sub={p?.hl?.month ? `${fmtUsd(p.hl.month.vlm, { compact: true })} volume` : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-3">
        {/* equity curve */}
        <section className="card p-4 flex flex-col">
          <div className="flex items-start justify-between">
            <div>
              <div className="num text-[26px] font-semibold tracking-tight leading-none"><span className={rangePnl > 0 ? "text-up" : rangePnl < 0 ? "text-down" : "text-fg"}>{fmtUsd(rangePnl, { sign: true })}</span></div>
              <div className="text-xs text-muted mt-1">PnL · Hyperliquid · {range === "ALL" ? "all time" : range.toLowerCase()}</div>
            </div>
            <span className="seg">
              {(["24H", "7D", "30D", "ALL"] as Range[]).map((r) => (
                <button key={r} className={`seg-item num ${range === r ? "seg-active" : ""}`} onClick={() => setRange(r)}>{r}</button>
              ))}
            </span>
          </div>
          <div className="flex-1 min-h-[180px] mt-3">{prof.isLoading ? <Skeleton rows={1} h={180} /> : <Sparkline points={series} />}</div>
        </section>

        {/* spot + stats */}
        <div className="space-y-3">
          <section className="card p-4">
            <div className="text-[13px] font-semibold mb-2">Spot</div>
            {spot.length === 0 && !bal.data?.spot?.some((s) => s.coin === "USDC" && s.total > 0.01) && <div className="text-xs text-muted">Nothing in spot. BTC, ETH and SOL deposits land here.</div>}
            {bal.data?.spot?.filter((s) => s.coin === "USDC" && s.total > 0.01).map((s) => (
              <div key="usdc" className="flex items-center justify-between text-xs py-1"><span className="flex items-center gap-2"><CoinIcon coin="USDC" size={18} /> USDC</span><span className="num">{fmtUsd(s.total)}{!bal.data?.unified && <button className="text-brand ml-2 hover:underline" onClick={() => openConvert("USDC")}>Move to perps</button>}</span></div>
            ))}
            {spot.map((r) => (
              <div key={r.coin} className="flex items-center justify-between text-xs py-1" data-testid={`pf-spot-${r.name}`}><span className="flex items-center gap-2"><CoinIcon coin={r.name} size={18} /> {r.name}</span><span className="num">{fmtQty(r.total)} {r.usd !== null && <span className="text-muted">≈ {fmtUsd(r.usd)}</span>}<button className="text-brand ml-2 hover:underline" onClick={() => openConvert(r.coin)}>Sell</button></span></div>
            ))}
          </section>
          {p && (
            <section className="card p-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div><div className="text-muted">Win rate</div><div className="num font-semibold">{p.stats.winRate === null ? "–" : `${Math.round(p.stats.winRate * 100)}%`}</div></div>
              <div><div className="text-muted">Closed trades</div><div className="num font-semibold">{p.stats.closedTrades}</div></div>
              <div><div className="text-muted">Thesis accuracy</div><div className="num font-semibold">{p.stats.thesisAccuracy === null ? "–" : `${Math.round(p.stats.thesisAccuracy * 100)}%`}</div></div>
              <div><div className="text-muted">Copied by</div><div className="num font-semibold">{p.stats.copiers} {p.stats.copiers === 1 ? "trader" : "traders"}</div></div>
              <div><div className="text-muted">Copiers PnL</div><Pnl value={p.stats.copiersPnl} className="font-semibold" /></div>
              <div><div className="text-muted">Followers</div><div className="num font-semibold">{p.followers}</div></div>
            </section>
          )}
        </div>
      </div>

      {/* positions */}
      <section className="card overflow-hidden">
        <div className="px-4 h-10 flex items-center text-[13px] font-semibold border-b border-line">Open positions <span className="text-dim font-normal ml-1.5 num">{positions.length}</span></div>
        {positions.length === 0 && <Empty title="No open positions" hint="Open one from any market, or copy a trader from the feed." />}
        {positions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[640px]">
              <thead className="text-[11px] text-dim"><tr className="border-b border-line"><th className="text-left font-medium px-4 py-2">Market</th><th className="text-right font-medium px-3 py-2">Size</th><th className="text-right font-medium px-3 py-2">Entry</th><th className="text-right font-medium px-3 py-2">Mark</th><th className="text-right font-medium px-3 py-2">PnL</th><th className="text-right font-medium px-4 py-2">Liq.</th></tr></thead>
              <tbody>
                {positions.map((x) => {
                  const mid = mids.data?.[x.coin] ? Number(mids.data[x.coin]) : undefined;
                  const pnl = livePnl({ side: x.szi > 0 ? "LONG" : "SHORT", size: Math.abs(x.szi), entryPx: x.entryPx }, mid) ?? x.unrealizedPnl;
                  const open = (p?.open ?? []).find((o) => o.coin === x.coin);
                  return (
                    <tr key={x.coin} className="border-b border-line/60 row-hover" data-testid={`pf-pos-${x.coin}`}>
                      <td className="px-4 py-2"><Link href={`/m/${x.coin}`} className="flex items-center gap-2 hover:underline"><CoinIcon coin={x.coin} size={20} /><span className="font-semibold">{x.coin}</span><span className={`pill ${x.szi > 0 ? "pill-up" : "pill-down"}`}>{x.szi > 0 ? "Long" : "Short"} {x.leverage}x</span>{open?.thesis && <span className="pill pill-thesis">Thesis</span>}</Link></td>
                      <td className="num text-right px-3">{fmtUsd(x.positionValue)}</td>
                      <td className="num text-right px-3">{fmtPx(x.entryPx)}</td>
                      <td className="num text-right px-3">{fmtPx(mid)}</td>
                      <td className="text-right px-3"><Pnl value={pnl} className="font-semibold" /></td>
                      <td className="num text-right px-4 text-muted">{x.liquidationPx ? fmtPx(x.liquidationPx) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* open orders + fills */}
        <section className="card overflow-hidden">
          <div className="px-4 h-10 flex items-center text-[13px] font-semibold border-b border-line">Open orders <span className="text-dim font-normal ml-1.5 num">{orders.data?.length ?? 0}</span></div>
          {!orders.data?.length && <Empty title="No open orders" />}
          {!!orders.data?.length && (
            <ul className="divide-y divide-line/60 text-xs">
              {orders.data.slice(0, 20).map((o) => (
                <li key={o.oid} className="flex items-center gap-2 px-4 py-2"><CoinIcon coin={o.coin} size={18} /><span className="font-semibold">{o.coin}</span><span className={o.side === "B" ? "text-up" : "text-down"}>{o.side === "B" ? "Buy" : "Sell"}</span><span className="text-muted">{o.type}</span><span className="ml-auto num">{o.sz} @ {fmtPx(o.isTrigger ? o.triggerPx : o.limitPx)}</span></li>
              ))}
            </ul>
          )}
        </section>
        <section className="card overflow-hidden">
          <div className="px-4 h-10 flex items-center text-[13px] font-semibold border-b border-line">Recent fills</div>
          {!fills.data?.length && <Empty title="No fills yet" />}
          {!!fills.data?.length && (
            <ul className="divide-y divide-line/60 text-xs">
              {fills.data.slice(0, 20).map((f, i) => (
                <li key={`${f.coin}-${f.time}-${i}`} className="flex items-center gap-2 px-4 py-2"><CoinIcon coin={f.coin} size={18} /><span className="font-semibold">{f.coin}</span><span className="text-muted">{f.dir}</span><span className="ml-auto num">{fmtUsd(f.px * f.sz)}</span>{f.closedPnl ? <Pnl value={f.closedPnl} className="num w-20 text-right" /> : <span className="w-20" />}<span className="text-dim num w-12 text-right">{timeAgo(f.time)}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* copies + theses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="card overflow-hidden">
          <div className="px-4 h-10 flex items-center text-[13px] font-semibold border-b border-line">Copied trades</div>
          {!(bal.data?.positions ?? []).some((x) => x.szi !== 0 && copiedFrom(p, x.coin)) && <Empty title="No copies open" hint="Press Copy on any trade in the feed and it shows up here with who you copied." />}
          <ul className="divide-y divide-line/60 text-xs">
            {(bal.data?.positions ?? []).filter((x) => x.szi !== 0 && copiedFrom(p, x.coin)).map((x) => {
              const c = copiedFrom(p, x.coin)!;
              return (
                <li key={x.coin} className="flex items-center gap-2 px-4 py-2"><CoinIcon coin={x.coin} size={18} /><span className="font-semibold">{x.coin}</span><span className="text-muted">copied</span><TraderLink address={c.address} handle={c.handle} displayName={c.displayName} className="font-medium" /><span className="ml-auto"><Pnl value={x.unrealizedPnl} /></span></li>
              );
            })}
          </ul>
        </section>
        <section className="card overflow-hidden">
          <div className="px-4 h-10 flex items-center text-[13px] font-semibold border-b border-line">Your theses <span className="text-dim font-normal ml-1.5 num">{theses.data?.length ?? 0} live</span></div>
          {!theses.data?.length && <Empty title="No live theses" hint="Post one with a trade, or from the Positions tab on an open position." />}
          <ul className="divide-y divide-line/60 text-xs">
            {(theses.data ?? []).slice(0, 10).map((t) => (
              <li key={t.id} className="px-4 py-2"><div className="flex items-center gap-2"><CoinIcon coin={t.coin} size={16} /><span className="font-semibold">{t.coin}</span><span className="text-dim num ml-auto">{timeAgo(t.createdAt)} · {t.likes} ♥ · {t.replies} replies</span></div><p className="text-fg-2 mt-0.5 line-clamp-2">{t.text}</p></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** the trader this open position copies, from the profile payload (which carries copiedFrom on open positions when present) */
function copiedFrom(p: Profile | undefined, coin: string): { address: string; handle: string | null; displayName: string | null } | null {
  return (p?.open ?? []).find((x) => x.coin === coin)?.copiedFrom ?? null;
}

function Stat({ label, value, sub, big }: { label: string; value: React.ReactNode; sub?: string; big?: boolean }) {
  return (
    <div className="card px-4 py-3 leading-tight">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`num font-semibold mt-0.5 ${big ? "text-[20px]" : "text-[15px]"}`}>{value}</div>
      {sub && <div className="text-[11px] text-dim mt-0.5">{sub}</div>}
    </div>
  );
}
