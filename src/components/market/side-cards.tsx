"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client";
import { fmtUsd, userLabel, userPath } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/queries";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, Pnl } from "../ui";

/** gomo's order flow card, for perps: notional opened long vs short in the last 24h */
export function FlowCard({ coin, flow }: { coin: string; flow?: { longUsd: number; shortUsd: number; count: number } }) {
  const l = flow?.longUsd ?? 0;
  const s = flow?.shortUsd ?? 0;
  const net = l - s;
  const tot = l + s;
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[15px]">Position flow</h3>
        <span className="text-[11px] text-dim">24h · {coin}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`num text-[26px] font-semibold tracking-tight ${net > 0 ? "text-up" : net < 0 ? "text-down" : "text-fg"}`}>{fmtUsd(net, { sign: true, compact: true })}</span>
        <span className="text-xs text-muted">net</span>
      </div>
      <div className="flex gap-1 h-1.5 mt-3">
        <span className="rounded-full bg-up" style={{ width: `${tot ? Math.max(2, (l / tot) * 100) : 50}%` }} />
        <span className="rounded-full bg-down flex-1" />
      </div>
      <div className="flex justify-between text-xs mt-2 num">
        <span><span className="text-up font-semibold">{fmtUsd(l, { compact: true })}</span> <span className="text-muted">longs</span></span>
        <span className="text-dim">{flow?.count ?? 0} fills</span>
        <span><span className="text-muted">shorts</span> <span className="text-down font-semibold">{fmtUsd(s, { compact: true })}</span></span>
      </div>
    </section>
  );
}

export function TradersToFollow() {
  const { signedIn } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["leaderboard", "pnl7d"], queryFn: () => api<{ rows: LeaderboardRow[] }>("/api/leaderboard?by=pnl7d").then((r) => r.rows), staleTime: 30_000 });
  const me = useQuery({ queryKey: ["me-follows"], queryFn: () => api<{ addresses: string[] }>("/api/follow"), enabled: signedIn, staleTime: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const rows = (q.data ?? []).slice(0, 5);
  if (!rows.length) return null;
  const following = new Set(me.data?.addresses ?? []);
  const toggle = async (address: string) => {
    if (!signedIn) return;
    setBusy(address);
    try {
      await api("/api/follow", { method: "POST", json: { address, follow: !following.has(address) } });
      qc.invalidateQueries({ queryKey: ["me-follows"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[15px]">Traders to follow</h3>
        <Link href="/leaderboard" className="text-xs text-brand hover:underline">See all</Link>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => {
          const on = following.has(r.user.address);
          return (
            <li key={r.user.address} className="flex items-center gap-2.5 py-2.5">
              <Link href={userPath(r.user)}><Avatar address={r.user.address} url={r.user.avatarUrl} handle={r.user.handle ?? r.user.displayName} size={32} /></Link>
              <span className="min-w-0 leading-tight">
                <Link href={userPath(r.user)} className="block font-semibold truncate hover:underline">{userLabel(r.user)}</Link>
                <span className="text-[11px] text-dim num">{r.followers} followers · {r.stats.winRate !== null ? `${Math.round(r.stats.winRate * 100)}% win` : `${r.stats.closedTrades} trades`}</span>
              </span>
              <Pnl value={r.stats.pnl7d} compact className="ml-auto text-xs font-semibold" />
              <button className={`btn btn-sm ${on ? "" : "bg-thesis border-thesis text-white hover:brightness-110"}`} onClick={() => toggle(r.user.address)} disabled={!signedIn || busy === r.user.address} title={signedIn ? "" : "sign in to follow"}>
                {on ? "Following" : "Follow"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
