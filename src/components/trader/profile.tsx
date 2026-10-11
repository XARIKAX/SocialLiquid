"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { livePnl, useMids } from "@/hooks/use-market";
import { api } from "@/lib/client";
import { fmtDuration, fmtPct, fmtPx, fmtUsd, shortAddr, timeAgo } from "@/lib/format";
import type { TraderStats } from "@/lib/queries";
import { Avatar, Empty, OutcomePill, Pnl, SidePill, Skeleton, Stat } from "../ui";

export type Profile = {
  address: string;
  user: { id: string; handle: string | null; xHandle: string | null; avatarUrl: string | null; createdAt: string } | null;
  displayName: string | null;
  claimed: boolean;
  isMe: boolean;
  isFollowing: boolean;
  followers: number;
  stats: TraderStats;
  accountValue: number | null;
  open: { id: string | null; coin: string; side: string; size: number; sizeUsd: number; leverage: number; entryPx: number; unrealisedPnl: number; roe: number; liquidationPx: number | null; openedAt: string | null; thesis: { id: string; text: string } | null }[];
  recentClosed: { id: string; coin: string; side: string; sizeUsd: number; leverage: number; entryPx: number; closePx: number | null; realisedPnl: number | null; openedAt: string; closedAt: string; liquidated: boolean }[];
  theses: { id: string; coin: string; text: string; outcome: string; createdAt: string; likes: number; likedByMe: boolean; position: { id: string; side: string; sizeUsd: number; leverage: number; entryPx: number; size: number; closedAt: string | null; realisedPnl: number | null; unrealisedPnl: number; openedAt: string } | null }[];
};

export function TraderProfile({ handle, initial }: { handle: string; initial: Profile }) {
  const q = useQuery({ queryKey: ["trader", handle], queryFn: () => api<Profile>(`/api/trader/${encodeURIComponent(handle)}`), initialData: initial, refetchInterval: 5000 });
  const p = q.data;
  const { signedIn } = useAuth();
  const mids = useMids();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"theses" | "open" | "closed">("theses");
  const [busy, setBusy] = useState(false);
  const name = p.user?.handle ?? p.displayName ?? shortAddr(p.address);

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

  return (
    <div className="max-w-5xl">
      <header className="p-4 border-b border-line">
        <div className="flex items-start gap-3">
          <Avatar address={p.address} url={p.user?.avatarUrl} handle={p.user?.handle} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold truncate">{name}</h1>
              {p.user?.xHandle && (
                <a href={`https://x.com/${p.user.xHandle}`} target="_blank" rel="noreferrer" className="text-muted text-xs hover:text-fg">@{p.user.xHandle}</a>
              )}
              {!p.claimed && <span className="pill bg-line text-muted">unclaimed</span>}
              {p.isMe && <span className="pill bg-accent/15 text-accent">you</span>}
            </div>
            <div className="text-[11px] text-dim num mt-0.5 flex gap-3 flex-wrap">
              <span title={p.address}>{p.address}</span>
              {p.accountValue !== null && <span>account {fmtUsd(p.accountValue, { compact: true })}</span>}
              <span>{p.followers} followers</span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {!p.isMe && (
              <button className={`btn ${p.isFollowing ? "" : "btn-primary"}`} onClick={follow} disabled={busy || !signedIn} title={signedIn ? "" : "sign in to follow"}>
                {p.isFollowing ? "following" : "follow"}
              </button>
            )}
            {!p.claimed && !signedIn && <span className="text-[11px] text-dim self-center hidden sm:block">connect this wallet to claim</span>}
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-4">
          <Stat label="win rate">{p.stats.winRate === null ? "–" : fmtPct(p.stats.winRate, 0, false)}</Stat>
          <Stat label="pnl 7d"><Pnl value={p.stats.pnl7d} compact /></Stat>
          <Stat label="pnl 30d"><Pnl value={p.stats.pnl30d} compact /></Stat>
          <Stat label="pnl all"><Pnl value={p.stats.pnlAll} compact /></Stat>
          <Stat label="avg hold">{p.stats.avgHoldMs ? fmtDuration(p.stats.avgHoldMs) : "–"}</Stat>
          <Stat label="thesis accuracy">{p.stats.thesisAccuracy === null ? "–" : fmtPct(p.stats.thesisAccuracy, 0, false)}</Stat>
        </div>
        <p className="text-[10px] text-dim mt-2">{p.stats.closedTrades} closed trades indexed · stats are computed from mirrored fills, not self reported</p>
      </header>

      <div className="flex items-center border-b border-line px-2">
        {(["theses", "open", "closed"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {t} <span className="text-dim num">{t === "theses" ? p.theses.length : t === "open" ? p.open.length : p.recentClosed.length}</span>
          </button>
        ))}
      </div>

      {tab === "open" && (
        <div>
          {p.open.length === 0 && <Empty title="no open positions" hint="read live from hyperliquid." />}
          {p.open.map((o) => {
            const mid = mids.data?.[o.coin] ? Number(mids.data[o.coin]) : undefined;
            const pnl = livePnl(o, mid) ?? o.unrealisedPnl;
            return (
              <div key={o.coin} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 text-xs">
                <Link href={`/m/${o.coin}`} className="font-semibold w-14 hover:underline">{o.coin}</Link>
                <SidePill side={o.side} />
                <span className="num">{fmtUsd(o.sizeUsd, { compact: true })}</span>
                <span className="num text-muted">{o.leverage}x</span>
                <span className="num text-muted">@ {fmtPx(o.entryPx)}</span>
                {o.liquidationPx && <span className="num text-dim hidden sm:inline">liq {fmtPx(o.liquidationPx)}</span>}
                {o.openedAt && <span className="text-dim hidden sm:inline">{fmtDuration(Date.now() - new Date(o.openedAt).getTime())}</span>}
                <Pnl value={pnl} className="ml-auto" pct={o.sizeUsd ? (pnl * o.leverage) / o.sizeUsd : null} />
              </div>
            );
          })}
        </div>
      )}

      {tab === "closed" && (
        <div>
          {p.recentClosed.length === 0 && <Empty title="no closed trades indexed yet" />}
          {p.recentClosed.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 text-xs">
              <Link href={`/m/${c.coin}`} className="font-semibold w-14 hover:underline">{c.coin}</Link>
              <SidePill side={c.side} />
              <span className="num">{fmtUsd(c.sizeUsd, { compact: true })}</span>
              <span className="num text-muted">{c.leverage}x</span>
              <span className="num text-muted hidden sm:inline">{fmtPx(c.entryPx)} → {fmtPx(c.closePx)}</span>
              <span className="text-dim">held {fmtDuration(new Date(c.closedAt).getTime() - new Date(c.openedAt).getTime())}</span>
              {c.liquidated && <span className="pill bg-down/25 text-down">liq</span>}
              <span className="ml-auto flex items-center gap-2">
                <Pnl value={c.realisedPnl} />
                <span className="text-dim num">{timeAgo(c.closedAt)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "theses" && (
        <div>
          {p.theses.length === 0 && <Empty title={p.claimed ? "no theses yet" : "this address hasn't claimed a profile"} hint={p.claimed ? "a thesis is a trade with a reason attached. post one from the trade panel." : "theses are only possible from a claimed socialLiquid account. positions and pnl are still tracked."} />}
          {p.theses.map((t) => {
            const mid = mids.data?.[t.coin] ? Number(mids.data[t.coin]) : undefined;
            const live = t.position && !t.position.closedAt ? livePnl(t.position, mid) : null;
            return (
              <article key={t.id} className="px-4 py-3 border-b border-line/60">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <Link href={`/m/${t.coin}`} className="font-semibold hover:underline">{t.coin}</Link>
                  {t.position && <SidePill side={t.position.side} />}
                  {t.position && <span className="num text-muted">{fmtUsd(t.position.sizeUsd, { compact: true })} · {t.position.leverage}x · @ {fmtPx(t.position.entryPx)}</span>}
                  <OutcomePill outcome={t.outcome} />
                  {live !== null && <Pnl value={live} />}
                  {t.position?.closedAt && <Pnl value={t.position.realisedPnl} />}
                  <span className="ml-auto text-dim num">{timeAgo(t.createdAt)}</span>
                </div>
                <p className="text-sm mt-1.5 whitespace-pre-wrap break-words">{t.text}</p>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-dim">
                  <span className={t.likedByMe ? "text-accent" : ""}>♥ {t.likes}</span>
                  <Link href={`/t/${p.user?.handle ?? p.address}/thesis/${t.id}`} className="hover:text-fg">permalink</Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {q.isFetching && !q.data && <Skeleton />}
    </div>
  );
}
