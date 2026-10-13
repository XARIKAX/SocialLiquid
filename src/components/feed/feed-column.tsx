"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import type { FeedItem, HlBoard, LeaderboardRow } from "@/lib/queries";
import { fmtPct, fmtPx, fmtUsd, userLabel, userPath } from "@/lib/format";
import { useMarkets, useMids } from "@/hooks/use-market";
import { useAuth } from "@/hooks/use-auth";
import { FeedCard } from "./feed-card";
import { Avatar, CoinIcon, Empty, Icon, Pnl, Skeleton, Toggle } from "../ui";

type Tab = "tokens" | "feed" | "leaderboard" | "alerts";
const TABS: Tab[] = ["tokens", "feed", "leaderboard", "alerts"];
const TAB_KEY = "sl:rail-tab";
const MIN_SIZES = [0, 1000, 10_000, 100_000];

export function FeedColumn({ onNavigate, onCollapse }: { onNavigate?: () => void; onCollapse?: () => void }) {
  // markets first: a new visitor has no alerts and nobody followed yet
  const [tab, setTab_] = useState<Tab>("tokens");
  useEffect(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as Tab | null;
      if (t && TABS.includes(t)) setTab_(t);
    } catch {}
  }, []);
  const setTab = (t: Tab) => {
    setTab_(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  };
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-0.5 px-2 h-12 border-b border-line shrink-0">
        {(
          [
            ["tokens", "Tokens", null],
            ["feed", "Feed", null],
            ["leaderboard", "Leaderboard", null],
            ["alerts", "Alerts", <Icon.bell key="b" />],
          ] as [Tab, string, React.ReactNode][]
        ).map(([t, label, icon]) => (
          <button key={t} className={`tab h-8 px-2.5 ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {icon}
            {label}
          </button>
        ))}
        <button className="ml-auto text-dim hover:text-fg p-1.5 rounded-md" onClick={onCollapse} title="collapse feed" aria-label="collapse feed"><Icon.collapse /></button>
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
  const [limit, setLimit] = useState(30);
  const markets = useMarkets();
  const mids = useMids();
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
        setTimeout(() => setFresh(new Set()), 1600);
      }
    }
    setSeen(new Set(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const gated = (alerts || following) && !signedIn;

  return (
    <div>
      <div className="px-3 pt-2.5 pb-2 border-b border-line sticky top-0 bg-panel z-10 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Icon.users /> <span className="font-medium text-fg-2">{alerts ? "Alerts" : "Traders"}</span>
          <span className="ml-auto flex items-center gap-1 text-dim"><Icon.filter /> Filters</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <select className="btn btn-sm num pr-6 appearance-none bg-panel-2" value={minUsd} onChange={(e) => setMinUsd(Number(e.target.value))} aria-label="minimum size">
            {MIN_SIZES.map((m) => (
              <option key={m} value={m}>
                {m ? `> ${fmtUsd(m, { compact: true })}` : "Any size"}
              </option>
            ))}
          </select>
          <select className="btn btn-sm pr-6 appearance-none bg-panel-2 max-w-[110px]" value={coin} onChange={(e) => setCoin(e.target.value)} aria-label="market">
            <option value="">All markets</option>
            {markets.data?.map((m) => (
              <option key={m.coin} value={m.coin}>
                {m.name}
              </option>
            ))}
          </select>
          <Toggle on={thesisOnly} onChange={setThesisOnly} label="Thesis" />
          {!alerts && <Toggle on={following} onChange={setFollowing} label="Following" />}
        </div>
      </div>
      {gated && <Empty title={alerts ? "Sign in to see alerts" : "Sign in to filter by following"} hint="Alerts are trades and theses from traders you follow." icon={<Icon.bell />} />}
      {!gated && q.isLoading && <Skeleton rows={8} h={64} />}
      {!gated && q.data && q.data.length === 0 && (
        <Empty
          title={alerts || following ? "Nothing from traders you follow yet" : "No trades yet"}
          hint={alerts || following ? "Follow a few traders from the leaderboard and their moves show up here." : "Positions appear here the moment a tracked trader opens or closes one on Hyperliquid."}
        />
      )}
      {!gated &&
        q.data?.map((item) => (
          <div key={item.id} className={fresh.has(item.id) ? (item.type === "SHORT" || item.type === "LIQUIDATED" ? "flash-down" : "flash-up") : ""}>
            <FeedCard item={item} mid={mids.data ? Number(mids.data[item.coin]) : undefined} onNavigate={onNavigate} signedIn={signedIn} />
          </div>
        ))}
      {!gated && q.data && q.data.length >= limit && limit < 100 && (
        <button className="btn btn-ghost w-full h-10 text-muted rounded-none" onClick={() => setLimit((l) => Math.min(100, l + 30))}>
          Load more
        </button>
      )}
    </div>
  );
}

export function Tokens({ onNavigate, full }: { onNavigate?: () => void; full?: boolean }) {
  const markets = useMarkets();
  const mids = useMids();
  const [q, setQ] = useState("");
  const list = useMemo(() => (markets.data ?? []).filter((m) => m.name.toLowerCase().includes(q.toLowerCase()) || m.coin.toLowerCase().includes(q.toLowerCase())), [markets.data, q]);
  if (markets.isLoading) return <Skeleton rows={10} h={44} />;
  return (
    <div>
      <div className="p-3 sticky top-0 bg-panel border-b border-line z-10">
        <div className="flex items-center h-9 card-2 px-2.5 gap-2">
          <span className="text-dim"><Icon.search /></span>
          <input className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-dim" placeholder="Filter markets" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <table className="w-full text-[13px]">
        <thead className="text-[11px] text-dim">
          <tr>
            <th className="text-left font-medium px-4 py-2">Market</th>
            <th className="text-right font-medium px-2 py-2">Price</th>
            <th className="text-right font-medium px-3 py-2">24h</th>
            {full && <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Volume</th>}
            {full && <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Open interest</th>}
            {full && <th className="text-right font-medium px-4 py-2 hidden md:table-cell">Funding</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((m) => {
            const px = mids.data?.[m.coin] ? Number(mids.data[m.coin]) : m.markPx;
            return (
              <tr key={m.coin} className="row-hover">
                <td className="px-4 py-2">
                  <Link href={`/m/${encodeURIComponent(m.slug)}`} onClick={onNavigate} className="flex items-center gap-2.5">
                    <CoinIcon coin={m.base} size={full ? 30 : 24} />
                    <span className="leading-tight">
                      <span className="font-semibold block">{m.coin}</span>
                      <span className="text-[11px] text-dim">{m.maxLeverage}x · perp</span>
                    </span>
                  </Link>
                </td>
                <td className="num text-right px-2 font-medium">{fmtPx(px)}</td>
                <td className={`num text-right px-3 ${m.change24h >= 0 ? "text-up" : "text-down"}`}>{m.change24h >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(m.change24h), 2, false)}</td>
                {full && <td className="num text-right px-3 text-muted hidden sm:table-cell">{fmtUsd(m.volume24h, { compact: true })}</td>}
                {full && <td className="num text-right px-3 text-muted hidden sm:table-cell">{fmtUsd(m.openInterestUsd, { compact: true })}</td>}
                {full && <td className={`num text-right px-4 hidden md:table-cell ${m.funding >= 0 ? "text-up" : "text-down"}`}>{fmtPct(m.funding, 4)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const MINI_WINDOWS = [["day", "24H"], ["week", "7D"], ["month", "30D"], ["allTime", "All"]] as const;

function MiniLeaderboard({ onNavigate }: { onNavigate?: () => void }) {
  const [src, setSrc] = useState<"hl" | "own">("hl");
  const [win, setWin] = useState<(typeof MINI_WINDOWS)[number][0]>("month");
  const hlq = useQuery({ queryKey: ["leaderboard", "hl", win, "pnl", "", false, "mini"], queryFn: () => api<HlBoard>(`/api/leaderboard/hl?window=${win}&limit=25`), refetchInterval: 60_000, placeholderData: (d) => d });
  const hl = { isLoading: hlq.isLoading, isError: hlq.isError, error: hlq.error, data: hlq.data?.rows };
  const own = useQuery({ queryKey: ["leaderboard", "pnl7d"], queryFn: () => api<{ rows: LeaderboardRow[] }>("/api/leaderboard?by=pnl7d").then((r) => r.rows), refetchInterval: 30_000 });
  const header = (
    <div className="px-4 h-9 flex items-center gap-2 text-[11px] text-dim border-b border-line">
      <span className="seg h-7">
        <button className={`seg-item h-6 px-2 ${src === "hl" ? "seg-active" : ""}`} onClick={() => setSrc("hl")}>Hyperliquid</button>
        <button className={`seg-item h-6 px-2 ${src === "own" ? "seg-active" : ""}`} onClick={() => setSrc("own")}>socialLiquid</button>
      </span>
      {src === "hl" && (
        <span className="seg h-7" data-testid="mini-windows">
          {MINI_WINDOWS.map(([w, label]) => (
            <button key={w} className={`seg-item h-6 px-1.5 ${win === w ? "seg-active" : ""}`} onClick={() => setWin(w)}>{label}</button>
          ))}
        </span>
      )}
      <Link href="/leaderboard" onClick={onNavigate} className="ml-auto hover:text-fg">Full board →</Link>
    </div>
  );
  if (src === "hl") {
    if (hl.isLoading) return <Skeleton rows={10} h={44} />;
    return (
      <div>
        {header}
        {hl.isError && <Empty title="Leaderboard unavailable" hint={(hl.error as Error).message} />}
        {!hl.isError && !hl.data?.length && <Empty title="Leaderboard unavailable" hint={hlq.data?.error ? `Hyperliquid did not answer: ${hlq.data.error}` : "Hyperliquid's leaderboard is mirrored on the first request. Refresh in a moment."} />}
        {hl.data?.map((r) => (
          <Link key={r.user.address} href={userPath(r.user)} onClick={onNavigate} className="flex items-center gap-2.5 px-4 h-12 row-hover" data-testid="mini-row">
            <span className={`num text-xs w-5 ${r.rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>{r.rank}</span>
            <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={26} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[13px] font-medium">{userLabel(r.user)}</span>
              <span className="block text-[11px] text-dim num">{fmtUsd(r.accountValue, { compact: true })} · ROI {(r.roi * 100).toFixed(1)}%</span>
            </span>
            <Pnl value={r.pnl} compact className="ml-auto text-[13px] font-semibold" />
          </Link>
        ))}
      </div>
    );
  }
  if (own.isLoading) return <Skeleton rows={10} h={44} />;
  return (
    <div>
      {header}
      {!own.data?.length && <Empty title="Nobody ranks yet" hint="Our own board needs 5 closed trades per trader on record. It fills as the indexer catches up." />}
      {own.data?.slice(0, 30).map((r) => (
        <Link key={r.user.address} href={userPath(r.user)} onClick={onNavigate} className="flex items-center gap-2.5 px-4 h-12 row-hover">
          <span className={`num text-xs w-5 ${r.rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>{r.rank}</span>
          <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={26} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-medium">{userLabel(r.user)}</span>
            <span className="block text-[11px] text-dim num">{r.stats.winRate !== null ? `${Math.round(r.stats.winRate * 100)}% win` : ""} · {r.stats.closedTrades} trades</span>
          </span>
          <Pnl value={r.stats.pnl7d} compact className="ml-auto text-[13px] font-semibold" />
        </Link>
      ))}
    </div>
  );
}
