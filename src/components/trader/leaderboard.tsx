"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import type { HlBoard, HlBoardRow, LeaderboardRow } from "@/lib/queries";
import type { PointsRow } from "@/app/api/leaderboard/points/route";
import { POINTS, POINT_LABELS } from "@/lib/points-table";
import { fmtDuration, fmtPct, fmtUsd, userLabel, userPath } from "@/lib/format";
import { Avatar, Empty, Icon, Pnl, Skeleton, Toggle } from "../ui";
import { HL_APP_URL } from "@/lib/env";

const BY = [
  { key: "hl", label: "Hyperliquid" },
  { key: "points", label: "Points" },
  { key: "pnl7d", label: "7d PnL" },
  { key: "winRate", label: "Win rate" },
  { key: "thesisAccuracy", label: "Thesis accuracy" },
  { key: "followers", label: "Followers" },
] as const;

type Key = (typeof BY)[number]["key"];

export function LeaderboardTable() {
  const [by, setBy] = useState<Key>("hl");
  return (
    <div className="space-y-3 pb-3 max-w-6xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-[22px] font-semibold tracking-tight mr-2">Leaderboard</h1>
        <span className="seg">
          {BY.map((b) => (
            <button key={b.key} className={`seg-item h-8 ${by === b.key ? "seg-active" : ""}`} onClick={() => setBy(b.key)}>{b.label}</button>
          ))}
        </span>
        <span className="ml-auto text-xs text-dim">
          {by === "hl" ? "Hyperliquid's own ranking · 24h, 7d, 30d and all-time windows · refreshed hourly" : by === "points" ? "socialLiquid points · trades, theses, copies and invites · claimed accounts only" : "Minimum 5 closed trades to rank · computed from on-chain fills"}
        </span>
      </div>
      {by === "hl" ? <HlBoard /> : by === "points" ? <PointsBoard /> : <OwnBoard by={by} />}
    </div>
  );
}

const fmtMoney = (n: number) => fmtUsd(n);
const fmtRoi = (n: number) => `${(n * 100).toFixed(2)}%`;

const WINDOWS = [["day", "24H"], ["week", "7D"], ["month", "30D"], ["allTime", "All time"]] as const;
type Win = (typeof WINDOWS)[number][0];
type Sort = "pnl" | "roi" | "vlm" | "accountValue";
const WIN_LABEL: Record<Win, string> = { day: "24H", week: "7D", month: "30D", allTime: "All" };

/** follow / unfollow straight from a board row */
function FollowButton({ row, onChange }: { row: HlBoardRow; onChange: (next: boolean) => void }) {
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

/** mirror of app.hyperliquid.xyz/leaderboard: every window, hyperliquid's figures, sortable, searchable, follow in place */
function HlBoard() {
  const [win, setWin] = useState<Win>("month");
  const [sort, setSort] = useState<Sort>("pnl");
  const [q, setQ] = useState("");
  const [claimed, setClaimed] = useState(false);
  const qc = useQueryClient();
  const key = ["leaderboard", "hl", win, sort, q, claimed];
  const board = useQuery({ queryKey: key, queryFn: () => api<HlBoard>(`/api/leaderboard/hl?window=${win}&sort=${sort}&limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}${claimed ? "&claimed=1" : ""}`), refetchInterval: 60_000, placeholderData: (d) => d });
  const rows = board.data?.rows ?? [];
  const top3 = !q && !claimed ? rows.slice(0, 3) : [];
  const updated = board.data?.updatedAt ? new Date(board.data.updatedAt) : null;
  const setFollow = (addr: string, next: boolean) =>
    qc.setQueriesData<HlBoard>({ queryKey: ["leaderboard", "hl"] }, (d) => (d ? { ...d, rows: d.rows.map((r) => (r.user.address === addr ? { ...r, isFollowing: next, followers: Math.max(0, r.followers + (next ? 1 : -1)) } : r)) } : d));
  const Th = ({ k, children, right = true }: { k?: Sort; children: React.ReactNode; right?: boolean }) => (
    <th className={`${right ? "text-right" : "text-left"} font-medium px-3 py-2.5 ${k ? "cursor-pointer select-none hover:text-fg" : ""} ${k && sort === k ? "text-fg" : ""}`} onClick={k ? () => setSort(k) : undefined} aria-sort={k && sort === k ? "descending" : undefined}>
      {children}
      {k && sort === k && <span className="text-brand ml-1">↓</span>}
    </th>
  );
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="seg" data-testid="hl-windows">
          {WINDOWS.map(([w, label]) => (
            <button key={w} className={`seg-item h-8 ${win === w ? "seg-active" : ""}`} onClick={() => setWin(w)}>{label}</button>
          ))}
        </span>
        <input className="input h-8 w-56 text-[13px]" placeholder="Search trader or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search traders" />
        <Toggle on={claimed} onChange={setClaimed} label="On socialLiquid" />
        <span className="ml-auto text-xs text-dim num">{board.data ? `${board.data.total} traders in the pool` : ""}</span>
      </div>
      {top3.length === 3 && (
        <div className="grid grid-cols-3 gap-3">
          {top3.map((r) => (
            <Link key={r.user.address} href={userPath(r.user)} className="card p-4 flex items-center gap-3 hover:bg-panel-2 transition-colors">
              <span className={`num text-2xl font-semibold ${r.rank === 1 ? "text-warn" : r.rank === 2 ? "text-fg-2" : "text-[#cd7f32]"}`}>#{r.rank}</span>
              <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={40} />
              <span className="min-w-0 leading-tight">
                <span className="block font-semibold truncate">{userLabel(r.user)}</span>
                <span className="block text-[11px] text-muted num">{fmtMoney(r.accountValue)} · ROI {fmtRoi(r.roi)}</span>
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
        {board.data && rows.length === 0 && <Empty title={q || claimed ? "No traders match" : "Leaderboard unavailable"} hint={q || claimed ? "Try another name, or turn the socialLiquid filter off." : board.data.error ? `Hyperliquid did not answer: ${board.data.error}` : "Hyperliquid's leaderboard is mirrored on the first request and refreshed hourly. Refresh in a moment."} />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[860px]" data-testid="hl-board">
              <thead className="text-[11px] text-dim">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2.5 w-12">Rank</th>
                  <Th right={false}>Trader</Th>
                  <Th k="accountValue">Account Value</Th>
                  <Th k="pnl">PNL ({WIN_LABEL[win]})</Th>
                  <Th k="roi">ROI ({WIN_LABEL[win]})</Th>
                  <Th k="vlm">Volume ({WIN_LABEL[win]})</Th>
                  <th className="text-right font-medium px-3 py-2.5">Followers</th>
                  <th className="text-right font-medium px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user.address} className="border-b border-line/60 row-hover" data-testid={`hl-row-${r.user.address}`}>
                    <td className={`num px-4 py-2.5 ${r.rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>{r.rank}</td>
                    <td className="px-3 py-2.5">
                      <Link href={userPath(r.user)} className="flex items-center gap-2.5 hover:underline underline-offset-2">
                        <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={28} />
                        <span className="font-medium">{userLabel(r.user)}</span>
                        {r.user.claimed ? <span className="pill pill-up" title="claimed on socialLiquid: posts theses, can be copied with attribution">socialLiquid</span> : <span className="pill pill-neutral">Unclaimed</span>}
                      </Link>
                    </td>
                    <td className="num text-right px-3">{fmtMoney(r.accountValue)}</td>
                    <td className="num text-right px-3"><Pnl value={r.pnl} className="font-semibold" /></td>
                    <td className={`num text-right px-3 ${r.roi >= 0 ? "text-up" : "text-down"}`}>{fmtRoi(r.roi)}</td>
                    <td className="num text-right px-3 text-muted">{fmtMoney(r.vlm)}</td>
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
                : "Hyperliquid's figures. Excludes accounts with less than 100k USDC account value and less than 10M USDC trading volume. ROI = PNL / max(100, starting account value + maximum net deposits) for the window. Pool: the top traders of every window, refreshed hourly."}
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

function OwnBoard({ by }: { by: Exclude<Key, "hl" | "points"> }) {
  const q = useQuery({ queryKey: ["leaderboard", by], queryFn: () => api<{ rows: LeaderboardRow[] }>(`/api/leaderboard?by=${by}`).then((r) => r.rows), refetchInterval: 30_000 });
  const top3 = q.data?.slice(0, 3) ?? [];
  return (
    <>

      {top3.length === 3 && (
        <div className="grid grid-cols-3 gap-3">
          {top3.map((r) => (
            <Link key={r.user.address} href={userPath(r.user)} className="card p-4 flex items-center gap-3 hover:bg-panel-2 transition-colors">
              <span className={`num text-2xl font-semibold ${r.rank === 1 ? "text-warn" : r.rank === 2 ? "text-fg-2" : "text-[#cd7f32]"}`}>#{r.rank}</span>
              <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={40} />
              <span className="min-w-0 leading-tight">
                <span className="block font-semibold truncate">{userLabel(r.user)}</span>
                <span className="block text-[11px] text-muted">{r.stats.winRate !== null ? `${Math.round(r.stats.winRate * 100)}% win` : "–"} · {r.stats.closedTrades} trades</span>
              </span>
              <Pnl value={r.stats.pnl7d} compact className="ml-auto text-[15px] font-semibold" />
            </Link>
          ))}
        </div>
      )}

      <section className="card overflow-hidden">
        {q.isLoading && <Skeleton rows={12} h={48} />}
        {q.data?.length === 0 && <Empty title="Nobody ranks yet" hint="Traders need 5 closed trades indexed. The leaderboard fills as the indexer catches up." />}
        {!!q.data?.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[760px]">
              <thead className="text-[11px] text-dim">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2.5 w-12">#</th>
                  <th className="text-left font-medium px-3 py-2.5">Trader</th>
                  <th className="text-right font-medium px-3 py-2.5">7d PnL</th>
                  <th className="text-right font-medium px-3 py-2.5">30d PnL</th>
                  <th className="text-right font-medium px-3 py-2.5">Win rate</th>
                  <th className="text-right font-medium px-3 py-2.5">Trades</th>
                  <th className="text-right font-medium px-3 py-2.5">Avg hold</th>
                  <th className="text-right font-medium px-3 py-2.5">Thesis acc.</th>
                  <th className="text-right font-medium px-4 py-2.5">Followers</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.user.address} className="border-b border-line/60 row-hover">
                    <td className={`num px-4 py-2.5 ${r.rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>{r.rank}</td>
                    <td className="px-3 py-2.5">
                      <Link href={userPath(r.user)} className="flex items-center gap-2.5 hover:underline underline-offset-2">
                        <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={28} />
                        <span className="font-medium">{userLabel(r.user)}</span>
                        {!r.user.claimed && <span className="pill pill-neutral">Unclaimed</span>}
                      </Link>
                    </td>
                    <td className="text-right px-3"><Pnl value={r.stats.pnl7d} compact className="font-semibold" /></td>
                    <td className="text-right px-3"><Pnl value={r.stats.pnl30d} compact /></td>
                    <td className="num text-right px-3">{r.stats.winRate === null ? "–" : fmtPct(r.stats.winRate, 0, false)}</td>
                    <td className="num text-right px-3 text-muted">{r.stats.closedTrades}</td>
                    <td className="num text-right px-3 text-muted">{r.stats.avgHoldMs ? fmtDuration(r.stats.avgHoldMs) : "–"}</td>
                    <td className="num text-right px-3">{r.stats.thesisAccuracy === null ? "–" : fmtPct(r.stats.thesisAccuracy, 0, false)}</td>
                    <td className="num text-right px-4 text-muted">{r.followers}</td>
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
