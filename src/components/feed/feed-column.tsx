"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import type { FeedItem, LeaderboardRow } from "@/lib/queries";
import { fmtPct, fmtPx, fmtUsd, userLabel, userPath } from "@/lib/format";
import { useMarkets, useMids } from "@/hooks/use-market";
import { useAuth } from "@/hooks/use-auth";
import { FeedCard } from "./feed-card";
import { Avatar, Empty, Pnl, Skeleton, Toggle } from "../ui";

type Tab = "feed" | "alerts" | "tokens" | "leaderboard";
const MIN_SIZES = [0, 1000, 10_000, 100_000];

export function FeedColumn({ onNavigate }: { onNavigate?: () => void }) {
  const [tab, setTab] = useState<Tab>("feed");
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b border-line px-1">
        {(["feed", "alerts", "tokens", "leaderboard"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "feed" && <Feed onNavigate={onNavigate} />}
        {tab === "alerts" && <Feed onNavigate={onNavigate} alerts />}
        {tab === "tokens" && <Tokens onNavigate={onNavigate} />}
        {tab === "leaderboard" && <MiniLeaderboard onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

export function useFeed(params: { coin?: string; minUsd: number; thesisOnly: boolean; following: boolean; address?: string; limit?: number }, enabled = true) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.coin) qs.set("coin", params.coin);
  if (params.minUsd) qs.set("minUsd", String(params.minUsd));
  if (params.thesisOnly) qs.set("thesis", "1");
  if (params.following) qs.set("following", "1");
  if (params.address) qs.set("address", params.address);
  return useQuery({
    queryKey: ["feed", qs.toString()],
    queryFn: () => api<{ items: FeedItem[] }>(`/api/feed?${qs}`).then((r) => r.items),
    refetchInterval: 3000,
    enabled,
  });
}

function Feed({ onNavigate, alerts }: { onNavigate?: () => void; alerts?: boolean }) {
  const { signedIn } = useAuth();
  const [thesisOnly, setThesisOnly] = useState(false);
  const [following, setFollowing] = useState(false);
  const [minUsd, setMinUsd] = useState(1000);
  const [coin, setCoin] = useState("");
  const markets = useMarkets();
  const mids = useMids();
  const [limit, setLimit] = useState(30);
  const q = useFeed({ coin: coin || undefined, minUsd, thesisOnly, following: alerts || following, limit });
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!q.data) return;
    const ids = q.data.map((i) => i.id);
    if (seen.size) {
      const n = new Set(ids.filter((id) => !seen.has(id)));
      if (n.size) {
        setFresh(n);
        setTimeout(() => setFresh(new Set()), 1500);
      }
    }
    setSeen(new Set(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  return (
    <div>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-line flex-wrap sticky top-0 bg-panel z-10">
        <Toggle on={thesisOnly} onChange={setThesisOnly} label="thesis" />
        {!alerts && <Toggle on={following} onChange={setFollowing} label="following" />}
        <select className="input h-6 w-auto px-1 text-[11px]" value={minUsd} onChange={(e) => setMinUsd(Number(e.target.value))} aria-label="minimum size">
          {MIN_SIZES.map((m) => (
            <option key={m} value={m}>
              {m ? `≥ ${fmtUsd(m, { compact: true })}` : "any size"}
            </option>
          ))}
        </select>
        <select className="input h-6 w-auto px-1 text-[11px]" value={coin} onChange={(e) => setCoin(e.target.value)} aria-label="market">
          <option value="">all markets</option>
          {markets.data?.map((m) => (
            <option key={m.coin} value={m.coin}>
              {m.coin}
            </option>
          ))}
        </select>
      </div>
      {alerts && !signedIn && <Empty title="sign in to see alerts" hint="alerts are trades and theses from traders you follow." />}
      {!alerts && following && !signedIn && <Empty title="sign in to filter by following" />}
      {q.isLoading && <Skeleton rows={8} />}
      {q.data && q.data.length === 0 && !q.isLoading && (alerts || following ? signedIn : true) && (
        <Empty title={alerts || following ? "nothing from traders you follow yet" : "no events yet"} hint={alerts || following ? "follow a few traders from the leaderboard." : "the indexer writes events as tracked traders open and close positions. is `pnpm worker` running?"} />
      )}
      {q.data?.map((item) => (
        <div key={item.id} className={fresh.has(item.id) ? (item.type === "SHORT" || item.type === "LIQUIDATED" ? "flash-down" : "flash-up") : ""}>
          <FeedCard item={item} mid={mids.data ? Number(mids.data[item.coin]) : undefined} onNavigate={onNavigate} signedIn={signedIn} />
        </div>
      ))}
      {q.data && q.data.length >= limit && limit < 100 && (
        <button className="btn btn-ghost w-full h-9 text-muted" onClick={() => setLimit((l) => Math.min(100, l + 30))}>
          load more
        </button>
      )}
    </div>
  );
}

export function Tokens({ onNavigate, full }: { onNavigate?: () => void; full?: boolean }) {
  const markets = useMarkets();
  const mids = useMids();
  const [q, setQ] = useState("");
  const list = useMemo(() => (markets.data ?? []).filter((m) => m.coin.toLowerCase().includes(q.toLowerCase())), [markets.data, q]);
  if (markets.isLoading) return <Skeleton rows={10} h={36} />;
  return (
    <div>
      <div className="p-2 sticky top-0 bg-panel border-b border-line">
        <input className="input h-7" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-dim">
          <tr className="border-b border-line">
            <th className="text-left font-medium px-3 py-1.5">market</th>
            <th className="text-right font-medium px-2 py-1.5">price</th>
            <th className="text-right font-medium px-2 py-1.5">24h</th>
            {full && <th className="text-right font-medium px-2 py-1.5 hidden sm:table-cell">volume</th>}
            {full && <th className="text-right font-medium px-2 py-1.5 hidden sm:table-cell">oi</th>}
            {full && <th className="text-right font-medium px-3 py-1.5 hidden md:table-cell">funding</th>}
            {!full && <th className="text-right font-medium px-3 py-1.5 hidden lg:table-cell">vol</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((m) => {
            const px = mids.data?.[m.coin] ? Number(mids.data[m.coin]) : m.markPx;
            return (
              <tr key={m.coin} className="border-b border-line/60 hover:bg-panel-2">
                <td className="px-3 py-1.5">
                  <Link href={`/m/${m.coin}`} onClick={onNavigate} className="font-semibold hover:underline">
                    {m.coin}
                  </Link>
                  <span className="text-dim ml-1">{m.maxLeverage}x</span>
                </td>
                <td className="num text-right px-2">{fmtPx(px)}</td>
                <td className={`num text-right px-2 ${m.change24h >= 0 ? "text-up" : "text-down"}`}>{fmtPct(m.change24h)}</td>
                {full && <td className="num text-right px-2 text-muted hidden sm:table-cell">{fmtUsd(m.volume24h, { compact: true })}</td>}
                {full && <td className="num text-right px-2 text-muted hidden sm:table-cell">{fmtUsd(m.openInterestUsd, { compact: true })}</td>}
                {full && <td className="num text-right px-3 text-muted hidden md:table-cell">{fmtPct(m.funding, 4)}</td>}
                {!full && <td className="num text-right px-3 text-muted hidden lg:table-cell">{fmtUsd(m.volume24h, { compact: true })}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniLeaderboard({ onNavigate }: { onNavigate?: () => void }) {
  const q = useQuery({ queryKey: ["leaderboard", "pnl7d"], queryFn: () => api<{ rows: LeaderboardRow[] }>("/api/leaderboard?by=pnl7d").then((r) => r.rows), refetchInterval: 30_000 });
  if (q.isLoading) return <Skeleton rows={10} h={36} />;
  if (!q.data?.length) return <Empty title="no ranked traders yet" hint="traders need 5 closed trades to rank." />;
  return (
    <div>
      <div className="px-3 py-1.5 text-[10px] uppercase text-dim border-b border-line flex justify-between">
        <span>7d realised pnl</span>
        <Link href="/leaderboard" onClick={onNavigate} className="hover:text-fg normal-case">
          full board →
        </Link>
      </div>
      {q.data.slice(0, 25).map((r) => (
        <Link key={r.user.address} href={userPath(r.user)} onClick={onNavigate} className="flex items-center gap-2 px-3 h-9 border-b border-line/60 hover:bg-panel-2">
          <span className="num text-dim w-5">{r.rank}</span>
          <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={20} />
          <span className="truncate text-xs">{userLabel(r.user)}</span>
          <span className="ml-auto num text-[11px] text-muted">{r.stats.winRate !== null ? `${Math.round(r.stats.winRate * 100)}%` : ""}</span>
          <Pnl value={r.stats.pnl7d} compact className="text-xs w-16 text-right" />
        </Link>
      ))}
    </div>
  );
}
