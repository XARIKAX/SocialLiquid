"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useMarkets } from "@/hooks/use-market";
import { api } from "@/lib/client";
import type { HlBoard, HlBoardRow, LeaderboardRow, LiveState, MarketBoardRow, OwnBoardBy, UserLite } from "@/lib/queries";
import { SIZE_BUCKETS, TRADE_STYLE_LABEL, type SizeBucket, type TradeStyle } from "@/lib/board-shared";
import type { MyRank } from "@/app/api/leaderboard/me/route";
import type { PointsRow } from "@/app/api/leaderboard/points/route";
import { POINTS, POINT_LABELS } from "@/lib/points-table";
import { fmtDuration, fmtPct, fmtUsd, userLabel, userPath } from "@/lib/format";
import { Avatar, CoinIcon, Empty, Icon, Pnl, Skeleton, Toggle } from "../ui";
import { HL_APP_URL } from "@/lib/env";

const BY = [
  { key: "hl", label: "Hyperliquid" },
  { key: "follow", label: "Best to follow" },
  { key: "rising", label: "Rising" },
  { key: "market", label: "By market" },
  { key: "own", label: "socialLiquid" },
  { key: "points", label: "Points" },
] as const;

type Key = (typeof BY)[number]["key"];

const BLURB: Record<Key, string> = {
  hl: "Hyperliquid's own ranking · 24h, 7d, 30d and all-time windows · refreshed hourly",
  follow: "Ranked by what the people who copied them made · the only board that measures following, not trading",
  rising: "Biggest climbs since the last hourly refresh · new names first",
  market: "Who makes money on one market · realised pnl from closed positions",
  own: "Traders we track, from on-chain fills · minimum 5 closed trades",
  points: "socialLiquid points · trades, theses, copies and invites · claimed accounts only",
};

export function LeaderboardTable() {
  const [by, setBy] = useState<Key>("hl");
  const [copyable, setCopyable] = useState(true);
  const [size, setSize] = useState<SizeBucket | "">("");
  const { signedIn } = useAuth();
  const f = { copyable, size: size || undefined };
  return (
    <div className="space-y-3 pb-3 max-w-7xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-[22px] font-semibold tracking-tight mr-2">Leaderboard</h1>
        <span className="seg" data-testid="lb-tabs">
          {BY.map((b) => (
            <button key={b.key} className={`seg-item h-8 ${by === b.key ? "seg-active" : ""}`} onClick={() => setBy(b.key)} data-testid={`lb-tab-${b.key}`}>{b.label}</button>
          ))}
        </span>
        <span className="ml-auto text-xs text-dim">{BLURB[by]}</span>
      </div>
      {signedIn && <MyRankCard />}
      {by !== "points" && (
        <div className="flex items-center gap-3 flex-wrap text-xs" data-testid="lb-filters">
          <Toggle on={copyable} onChange={setCopyable} label="Copyable only" />
          <span className="text-dim -ml-1" title="hides market makers and bots: accounts holding under two minutes on average or closing over 700 trades a week">(no bots)</span>
          <label className="inline-flex items-center gap-1.5 text-muted">
            Account size
            <select className="input h-8 text-xs w-40" value={size} onChange={(e) => setSize(e.target.value as SizeBucket | "")} aria-label="account size" data-testid="lb-size">
              <option value="">any</option>
              {SIZE_BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </label>
          <ShareButton />
        </div>
      )}
      {by === "hl" && <HlBoard mode="board" {...f} />}
      {by === "rising" && <HlBoard mode="rising" {...f} />}
      {by === "follow" && <OwnBoard preset="follow" {...f} />}
      {by === "own" && <OwnBoard preset="own" {...f} />}
      {by === "market" && <MarketBoard {...f} />}
      {by === "points" && <PointsBoard />}
    </div>
  );
}

const fmtMoney = (n: number) => fmtUsd(n);
const fmtRoi = (n: number) => `${(n * 100).toFixed(2)}%`;

const WINDOWS = [["day", "24H"], ["week", "7D"], ["month", "30D"], ["allTime", "All time"]] as const;
type Win = (typeof WINDOWS)[number][0];
type Sort = "pnl" | "roi" | "vlm" | "accountValue" | "movers" | "copiersPnl" | "copiers" | "drawdown" | "consistency" | "pnlPerVlm";
const WIN_LABEL: Record<Win, string> = { day: "24H", week: "7D", month: "30D", allTime: "All" };
const EXTRA_SORTS: [Sort, string][] = [["copiersPnl", "Copiers' PnL"], ["copiers", "Copiers"], ["drawdown", "Smallest drawdown"], ["consistency", "Consistency"], ["pnlPerVlm", "PnL per $ traded"]];

// ---------- shared cells ----------

/** follow / unfollow straight from a board row */
function FollowButton({ row, onChange }: { row: { user: UserLite; isFollowing: boolean }; onChange: (next: boolean) => void }) {
  const { signedIn, address } = useAuth();
  const [busy, setBusy] = useState(false);
  if (address && row.user.address === address.toLowerCase()) return <span className="text-[11px] text-dim">you</span>;
  const toggle = async () => {
    if (!signedIn || busy) return;
    setBusy(true);
    try {
      await api("/api/follow", { method: "POST", json: { address: row.user.address, follow: !row.isFollowing } });
      onChange(!row.isFollowing);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`btn btn-sm h-7 px-2.5 text-[11px] ${row.isFollowing ? "" : "bg-thesis border-thesis text-white hover:brightness-110"}`} onClick={toggle} disabled={!signedIn || busy} title={signedIn ? "" : "sign in to follow"} data-testid={`follow-${row.user.address}`}>
      {row.isFollowing ? "Following" : "Follow"}
    </button>
  );
}

function RankCell({ rank, delta, isNew }: { rank: number; delta?: number | null; isNew?: boolean }) {
  return (
    <td className={`num px-4 py-2.5 whitespace-nowrap ${rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>
      {rank}
      {isNew ? <span className="ml-1.5 pill pill-brand text-[10px]" title="new in the pool since the last refresh">new</span>
        : delta === null || delta === undefined || delta === 0 ? null
        : <span className={`ml-1.5 text-[11px] ${delta > 0 ? "text-up" : "text-down"}`} title={`${Math.abs(delta)} place${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "up" : "down"} since the last refresh`} data-testid="rank-delta">{delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>}
    </td>
  );
}

function TraderCell({ user, style, streak, claimedPill = true }: { user: UserLite; style?: TradeStyle; streak?: number; claimedPill?: boolean }) {
  return (
    <td className="px-3 py-2.5">
      <span className="flex items-center gap-2.5 flex-wrap">
        <Link href={userPath(user)} className="flex items-center gap-2.5 hover:underline underline-offset-2">
          <Avatar address={user.address} url={user.avatarUrl} handle={user.handle ?? user.displayName} size={28} />
          <span className="font-medium">{userLabel(user)}</span>
        </Link>
        {claimedPill && (user.claimed ? <span className="pill pill-up" title="claimed on socialLiquid: posts theses, can be copied with attribution">socialLiquid</span> : <span className="pill pill-neutral">Unclaimed</span>)}
        {style && style !== "bot" && <span className="pill pill-neutral hidden lg:inline-flex" title="from average hold time">{TRADE_STYLE_LABEL[style]}</span>}
        {style === "bot" && <span className="pill pill-warn" title="holds under two minutes on average or closes hundreds of trades a day: a market maker or bot, not something to copy by hand" data-testid="bot-tag">bot</span>}
        {(streak ?? 0) >= 3 && <span className="pill pill-warn num" title={`${streak} winning trades in a row`}>🔥 {streak}</span>}
      </span>
    </td>
  );
}

const copyHref = (live: NonNullable<LiveState>, user: UserLite) => `/m/${encodeURIComponent(live.coin)}?${new URLSearchParams({ copy: live.positionId, from: user.address, side: live.side, lev: String(live.leverage), name: userLabel(user) })}`;

/** what the trader is in right now, with a Copy that prefills the ticket */
function LiveCell({ live, user }: { live: LiveState; user: UserLite }) {
  if (!live) return <td className="px-3 text-[11px] text-dim whitespace-nowrap">flat</td>;
  return (
    <td className="px-3 whitespace-nowrap" data-testid="live-cell">
      <span className="inline-flex items-center gap-1.5">
        <span className="live-dot w-1.5 h-1.5 rounded-full bg-up inline-block" />
        <CoinIcon coin={live.coin.replace(/^[a-z]+:/, "")} size={16} />
        <span className={`num text-[12px] font-semibold ${live.side === "LONG" ? "text-up" : "text-down"}`}>{live.side === "LONG" ? "Long" : "Short"} {live.coin}</span>
        <span className="num text-[11px] text-muted">{fmtUsd(live.sizeUsd, { compact: true })}{live.count > 1 ? ` +${live.count - 1}` : ""}</span>
        <Link href={copyHref(live, user)} className="btn btn-sm h-6 px-2 text-[11px] inline-flex items-center gap-1" data-testid="row-copy"><Icon.copy /> Copy</Link>
      </span>
    </td>
  );
}

function ShareButton() {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn h-8 px-3 text-xs ml-auto inline-flex items-center gap-1.5"
      onClick={async () => {
        const url = `${location.origin}/leaderboard`;
        const text = "This week's top traders on Hyperliquid, with a copy button next to each one.";
        try {
          if (navigator.share) await navigator.share({ url, text });
          else await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
      title="share this week's board (the link unfurls to the top 10)"
      data-testid="lb-share"
    >
      <Icon.share /> {done ? "Copied" : "Share this week"}
    </button>
  );
}

/** follow the first ten of whatever board is showing, skipping anyone already followed */
function FollowTopButton({ rows, onDone }: { rows: { user: UserLite; isFollowing: boolean }[]; onDone: () => void }) {
  const { signedIn, address } = useAuth();
  const [busy, setBusy] = useState(false);
  const targets = rows.filter((r) => !r.isFollowing && r.user.address !== address?.toLowerCase()).slice(0, 10).map((r) => r.user.address);
  if (!rows.length) return null;
  return (
    <button
      className="btn btn-primary h-8 px-3 text-xs"
      disabled={!signedIn || busy || !targets.length}
      title={!signedIn ? "sign in to follow" : !targets.length ? "you already follow the top 10" : `follow ${targets.length} trader${targets.length === 1 ? "" : "s"}`}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/follow/bulk", { method: "POST", json: { addresses: targets } });
          onDone();
        } finally {
          setBusy(false);
        }
      }}
      data-testid="follow-top"
    >
      {busy ? "Following…" : targets.length ? `Follow top ${targets.length}` : "Following the top 10"}
    </button>
  );
}

/** the signed-in user's own standing */
function MyRankCard() {
  const q = useQuery({ queryKey: ["leaderboard", "me"], queryFn: () => api<{ me: MyRank | null }>("/api/leaderboard/me").then((r) => r.me), refetchInterval: 60_000 });
  const m = q.data;
  if (!m) return null;
  return (
    <div className="card px-4 py-2.5 flex items-center gap-5 flex-wrap text-[12.5px]" data-testid="my-rank">
      <span className="text-[11px] text-muted uppercase tracking-wide">You</span>
      {m.points ? (
        <span>Points <b className="num">#{m.points.rank}</b> <span className="text-muted num">· {m.points.total} pts{m.points.gap !== null ? ` · ${m.points.gap} to pass ${m.points.above?.handle ? `@${m.points.above.handle}` : "the next place"}` : " · top of the board"}</span></span>
      ) : (
        <span className="text-muted">No points yet. Close a trade or post a thesis to get on the board.</span>
      )}
      <span>
        7d PnL {m.pnl7d.rank ? <b className="num">#{m.pnl7d.rank}</b> : <span className="text-muted">unranked</span>} <span className="text-muted num">of {m.pnl7d.of}{m.pnl7d.gap !== null ? ` · ${fmtUsd(m.pnl7d.gap, { compact: true })} to the next place` : m.pnl7d.rank === 1 ? " · you lead" : ""}</span>
      </span>
      {m.hl && (
        <span>Hyperliquid 30d <b className="num">#{m.hl.rank}</b>{m.hl.delta !== null && m.hl.delta !== 0 && <span className={`num ml-1 ${m.hl.delta > 0 ? "text-up" : "text-down"}`}>{m.hl.delta > 0 ? "▲" : "▼"}{Math.abs(m.hl.delta)}</span>}</span>
      )}
    </div>
  );
}

// ---------- hyperliquid board (also the Rising view) ----------

function HlBoard({ mode, copyable, size }: { mode: "board" | "rising"; copyable: boolean; size?: SizeBucket }) {
  const [win, setWin] = useState<Win>(mode === "rising" ? "day" : "month");
  const [sort, setSort] = useState<Sort>("pnl");
  const [q, setQ] = useState("");
  const [claimed, setClaimed] = useState(false);
  const qc = useQueryClient();
  const effSort: Sort = mode === "rising" ? "movers" : sort;
  const key = ["leaderboard", "hl", win, effSort, q, claimed, copyable, size ?? ""];
  const board = useQuery({ queryKey: key, queryFn: () => api<HlBoard>(`/api/leaderboard/hl?window=${win}&sort=${effSort}&limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}${claimed ? "&claimed=1" : ""}${copyable ? "&copyable=1" : ""}${size ? `&size=${size}` : ""}`), refetchInterval: 60_000, placeholderData: (d) => d });
  const rows = board.data?.rows ?? [];
  const top3 = !q && !claimed && mode === "board" ? rows.slice(0, 3) : [];
  const updated = board.data?.updatedAt ? new Date(board.data.updatedAt) : null;
  const setFollow = (addr: string, next: boolean) =>
    qc.setQueriesData<HlBoard>({ queryKey: ["leaderboard", "hl"] }, (d) => (d ? { ...d, rows: d.rows.map((r) => (r.user.address === addr ? { ...r, isFollowing: next, followers: Math.max(0, r.followers + (next ? 1 : -1)) } : r)) } : d));
  const refetchAll = () => qc.invalidateQueries({ queryKey: ["leaderboard"] });
  const Th = ({ k, children, right = true, title }: { k?: Sort; children: React.ReactNode; right?: boolean; title?: string }) => (
    <th title={title} className={`${right ? "text-right" : "text-left"} font-medium px-3 py-2.5 whitespace-nowrap ${k && mode === "board" ? "cursor-pointer select-none hover:text-fg" : ""} ${k && effSort === k ? "text-fg" : ""}`} onClick={k && mode === "board" ? () => setSort(k) : undefined} aria-sort={k && effSort === k ? "descending" : undefined}>
      {children}
      {k && effSort === k && <span className="text-brand ml-1">↓</span>}
    </th>
  );
  const extra = EXTRA_SORTS.some(([k]) => k === sort);
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="seg" data-testid="hl-windows">
          {WINDOWS.map(([w, label]) => (
            <button key={w} className={`seg-item h-8 ${win === w ? "seg-active" : ""}`} onClick={() => setWin(w)}>{label}</button>
          ))}
        </span>
        <input className="input h-8 w-52 text-[13px]" placeholder="Search trader or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search traders" />
        <Toggle on={claimed} onChange={setClaimed} label="On socialLiquid" />
        {mode === "board" && (
          <select className="input h-8 text-xs w-44" value={extra ? sort : ""} onChange={(e) => setSort((e.target.value || "pnl") as Sort)} aria-label="more rankings" data-testid="hl-extra-sort">
            <option value="">Rank by… (PnL)</option>
            {EXTRA_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
        <FollowTopButton rows={rows} onDone={refetchAll} />
        <span className="ml-auto text-xs text-dim num">{board.data ? `${board.data.total} traders${mode === "rising" ? " climbing" : " in the pool"}` : ""}</span>
      </div>
      {top3.length === 3 && (
        <div className="grid grid-cols-3 gap-3">
          {top3.map((r) => (
            <Link key={r.user.address} href={userPath(r.user)} className="card p-4 flex items-center gap-3 hover:bg-panel-2 transition-colors">
              <span className={`num text-2xl font-semibold ${r.rank === 1 ? "text-warn" : r.rank === 2 ? "text-fg-2" : "text-[#cd7f32]"}`}>#{r.rank}</span>
              <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={40} />
              <span className="min-w-0 leading-tight">
                <span className="block font-semibold truncate">{userLabel(r.user)}</span>
                <span className="block text-[11px] text-muted num">{fmtMoney(r.accountValue)} · ROI {fmtRoi(r.roi)}{r.live ? ` · in ${r.live.coin}` : ""}</span>
              </span>
              <Pnl value={r.pnl} compact className="ml-auto text-[15px] font-semibold" />
            </Link>
          ))}
        </div>
      )}
      {board.data?.note && (
        <div className="card px-4 py-2.5 text-xs text-warn flex items-center gap-2" data-testid="hl-fallback">
          <Icon.bell /> {board.data.note}
        </div>
      )}
      <section className="card overflow-hidden">
        {board.isLoading && <Skeleton rows={10} h={48} />}
        {board.isError && <Empty title="Leaderboard unavailable" hint={(board.error as Error).message} />}
        {board.data && rows.length === 0 && <Empty title={mode === "rising" ? "Nobody has moved yet" : q || claimed || size ? "No traders match" : "Leaderboard unavailable"} hint={mode === "rising" ? "Movers appear once the board has refreshed twice, about an hour after the first mirror." : q || claimed || size ? "Try another name, or loosen the filters." : board.data.error ? `Hyperliquid did not answer: ${board.data.error}` : "Hyperliquid's leaderboard is mirrored on the first request and refreshed hourly. Refresh in a moment."} />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[1180px]" data-testid="hl-board">
              <thead className="text-[11px] text-dim">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2.5 w-20">Rank</th>
                  <Th right={false}>Trader</Th>
                  <Th right={false}>Live</Th>
                  <Th k="accountValue">Account Value</Th>
                  <Th k="pnl">PNL ({WIN_LABEL[win]})</Th>
                  <Th k="roi">ROI ({WIN_LABEL[win]})</Th>
                  <Th k="vlm">Volume ({WIN_LABEL[win]})</Th>
                  <Th k="drawdown" title="deepest fall of realised pnl from its peak, from the positions we track">Drawdown</Th>
                  <Th k="consistency" title="share of trading weeks that ended positive">Weeks +</Th>
                  <Th k="copiersPnl" title="distinct traders who copied this account · what their copies made">Copiers</Th>
                  <th className="text-right font-medium px-3 py-2.5">Followers</th>
                  <th className="text-right font-medium px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user.address} className="border-b border-line/60 row-hover" data-testid={`hl-row-${r.user.address}`}>
                    <RankCell rank={r.rank} delta={r.delta} isNew={r.isNew} />
                    <TraderCell user={r.user} style={r.style} streak={r.streak} />
                    <LiveCell live={r.live} user={r.user} />
                    <td className="num text-right px-3">{fmtMoney(r.accountValue)}</td>
                    <td className="num text-right px-3"><Pnl value={r.pnl} className="font-semibold" /></td>
                    <td className={`num text-right px-3 ${r.roi >= 0 ? "text-up" : "text-down"}`}>{fmtRoi(r.roi)}</td>
                    <td className="num text-right px-3 text-muted">{fmtMoney(r.vlm)}</td>
                    <td className="num text-right px-3 text-muted">{r.stats.closedTrades >= 10 ? fmtUsd(-r.stats.maxDrawdown, { compact: true }) : "–"}</td>
                    <td className="num text-right px-3 text-muted">{r.stats.consistency === null ? "–" : fmtPct(r.stats.consistency, 0, false)}</td>
                    <td className="num text-right px-3">{r.stats.copiers ? <span>{r.stats.copiers} · <Pnl value={r.stats.copiersPnl} compact /></span> : <span className="text-dim">–</span>}</td>
                    <td className="num text-right px-3 text-muted">{r.followers}</td>
                    <td className="text-right px-4"><FollowButton row={r} onChange={(n) => setFollow(r.user.address, n)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 text-[11px] text-dim border-t border-line">
            <span>
              {board.data?.source === "portfolio"
                ? "Built from Hyperliquid's portfolio API for the featured traders: PNL and volume are exact, ROI = PNL / account value at the start of the window."
                : "Hyperliquid's figures. Excludes accounts with less than 100k USDC account value and less than 10M USDC trading volume. Drawdown, weeks, copiers, live positions and the bot tag come from the positions socialLiquid tracks."}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              {updated && <span suppressHydrationWarning>Updated {updated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>}
              <a href={`${HL_APP_URL}/leaderboard`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Source: Hyperliquid <Icon.external /></a>
            </span>
          </div>
        )}
      </section>
    </>
  );
}

// ---------- socialLiquid's own board (also Best to follow) ----------

const OWN_SORTS: [OwnBoardBy, string][] = [["pnl7d", "7d PnL"], ["pnl30d", "30d PnL"], ["pnlAll", "All-time PnL"], ["winRate", "Win rate"], ["drawdown", "Smallest drawdown"], ["consistency", "Consistency"], ["thesisAccuracy", "Thesis accuracy"], ["followers", "Followers"]];

function OwnBoard({ preset, copyable, size }: { preset: "own" | "follow"; copyable: boolean; size?: SizeBucket }) {
  const [by, setBy] = useState<OwnBoardBy>(preset === "follow" ? "copiersPnl" : "pnl7d");
  const qc = useQueryClient();
  const key = ["leaderboard", "own", by, copyable, size ?? ""];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ rows: LeaderboardRow[] }>(`/api/leaderboard?by=${by}&limit=100${copyable ? "&copyable=1" : ""}${size ? `&size=${size}` : ""}`).then((r) => r.rows), refetchInterval: 30_000, placeholderData: (d) => d });
  const rows = q.data ?? [];
  const top3 = rows.slice(0, 3);
  const setFollow = (addr: string, next: boolean) => qc.setQueriesData<LeaderboardRow[]>({ queryKey: ["leaderboard", "own"] }, (d) => d?.map((r) => (r.user.address === addr ? { ...r, isFollowing: next, followers: Math.max(0, r.followers + (next ? 1 : -1)) } : r)));
  const refetchAll = () => qc.invalidateQueries({ queryKey: ["leaderboard"] });
  const follow = preset === "follow";
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {follow ? (
          <span className="seg">
            <button className={`seg-item h-8 ${by === "copiersPnl" ? "seg-active" : ""}`} onClick={() => setBy("copiersPnl")}>Copiers' PnL</button>
            <button className={`seg-item h-8 ${by === "copiers" ? "seg-active" : ""}`} onClick={() => setBy("copiers")}>Most copied</button>
          </span>
        ) : (
          <select className="input h-8 text-xs w-44" value={by} onChange={(e) => setBy(e.target.value as OwnBoardBy)} aria-label="rank by" data-testid="own-sort">
            {OWN_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
        <FollowTopButton rows={rows} onDone={refetchAll} />
        <span className="ml-auto text-xs text-dim num">{rows.length ? `${rows.length} traders` : ""}</span>
      </div>
      {top3.length === 3 && (
        <div className="grid grid-cols-3 gap-3">
          {top3.map((r) => (
            <Link key={r.user.address} href={userPath(r.user)} className="card p-4 flex items-center gap-3 hover:bg-panel-2 transition-colors">
              <span className={`num text-2xl font-semibold ${r.rank === 1 ? "text-warn" : r.rank === 2 ? "text-fg-2" : "text-[#cd7f32]"}`}>#{r.rank}</span>
              <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={40} />
              <span className="min-w-0 leading-tight">
                <span className="block font-semibold truncate">{userLabel(r.user)}</span>
                <span className="block text-[11px] text-muted">{follow ? `${r.stats.copiers} copier${r.stats.copiers === 1 ? "" : "s"} · ${r.stats.copyTrades} copies` : `${r.stats.winRate !== null ? `${Math.round(r.stats.winRate * 100)}% win` : "–"} · ${r.stats.closedTrades} trades`}</span>
              </span>
              <Pnl value={follow ? r.stats.copiersPnl : r.stats.pnl7d} compact className="ml-auto text-[15px] font-semibold" />
            </Link>
          ))}
        </div>
      )}
      <section className="card overflow-hidden">
        {q.isLoading && <Skeleton rows={12} h={48} />}
        {q.data?.length === 0 && <Empty title={follow ? "Nobody has been copied yet" : "Nobody ranks yet"} hint={follow ? "When someone copies a trade with the Copy button, the trader they copied appears here, ranked by what the copies made." : "Traders need 5 closed trades indexed. Loosen the filters or wait for the indexer to catch up."} />}
        {!!q.data?.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[1100px]" data-testid={follow ? "follow-board" : "own-board"}>
              <thead className="text-[11px] text-dim">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2.5 w-12">#</th>
                  <th className="text-left font-medium px-3 py-2.5">Trader</th>
                  <th className="text-left font-medium px-3 py-2.5">Live</th>
                  {follow && <th className="text-right font-medium px-3 py-2.5" title="distinct traders who copied them">Copiers</th>}
                  {follow && <th className="text-right font-medium px-3 py-2.5" title="what every copy of their trades made, open and closed">Copiers' PnL</th>}
                  <th className="text-right font-medium px-3 py-2.5">Account</th>
                  <th className="text-right font-medium px-3 py-2.5">7d PnL</th>
                  <th className="text-right font-medium px-3 py-2.5">30d PnL</th>
                  <th className="text-right font-medium px-3 py-2.5">Win rate</th>
                  <th className="text-right font-medium px-3 py-2.5">Trades</th>
                  <th className="text-right font-medium px-3 py-2.5" title="deepest fall of realised pnl from its peak">Drawdown</th>
                  <th className="text-right font-medium px-3 py-2.5" title="share of trading weeks that ended positive">Weeks +</th>
                  <th className="text-right font-medium px-3 py-2.5">Avg hold</th>
                  {!follow && <th className="text-right font-medium px-3 py-2.5">Thesis acc.</th>}
                  <th className="text-right font-medium px-3 py-2.5">Followers</th>
                  <th className="text-right font-medium px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user.address} className="border-b border-line/60 row-hover" data-testid={`own-row-${r.user.address}`}>
                    <RankCell rank={r.rank} />
                    <TraderCell user={r.user} style={r.style} streak={r.streak} />
                    <LiveCell live={r.live} user={r.user} />
                    {follow && <td className="num text-right px-3 font-semibold">{r.stats.copiers}</td>}
                    {follow && <td className="text-right px-3"><Pnl value={r.stats.copiersPnl} compact className="font-semibold" /></td>}
                    <td className="num text-right px-3 text-muted">{r.accountValue === null ? "–" : fmtUsd(r.accountValue, { compact: true })}</td>
                    <td className="text-right px-3"><Pnl value={r.stats.pnl7d} compact className={follow ? "" : "font-semibold"} /></td>
                    <td className="text-right px-3"><Pnl value={r.stats.pnl30d} compact /></td>
                    <td className="num text-right px-3">{r.stats.winRate === null ? "–" : fmtPct(r.stats.winRate, 0, false)}</td>
                    <td className="num text-right px-3 text-muted">{r.stats.closedTrades}</td>
                    <td className="num text-right px-3 text-muted">{r.stats.closedTrades >= 10 ? fmtUsd(-r.stats.maxDrawdown, { compact: true }) : "–"}</td>
                    <td className="num text-right px-3 text-muted">{r.stats.consistency === null ? "–" : fmtPct(r.stats.consistency, 0, false)}</td>
                    <td className="num text-right px-3 text-muted">{r.stats.avgHoldMs ? fmtDuration(r.stats.avgHoldMs) : "–"}</td>
                    {!follow && <td className="num text-right px-3">{r.stats.thesisAccuracy === null ? "–" : fmtPct(r.stats.thesisAccuracy, 0, false)}</td>}
                    <td className="num text-right px-3 text-muted">{r.followers}</td>
                    <td className="text-right px-4"><FollowButton row={r} onChange={(n) => setFollow(r.user.address, n)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------- by market ----------

const MARKET_WINDOWS = [["7d", "7D"], ["30d", "30D"], ["all", "All time"]] as const;

function MarketBoard({ copyable }: { copyable: boolean; size?: SizeBucket }) {
  const markets = useMarkets();
  const [coin, setCoin] = useState("BTC");
  const [win, setWin] = useState<(typeof MARKET_WINDOWS)[number][0]>("30d");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["leaderboard", "market", coin, win], queryFn: () => api<{ rows: MarketBoardRow[] }>(`/api/leaderboard/market?coin=${encodeURIComponent(coin)}&window=${win}`).then((r) => r.rows), refetchInterval: 60_000, placeholderData: (d) => d, enabled: !!coin });
  const rows = useMemo(() => (q.data ?? []).filter((r) => !copyable || r.style !== "bot"), [q.data, copyable]);
  const options = useMemo(() => (markets.data ?? []).filter((m) => m.kind === "perp").map((m) => m.coin).sort(), [markets.data]);
  const setFollow = (addr: string, next: boolean) => qc.setQueriesData<MarketBoardRow[]>({ queryKey: ["leaderboard", "market"] }, (d) => d?.map((r) => (r.user.address === addr ? { ...r, isFollowing: next, followers: Math.max(0, r.followers + (next ? 1 : -1)) } : r)));
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-2">
          <CoinIcon coin={coin.replace(/^[a-z]+:/, "")} size={22} />
          <input className="input h-8 w-36 text-[13px] uppercase" list="lb-coins" value={coin} onChange={(e) => setCoin(e.target.value.toUpperCase())} aria-label="market" data-testid="market-coin" />
          <datalist id="lb-coins">{options.map((c) => <option key={c} value={c} />)}</datalist>
        </span>
        <span className="seg">
          {MARKET_WINDOWS.map(([w, label]) => (
            <button key={w} className={`seg-item h-8 ${win === w ? "seg-active" : ""}`} onClick={() => setWin(w)}>{label}</button>
          ))}
        </span>
        <span className="flex gap-1">
          {["BTC", "ETH", "SOL", "HYPE"].map((c) => <button key={c} className={`pill ${coin === c ? "pill-brand" : "pill-neutral"} hover:border-brand/50`} onClick={() => setCoin(c)}>{c}</button>)}
        </span>
        <FollowTopButton rows={rows} onDone={() => qc.invalidateQueries({ queryKey: ["leaderboard"] })} />
        <span className="ml-auto text-xs text-dim num">{rows.length ? `${rows.length} profitable on ${coin}` : ""}</span>
      </div>
      <section className="card overflow-hidden">
        {q.isLoading && <Skeleton rows={8} h={48} />}
        {q.data && rows.length === 0 && <Empty title={`Nobody we track has made money on ${coin} in this window`} hint="Try a longer window or another market." />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[900px]" data-testid="market-board">
              <thead className="text-[11px] text-dim">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2.5 w-12">#</th>
                  <th className="text-left font-medium px-3 py-2.5">Trader</th>
                  <th className="text-left font-medium px-3 py-2.5">Live</th>
                  <th className="text-right font-medium px-3 py-2.5">PnL on {coin}</th>
                  <th className="text-right font-medium px-3 py-2.5">Trades</th>
                  <th className="text-right font-medium px-3 py-2.5">Win rate</th>
                  <th className="text-right font-medium px-3 py-2.5">Copiers</th>
                  <th className="text-right font-medium px-3 py-2.5">Followers</th>
                  <th className="text-right font-medium px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.user.address} className="border-b border-line/60 row-hover" data-testid={`market-row-${r.user.address}`}>
                    <RankCell rank={i + 1} />
                    <TraderCell user={r.user} style={r.style} streak={r.streak} />
                    <LiveCell live={r.live} user={r.user} />
                    <td className="text-right px-3"><Pnl value={r.pnl} compact className="font-semibold" /></td>
                    <td className="num text-right px-3 text-muted">{r.trades}</td>
                    <td className="num text-right px-3">{r.winRate === null ? "–" : fmtPct(r.winRate, 0, false)}</td>
                    <td className="num text-right px-3 text-muted">{r.copiers || "–"}</td>
                    <td className="num text-right px-3 text-muted">{r.followers}</td>
                    <td className="text-right px-4"><FollowButton row={r} onChange={(n) => setFollow(r.user.address, n)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** the points board: all time or this week, with streaks and a "how points work" key */
function PointsBoard() {
  const [window, setWindow] = useState<"all" | "7d">("all");
  const [showKey, setShowKey] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["leaderboard", "points", window], queryFn: () => api<{ rows: PointsRow[] }>(`/api/leaderboard/points?window=${window}`).then((r) => r.rows), refetchInterval: 30_000 });
  const setFollowing = (address: string, next: boolean) => qc.setQueryData<PointsRow[]>(["leaderboard", "points", window], (rows) => rows?.map((r) => (r.user.address === address ? { ...r, isFollowing: next, followers: r.followers + (next ? 1 : -1) } : r)));
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="seg">
          <button className={`seg-item h-8 ${window === "all" ? "seg-active" : ""}`} onClick={() => setWindow("all")}>All time</button>
          <button className={`seg-item h-8 ${window === "7d" ? "seg-active" : ""}`} onClick={() => setWindow("7d")}>This week</button>
        </span>
        <button className="btn btn-ghost h-8 px-2 text-xs ml-auto" onClick={() => setShowKey((v) => !v)} data-testid="points-key-toggle">{showKey ? "Hide" : "How points work"}</button>
      </div>
      {showKey && (
        <div className="card p-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-[12px]" data-testid="points-key">
          {(Object.keys(POINTS) as (keyof typeof POINTS)[]).map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 py-0.5 border-b border-line/60">
              <span className="text-muted">{POINT_LABELS[k]}</span>
              <span className="num text-brand">+{POINTS[k]}</span>
            </div>
          ))}
        </div>
      )}
      <section className="card overflow-hidden">
        {q.isLoading && <Skeleton rows={12} h={48} />}
        {q.data?.length === 0 && <Empty title="No points yet" hint="Close a trade, post a thesis or get copied to get on the board." />}
        {!!q.data?.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[720px]" data-testid="points-board">
              <thead className="text-[11px] text-dim">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2.5 w-12">#</th>
                  <th className="text-left font-medium px-3 py-2.5">Trader</th>
                  <th className="text-right font-medium px-3 py-2.5">{window === "7d" ? "Points · 7d" : "Points"}</th>
                  <th className="text-right font-medium px-3 py-2.5">{window === "7d" ? "All time" : "This week"}</th>
                  <th className="text-right font-medium px-3 py-2.5">Streak</th>
                  <th className="text-right font-medium px-3 py-2.5">Win rate</th>
                  <th className="text-right font-medium px-3 py-2.5">Trades</th>
                  <th className="text-right font-medium px-3 py-2.5">Followers</th>
                  <th className="px-4 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.user.address} className="border-b border-line/60 row-hover" data-testid={`points-row-${r.user.address}`}>
                    <td className={`num px-4 py-2.5 ${r.rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>{r.rank}</td>
                    <td className="px-3 py-2.5">
                      <Link href={userPath(r.user)} className="flex items-center gap-2.5 hover:underline underline-offset-2">
                        <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={28} />
                        <span className="font-medium">{userLabel(r.user)}</span>
                        {r.user.style && <span className="pill pill-neutral hidden md:inline-flex">{r.user.style}</span>}
                      </Link>
                    </td>
                    <td className="num text-right px-3 font-semibold">{window === "7d" ? r.weekPoints : r.points}</td>
                    <td className="num text-right px-3 text-muted">{window === "7d" ? r.points : r.weekPoints}</td>
                    <td className="num text-right px-3">{r.streak >= 2 ? <span className="text-warn">🔥 {r.streak}</span> : <span className="text-dim">–</span>}{r.bestStreak >= 2 && <span className="text-dim text-[11px]"> · best {r.bestStreak}</span>}</td>
                    <td className="num text-right px-3">{r.winRate === null ? "–" : fmtPct(r.winRate, 0, false)}</td>
                    <td className="num text-right px-3 text-muted">{r.closedTrades}</td>
                    <td className="num text-right px-3 text-muted">{r.followers}</td>
                    <td className="px-4 text-right"><FollowButton row={{ user: r.user, isFollowing: r.isFollowing } as HlBoardRow} onChange={(next) => setFollowing(r.user.address, next)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
