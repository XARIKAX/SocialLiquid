"use client";
/**
 * alerts: a bell with an unread dot and a dropdown in the top bar, plus toasts that slide in while you are on the
 * page. two kinds of entry share them: followed traders opening, closing or getting liquidated, and notifications
 * about your own things (someone copied, commented on or reacted to your trade, your thesis settled, a trader whose
 * key you hold posted).
 * styles: ./chrome.css (.tm-chrome-alert*, .tm-chrome-toast*).
 */
import "./chrome.css";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { marketIdentity, useMarketIdentity } from "@/hooks/use-market";
import { api } from "@/lib/client";
import type { FeedItem } from "@/lib/queries";
import { fmtUsd, timeAgo, userLabel } from "@/lib/format";
import { Avatar, CoinIcon, EventPill, Icon } from "./ui";

type NoteType = "COPIED" | "REPLY" | "REACTION" | "THESIS_SETTLED" | "CREATOR_POST";
type Note = { id: string; type: NoteType; actorAddress: string | null; actor: { address: string; handle: string | null; displayName: string | null; avatarUrl: string | null } | null; coin: string | null; eventId: string | null; thesisId: string | null; positionId: string | null; payload: Record<string, unknown>; createdAt: string };
type Alerts = { items: FeedItem[]; notes?: Note[]; seenAt: string | null; unread: number };
/** one row in the bell or one toast: a followed trader's event, or a notification about something of yours */
type Entry = { key: string; time: string; event?: FeedItem; note?: Note };
const EMOJI: Record<string, string> = { fire: "🔥", skull: "💀", eyes: "👀" };
const POST_WORD: Record<string, string> = { call: "a call", exit: "an exit", lesson: "a lesson", loss: "a loss breakdown", note: "a note" };

/** followed-trader events and notifications in one list, newest first */
function entries(d: Alerts | undefined): Entry[] {
  if (!d) return [];
  return [
    ...d.items.map((it) => ({ key: `e-${it.id}`, time: it.time, event: it })),
    ...(d.notes ?? []).map((n) => ({ key: `n-${n.id}`, time: n.createdAt, note: n })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

export function useAlerts() {
  const { signedIn } = useAuth();
  return useQuery({ queryKey: ["alerts"], queryFn: () => api<Alerts>("/api/alerts"), enabled: signedIn, refetchInterval: 10_000, staleTime: 5_000 });
}

function verb(it: FeedItem) {
  switch (it.type) {
    case "LONG":
      return "went long";
    case "SHORT":
      return "went short";
    case "CLOSED":
      return "closed";
    case "LIQUIDATED":
      return "got liquidated on";
    case "THESIS":
      return "posted a thesis on";
    default:
      return "traded";
  }
}

/** the colour an alert wears: green opens long, red opens short or liquidations, periwinkle theses, mint the rest */
function tone(it: FeedItem): "up" | "down" | "thesis" | "mint" {
  if (it.type === "LONG") return "up";
  if (it.type === "SHORT" || it.type === "LIQUIDATED") return "down";
  if (it.type === "THESIS") return "thesis";
  return "mint";
}

const EYEBROW: Record<string, string> = { LONG: "New position", SHORT: "New position", CLOSED: "Position closed", LIQUIDATED: "Liquidation", THESIS: "New thesis" };
const NOTE_EYEBROW: Record<NoteType, string> = { COPIED: "Copied · yours", REPLY: "New comment · yours", REACTION: "New reaction · yours", THESIS_SETTLED: "Thesis settled · yours", CREATOR_POST: "New post · key you hold" };
const NOTE_PILL: Record<NoteType, [string, string]> = { COPIED: ["Copied", "pill-brand"], REPLY: ["Comment", "pill-neutral"], REACTION: ["Reaction", "pill-neutral"], THESIS_SETTLED: ["Settled", "pill-thesis"], CREATOR_POST: ["Key holders", "pill-thesis"] };

function noteTone(n: Note): "up" | "down" | "thesis" | "mint" {
  if (n.type === "THESIS_SETTLED") return (n.payload as { outcome?: string }).outcome === "PROFIT" ? "up" : "down";
  if (n.type === "CREATOR_POST") return "thesis";
  return "mint";
}

/** what a notification says, shared by the row and its spoken summary. `me` is the viewer's handle, for thesis links */
function noteFacts(n: Note, me: string | null | undefined, mk: ReturnType<typeof marketIdentity>) {
  const name = n.actor ? userLabel(n.actor) : n.actorAddress ? n.actorAddress.slice(0, 6) + "…" + n.actorAddress.slice(-4) : "";
  const p = n.payload as { side?: string; sizeUsd?: number; leverage?: number; text?: string; emoji?: string; outcome?: string; realisedPnl?: number; eventType?: string; kind?: string; handle?: string };
  const thing = p.eventType === "THESIS" ? "thesis" : "trade";
  const coin = n.coin ? mk.name : "";
  let what: string;
  switch (n.type) {
    case "COPIED":
      what = `copied your ${coin} ${p.side === "SHORT" ? "short" : "long"}`;
      break;
    case "REPLY":
      what = `commented on your ${coin} ${thing}`;
      break;
    case "REACTION":
      what = `reacted ${EMOJI[p.emoji ?? ""] ?? ""} to your ${coin} ${thing}`;
      break;
    case "CREATOR_POST":
      what = `posted ${POST_WORD[p.kind ?? ""] ?? "an update"}${coin ? ` on ${coin}` : ""}`;
      break;
    default:
      what = `${coin} thesis settled: ${(p.outcome ?? "").toLowerCase()}`;
  }
  const pnl = n.type === "THESIS_SETTLED" && p.realisedPnl !== undefined ? p.realisedPnl : null;
  const quote = n.type === "REPLY" || n.type === "CREATOR_POST" ? p.text : undefined;
  const href = n.type === "CREATOR_POST" ? `/keys/${encodeURIComponent(p.handle ?? n.actorAddress ?? "")}` : n.thesisId && me ? `/t/${me}/thesis/${n.thesisId}` : n.coin ? mk.href : "/";
  const ago = timeAgo(n.createdAt);
  const who = n.type === "THESIS_SETTLED" ? "Your" : name;
  const label = `${who} ${what}${pnl !== null ? `, ${fmtUsd(pnl, { sign: true })}` : ""}, ${ago} ago`;
  return { name: n.type === "THESIS_SETTLED" ? "Your thesis" : name, what, pnl, quote, href, ago, label, lev: p.leverage, size: p.sizeUsd };
}

function NoteRow({ n, me, onClick, fresh }: { n: Note; me?: string | null; onClick?: () => void; fresh?: boolean }) {
  const mk = useMarketIdentity()(n.coin ?? "");
  const { name, what, pnl, quote, href, ago, label, lev, size } = noteFacts(n, me, mk);
  const [pill, cls] = NOTE_PILL[n.type];
  return (
    <Link href={href} onClick={onClick} className="tm-chrome-alert" data-new={fresh || undefined} aria-label={label} data-testid={`note-${n.type}`}>
      <span className="tm-chrome-alert-av" aria-hidden>
        {n.actorAddress && n.type !== "THESIS_SETTLED" ? (
          <Avatar address={n.actorAddress} url={n.actor?.avatarUrl} handle={n.actor?.handle ?? n.actor?.displayName} size={32} />
        ) : (
          <span className="tm-chrome-glyph">
            <Icon.check />
          </span>
        )}
        {n.coin && <CoinIcon coin={mk.icon} size={15} className="tm-chrome-alert-coinbadge" />}
      </span>
      <span className="tm-chrome-alert-body" aria-hidden>
        <span className="tm-chrome-alert-line">
          <span className="tm-chrome-alert-name">{name}</span>
          <span className={`pill ${cls}`}>{pill}</span>
          <span className="tm-chrome-alert-time">{ago}</span>
        </span>
        <span className="tm-chrome-alert-meta tm-chrome-num">
          <span>{what}</span>
          {n.type === "COPIED" && size ? <span>{fmtUsd(size, { compact: true })}</span> : null}
          {n.type === "COPIED" && lev ? <span className="tm-chrome-alert-lev">{lev}x</span> : null}
          {pnl !== null && <span className={`tm-chrome-alert-pnl ${pnl >= 0 ? "tm-chrome-up glow-up" : "tm-chrome-down glow-down"}`}>{fmtUsd(pnl, { sign: true })}</span>}
        </span>
        {quote && <span className="tm-chrome-alert-quote">{quote}</span>}
      </span>
    </Link>
  );
}

/** a row for either kind of entry */
function EntryRow({ e, me, onClick, fresh }: { e: Entry; me?: string | null; onClick?: () => void; fresh?: boolean }) {
  return e.event ? <AlertRow it={e.event} onClick={onClick} fresh={fresh} /> : <NoteRow n={e.note!} me={me} onClick={onClick} fresh={fresh} />;
}

const closeIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/** the facts an alert carries, shared by the row and its spoken summary */
function facts(it: FeedItem, mk: ReturnType<typeof marketIdentity> = marketIdentity(it.coin)) {
  const p = it.payload as { sizeUsd?: number; leverage?: number; realisedPnl?: number; side?: string; text?: string };
  const name = it.user ? userLabel(it.user) : it.address.slice(0, 6) + "…" + it.address.slice(-4);
  const pnl = p.realisedPnl ?? it.position?.realisedPnl ?? null;
  const closed = it.type === "CLOSED" || it.type === "LIQUIDATED";
  const lev = p.leverage ?? it.position?.leverage;
  const size = p.sizeUsd ?? it.position?.sizeUsd;
  const side = it.type === "THESIS" ? (p.side ?? it.position?.side) : undefined;
  const text = it.type === "THESIS" ? (it.thesis?.text ?? p.text) : undefined;
  const ago = timeAgo(it.time);
  const label = `${name} ${verb(it)} ${mk.name}${size ? `, ${fmtUsd(size, { compact: true })}` : ""}${lev ? ` at ${lev}x` : ""}${closed && pnl !== null ? `, ${fmtUsd(pnl, { sign: true })}` : ""}, ${ago} ago`;
  return { name, pnl, closed, lev, size, side, text, ago, label, mk };
}

function AlertRow({ it, onClick, fresh }: { it: FeedItem; onClick?: () => void; fresh?: boolean }) {
  const { name, pnl, closed, lev, size, side, text, ago, label, mk } = facts(it, useMarketIdentity()(it.coin));
  return (
    <Link href={mk.href} onClick={onClick} className="tm-chrome-alert" data-new={fresh || undefined} aria-label={label}>
      <span className="tm-chrome-alert-av" aria-hidden>
        <Avatar address={it.address} url={it.user?.avatarUrl} handle={it.user?.handle ?? it.user?.displayName} size={32} />
        <CoinIcon coin={mk.icon} size={15} className="tm-chrome-alert-coinbadge" />
      </span>
      <span className="tm-chrome-alert-body" aria-hidden>
        <span className="tm-chrome-alert-line">
          <span className="tm-chrome-alert-name">{name}</span>
          <EventPill type={it.type} />
          <span className="tm-chrome-alert-time">{ago}</span>
        </span>
        <span className="tm-chrome-alert-meta tm-chrome-num">
          {side && <span className={side === "LONG" ? "tm-chrome-up" : "tm-chrome-down"}>{side === "LONG" ? "Long" : "Short"}</span>}
          <b>{mk.name}</b>
          {size ? <span>{fmtUsd(size, { compact: true })}</span> : null}
          {lev ? <span className="tm-chrome-alert-lev">{lev}x</span> : null}
          {closed && pnl !== null && <span className={`tm-chrome-alert-pnl ${pnl >= 0 ? "tm-chrome-up glow-up" : "tm-chrome-down glow-down"}`}>{fmtUsd(pnl, { sign: true })}</span>}
        </span>
        {text && <span className="tm-chrome-alert-quote">{text}</span>}
      </span>
    </Link>
  );
}

/** top-bar bell: unread dot, dropdown with the latest alerts, mark-read on open */
export function AlertsBell() {
  const q = useAlerts();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // how many rows were unread when the list opened: they stay lit while you read them
  const [fresh, setFresh] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const unread = q.data?.unread ?? 0;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
    };
  }, [open]);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) setFresh(unread);
    if (next && unread > 0) {
      await api("/api/alerts", { method: "POST" }).catch(() => {});
      qc.setQueryData<Alerts>(["alerts"], (d) => (d ? { ...d, unread: 0, seenAt: new Date().toISOString() } : d));
    }
  };
  const items = entries(q.data);
  return (
    <div className="relative" ref={ref}>
      <button ref={btn} type="button" className="tm-chrome-iconbtn" onClick={toggle} title="Alerts" aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} aria-haspopup="dialog">
        <Icon.bell />
        {unread > 0 && <span className="tm-chrome-unread" aria-hidden />}
      </button>
      {open && (
        <div className="pop tm-chrome-alerts" role="dialog" aria-label="Alerts">
          <div className="tm-chrome-alerts-head">
            <span className="tm-chrome-alerts-title">Alerts</span>
            {fresh > 0 && <span className="pill pill-brand">{fresh > 99 ? "99+" : fresh} new</span>}
            <span className="tm-chrome-alerts-sub">Traders you follow · keys you hold · yours</span>
          </div>
          <div className="tm-chrome-alerts-list">
            {q.isLoading && (
              <div className="tm-chrome-loading space-y-2" aria-label="Loading alerts">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-12" style={{ opacity: 1 - i * 0.25 }} />
                ))}
              </div>
            )}
            {q.data && items.length === 0 && (
              <div className="tm-chrome-alerts-empty">
                <span className="tm-chrome-glyph" aria-hidden>
                  <Icon.bell />
                </span>
                <div className="text-[13px] font-semibold text-fg">No alerts yet</div>
                <p>
                  Follow a few traders from the{" "}
                  <Link href="/leaderboard" onClick={() => setOpen(false)}>
                    leaderboard
                  </Link>{" "}
                  and their moves land here the second they hit chain.
                </p>
              </div>
            )}
            {items.map((e, i) => (
              <EntryRow key={e.key} e={e} me={me?.user?.handle} fresh={i < fresh} onClick={() => setOpen(false)} />
            ))}
          </div>
          {items.length > 0 && (
            <div className="tm-chrome-alerts-foot">
              <Link href="/leaderboard" onClick={() => setOpen(false)}>
                Find more traders to follow
                <Icon.right />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TOAST_MS = 7000;
const MAX_TOASTS = 3;
/** the gap between cards when the deck fans out */
const GAP = 8;

/**
 * mount once: toasts for alerts that arrive while the page is open. they stack as a deck: the newest in front, the
 * others tucked behind with just their lit edge showing. pointing at (or tabbing into) the deck fans it out and holds
 * every clock, so nothing slides away while you read it.
 */
export function AlertToasts() {
  const q = useAlerts();
  const { me } = useAuth();
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<Entry[]>([]);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const closeT = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!q.data) return;
    const items = entries(q.data);
    if (seen.current === null) {
      // first load: everything already on the list is old news
      seen.current = new Set(items.map((i) => i.key));
      return;
    }
    const fresh = items.filter((i) => !seen.current!.has(i.key));
    if (!fresh.length) return;
    for (const i of fresh) seen.current.add(i.key);
    setToasts((t) => [...fresh.slice(0, MAX_TOASTS), ...t].slice(0, MAX_TOASTS));
  }, [q.data]);
  const done = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.key !== id));
    setHeights((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }, []);
  const onHeight = useCallback((id: string, h: number) => setHeights((m) => (m[id] === h ? m : { ...m, [id]: h })), []);
  useEffect(() => {
    if (toasts.length) return;
    window.clearTimeout(closeT.current);
    setOpen(false);
  }, [toasts.length]);
  useEffect(() => () => window.clearTimeout(closeT.current), []);
  const hold = () => {
    window.clearTimeout(closeT.current);
    setOpen(true);
  };
  // a short grace, so crossing the gap between two fanned-out cards does not fold the deck under the pointer
  const release = () => {
    window.clearTimeout(closeT.current);
    closeT.current = window.setTimeout(() => setOpen(false), 180);
  };
  const front = toasts[0] ? heights[toasts[0].key] : undefined;
  let below = 0;
  // the live region is always in the page, so the first toast is announced too (a region born with its content is not)
  return (
    <div
      className="tm-chrome-toasts"
      aria-live="polite"
      aria-relevant="additions"
      data-open={open || undefined}
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) release();
      }}
    >
      {toasts.map((e, i) => {
        const h = heights[e.key];
        const lift = below;
        below += (h ?? 0) + GAP;
        return <Toast key={e.key} e={e} me={me?.user?.handle} index={i} height={h} front={front} lift={lift} hold={open} onDone={done} onHeight={onHeight} />;
      })}
    </div>
  );
}

/** one card: a coloured edge, a life bar, its own clock (held while the deck is open), then out */
function Toast({ e, me, index, height, front, lift, hold, onDone, onHeight }: { e: Entry; me?: string | null; index: number; height?: number; front?: number; lift: number; hold: boolean; onDone: (id: string) => void; onHeight: (id: string, h: number) => void }) {
  const mkOf = useMarketIdentity();
  const id = e.key;
  const eyebrow = e.event ? `${EYEBROW[e.event.type] ?? "Alert"} · following` : NOTE_EYEBROW[e.note!.type];
  const spoken = e.event ? `${EYEBROW[e.event.type] ?? "Alert"}: ${facts(e.event, mkOf(e.event.coin)).label}` : noteFacts(e.note!, me, mkOf(e.note!.coin ?? "")).label;
  const [leaving, setLeaving] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const left = useRef(TOAST_MS);
  const leave = useCallback(() => setLeaving(true), []);
  // the clock runs only while the deck is at rest; whatever was left resumes when the pointer or focus moves on
  useEffect(() => {
    if (hold || leaving) return;
    const started = Date.now();
    const t = window.setTimeout(leave, left.current);
    return () => {
      window.clearTimeout(t);
      left.current = Math.max(800, left.current - (Date.now() - started));
    };
  }, [hold, leaving, leave]);
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => onDone(id), 240);
    return () => window.clearTimeout(t);
  }, [leaving, id, onDone]);
  // the card's natural height (its body, not the card, which is cut to the front card's height while tucked behind)
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const report = () => onHeight(id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, onHeight]);
  const vars: Record<string, string | number> = { "--life": `${TOAST_MS}ms`, "--i": index, "--lift": `${-lift}px` };
  if (height !== undefined) vars["--h"] = `${height}px`;
  if (front !== undefined) vars["--fh"] = `${front}px`;
  return (
    <div className="tm-chrome-toast" data-tone={e.event ? tone(e.event) : noteTone(e.note!)} data-front={index === 0 || undefined} data-leaving={leaving || undefined} style={vars as React.CSSProperties}>
      <div ref={body} className="tm-chrome-toast-body">
        <span className="sr-only">{spoken}</span>
        <div className="tm-chrome-toast-eyebrow" aria-hidden>
          <i />
          {eyebrow}
        </div>
        <button type="button" className="tm-chrome-toast-x" onClick={leave} aria-label="Dismiss alert">
          {closeIcon}
        </button>
        <EntryRow e={e} me={me} onClick={leave} />
      </div>
      <span className="tm-chrome-toast-life" aria-hidden />
    </div>
  );
}
