"use client";
/**
 * alerts for followed traders: a bell with an unread dot and a dropdown in the top bar,
 * plus toasts that slide in when a followed trader opens, closes or gets liquidated while you are on the page.
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

type Alerts = { items: FeedItem[]; seenAt: string | null; unread: number };

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
  const items = q.data?.items ?? [];
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
            <span className="tm-chrome-alerts-sub">Traders you follow</span>
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
            {items.map((it, i) => (
              <AlertRow key={it.id} it={it} fresh={i < fresh} onClick={() => setOpen(false)} />
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
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<FeedItem[]>([]);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const closeT = useRef<number | undefined>(undefined);
  useEffect(() => {
    const items = q.data?.items;
    if (!items) return;
    if (seen.current === null) {
      // first load: everything already on the list is old news
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !seen.current!.has(i.id));
    if (!fresh.length) return;
    for (const i of fresh) seen.current.add(i.id);
    setToasts((t) => [...fresh.slice(0, MAX_TOASTS), ...t].slice(0, MAX_TOASTS));
  }, [q.data]);
  const done = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
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
  const front = toasts[0] ? heights[toasts[0].id] : undefined;
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
      {toasts.map((it, i) => {
        const h = heights[it.id];
        const lift = below;
        below += (h ?? 0) + GAP;
        return <Toast key={it.id} it={it} index={i} height={h} front={front} lift={lift} hold={open} onDone={done} onHeight={onHeight} />;
      })}
    </div>
  );
}

/** one card: a coloured edge, a life bar, its own clock (held while the deck is open), then out */
function Toast({ it, index, height, front, lift, hold, onDone, onHeight }: { it: FeedItem; index: number; height?: number; front?: number; lift: number; hold: boolean; onDone: (id: string) => void; onHeight: (id: string, h: number) => void }) {
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
    const t = window.setTimeout(() => onDone(it.id), 240);
    return () => window.clearTimeout(t);
  }, [leaving, it.id, onDone]);
  // the card's natural height (its body, not the card, which is cut to the front card's height while tucked behind)
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const report = () => onHeight(it.id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [it.id, onHeight]);
  const vars: Record<string, string | number> = { "--life": `${TOAST_MS}ms`, "--i": index, "--lift": `${-lift}px` };
  if (height !== undefined) vars["--h"] = `${height}px`;
  if (front !== undefined) vars["--fh"] = `${front}px`;
  return (
    <div className="tm-chrome-toast" data-tone={tone(it)} data-front={index === 0 || undefined} data-leaving={leaving || undefined} style={vars as React.CSSProperties}>
      <div ref={body} className="tm-chrome-toast-body">
        <span className="sr-only">
          {EYEBROW[it.type] ?? "Alert"}: {facts(it).label}
        </span>
        <div className="tm-chrome-toast-eyebrow" aria-hidden>
          <i />
          {EYEBROW[it.type] ?? "Alert"} · following
        </div>
        <button type="button" className="tm-chrome-toast-x" onClick={leave} aria-label="Dismiss alert">
          {closeIcon}
        </button>
        <AlertRow it={it} onClick={leave} />
      </div>
      <span className="tm-chrome-toast-life" aria-hidden />
    </div>
  );
}
