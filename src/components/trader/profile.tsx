"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { livePnl, useMids } from "@/hooks/use-market";
import { api } from "@/lib/client";
import { fmtDuration, fmtPct, fmtPx, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import type { TraderStats } from "@/lib/queries";
import { Avatar, CoinIcon, Empty, Icon, OutcomePill, Pnl, SidePill } from "../ui";
import { openProfileEditor } from "../profile-editor";

export type Profile = {
  address: string;
  user: { id: string; handle: string | null; displayName: string | null; xHandle: string | null; tgHandle: string | null; bio: string | null; avatarUrl: string | null; bannerUrl: string | null; createdAt: string; style?: string | null; pinnedThesisId?: string | null; pinnedPositionId?: string | null } | null;
  pinnedPosition?: { id: string; coin: string; side: string; sizeUsd: number; leverage: number; entryPx: number; closePx: number | null; realisedPnl: number | null; unrealisedPnl: number; size: number; openedAt: string; closedAt: string | null; liquidated: boolean; thesis: { id: string; text: string; outcome: string } | null } | null;
  mutuals: number;
  displayName: string | null;
  claimed: boolean;
  isMe: boolean;
  isFollowing: boolean;
  followers: number;
  following: number;
  stats: TraderStats;
  accountValue: number | null;
  pnlSeries: { t: number; pnl: number }[];
  fills: { id: string; coin: string; dir: string; px: number; sz: number; usd: number; closedPnl: number; liquidation: boolean; time: string }[];
  fillsSource: "indexed" | "live";
  fillStats: { fills: number; closes: number; wins: number } | null;
  /** hyperliquid's own portfolio windows: cumulative pnl curve, pnl, volume, account value at window start */
  hl: Record<"day" | "week" | "month" | "allTime", { pnl: number; vlm: number; startValue: number; curve: { t: number; v: number }[] } | null> | null;
  open: { id: string | null; coin: string; side: string; size: number; sizeUsd: number; leverage: number; entryPx: number; unrealisedPnl: number; roe: number; liquidationPx: number | null; openedAt: string | null; thesis: { id: string; text: string } | null; copiedFrom?: { address: string; handle: string | null; displayName: string | null } | null }[];
  recentClosed: { id: string; coin: string; side: string; sizeUsd: number; leverage: number; entryPx: number; closePx: number | null; realisedPnl: number | null; openedAt: string; closedAt: string; liquidated: boolean }[];
  theses: { id: string; coin: string; text: string; outcome: string; createdAt: string; likes: number; likedByMe: boolean; position: { id: string; side: string; sizeUsd: number; leverage: number; entryPx: number; size: number; closedAt: string | null; realisedPnl: number | null; unrealisedPnl: number; openedAt: string } | null }[];
};

type Range = "24H" | "7D" | "30D" | "ALL";
const RANGE_KEY = { "24H": "day", "7D": "week", "30D": "month", ALL: "allTime" } as const;

export function TraderProfile({ handle, initial }: { handle: string; initial: Profile }) {
  const q = useQuery({ queryKey: ["trader", handle], queryFn: () => api<Profile>(`/api/trader/${encodeURIComponent(handle)}`), initialData: initial, refetchInterval: 5000 });
  const p = q.data;
  const { signedIn } = useAuth();
  const mids = useMids();
  const qc = useQueryClient();
  const [posTab, setPosTab] = useState<"open" | "closed">("open");
  const [range, setRange] = useState<Range>("7D");
  const [busy, setBusy] = useState(false);
  const name = p.user?.displayName ?? p.user?.handle ?? p.displayName ?? shortAddr(p.address);
  const hue = parseInt(p.address.slice(2, 8), 16) % 360;

  const follow = async () => {
    setBusy(true);
    try {
      await api("/api/follow", { method: "POST", json: { address: p.address, follow: !p.isFollowing } });
      qc.invalidateQueries({ queryKey: ["trader", handle] });
      qc.invalidateQueries({ queryKey: ["feed"] });
    } finally {
      setBusy(false);
    }
  };

  const topTrades = useMemo(() => [...p.recentClosed].filter((c) => c.realisedPnl !== null).sort((a, b) => (b.realisedPnl ?? 0) - (a.realisedPnl ?? 0)).slice(0, 5), [p.recentClosed]);
  const rangeMs = range === "24H" ? 86_400_000 : range === "7D" ? 7 * 86_400_000 : range === "30D" ? 30 * 86_400_000 : Infinity;
  const hlWin = p.hl?.[RANGE_KEY[range]] ?? null;
  const series = useMemo(() => {
    // hyperliquid's own cumulative pnl curve for the window; our realised series only as a fallback
    if (hlWin) return hlWin.curve;
    const since = Date.now() - rangeMs;
    let acc = 0;
    return p.pnlSeries.filter((x) => x.t >= since).map((x) => ({ t: x.t, v: (acc += x.pnl) }));
  }, [hlWin, p.pnlSeries, rangeMs]);
  const rangePnl = hlWin ? hlWin.pnl : (series.at(-1)?.v ?? 0);
  const allTimePnl = p.hl?.allTime?.pnl ?? p.stats.pnlAll;
  const tradeCount = p.stats.closedTrades || p.fillStats?.closes || 0;
  const winRate = p.stats.closedTrades ? p.stats.winRate : p.fillStats?.closes ? p.fillStats.wins / p.fillStats.closes : null;
  const pinned = useMemo(() => (p.user?.pinnedThesisId ? p.theses.find((t) => t.id === p.user!.pinnedThesisId) : undefined) ?? [...p.theses].sort((a, b) => b.likes - a.likes)[0], [p.theses, p.user?.pinnedThesisId]);
  const pinnedIsChoice = !!p.user?.pinnedThesisId && pinned?.id === p.user.pinnedThesisId;
  const openUpnl = p.open.reduce((a, o) => a + (livePnl(o, mids.data?.[o.coin] ? Number(mids.data[o.coin]) : undefined) ?? o.unrealisedPnl), 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3 pb-3">
      <div className="min-w-0 space-y-3">
        {/* header card */}
        <section className="card overflow-hidden">
          <div className="h-36 md:h-44 relative overflow-hidden" style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 14%), hsl(${(hue + 60) % 360} 50% 9%) 60%, #0b0b0e)` }}>
            {p.user?.bannerUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.user.bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            )}
          </div>
          <div className="px-5 pb-5 relative">
            <div className="flex items-start gap-4 -mt-10">
              <Avatar address={p.address} url={p.user?.avatarUrl} handle={p.user?.handle ?? p.displayName} size={88} ring />
              <div className="flex-1 min-w-0 pt-12">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-[22px] font-semibold tracking-tight truncate">{name}</h1>
                  {p.claimed && <span className="text-brand" title="claimed"><Icon.check /></span>}
                  {!p.claimed && <span className="pill pill-neutral">Unclaimed</span>}
                  {p.isMe && <span className="pill pill-brand">You</span>}
                  {p.user?.style && <span className="pill pill-neutral" data-testid="style-pill">{p.user.style}</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted mt-0.5 flex-wrap">
                  {p.user?.handle && <span className="text-fg-2">@{p.user.handle}</span>}
                  {p.user?.xHandle && <a href={`https://x.com/${p.user.xHandle}`} target="_blank" rel="noreferrer" className="hover:text-fg inline-flex items-center gap-1"><Icon.x /> {p.user.xHandle}</a>}
                  {p.user?.tgHandle && <a href={`https://t.me/${p.user.tgHandle}`} target="_blank" rel="noreferrer" className="hover:text-fg inline-flex items-center gap-1"><Icon.send /> {p.user.tgHandle}</a>}
                  <span className="num" title={p.address}>{shortAddr(p.address)}</span>
                </div>
                {p.user?.bio && <p className="text-[13px] text-fg-2 mt-1.5 max-w-[560px] leading-snug">{p.user.bio}</p>}
              </div>
              <div className="hidden sm:flex items-center gap-6 pt-12 text-center">
                <StatBig label="Mutuals" value={p.mutuals} />
                <StatBig label="Following" value={p.following} />
                <StatBig label="Followers" value={p.followers} />
              </div>
              <div className="flex gap-2 pt-12">
                <button className="btn h-9 w-9 px-0" title="share" onClick={() => navigator.share?.({ url: location.href, title: name }).catch(() => navigator.clipboard?.writeText(location.href))}><Icon.share /></button>
                {p.isMe && <button className="btn h-9 px-4" onClick={() => openProfileEditor()}>Edit profile</button>}
                {!p.isMe && (
                  <button className={`btn h-9 px-4 ${p.isFollowing ? "" : "bg-thesis border-thesis text-white hover:brightness-110"}`} onClick={follow} disabled={busy || !signedIn} title={signedIn ? "" : "sign in to follow"}>
                    {p.isFollowing ? "Following" : "Follow"}
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 mt-4 text-xs text-muted flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-fg-2 font-medium"><span className="text-warn">⚡</span> All time <Pnl value={allTimePnl} compact className="font-semibold" /></span>
              {p.hl?.allTime && <span className="num">{fmtUsd(p.hl.allTime.vlm, { compact: true })} volume</span>}
              {p.stats.avgHoldMs ? <span className="inline-flex items-center gap-1"><Icon.clock /> {fmtDuration(p.stats.avgHoldMs)} avg. hold</span> : null}
              <span className="inline-flex items-center gap-1"><Icon.layers /> {tradeCount} trades{!p.stats.closedTrades && p.fillStats ? ` · last ${p.fillStats.fills} fills` : ""}</span>
              <span>{winRate === null || winRate === undefined ? "" : `${fmtPct(winRate, 0, false)} win rate`}</span>
              {p.stats.copyTrades > 0 && (
                <span className="inline-flex items-center gap-1.5" title={`${p.stats.copyTrades} positions were opened with Copy on this trader`} data-testid="copier-stats">
                  <Icon.copy /> Copied by <b className="text-fg-2">{p.stats.copiers}</b> {p.stats.copiers === 1 ? "trader" : "traders"} · copiers <Pnl value={p.stats.copiersPnl} compact className="font-semibold" />
                </span>
              )}
              {p.user?.createdAt && <span>Joined {new Date(p.user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>}
              {p.accountValue !== null && <span className="num">Account {fmtUsd(p.accountValue, { compact: true })}</span>}
            </div>
          </div>
        </section>

        {/* top trades strip */}
        {topTrades.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {topTrades.map((t, i) => {
              const roe = t.sizeUsd ? ((t.realisedPnl ?? 0) * t.leverage) / t.sizeUsd : 0;
              return (
                <Link key={t.id} href={`/m/${t.coin}`} className="card-2 px-3 py-2 min-w-[200px] hover:bg-panel-3 transition-colors">
                  <div className="text-[11px] text-muted"><span className="text-fg-2 font-semibold">#{i + 1}</span> Trade</div>
                  <div className="flex items-center gap-2 mt-1">
                    <CoinIcon coin={t.coin} size={18} />
                    <Pnl value={t.realisedPnl} className="font-semibold" />
                    <span className={`num text-[11px] ${roe >= 0 ? "text-up" : "text-down"}`}>({roe >= 0 ? "▲" : "▼"} {Math.abs(roe * 100).toFixed(1)}%)</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* pnl chart card */}
          <section className="card p-4 flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <div className="num text-[26px] font-semibold tracking-tight leading-none">
                  <span className={rangePnl > 0 ? "text-up" : rangePnl < 0 ? "text-down" : "text-fg"}>{fmtUsd(rangePnl, { sign: true })}</span>
                </div>
                <div className="text-xs text-muted mt-1">{hlWin ? "PnL · Hyperliquid" : "Realised PnL"} · {range === "ALL" ? "all time" : range.toLowerCase()}</div>
              </div>
              <span className="seg">
                {(["24H", "7D", "30D", "ALL"] as Range[]).map((r) => (
                  <button key={r} className={`seg-item num ${range === r ? "seg-active" : ""}`} onClick={() => setRange(r)}>{r}</button>
                ))}
              </span>
            </div>
            <div className="flex-1 min-h-[150px] mt-3">
              <Sparkline points={series} />
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-line">
              <span className="w-9 h-9 rounded-full bg-panel-2 border border-line inline-flex items-center justify-center text-muted">$</span>
              <div className="leading-tight">
                <div className="text-[11px] text-muted">Open PnL</div>
                <Pnl value={openUpnl} className="font-semibold text-[15px]" />
              </div>
              <div className="leading-tight ml-6">
                <div className="text-[11px] text-muted">Account value</div>
                <div className="num font-semibold text-[15px]">{p.accountValue === null ? "–" : fmtUsd(p.accountValue)}</div>
              </div>
            </div>
          </section>

          {/* pinned thesis + trades */}
          <div className="space-y-3">
            {pinned ? (
              <section className="card p-4">
                <div className="flex items-center gap-2">
                  <CoinIcon coin={pinned.coin} size={22} />
                  <span className="font-semibold">{pinned.coin}</span>
                  <span className="pill pill-thesis">Thesis</span>
                  <span className="pill pill-neutral">{pinnedIsChoice ? "Pinned" : "Most liked"}</span>
                  <span className="ml-auto"><OutcomePill outcome={pinned.outcome} /></span>
                </div>
                <p className="text-[13.5px] mt-2 leading-snug whitespace-pre-wrap break-words">{pinned.text}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-dim">
                  <span className="inline-flex items-center gap-1 num"><Icon.heart /> {pinned.likes}</span>
                  <span className="num" suppressHydrationWarning>{timeAgo(pinned.createdAt)} ago</span>
                  <Link href={`/t/${p.user?.handle ?? p.address}/thesis/${pinned.id}`} className="ml-auto hover:text-fg">Permalink</Link>
                </div>
              </section>
            ) : (
              <section className="card p-4">
                <Empty title={p.claimed ? "No theses yet" : "Unclaimed address"} hint={p.claimed ? "A thesis is a trade with a reason attached. Post one from the trade panel." : "Positions and PnL are tracked from chain. Connect this wallet to claim it and post theses."} />
              </section>
            )}
            {p.pinnedPosition && (
              <section className="card p-4" data-testid="pinned-trade">
                <div className="flex items-center gap-2">
                  <CoinIcon coin={p.pinnedPosition.coin} size={22} />
                  <span className="font-semibold">{p.pinnedPosition.coin}</span>
                  <span className={`pill ${p.pinnedPosition.side === "LONG" ? "pill-up" : "pill-down"}`}>{p.pinnedPosition.side === "LONG" ? "Long" : "Short"} {p.pinnedPosition.leverage}x</span>
                  <span className="pill pill-neutral">Pinned trade</span>
                  <span className="ml-auto"><Pnl value={p.pinnedPosition.closedAt ? p.pinnedPosition.realisedPnl : livePnl({ side: p.pinnedPosition.side, size: p.pinnedPosition.size, entryPx: p.pinnedPosition.entryPx }, mids.data?.[p.pinnedPosition.coin] ? Number(mids.data[p.pinnedPosition.coin]) : undefined) ?? p.pinnedPosition.unrealisedPnl} className="font-semibold" /></span>
                </div>
                <div className="text-[12px] text-muted num mt-1.5" suppressHydrationWarning>{fmtUsd(p.pinnedPosition.sizeUsd, { compact: true })} · entry {fmtPx(p.pinnedPosition.entryPx)}{p.pinnedPosition.closePx ? ` → ${fmtPx(p.pinnedPosition.closePx)}` : ""} · {p.pinnedPosition.closedAt ? `closed ${timeAgo(p.pinnedPosition.closedAt)}` : "open"}</div>
                {p.pinnedPosition.thesis && <p className="text-[13px] mt-2 leading-snug text-fg-2"><span className="text-thesis font-medium">Thesis · </span>{p.pinnedPosition.thesis.text}</p>}
              </section>
            )}
            <section className="card overflow-hidden">
              <div className="flex items-center gap-1 px-2 h-11 border-b border-line">
                <span className="tab tab-active h-8">All trades</span>
                <span className="text-[11px] text-dim ml-auto pr-2 num">{p.fills.length} fills{p.fillsSource === "live" ? " · live from Hyperliquid" : ""}</span>
              </div>
              {p.fills.length === 0 && <Empty title="No fills yet" hint="This account has no fills on Hyperliquid." />}
              <div className="max-h-[320px] overflow-y-auto">
                <table className="w-full text-[13px]">
                  <tbody>
                    {p.fills.map((f) => {
                      const open = /open/i.test(f.dir) || /> (Long|Short)/.test(f.dir);
                      const long = /long/i.test(f.dir) && !/short >/i.test(f.dir);
                      return (
                        <tr key={f.id} className="row-hover border-b border-line/60">
                          <td className="px-4 py-2"><Link href={`/m/${f.coin}`} className="flex items-center gap-2 font-medium"><CoinIcon coin={f.coin} size={22} />{f.coin}</Link></td>
                          <td className="px-2 py-2"><span className={`pill ${f.liquidation ? "pill-liq" : open ? (long ? "pill-up" : "pill-down") : "pill-neutral"}`}>{f.liquidation ? "Liquidated" : f.dir}</span></td>
                          <td className="num px-2 py-2 text-right font-medium">{fmtUsd(f.usd)}</td>
                          <td className={`num px-2 py-2 text-right hidden sm:table-cell ${f.closedPnl > 0 ? "text-up" : f.closedPnl < 0 ? "text-down" : "text-dim"}`}>{f.closedPnl ? fmtUsd(f.closedPnl, { sign: true }) : ""}</td>
                          <td className="num px-4 py-2 text-right text-dim" suppressHydrationWarning>{timeAgo(f.time)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>

        {/* positions */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 h-12 border-b border-line">
            <h3 className="font-semibold">Positions <span className="text-dim font-normal num">{posTab === "open" ? p.open.length : p.recentClosed.length}</span></h3>
            <span className="seg">
              <button className={`seg-item flex items-center gap-1.5 ${posTab === "open" ? "seg-active" : ""}`} onClick={() => setPosTab("open")}>Open <span className="w-1.5 h-1.5 rounded-full bg-brand" /></button>
              <button className={`seg-item ${posTab === "closed" ? "seg-active" : ""}`} onClick={() => setPosTab("closed")}>Closed</button>
            </span>
          </div>
          {posTab === "open" && (
            <div>
              {p.open.length === 0 && <Empty title="No open positions" hint="Read live from Hyperliquid." />}
              {p.open.map((o) => {
                const mid = mids.data?.[o.coin] ? Number(mids.data[o.coin]) : undefined;
                const pnl = livePnl(o, mid) ?? o.unrealisedPnl;
                const roe = o.sizeUsd ? (pnl * o.leverage) / o.sizeUsd : 0;
                return (
                  <div key={o.coin} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 row-hover">
                    <CoinIcon coin={o.coin} size={32} />
                    <div className="leading-tight min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/m/${o.coin}`} className="font-semibold hover:underline">{o.coin}</Link>
                        <SidePill side={o.side} />
                        <span className="pill pill-neutral num">{o.leverage}x</span>
                        {o.thesis && <span className="pill pill-thesis">Thesis</span>}
                      </div>
                      <div className="text-[11px] text-dim num mt-0.5" suppressHydrationWarning>{o.size} {o.coin} · entry {fmtPx(o.entryPx)}{o.liquidationPx ? ` · liq ${fmtPx(o.liquidationPx)}` : ""}{o.openedAt ? ` · ${fmtDuration(Date.now() - new Date(o.openedAt).getTime())}` : ""}</div>
                    </div>
                    <div className="text-right leading-tight">
                      <div className="num font-semibold">{fmtUsd(o.sizeUsd)}</div>
                      <div className={`num text-[11px] ${pnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(pnl, { sign: true })} · {roe >= 0 ? "▲" : "▼"} {Math.abs(roe * 100).toFixed(2)}%</div>
                    </div>
                    {!p.isMe && o.id && (
                      <Link
                        href={`/m/${o.coin}?${new URLSearchParams({ copy: o.id, from: p.address, side: o.side, lev: String(o.leverage), name }).toString()}`}
                        className="btn h-8 px-2.5 text-[11px] font-semibold border-brand/40 text-brand hover:bg-brand/10 shrink-0"
                        title={`Open the same ${o.side === "SHORT" ? "short" : "long"} on ${o.coin}`}
                      >
                        <Icon.copy /> Copy
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {posTab === "closed" && (
            <div>
              {p.recentClosed.length === 0 && <Empty title="No closed trades indexed yet" hint="Closed positions appear once the indexer has walked this account's fills. Recent fills are in the trades list above." />}
              {p.recentClosed.map((c) => {
                const roe = c.sizeUsd ? ((c.realisedPnl ?? 0) * c.leverage) / c.sizeUsd : 0;
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 row-hover">
                    <CoinIcon coin={c.coin} size={32} />
                    <div className="leading-tight min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/m/${c.coin}`} className="font-semibold hover:underline">{c.coin}</Link>
                        <SidePill side={c.side} />
                        <span className="pill pill-neutral num">{c.leverage}x</span>
                        {c.liquidated && <span className="pill pill-liq">Liquidated</span>}
                      </div>
                      <div className="text-[11px] text-dim num mt-0.5" suppressHydrationWarning>{fmtPx(c.entryPx)} → {fmtPx(c.closePx)} · held {fmtDuration(new Date(c.closedAt).getTime() - new Date(c.openedAt).getTime())} · {timeAgo(c.closedAt)} ago</div>
                    </div>
                    <div className="text-right leading-tight">
                      <Pnl value={c.realisedPnl} className="font-semibold block" />
                      <span className={`num text-[11px] ${roe >= 0 ? "text-up" : "text-down"}`}>{roe >= 0 ? "▲" : "▼"} {Math.abs(roe * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* right: thesis history (the receipts) */}
      <aside className="space-y-3">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 h-12 border-b border-line">
            <h3 className="font-semibold">Theses <span className="text-dim font-normal num">{p.theses.length}</span></h3>
            <span className="text-[11px] text-dim">receipts from chain</span>
          </div>
          {p.theses.length === 0 && <Empty title="No theses" hint={p.claimed ? "Every thesis gets an outcome: held, closed in profit, closed at loss, liquidated, or dumped inside an hour." : "Only claimed accounts can post."} />}
          <div className="max-h-[70vh] overflow-y-auto">
            {p.theses.map((t) => {
              const mid = mids.data?.[t.coin] ? Number(mids.data[t.coin]) : undefined;
              const live = t.position && !t.position.closedAt ? livePnl(t.position, mid) : null;
              return (
                <article key={t.id} className="px-4 py-3 border-b border-line/60">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <CoinIcon coin={t.coin} size={18} />
                    <Link href={`/m/${t.coin}`} className="font-semibold text-[13px] hover:underline">{t.coin}</Link>
                    {t.position && <span className={`num ${t.position.side === "LONG" ? "text-up" : "text-down"}`}>{t.position.side === "LONG" ? "Long" : "Short"} {fmtUsd(t.position.sizeUsd, { compact: true })} · {t.position.leverage}x</span>}
                    <span className="ml-auto text-dim num" suppressHydrationWarning>{timeAgo(t.createdAt)}</span>
                  </div>
                  <p className="text-[13px] mt-1.5 leading-snug whitespace-pre-wrap break-words">{t.text}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <OutcomePill outcome={t.outcome} />
                    {live !== null && <Pnl value={live} className="text-xs" />}
                    {t.position?.closedAt && <Pnl value={t.position.realisedPnl} className="text-xs" />}
                    <span className={`ml-auto inline-flex items-center gap-1 text-xs num ${t.likedByMe ? "text-down" : "text-dim"}`}><Icon.heart filled={t.likedByMe} /> {t.likes}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </aside>
    </div>
  );
}

function StatBig({ label, value }: { label: string; value: number }) {
  return (
    <div className="leading-tight">
      <div className="num text-[15px] font-semibold">{value.toLocaleString("en-US")}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

export function Sparkline({ points }: { points: { t: number; v: number }[] }) {
  if (points.length < 2) {
    return <div className="h-full flex items-center justify-center text-xs text-dim border border-dashed border-line rounded-[10px]">Not enough closed trades in this window</div>;
  }
  const w = 600;
  const h = 160;
  const pad = 6;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.v);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (w - pad * 2);
  const sy = (y: number) => h - pad - ((y - minY) / Math.max(1e-9, maxY - minY)) * (h - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1].v;
  const color = last >= 0 ? "#22d36b" : "#ff4d4f";
  const zero = sy(0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={0} x2={w} y1={zero} y2={zero} stroke="var(--color-line-2)" strokeDasharray="3 4" />
      <path d={`${d} L${sx(maxX).toFixed(1)},${zero} L${sx(minX).toFixed(1)},${zero} Z`} fill="url(#spark)" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
