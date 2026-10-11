"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";
import type { LeaderboardRow } from "@/lib/queries";
import { fmtDuration, fmtPct, shortAddr } from "@/lib/format";
import { Avatar, Empty, Pnl, Skeleton } from "../ui";

const BY = [
  { key: "pnl7d", label: "7d pnl" },
  { key: "winRate", label: "win rate" },
  { key: "thesisAccuracy", label: "thesis accuracy" },
  { key: "followers", label: "followers" },
] as const;

export function LeaderboardTable() {
  const [by, setBy] = useState<(typeof BY)[number]["key"]>("pnl7d");
  const q = useQuery({ queryKey: ["leaderboard", by], queryFn: () => api<{ rows: LeaderboardRow[] }>(`/api/leaderboard?by=${by}`).then((r) => r.rows), refetchInterval: 30_000 });
  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-1 px-2 h-10 border-b border-line">
        <span className="text-sm font-semibold px-1 mr-2">leaderboard</span>
        {BY.map((b) => (
          <button key={b.key} className={`tab h-10 ${by === b.key ? "tab-active" : ""}`} onClick={() => setBy(b.key)}>{b.label}</button>
        ))}
        <span className="ml-auto text-[10px] text-dim pr-2 hidden sm:inline">min 5 closed trades to rank</span>
      </div>
      {q.isLoading && <Skeleton rows={12} h={40} />}
      {q.data?.length === 0 && <Empty title="nobody ranks yet" hint="traders need 5 closed trades indexed. give the worker a little time." />}
      {!!q.data?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="text-[10px] uppercase text-dim">
              <tr className="border-b border-line">
                <th className="text-left font-medium px-3 py-2 w-10">#</th>
                <th className="text-left font-medium px-2 py-2">trader</th>
                <th className="text-right font-medium px-2 py-2">7d pnl</th>
                <th className="text-right font-medium px-2 py-2">30d pnl</th>
                <th className="text-right font-medium px-2 py-2">win rate</th>
                <th className="text-right font-medium px-2 py-2">trades</th>
                <th className="text-right font-medium px-2 py-2">avg hold</th>
                <th className="text-right font-medium px-2 py-2">thesis acc.</th>
                <th className="text-right font-medium px-3 py-2">followers</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.user.address} className="border-b border-line/60 hover:bg-panel-2">
                  <td className="num px-3 py-2 text-dim">{r.rank}</td>
                  <td className="px-2 py-2">
                    <Link href={`/t/${r.user.handle ?? r.user.address}`} className="flex items-center gap-2 hover:underline">
                      <Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle} size={22} />
                      <span>{r.user.handle ?? shortAddr(r.user.address)}</span>
                      {!r.user.id && <span className="pill bg-line text-dim">unclaimed</span>}
                    </Link>
                  </td>
                  <td className="text-right px-2"><Pnl value={r.stats.pnl7d} compact /></td>
                  <td className="text-right px-2"><Pnl value={r.stats.pnl30d} compact /></td>
                  <td className="num text-right px-2">{r.stats.winRate === null ? "–" : fmtPct(r.stats.winRate, 0, false)}</td>
                  <td className="num text-right px-2 text-muted">{r.stats.closedTrades}</td>
                  <td className="num text-right px-2 text-muted">{r.stats.avgHoldMs ? fmtDuration(r.stats.avgHoldMs) : "–"}</td>
                  <td className="num text-right px-2">{r.stats.thesisAccuracy === null ? "–" : fmtPct(r.stats.thesisAccuracy, 0, false)}</td>
                  <td className="num text-right px-3 text-muted">{r.followers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
