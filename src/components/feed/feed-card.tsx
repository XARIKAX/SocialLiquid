"use client";
import "./feed.css";
import Link from "next/link";
import { memo, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FeedItem } from "@/lib/queries";
import { api } from "@/lib/client";
import { fmtDuration, fmtPx, fmtUsd, shortAddr, timeAgo, userPath } from "@/lib/format";
import { livePnl, useMarketIdentity } from "@/hooks/use-market";
import { EMOJIS, EMOJI_CHAR, type Emoji } from "@/lib/reactions";
import { Avatar, CoinIcon, EventPill, Icon, OutcomePill } from "../ui";
import { ThesisThread, useSignInPrompt } from "./thesis-thread";

type Payload = { side?: string; sizeUsd?: number; size?: number; leverage?: number; entryPx?: number; closePx?: number | null; realisedPnl?: number; holdMs?: number; text?: string };

/** /m/[coin]?copy=… prefills the ticket with the same side and leverage and records the copy on the resulting position.
    pass the market's page (its slug) when known; the id works too */
export function copyHref(item: FeedItem, page = `/m/${encodeURIComponent(item.coin)}`): string {
  const p = item.payload as { side?: string; leverage?: number };
  const pos = item.position!;
  const name = item.user?.displayName ?? item.user?.handle ?? item.address.slice(0, 6) + "…" + item.address.slice(-4);
  const q = new URLSearchParams({ copy: pos.id, from: item.address, side: String(pos.side ?? p.side ?? "LONG"), lev: String(pos.leverage ?? p.leverage ?? 10), name });
  return `${page}?${q.toString()}`;
}

/** how the rail names a trader (as the landing mock does): @handle once claimed, else the hyperliquid display name, else a short address */
export function railName(u: { handle?: string | null; displayName?: string | null } | null | undefined, address: string): string {
  return u?.handle ? `@${u.handle}` : u?.displayName ?? shortAddr(address);
}

/**
 * usd as the rail shows it, as the mock does: whole dollars once cents stop mattering (+$2,140, not +$2,140.37),
 * cents below $100, and never past the cent (a fresh position reads $0.00, not +$0.0027). `compact` columns use
 * whole dollars under $1K so they read -$277 beside +$4.9K. the tone follows what is shown: a rounded zero is flat.
 */
function railUsd(v: number, compact?: boolean): { text: string; tone: "up" | "down" | "flat" } {
  const abs = Math.abs(v);
  const whole = compact ? abs < 999.5 : abs >= 99.995;
  const shown = whole ? Math.round(abs) : Math.round(abs * 100) / 100;
  if (shown === 0) return { text: whole ? "$0" : "$0.00", tone: "flat" };
  const body = whole ? `$${shown.toLocaleString("en-US")}` : fmtUsd(shown, { compact });
  return { text: `${v < 0 ? "-" : "+"}${body}`, tone: v < 0 ? "down" : "up" };
}

/** a usd amount coloured by sign, glowing softly unless `glow` is off (closed pnl, leaderboard pnl) */
export function RailMoney({ v, compact, className = "", quiet, glow = true }: { v: number | null | undefined; compact?: boolean; className?: string; quiet?: boolean; glow?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span className={`tm-rail-dim ${className}`}>–</span>;
  const { text, tone } = railUsd(v, compact);
  return <span className={`num tm-rail-pnl tm-rail-pnl-${tone} ${quiet ? "tm-rail-upnl" : glow ? "" : "tm-rail-noglow"} ${className}`}>{text}</span>;
}

/**
 * a link to a trader's profile. in the rail it also calls `onNavigate`, so on a phone the page comes forward
 * instead of opening behind the feed tab. `decorative` (the avatar beside the name) keeps it out of the tab
 * order and the accessibility tree: the name is the one link to it.
 */
function TraderAnchor({ address, handle, onNavigate, className = "", decorative, children }: { address: string; handle?: string | null; onNavigate?: () => void; className?: string; decorative?: boolean; children: ReactNode }) {
  return (
    <Link href={userPath({ handle, address })} onClick={onNavigate} className={className} tabIndex={decorative ? -1 : undefined} aria-hidden={decorative || undefined}>
      {children}
    </Link>
  );
}

/**
 * one clock for every relative time on the page: a single interval, started by the first label and stopped with the
 * last. a label re-renders only itself, so a memoised card that nothing else touches still counts up its age.
 */
const clock = (() => {
  let now = 0;
  let iv = 0;
  const subs = new Set<() => void>();
  return {
    now: () => now,
    subscribe(fn: () => void) {
      subs.add(fn);
      if (subs.size === 1) {
        now = Date.now();
        iv = window.setInterval(() => {
          now = Date.now();
          subs.forEach((f) => f());
        }, 5000);
      }
      return () => {
        subs.delete(fn);
        if (!subs.size) window.clearInterval(iv);
      };
    },
  };
})();

/** "now" for the first few seconds (a bare 0s reads as a glitch), then the shared format: 12s, 4m, 3h */
function Ago({ time, className }: { time: string; className?: string }) {
  useSyncExternalStore(clock.subscribe, clock.now, () => 0);
  const t = new Date(time).getTime();
  const label = Date.now() - t < 5000 ? "now" : timeAgo(time);
  return (
    <time className={className} dateTime={time} title={new Date(t).toLocaleString()} suppressHydrationWarning>
      {label}
    </time>
  );
}

function Tri({ up }: { up: boolean }) {
  return (
    <svg width="7" height="7" viewBox="0 0 10 10" fill="currentColor" aria-hidden style={{ display: "inline", verticalAlign: "0.5px" }}>
      <path d={up ? "M5 1.5 9 8.5H1z" : "M5 8.5 1 1.5h8z"} />
    </svg>
  );
}

/** a return on equity as an arrow and a percentage, coloured by sign */
function Roe({ v, className = "" }: { v: number; className?: string }) {
  const up = v >= 0;
  return (
    <span className={`num ${up ? "tm-rail-up" : "tm-rail-down"} ${className}`}>
      <Tri up={up} /> <span className="sr-only">{up ? "up" : "down"} </span>
      {Math.abs(v * 100).toFixed(2)}%
    </span>
  );
}

/**
 * one event in the stream, in the landing mock's language: identity and event pill on top, the position on
 * the second line (side first, then the coin), then a thesis as a periwinkle quote or a close's prices and hold.
 * optional `fresh` (glows in) and `lead` (the newest card: a breathing mint edge) are set by the rail.
 * memoised: the rail passes `mid` only to open positions, so a price poll re-renders just the cards it moves.
 */
export const FeedCard = memo(function FeedCard({ item, mid, onNavigate, signedIn, fresh, lead }: { item: FeedItem; mid?: number; onNavigate?: () => void; signedIn: boolean; fresh?: boolean; lead?: boolean }) {
  const p = item.payload as Payload;
  const pos = item.position;
  const side = (p.side ?? pos?.side) as string | undefined;
  const sizeUsd = p.sizeUsd ?? pos?.sizeUsd;
  const lev = p.leverage ?? pos?.leverage;
  const entry = p.entryPx ?? pos?.entryPx;
  const isClosed = item.type === "CLOSED" || item.type === "LIQUIDATED";
  const isThesis = item.type === "THESIS";
  const open = !!pos && !pos.closedAt;
  const live = pos && open ? livePnl({ side: pos.side, size: pos.size, entryPx: pos.entryPx }, mid) : null;
  const roe = live !== null && pos && pos.sizeUsd ? (live * pos.leverage) / pos.sizeUsd : null;
  const realised = p.realisedPnl ?? pos?.realisedPnl ?? null;
  const closedRoe = isClosed && realised !== null && sizeUsd && lev ? (realised * lev) / sizeUsd : null;
  const handle = item.user?.handle;
  const displayName = item.user?.displayName;
  const name = railName(item.user, item.address);
  const tone = item.type === "LONG" ? "up" : item.type === "SHORT" || item.type === "LIQUIDATED" ? "down" : isThesis ? "thesis" : (realised ?? 0) >= 0 ? "up" : "down";
  const long = side === "LONG";
  const sideTag = side && <span className={`tm-rail-side ${long ? "tm-rail-up" : "tm-rail-down"}`}>{long ? "Long" : "Short"}</span>;
  const mk = useMarketIdentity()(item.coin);
  const coinLink = (
    <Link href={mk.href} onClick={onNavigate} className="tm-rail-fc-coin" title={`Open ${mk.name}`}>
      <span className="tm-rail-coin">
        <CoinIcon coin={mk.icon} size={15} />
      </span>
      <b>{mk.name}</b>
    </Link>
  );

  return (
    <article className={`tm-rail-fc ${isThesis ? "tm-rail-fc-thesis" : ""} ${fresh ? "tm-rail-fc-new" : ""} ${lead ? "tm-rail-fc-lead" : ""}`} data-tone={tone}>
      <div className="tm-rail-fc-top">
        <TraderAnchor address={item.address} handle={handle} onNavigate={onNavigate} decorative className="tm-rail-av-link">
          <span className="tm-rail-av">
            <Avatar address={item.address} url={item.user?.avatarUrl} handle={handle ?? displayName} size={28} />
          </span>
        </TraderAnchor>
        <div className="tm-rail-fc-who">
          <TraderAnchor address={item.address} handle={handle} onNavigate={onNavigate} className="tm-rail-fc-name">
            {name}
          </TraderAnchor>
          {item.user?.xHandle && (
            <a href={`https://x.com/${item.user.xHandle}`} target="_blank" rel="noreferrer" className="tm-rail-fc-x" title={`@${item.user.xHandle} on X`} aria-label={`@${item.user.xHandle} on X`}>
              <Icon.x />
            </a>
          )}
          {item.user?.style && <span className="pill pill-neutral hidden sm:inline-flex">{item.user.style}</span>}
          {(item.user?.winStreak ?? 0) >= 3 && <span className="pill pill-warn num" title={`${item.user!.winStreak} winning trades in a row`} data-testid="feed-streak">🔥 {item.user!.winStreak}</span>}
          <EventPill type={item.type} />
        </div>
        {open && !isClosed && (
          <Link href={copyHref(item, mk.href)} onClick={onNavigate} className="tm-rail-copy" title={`Open the same ${side === "SHORT" ? "short" : "long"} on ${mk.name}`}>
            <Icon.copy /> Copy
          </Link>
        )}
        <Ago time={item.time} className="tm-rail-fc-ago" />
      </div>

      <div className="tm-rail-fc-body">
        {!isClosed && (
          <div className="tm-rail-fc-mid num">
            {/* a long or short event says its side in the pill; a thesis says it here */}
            {isThesis && sideTag}
            {coinLink}
            {sizeUsd !== undefined && <span>{fmtUsd(sizeUsd, { compact: true })}</span>}
            {entry !== undefined && (
              <>
                <span className="tm-rail-dim">at</span>
                <span>{fmtPx(entry)}</span>
              </>
            )}
            {lev !== undefined && <span className="tm-rail-lev">{lev}x</span>}
            {!isThesis && live !== null && (
              <span className="tm-rail-fc-right" title="Unrealised PnL, live">
                <RailMoney v={live} quiet />
              </span>
            )}
          </div>
        )}

        {isClosed && (
          <>
            <div className="tm-rail-fc-mid num">
              {sideTag}
              {coinLink}
              {sizeUsd !== undefined && <span>{fmtUsd(sizeUsd, { compact: true })}</span>}
              {lev !== undefined && <span className="tm-rail-lev">{lev}x</span>}
              <span className="tm-rail-fc-right">
                <RailMoney v={realised} />
              </span>
            </div>
            <div className="tm-rail-fc-sub num">
              <span className="tm-rail-ellipsis">
                {entry !== undefined && fmtPx(entry)}
                {p.closePx !== undefined && p.closePx !== null && <> → {fmtPx(p.closePx)}</>}
                {p.holdMs !== undefined && <> · held {fmtDuration(p.holdMs)}</>}
              </span>
              {closedRoe !== null && <Roe v={closedRoe} className="ml-auto shrink-0" />}
            </div>
          </>
        )}

        {pos && open && (pos.copiedFrom || pos.copiers > 0) && (
          <div className="tm-rail-fc-meta">
            {pos.copiedFrom && (
              <span>
                <Icon.copy /> copied{" "}
                <TraderAnchor address={pos.copiedFrom.address} handle={pos.copiedFrom.handle} onNavigate={onNavigate} className="tm-rail-fc-meta-link">
                  {railName(pos.copiedFrom, pos.copiedFrom.address)}
                </TraderAnchor>
              </span>
            )}
            {pos.copiers > 0 && (
              <span className="tm-rail-copiers num">
                {pos.copiers} {pos.copiers === 1 ? "copier" : "copiers"}
              </span>
            )}
          </div>
        )}

        {item.thesis && <ThesisBody item={item} signedIn={signedIn} roe={roe} onNavigate={onNavigate} />}
        <Reactions item={item} signedIn={signedIn} withComments={!isThesis} />
      </div>
    </article>
  );
});

function ThesisBody({ item, signedIn, roe, onNavigate }: { item: FeedItem; signedIn: boolean; roe: number | null; onNavigate?: () => void }) {
  const t = item.thesis!;
  const qc = useQueryClient();
  const prompt = useSignInPrompt();
  const [likes, setLikes] = useState(t.likes);
  const [liked, setLiked] = useState(t.likedByMe);
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState(0);
  const [replies, setReplies] = useState(t.replies ?? 0);
  const [threadOpen, setThreadOpen] = useState(false);
  const pos = item.position;
  // follow the server's counts as the feed refreshes, unless a like is in flight
  useEffect(() => {
    if (busy) return;
    setLikes(t.likes);
    setLiked(t.likedByMe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.likes, t.likedByMe]);
  // and the reply count, when another reader adds one
  useEffect(() => {
    setReplies(t.replies ?? 0);
  }, [t.replies]);
  const toggleLike = async () => {
    if (!signedIn) return prompt();
    if (busy) return;
    // optimistic: the heart answers at once, the server's count settles it
    const was = liked;
    setLiked(!was);
    setLikes((n) => Math.max(0, n + (was ? -1 : 1)));
    if (!was) setPop((n) => n + 1);
    setBusy(true);
    try {
      const r = await api<{ liked: boolean; likes: number }>("/api/like", { method: "POST", json: { thesisId: t.id } });
      setLiked(r.liked);
      setLikes(r.likes);
      qc.invalidateQueries({ queryKey: ["feed"] });
    } catch {
      setLiked(was);
      setLikes(t.likes);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="tm-rail-quote">{t.text}</p>
      <div className="tm-rail-fc-foot">
        {/* the call and how it is going: holding with the live return, or the outcome with what it made */}
        <span className="tm-rail-fc-result">
          <OutcomePill outcome={t.outcome} />
          {pos && !pos.closedAt && roe !== null && (
            <span className="tm-rail-fc-result-live" title="Return on margin, live">
              <Roe v={roe} className="tm-rail-roe" />
              <span className="tm-rail-live tm-rail-live-thesis" aria-hidden />
            </span>
          )}
          {t.outcome !== "OPEN" && pos?.closedAt && <RailMoney v={pos.realisedPnl} className="text-[12px]" />}
        </span>
        <button
          type="button"
          onClick={toggleLike}
          className="tm-rail-act tm-rail-like"
          aria-pressed={liked}
          data-pop={pop ? "" : undefined}
          title={signedIn ? (liked ? "Unlike" : "Like") : "Sign in to like"}
          aria-label={`${liked ? "Unlike" : "Like"}, ${likes} ${likes === 1 ? "like" : "likes"}`}
        >
          <Icon.heart key={pop} filled={liked} /> <span className="num">{likes}</span>
        </button>
        <button type="button" onClick={() => setThreadOpen((v) => !v)} className="tm-rail-act" aria-expanded={threadOpen} title={threadOpen ? "Hide replies" : "Replies"} aria-label={`${replies} ${replies === 1 ? "reply" : "replies"}`}>
          <Icon.reply /> <span className="num">{replies}</span>
        </button>
        <Link href={`/t/${item.user?.handle ?? item.address}/thesis/${t.id}`} onClick={onNavigate} className="tm-rail-act tm-rail-push" title="Open the thesis" aria-label="Open the thesis">
          <Icon.share />
        </Link>
      </div>
      {threadOpen && <ThesisThread thesisId={t.id} compact autoFocus onCount={setReplies} onNavigate={onNavigate} />}
    </>
  );
}

/** fire / skull / eyes on any card, plus a comment thread on trade cards (theses have their own replies above) */
function Reactions({ item, signedIn, withComments }: { item: FeedItem; signedIn: boolean; withComments: boolean }) {
  const [state, setState] = useState(item.reactions ?? { fire: 0, skull: 0, eyes: 0, mine: [] as Emoji[] });
  const [busy, setBusy] = useState<Emoji | null>(null);
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState(item.comments ?? 0);
  const react = async (e: Emoji) => {
    if (!signedIn || busy) return;
    setBusy(e);
    try {
      const r = await api<{ reacted: boolean; fire: number; skull: number; eyes: number; mine: Emoji[] }>("/api/react", { method: "POST", json: { eventId: item.id, emoji: e } });
      setState({ fire: r.fire, skull: r.skull, eyes: r.eyes, mine: r.mine });
    } finally {
      setBusy(null);
    }
  };
  const total = state.fire + state.skull + state.eyes;
  return (
    <div className="mt-2" data-testid={`reactions-${item.id}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {EMOJIS.map((e) => {
          const n = state[e];
          const on = state.mine.includes(e);
          if (!on && n === 0 && !signedIn) return null;
          return (
            <button
              key={e}
              onClick={() => react(e)}
              disabled={!signedIn || busy === e}
              className={`h-6 px-2 rounded-full text-[11px] num inline-flex items-center gap-1 border transition-colors ${on ? "border-brand/50 bg-brand/10 text-fg" : n > 0 ? "border-line-2 bg-panel-2 text-fg-2 hover:border-brand/40" : "border-transparent text-dim hover:bg-panel-2 hover:text-fg-2"} ${signedIn ? "" : "cursor-default"}`}
              title={signedIn ? (on ? "remove reaction" : "react") : "sign in to react"}
              aria-pressed={on}
              data-testid={`react-${e}`}
            >
              <span aria-hidden>{EMOJI_CHAR[e]}</span>
              {n > 0 && <span>{n}</span>}
            </button>
          );
        })}
        {withComments && (
          <button onClick={() => setOpen((v) => !v)} className={`h-6 px-2 rounded-full text-[11px] num inline-flex items-center gap-1 ${open ? "text-fg bg-panel-2" : "text-dim hover:text-fg-2 hover:bg-panel-2"}`} title="comments" data-testid="comments-toggle">
            <Icon.reply /> {comments > 0 ? comments : "Comment"}
          </button>
        )}
        {total === 0 && !withComments && !signedIn && null}
      </div>
      {open && withComments && <ThesisThread eventId={item.id} compact autoFocus onCount={setComments} />}
    </div>
  );
}
