"use client";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FeedItem } from "@/lib/queries";
import { api } from "@/lib/client";
import { fmtDuration, fmtPx, fmtUsd, timeAgo } from "@/lib/format";
import { livePnl } from "@/hooks/use-market";
import { Avatar, CoinIcon, EventPill, Icon, OutcomePill, Pnl, TraderLink } from "../ui";
import { ThesisThread } from "./thesis-thread";

type Payload = { side?: string; sizeUsd?: number; size?: number; leverage?: number; entryPx?: number; closePx?: number | null; realisedPnl?: number; holdMs?: number; text?: string };

/** /m/[coin]?copy=… prefills the ticket with the same side and leverage and records the copy on the resulting position */
export function copyHref(item: FeedItem): string {
  const p = item.payload as { side?: string; leverage?: number };
  const pos = item.position!;
  const name = item.user?.displayName ?? item.user?.handle ?? item.address.slice(0, 6) + "…" + item.address.slice(-4);
  const q = new URLSearchParams({ copy: pos.id, from: item.address, side: String(pos.side ?? p.side ?? "LONG"), lev: String(pos.leverage ?? p.leverage ?? 10), name });
  return `/m/${item.coin}?${q.toString()}`;
}

export function FeedCard({ item, mid, onNavigate, signedIn }: { item: FeedItem; mid?: number; onNavigate?: () => void; signedIn: boolean }) {
  const p = item.payload as Payload;
  const pos = item.position;
  const side = (p.side ?? pos?.side) as string | undefined;
  const sizeUsd = p.sizeUsd ?? pos?.sizeUsd;
  const lev = p.leverage ?? pos?.leverage;
  const entry = p.entryPx ?? pos?.entryPx;
  const isClosed = item.type === "CLOSED" || item.type === "LIQUIDATED";
  const isThesis = item.type === "THESIS";
  const live = pos && !pos.closedAt ? livePnl({ side: pos.side, size: pos.size, entryPx: pos.entryPx }, mid) : null;
  const roe = live !== null && pos && pos.sizeUsd ? (live * pos.leverage) / pos.sizeUsd : null;
  const handle = item.user?.handle;
  const displayName = item.user?.displayName;

  return (
    <article className={`relative px-4 py-3 border-b border-line row-hover ${isThesis ? "thread" : ""}`}>
      <div className="flex items-center gap-2.5">
        <TraderLink address={item.address} handle={handle} displayName={displayName} className="shrink-0 hover:no-underline">
          <Avatar address={item.address} url={item.user?.avatarUrl} handle={handle ?? displayName} size={32} />
        </TraderLink>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <TraderLink address={item.address} handle={handle} displayName={displayName} className="font-semibold text-[13px] truncate max-w-[10rem]" />
          {item.user?.xHandle && (
            <a href={`https://x.com/${item.user.xHandle}`} target="_blank" rel="noreferrer" className="text-dim hover:text-fg" title={`@${item.user.xHandle}`}>
              <Icon.x />
            </a>
          )}
          <EventPill type={item.type} />
        </div>
        <span className="text-[11px] text-dim num shrink-0">{timeAgo(item.time)}</span>
      </div>

      <div className="pl-[42px] mt-1.5">
        {!isClosed && (
          <div className="flex items-center gap-1.5 text-[13px] flex-wrap">
            <Link href={`/m/${item.coin}`} onClick={onNavigate} className="flex items-center gap-1.5 font-semibold hover:underline underline-offset-2">
              <CoinIcon coin={item.coin} size={18} />
              {item.coin}
            </Link>
            {sizeUsd !== undefined && <span className="num font-semibold">{fmtUsd(sizeUsd, { compact: true })}</span>}
            {entry !== undefined && (
              <>
                <span className="text-dim">at</span>
                <span className="num text-fg-2">{fmtPx(entry)}</span>
              </>
            )}
            {lev !== undefined && <span className="pill pill-neutral num">{lev}x</span>}
            {isThesis && roe !== null && (
              <span className={`num text-xs ${roe >= 0 ? "text-up" : "text-down"}`}>
                ({roe >= 0 ? "▲" : "▼"} {Math.abs(roe * 100).toFixed(2)}%)
              </span>
            )}
            {isThesis && pos && !pos.closedAt && <span className="w-1.5 h-1.5 rounded-full bg-thesis live-dot" />}
            {!isThesis && live !== null && <Pnl value={live} className="ml-auto text-xs font-medium" />}
          </div>
        )}
        {pos && !pos.closedAt && (pos.copiedFrom || pos.copiers > 0 || !isClosed) && (
          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-dim flex-wrap">
            {pos.copiedFrom && (
              <span className="inline-flex items-center gap-1">
                <Icon.copy /> copied <TraderLink address={pos.copiedFrom.address} handle={pos.copiedFrom.handle} displayName={pos.copiedFrom.displayName} className="text-fg-2 font-medium" />
              </span>
            )}
            {pos.copiers > 0 && <span className="num">{pos.copiers} {pos.copiers === 1 ? "trader" : "traders"} copied this</span>}
            {!isClosed && (
              <Link
                href={copyHref(item)}
                onClick={onNavigate}
                className="ml-auto btn h-7 px-2.5 text-[11px] font-semibold border-brand/40 text-brand hover:bg-brand/10"
                title={`Open the same ${side === "SHORT" ? "short" : "long"} on ${item.coin}`}
              >
                <Icon.copy /> Copy
              </Link>
            )}
          </div>
        )}

        {isClosed && (
          <div className="card-2 flex items-center gap-2.5 px-3 py-2 mt-0.5">
            <CoinIcon coin={item.coin} size={28} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5">
                <Link href={`/m/${item.coin}`} onClick={onNavigate} className="font-semibold text-[13px] hover:underline underline-offset-2">
                  {item.coin}
                </Link>
                {side && <span className={`text-[11px] font-medium ${side === "LONG" ? "text-up" : "text-down"}`}>{side === "LONG" ? "Long" : "Short"}</span>}
                {lev !== undefined && <span className="text-[11px] text-dim num">{lev}x</span>}
              </div>
              <div className="text-[11px] text-muted num mt-0.5 truncate">
                {sizeUsd !== undefined && <span>{fmtUsd(sizeUsd, { compact: true })} · </span>}
                {entry !== undefined && <span>{fmtPx(entry)}</span>}
                {p.closePx !== undefined && p.closePx !== null && <span> → {fmtPx(p.closePx)}</span>}
                {p.holdMs !== undefined && <span> · held {fmtDuration(p.holdMs)}</span>}
              </div>
            </div>
            <div className="text-right leading-tight shrink-0">
              <Pnl value={p.realisedPnl ?? pos?.realisedPnl} className="text-[13px] font-semibold block" />
              {sizeUsd !== undefined && lev !== undefined && (p.realisedPnl ?? pos?.realisedPnl) !== undefined && (
                <span className={`num text-[11px] ${(p.realisedPnl ?? pos?.realisedPnl ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                  {(p.realisedPnl ?? pos?.realisedPnl ?? 0) >= 0 ? "▲" : "▼"} {Math.abs((((p.realisedPnl ?? pos?.realisedPnl ?? 0) * lev) / sizeUsd) * 100).toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        )}

        {item.thesis && <ThesisBody item={item} signedIn={signedIn} />}
      </div>
    </article>
  );
}

function ThesisBody({ item, signedIn }: { item: FeedItem; signedIn: boolean }) {
  const t = item.thesis!;
  const qc = useQueryClient();
  const [likes, setLikes] = useState(t.likes);
  const [liked, setLiked] = useState(t.likedByMe);
  const [busy, setBusy] = useState(false);
  const [replies, setReplies] = useState(t.replies ?? 0);
  const [threadOpen, setThreadOpen] = useState(false);
  const pos = item.position;
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
    <div className="mt-2">
      <p className="text-[13.5px] leading-snug text-fg whitespace-pre-wrap break-words">{t.text}</p>
      <div className="mt-2 flex items-center gap-3">
        <button onClick={toggleLike} className={`inline-flex items-center gap-1 text-xs num ${liked ? "text-down" : "text-dim hover:text-fg"} ${signedIn ? "" : "cursor-default"}`} title={signedIn ? "like" : "sign in to like"}>
          <Icon.heart filled={liked} /> {likes}
        </button>
        <button onClick={() => setThreadOpen((v) => !v)} className={`inline-flex items-center gap-1 text-xs num ${threadOpen ? "text-fg" : "text-dim hover:text-fg"}`} title="replies">
          <Icon.reply /> {replies}
        </button>
        {t.outcome !== "OPEN" && <OutcomePill outcome={t.outcome} />}
        {t.outcome !== "OPEN" && pos?.closedAt && <Pnl value={pos.realisedPnl} className="text-xs" />}
        <Link href={`/t/${item.user?.handle ?? item.address}/thesis/${t.id}`} className="ml-auto text-dim hover:text-fg" title="permalink">
          <Icon.share />
        </Link>
      </div>
      {threadOpen && <ThesisThread thesisId={t.id} compact autoFocus onCount={setReplies} />}
    </div>
  );
}
