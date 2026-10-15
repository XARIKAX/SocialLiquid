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

type Note = { id: string; type: "COPIED" | "REPLY" | "REACTION" | "THESIS_SETTLED" | "CREATOR_POST" | "SUB_ENDING"; actorAddress: string | null; actor: { address: string; handle: string | null; displayName: string | null; avatarUrl: string | null } | null; coin: string | null; eventId: string | null; thesisId: string | null; positionId: string | null; payload: Record<string, unknown>; createdAt: string };
type Alerts = { items: FeedItem[]; notes?: Note[]; seenAt: string | null; unread: number };
type Row = { key: string; time: string; node: React.ReactNode };
const EMOJI: Record<string, string> = { fire: "🔥", skull: "💀", eyes: "👀" };
const POST_WORD: Record<string, string> = { call: "a call", exit: "an exit", lesson: "a lesson", loss: "a loss breakdown", note: "a note" };
const timeAhead = (iso: string) => {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
};

/** a social notification: who did what to which of your trades or theses */
function NoteRow({ n, me, onClick }: { n: Note; me?: string | null; onClick?: () => void }) {
  const who = n.actor ? userLabel(n.actor) : n.actorAddress ? n.actorAddress.slice(0, 6) + "…" + n.actorAddress.slice(-4) : "";
  const p = n.payload as { side?: string; sizeUsd?: number; leverage?: number; text?: string; emoji?: string; outcome?: string; realisedPnl?: number; eventType?: string; kind?: string; handle?: string; paidUntil?: string };
  const thing = p.eventType === "THESIS" ? "thesis" : "trade";
  let text: React.ReactNode;
  let sub: React.ReactNode = null;
  switch (n.type) {
    case "COPIED":
      text = <><b>{who}</b> copied your <b>{n.coin}</b> {p.side === "SHORT" ? "short" : "long"}</>;
      sub = <>{p.leverage ? `${p.leverage}x` : ""}{p.sizeUsd ? ` · ${fmtUsd(p.sizeUsd, { compact: true })}` : ""}</>;
      break;
    case "REPLY":
      text = <><b>{who}</b> commented on your <b>{n.coin}</b> {thing}</>;
      sub = p.text ? <span className="italic">“{p.text}”</span> : null;
      break;
    case "REACTION":
      text = <><b>{who}</b> reacted {EMOJI[p.emoji ?? ""] ?? ""} to your <b>{n.coin}</b> {thing}</>;
      break;
    case "CREATOR_POST":
      text = <><b>{who}</b> posted {POST_WORD[p.kind ?? ""] ?? "an update"}{n.coin ? <> on <b>{n.coin}</b></> : null}</>;
      sub = p.text ? <span>{p.text}</span> : null;
      break;
    case "SUB_ENDING":
      text = <>Your subscription to <b>{who}</b> ends {p.paidUntil ? timeAhead(p.paidUntil) : "soon"}</>;
      sub = <>Renew from their page to keep the feed</>;
      break;
    default:
      text = <>Your <b>{n.coin}</b> thesis settled: <b className={p.outcome === "PROFIT" ? "text-up" : p.outcome === "OPEN" ? "" : "text-down"}>{(p.outcome ?? "").toLowerCase()}</b></>;
      sub = p.realisedPnl !== undefined ? <span className={(p.realisedPnl ?? 0) >= 0 ? "text-up" : "text-down"}>{fmtUsd(p.realisedPnl ?? 0, { sign: true })}</span> : null;
  }
  const href = n.type === "CREATOR_POST" || n.type === "SUB_ENDING" ? `/keys/${encodeURIComponent(p.handle ?? n.actorAddress ?? "")}` : n.thesisId && me ? `/t/${me}/thesis/${n.thesisId}` : `/m/${n.coin ?? ""}`;
  return (
    <Link href={href} onClick={onClick} className="flex items-center gap-2.5 px-3 py-2.5 row-hover border-b border-line/60 last:border-0" data-testid={`note-${n.type}`}>
      {n.actorAddress ? <Avatar address={n.actorAddress} url={n.actor?.avatarUrl} handle={n.actor?.handle ?? n.actor?.displayName} size={30} /> : <span className="w-[30px] h-[30px] rounded-full bg-thesis/15 text-thesis inline-flex items-center justify-center shrink-0"><Icon.check /></span>}
      <span className="min-w-0 flex-1 leading-tight text-[13px]">
        <span className="block truncate">{text}</span>
        <span className="block text-[11px] text-dim num truncate">{sub}{sub ? " · " : ""}{timeAgo(n.createdAt)}</span>
      </span>
      {n.coin && <CoinIcon coin={n.coin} size={20} />}
    </Link>
  );
}

/** followed-trader events and social notifications in one list, newest first */
function rows(d: Alerts | undefined, me: string | null | undefined, onClick: () => void): Row[] {
  if (!d) return [];
  const out: Row[] = [
    ...d.items.map((it) => ({ key: `e-${it.id}`, time: it.time, node: <AlertRow key={`e-${it.id}`} it={it} onClick={onClick} /> })),
    ...(d.notes ?? []).map((n) => ({ key: `n-${n.id}`, time: n.createdAt, node: <NoteRow key={`n-${n.id}`} n={n} me={me} onClick={onClick} /> })),
  ];
  return out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
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
  const { me } = useAuth();
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
            <span className="text-[11px] text-dim">traders you follow · subscriptions · activity on yours</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {q.isLoading && <div className="p-4 text-xs text-dim">Loading…</div>}
            {q.data && q.data.items.length === 0 && (q.data.notes ?? []).length === 0 && (
              <div className="p-5 text-center">
                <div className="text-sm font-medium">No alerts yet</div>
                <div className="text-xs text-muted mt-1">Follow a few traders from the <Link href="/leaderboard" className="text-brand hover:underline" onClick={() => setOpen(false)}>leaderboard</Link> and their moves land here the second they hit chain.</div>
              </div>
            )}
            {rows(q.data, me?.user?.handle ?? null, () => setOpen(false)).map((r) => r.node)}
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
  const { me } = useAuth();
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<Row[]>([]);
  useEffect(() => {
    const items = q.data ? rows(q.data, me?.user?.handle ?? null, () => {}) : undefined;
    if (!items) return;
    if (seen.current === null) {
      // first load: everything already on the list is old news
      seen.current = new Set(items.map((i) => i.key));
      return;
    }
    const fresh = items.filter((i) => !seen.current!.has(i.key));
    if (!fresh.length) return;
    for (const i of fresh) seen.current.add(i.key);
    setToasts((t) => [...fresh.slice(0, MAX_TOASTS), ...t].slice(0, MAX_TOASTS));
    const ids = fresh.map((i) => i.key);
    const timer = setTimeout(() => setToasts((t) => t.filter((x) => !ids.includes(x.key))), TOAST_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  if (!toasts.length) return null;
  return (
    <div className="fixed right-3 bottom-14 md:bottom-12 z-[55] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-24px)]" aria-live="polite">
      {toasts.map((r) => (
        <div key={r.key} className="toast-in card shadow-2xl border-brand/30 overflow-hidden" onClick={() => setToasts((t) => t.filter((x) => x.key !== r.key))}>
          {r.node}
        </div>
      ))}
    </div>
  );
}
