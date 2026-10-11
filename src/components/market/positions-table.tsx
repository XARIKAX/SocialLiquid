"use client";
import { useMemo, useState } from "react";
import { fmtDuration, fmtPx, fmtUsd, timeAgo } from "@/lib/format";
import { livePnl } from "@/hooks/use-market";
import type { FeedItem, UserLite } from "@/lib/queries";
import { Avatar, Empty, Icon, Skeleton, Toggle, TraderLink } from "../ui";
import { useAuth } from "@/hooks/use-auth";
import { FeedCard } from "../feed/feed-card";

export type MarketPosition = {
  id: string;
  address: string;
  user: UserLite | null;
  side: string;
  size: number;
  sizeUsd: number;
  leverage: number;
  entryPx: number;
  openedAt: string;
  unrealisedPnl: number;
  closedCount: number;
  avgHoldMs: number | null;
  thesis: { id: string; text: string; likes: number; outcome: string } | null;
};

export type MarketTrade = {
  id: string;
  address: string;
  user: UserLite | null;
  dir: string;
  side: string;
  px: number;
  sz: number;
  usd: number;
  closedPnl: number;
  liquidation: boolean;
  time: string;
};

type Sort = "pnl" | "size";
type Tab = "positions" | "trades" | "thesis";

export function PositionsTable({
  coin,
  positions,
  trades,
  theses,
  mid,
  loading,
  thesisOnly,
  following,
  setThesisOnly,
  setFollowing,
}: {
  coin: string;
  positions: MarketPosition[] | undefined;
  trades: MarketTrade[] | undefined;
  theses: FeedItem[] | undefined;
  mid?: number;
  loading: boolean;
  thesisOnly: boolean;
  following: boolean;
  setThesisOnly: (v: boolean) => void;
  setFollowing: (v: boolean) => void;
}) {
  const [sort, setSort] = useState<Sort>("size");
  const [tab, setTab] = useState<Tab>("positions");
  const { signedIn } = useAuth();
  const rows = useMemo(() => {
    const list = (positions ?? []).map((p) => ({ ...p, pnl: livePnl(p, mid) ?? p.unrealisedPnl }));
    return list.sort((a, b) => (sort === "pnl" ? b.pnl - a.pnl : b.sizeUsd - a.sizeUsd));
  }, [positions, mid, sort]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 h-12 border-b border-line overflow-x-auto">
        {(
          [
            ["positions", `Positions (${positions?.length ?? 0})`],
            ["trades", "Trades"],
            ["thesis", `Thesis (${theses?.length ?? 0})`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={`tab h-8 px-3 ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-3 pr-2 shrink-0">
          {tab === "positions" && (
            <span className="seg hidden sm:inline-flex">
              {(["size", "pnl"] as Sort[]).map((s) => (
                <button key={s} className={`seg-item ${sort === s ? "seg-active" : ""}`} onClick={() => setSort(s)}>
                  {s === "size" ? "Size" : "PnL"}
                </button>
              ))}
            </span>
          )}
          <Toggle on={thesisOnly} onChange={setThesisOnly} label="Thesis only" />
          <Toggle on={following} onChange={setFollowing} label="Following only" />
        </span>
      </div>

      {tab === "positions" && (
        <>
          {loading && <Skeleton rows={6} h={48} />}
          {!loading && following && !signedIn && <Empty title="Sign in to filter by following" />}
          {!loading && rows.length === 0 && (signedIn || !following) && (
            <Empty title={`No open ${coin} positions`} hint={thesisOnly ? "Nobody has posted a thesis on this market yet. Be the first from the trade panel." : "Tracked traders have nothing open here right now."} />
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[760px]">
                <thead className="text-[11px] text-dim">
                  <tr className="border-b border-line">
                    <th className="text-left font-medium px-4 py-2">Trader</th>
                    <th className="text-left font-medium px-3 py-2">Position</th>
                    <th className="text-left font-medium px-3 py-2">PnL</th>
                    <th className="text-left font-medium px-3 py-2">Entry</th>
                    <th className="text-left font-medium px-3 py-2 w-10">♥</th>
                    <th className="text-left font-medium px-3 py-2">Thesis</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const roe = p.sizeUsd ? (p.pnl * p.leverage) / p.sizeUsd : 0;
                    return (
                      <tr key={p.id} className="border-b border-line/60 row-hover align-top">
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <Avatar address={p.address} url={p.user?.avatarUrl} handle={p.user?.handle ?? p.user?.displayName} size={30} />
                            <span className="leading-tight min-w-0">
                              <TraderLink address={p.address} handle={p.user?.handle} displayName={p.user?.displayName} className="font-semibold block truncate max-w-[9rem]" />
                              <span className="text-[11px] text-dim flex items-center gap-1"><Icon.clock /> {p.avgHoldMs ? `${fmtDuration(p.avgHoldMs)} avg. hold` : `open ${fmtDuration(Date.now() - new Date(p.openedAt).getTime())}`}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 leading-tight">
                          <span className="num font-semibold block">{fmtUsd(p.sizeUsd)}</span>
                          <span className="text-[11px] num">
                            <span className={p.side === "LONG" ? "text-up" : "text-down"}>{p.side === "LONG" ? "Long" : "Short"}</span>
                            <span className="text-dim"> {p.leverage}x · {p.size} {coin}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 leading-tight">
                          <span className={`num font-semibold block ${p.pnl > 0 ? "text-up" : p.pnl < 0 ? "text-down" : "text-muted"}`}>{fmtUsd(p.pnl, { sign: true })}</span>
                          <span className={`num text-[11px] ${roe >= 0 ? "text-up" : "text-down"}`}>{roe >= 0 ? "▲" : "▼"} {Math.abs(roe * 100).toFixed(2)}%</span>
                        </td>
                        <td className="px-3 py-2.5 leading-tight">
                          <span className="num block">{fmtPx(p.entryPx)}</span>
                          <span className="text-[11px] text-dim">{timeAgo(p.openedAt)} ago</span>
                        </td>
                        <td className="px-3 py-2.5 num text-muted">{p.thesis ? <span className="inline-flex items-center gap-1"><Icon.heart /> {p.thesis.likes}</span> : ""}</td>
                        <td className="px-3 py-2.5 max-w-[22rem] text-fg-2 leading-snug">{p.thesis?.text ?? <span className="text-dim">–</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "trades" && (
        <>
          {!trades?.length && <Empty title={`No ${coin} fills indexed yet`} hint="Fills land here as tracked traders execute on Hyperliquid." />}
          {!!trades?.length && (
            <table className="w-full text-[13px]">
              <thead className="text-[11px] text-dim">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2">Trader</th>
                  <th className="text-left font-medium px-3 py-2">Action</th>
                  <th className="text-right font-medium px-3 py-2">Amount</th>
                  <th className="text-right font-medium px-3 py-2">Price</th>
                  <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Realised</th>
                  <th className="text-right font-medium px-4 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const open = /open/i.test(t.dir) || /> (Long|Short)/.test(t.dir);
                  const long = /long/i.test(t.dir) && !/short >/i.test(t.dir);
                  const label = t.liquidation ? "Liquidated" : t.dir;
                  return (
                    <tr key={t.id} className="border-b border-line/60 row-hover">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          <Avatar address={t.address} url={t.user?.avatarUrl} handle={t.user?.handle ?? t.user?.displayName} size={22} />
                          <TraderLink address={t.address} handle={t.user?.handle} displayName={t.user?.displayName} className="font-medium truncate max-w-[9rem]" />
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`pill ${t.liquidation ? "pill-liq" : open ? (long ? "pill-up" : "pill-down") : "pill-neutral"}`}>{label}</span>
                      </td>
                      <td className="num text-right px-3 py-2 font-medium">{fmtUsd(t.usd)}</td>
                      <td className="num text-right px-3 py-2 text-fg-2">{fmtPx(t.px)}</td>
                      <td className={`num text-right px-3 py-2 hidden sm:table-cell ${t.closedPnl > 0 ? "text-up" : t.closedPnl < 0 ? "text-down" : "text-dim"}`}>{t.closedPnl ? fmtUsd(t.closedPnl, { sign: true }) : "–"}</td>
                      <td className="num text-right px-4 py-2 text-dim">{timeAgo(t.time)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === "thesis" && (
        <>
          {!theses?.length && <Empty title={`No ${coin} theses yet`} hint="A thesis is a trade with a reason attached. Post one from the trade panel and it shows up here with a live PnL badge." />}
          {theses?.map((item) => (
            <FeedCard key={item.id} item={item} mid={mid} signedIn={signedIn} />
          ))}
        </>
      )}
    </div>
  );
}
