"use client";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FeedItem } from "@/lib/queries";
import { api } from "@/lib/client";
import { fmtDuration, fmtPx, fmtUsd, timeAgo } from "@/lib/format";
import { livePnl } from "@/hooks/use-market";
import { Avatar, OutcomePill, Pnl, TraderLink } from "../ui";

const TAG: Record<string, { label: string; cls: string }> = {
  LONG: { label: "long", cls: "bg-up/15 text-up" },
  SHORT: { label: "short", cls: "bg-down/15 text-down" },
  THESIS: { label: "thesis", cls: "bg-accent/15 text-accent" },
  CLOSED: { label: "closed", cls: "bg-line text-muted" },
  LIQUIDATED: { label: "liquidated", cls: "bg-down/30 text-down" },
};

export function FeedCard({ item, mid, onNavigate, signedIn }: { item: FeedItem; mid?: number; onNavigate?: () => void; signedIn: boolean }) {
  const p = item.payload as { side?: string; sizeUsd?: number; leverage?: number; entryPx?: number; closePx?: number; realisedPnl?: number; holdMs?: number; text?: string };
  const tag = TAG[item.type];
  const side = (p.side ?? item.position?.side) as string | undefined;
  const sizeUsd = p.sizeUsd ?? item.position?.sizeUsd;
  const lev = p.leverage ?? item.position?.leverage;
  const entry = p.entryPx ?? item.position?.entryPx;
  const isClosed = item.type === "CLOSED" || item.type === "LIQUIDATED";
  const pos = item.position;
  const live = pos && !pos.closedAt ? livePnl({ side: pos.side, size: pos.size, entryPx: pos.entryPx }, mid) : null;
  const name = item.user?.handle ?? item.user?.displayName ?? null;
  const tagLine = item.type === "THESIS" && side ? `${side.toLowerCase()} ${item.coin}` : item.coin;

  return (
    <article className="px-3 py-2.5 border-b border-line hover:bg-panel-2/60 transition-colors">
      <div className="flex items-start gap-2">
        <Avatar address={item.address} url={item.user?.avatarUrl} handle={name} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <TraderLink address={item.address} handle={item.user?.handle} displayName={item.user?.displayName} className="font-medium text-xs truncate max-w-[9rem]" />
            {item.user?.xHandle && (
              <a href={`https://x.com/${item.user.xHandle}`} target="_blank" rel="noreferrer" className="text-dim text-[10px] hover:text-fg">
                @{item.user.xHandle}
              </a>
            )}
            <span className={`pill ${tag.cls}`}>{tag.label}</span>
            <Link href={`/m/${item.coin}`} onClick={onNavigate} className="font-semibold text-xs hover:underline">
              {tagLine}
            </Link>
            <span className="ml-auto text-[10px] text-dim num">{timeAgo(item.time)}</span>
          </div>

          <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-muted num">
            {sizeUsd !== undefined && <span className="text-fg">{fmtUsd(sizeUsd, { compact: true })}</span>}
            {lev !== undefined && <span>{lev}x</span>}
            {entry !== undefined && <span>@ {fmtPx(entry)}</span>}
            {isClosed && p.closePx !== undefined && p.closePx !== null && <span>→ {fmtPx(p.closePx)}</span>}
            {isClosed && p.holdMs !== undefined && <span>held {fmtDuration(p.holdMs)}</span>}
            {isClosed && <Pnl value={p.realisedPnl ?? pos?.realisedPnl} className="ml-auto font-semibold" />}
            {!isClosed && item.type !== "THESIS" && live !== null && <Pnl value={live} className="ml-auto" />}
          </div>

          {item.thesis && (
            <ThesisBody item={item} live={live} signedIn={signedIn} />
          )}
        </div>
      </div>
    </article>
  );
}

function ThesisBody({ item, live, signedIn }: { item: FeedItem; live: number | null; signedIn: boolean }) {
  const t = item.thesis!;
  const qc = useQueryClient();
  const [likes, setLikes] = useState(t.likes);
  const [liked, setLiked] = useState(t.likedByMe);
  const [busy, setBusy] = useState(false);
  const pos = item.position;
  const settledPnl = pos?.closedAt ? pos.realisedPnl : null;
  const toggleLike = async () => {
    if (!signedIn || busy) return;
    setBusy(true);
    try {
      const r = await api<{ liked: boolean; likes: number }>("/api/like", { method: "POST", json: { thesisId: t.id } });
      setLiked(r.liked);
      setLikes(r.likes);
      qc.invalidateQueries({ queryKey: ["feed"] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1.5">
      <p className="text-xs text-fg/90 whitespace-pre-wrap break-words">{t.text}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {t.outcome !== "OPEN" ? <OutcomePill outcome={t.outcome} /> : pos ? <span className="pill bg-accent/10 text-accent">live</span> : <span className="pill bg-line text-muted">no position</span>}
        {t.outcome === "OPEN" && live !== null && <Pnl value={live} className="text-[11px]" />}
        {settledPnl !== null && settledPnl !== undefined && <Pnl value={settledPnl} className="text-[11px]" />}
        <button onClick={toggleLike} className={`ml-auto text-[11px] num ${liked ? "text-accent" : "text-dim hover:text-fg"} ${signedIn ? "" : "cursor-default"}`} title={signedIn ? "like" : "sign in to like"}>
          ♥ {likes}
        </button>
        <Link href={`/t/${item.user?.handle ?? item.address}/thesis/${t.id}`} className="text-[11px] text-dim hover:text-fg">
          ↗
        </Link>
      </div>
    </div>
  );
}
