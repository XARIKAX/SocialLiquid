"use client";
/**
 * alerts for followed traders: a bell with an unread badge and a dropdown in the top bar,
 * plus toasts that slide in when a followed trader opens, closes or gets liquidated while you are on the page.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/client";
import type { FeedItem } from "@/lib/queries";
import { fmtUsd, timeAgo, userLabel, userPath } from "@/lib/format";
import { Avatar, CoinIcon, Icon } from "./ui";

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

function AlertRow({ it, onClick }: { it: FeedItem; onClick?: () => void }) {
  const p = it.payload as { sizeUsd?: number; leverage?: number; realisedPnl?: number };
  const name = it.user ? userLabel(it.user) : it.address.slice(0, 6) + "…" + it.address.slice(-4);
  const pnl = p.realisedPnl ?? it.position?.realisedPnl ?? null;
  return (
    <Link href={`/m/${it.coin}`} onClick={onClick} className="flex items-center gap-2.5 px-3 py-2.5 row-hover border-b border-line/60 last:border-0">
      <Avatar address={it.address} url={it.user?.avatarUrl} handle={it.user?.handle ?? it.user?.displayName} size={30} />
      <span className="min-w-0 flex-1 leading-tight text-[13px]">
        <span className="block truncate"><b>{name}</b> {verb(it)} <b>{it.coin}</b></span>
        <span className="block text-[11px] text-dim num">
          {p.leverage ? `${p.leverage}x` : ""}{p.sizeUsd ? ` · ${fmtUsd(p.sizeUsd, { compact: true })}` : ""}
          {(it.type === "CLOSED" || it.type === "LIQUIDATED") && pnl !== null && <span className={pnl >= 0 ? " text-up" : " text-down"}> · {fmtUsd(pnl, { sign: true })}</span>}
          {" · "}
          {timeAgo(it.time)}
        </span>
      </span>
      <CoinIcon coin={it.coin} size={20} />
    </Link>
  );
}

/** top-bar bell: unread badge, dropdown with the latest alerts, mark-read on open */
export function AlertsBell() {
  const q = useAlerts();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = q.data?.unread ?? 0;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
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
    if (next && unread > 0) {
      await api("/api/alerts", { method: "POST" }).catch(() => {});
      qc.setQueryData<Alerts>(["alerts"], (d) => (d ? { ...d, unread: 0, seenAt: new Date().toISOString() } : d));
    }
  };
  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-ghost h-9 w-9 px-0 relative" onClick={toggle} title="Alerts" aria-label={`alerts${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}>
        <Icon.bell />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-black text-[10px] font-bold inline-flex items-center justify-center num">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-[360px] max-w-[calc(100vw-24px)] card shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 h-10 border-b border-line">
            <span className="text-[13px] font-semibold">Alerts</span>
            <span className="text-[11px] text-dim">traders you follow</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {q.isLoading && <div className="p-4 text-xs text-dim">Loading…</div>}
            {q.data && q.data.items.length === 0 && (
              <div className="p-5 text-center">
                <div className="text-sm font-medium">No alerts yet</div>
                <div className="text-xs text-muted mt-1">Follow a few traders from the <Link href="/leaderboard" className="text-brand hover:underline" onClick={() => setOpen(false)}>leaderboard</Link> and their moves land here the second they hit chain.</div>
              </div>
            )}
            {q.data?.items.map((it) => (
              <AlertRow key={it.id} it={it} onClick={() => setOpen(false)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TOAST_MS = 7000;
const MAX_TOASTS = 3;

/** mount once: toasts for alerts that arrive while the page is open */
export function AlertToasts() {
  const q = useAlerts();
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<FeedItem[]>([]);
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
    const ids = fresh.map((i) => i.id);
    const timer = setTimeout(() => setToasts((t) => t.filter((x) => !ids.includes(x.id))), TOAST_MS);
    return () => clearTimeout(timer);
  }, [q.data]);
  if (!toasts.length) return null;
  return (
    <div className="fixed right-3 bottom-14 md:bottom-12 z-[55] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-24px)]" aria-live="polite">
      {toasts.map((it) => (
        <div key={it.id} className="toast-in card shadow-2xl border-brand/30 overflow-hidden">
          <AlertRow it={it} onClick={() => setToasts((t) => t.filter((x) => x.id !== it.id))} />
        </div>
      ))}
    </div>
  );
}
