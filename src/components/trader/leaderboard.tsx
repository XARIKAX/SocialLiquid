"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import type { HlBoard, HlBoardRow, LeaderboardRow } from "@/lib/queries";
import { fmtDuration, fmtPct, fmtUsd, userLabel, userPath } from "@/lib/format";
import { Avatar, Empty, Icon, Pnl, Skeleton } from "../ui";
import { HL_APP_URL } from "@/lib/env";

const BY = [
  { key: "hl", label: "Hyperliquid 30D" },
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
          {by === "hl" ? "Hyperliquid's own ranking · 30-day window · refreshed hourly" : "Minimum 5 closed trades to rank · computed from on-chain fills"}
        </span>
      </div>
      {by === "hl" ? <HlBoard /> : <OwnBoard by={by} />}
    </div>
  );
}

const fmtMoney = (n: number) => fmtUsd(n);
const fmtRoi = (n: number) => `${(n * 100).toFixed(2)}%`;

/** mirror of app.hyperliquid.xyz/leaderboard (30D): same rows, same figures, same exclusion rule */
function HlBoard() {
  const q = useQuery({ queryKey: ["leaderboard", "hl"], queryFn: () => api<HlBoard>("/api/leaderboard/hl"), refetchInterval: 60_000 });
  const rows = q.data?.rows ?? [];
  const top3 = rows.slice(0, 3);
  const updated = q.data?.updatedAt ? new Date(q.data.updatedAt) : null;
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
                <span className="block text-[11px] text-muted num">{fmtMoney(r.accountValue)} · ROI {fmtRoi(r.roi30d)}</span>
              </span>
              <Pnl value={r.pnl30d} compact className="ml-auto text-[15px] font-semibold" />
            </Link>
          ))}
        </div>
      )}
      <section className="card overflow-hidden">
        {q.isLoading && <Skeleton rows={10} h={48} />}
        {q.isError && <Empty title="Leaderboard unavailable" hint={(q.error as Error).message} />}
        {q.data && rows.length === 0 && <Empty title="Leaderboard unavailable" hint={q.data.error ? `Hyperliquid did not answer: ${q.data.error}` : "Hyperliquid's leaderboard is mirrored on the first request and refreshed hourly. Refresh in a moment."} />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[760px]">
              <thead className="text-[11px] text-dim">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2.5 w-12">Rank</th>
                  <th className="text-left font-medium px-3 py-2.5">Trader</th>
                  <th className="text-right font-medium px-3 py-2.5">Account Value</th>
                  <th className="text-right font-medium px-3 py-2.5">PNL (30D)</th>
                  <th className="text-right font-medium px-3 py-2.5">ROI (30D)</th>
                  <th className="text-right font-medium px-3 py-2.5">Volume (30D)</th>
                  <th className="text-right font-medium px-4 py-2.5">7D PNL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rank} className="border-b border-line/60 row-hover">
                    <td className={`num px-4 py-2.5 ${r.rank <= 3 ? "text-brand font-semibold" : "text-dim"}`}>{r.rank}</td>
                    <td className="px-3 py-2.5">
                      <Link href={userPath(r.user)} className="flex items-center gap-2.5 hover:underline underline-offset-2">
                        <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={28} />
                        <span className="font-medium">{userLabel(r.user)}</span>
                        {!r.user.claimed && <span className="pill pill-neutral">Unclaimed</span>}
                      </Link>
                    </td>
                    <td className="num text-right px-3">{fmtMoney(r.accountValue)}</td>
                    <td className="num text-right px-3"><Pnl value={r.pnl30d} className="font-semibold" /></td>
                    <td className={`num text-right px-3 ${r.roi30d >= 0 ? "text-up" : "text-down"}`}>{fmtRoi(r.roi30d)}</td>
                    <td className="num text-right px-3 text-muted">{fmtMoney(r.vlm30d)}</td>
                    <td className="text-right px-4"><Pnl value={r.pnl7d} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 text-[11px] text-dim border-t border-line">
            <span>
              {q.data?.source === "portfolio"
                ? "Built from Hyperliquid's portfolio API for the featured traders: PNL and volume are exact, ROI = PNL / account value at the start of the window."
                : "Excludes accounts with less than 100k USDC account value and less than 10M USDC trading volume. ROI = PNL / max(100, starting account value + maximum net deposits) for the time window."}
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

function OwnBoard({ by }: { by: Exclude<Key, "hl"> }) {
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
