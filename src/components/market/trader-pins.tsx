"use client";
/**
 * trader pins: avatars on the chart at the entry price and time of open positions on this market, for the traders you
 * follow plus the biggest books. hover (or tap) opens a card with the trade, its live pnl, the thesis and a Copy button.
 * the chart hands us a projector from (time, price) to pixels; we only lay out html on top of it.
 */
import Link from "next/link";
import { useState } from "react";
import type { UserLite } from "@/lib/queries";
import { fmtPx, fmtUsd, timeAgo, userLabel } from "@/lib/format";
import { livePnl } from "@/hooks/use-market";
import { Avatar, Icon, Pnl, TraderLink } from "../ui";

export type TraderPin = {
  id: string;
  address: string;
  user: UserLite | null;
  side: "LONG" | "SHORT";
  entryPx: number;
  size: number;
  sizeUsd: number;
  leverage: number;
  /** ms epoch */
  time: number;
  thesis: string | null;
  followed: boolean;
};

export type Project = (timeMs: number, price: number) => { x: number; y: number; clampedLeft: boolean } | null;

const PIN = 22;

export function copyHrefFor(coin: string, p: TraderPin) {
  const q = new URLSearchParams({ copy: p.id, from: p.address, side: p.side, lev: String(p.leverage), name: p.user ? userLabel(p.user) : p.address.slice(0, 6) + "…" + p.address.slice(-4) });
  return `/m/${coin}?${q.toString()}`;
}

export function TraderPins({ coin, pins, project, lastPx, width, height }: { coin: string; pins: TraderPin[]; project: Project; lastPx?: number; width: number; height: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  if (!width || !height) return null;
  // place, then push overlapping pins down so every avatar stays visible
  const placed: { p: TraderPin; x: number; y: number; clamped: boolean }[] = [];
  for (const p of [...pins].sort((a, b) => a.time - b.time)) {
    const xy = project(p.time, p.entryPx);
    if (!xy) continue;
    if (xy.y < -PIN || xy.y > height + PIN) continue;
    let y = xy.y;
    for (let i = 0; i < 6; i++) {
      const hit = placed.find((q) => Math.abs(q.x - xy.x) < PIN && Math.abs(q.y - y) < PIN);
      if (!hit) break;
      y = hit.y + PIN + 2;
    }
    placed.push({ p, x: Math.min(width - PIN / 2, Math.max(PIN / 2, xy.x)), y: Math.min(height - PIN / 2, Math.max(PIN / 2, y)), clamped: xy.clampedLeft });
  }
  const active = open ?? hover;
  return (
    <div className="absolute inset-0 z-[25] pointer-events-none" data-testid="trader-pins" data-count={placed.length}>
      {placed.map(({ p, x, y, clamped }) => {
        const col = p.side === "LONG" ? "var(--color-up)" : "var(--color-down)";
        const isActive = active === p.id;
        return (
          <button
            key={p.id}
            type="button"
            className={`absolute pointer-events-auto rounded-full transition-transform ${isActive ? "scale-125 z-[8]" : "hover:scale-110"}`}
            style={{ left: x - PIN / 2, top: y - PIN / 2, width: PIN, height: PIN, boxShadow: `0 0 0 2px ${col}, 0 0 0 3px rgb(0 0 0 / 0.5)${p.followed ? `, 0 0 10px ${col}` : ""}`, opacity: clamped ? 0.75 : 1 }}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => (o === p.id ? null : p.id)); }}
            title={`${p.user ? userLabel(p.user) : p.address.slice(0, 8)} · ${p.side === "LONG" ? "long" : "short"} ${fmtUsd(p.sizeUsd, { compact: true })} at ${fmtPx(p.entryPx)}`}
            aria-label={`${p.side} by ${p.user ? userLabel(p.user) : p.address}`}
            data-testid={`pin-${p.address}`}
            data-xy={`${Math.round(x)},${Math.round(y)}${clamped ? ",clamped" : ""}`}
          >
            <Avatar address={p.address} url={p.user?.avatarUrl} handle={p.user?.handle ?? p.user?.displayName} size={PIN} />
            <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full text-[8px] leading-3 text-center font-bold text-black" style={{ background: col }}>{p.side === "LONG" ? "L" : "S"}</span>
          </button>
        );
      })}
      {placed.filter(({ p }) => p.id === active).map(({ p, x, y }) => {
        const pnl = livePnl({ side: p.side, size: p.size, entryPx: p.entryPx }, lastPx);
        const roe = pnl !== null && p.sizeUsd ? (pnl * p.leverage) / p.sizeUsd : null;
        const left = x + 16 + 260 > width ? Math.max(4, x - 16 - 260) : x + 16;
        const top = Math.min(Math.max(4, y - 20), Math.max(4, height - 170));
        return (
          <div key={`card-${p.id}`} className="absolute pointer-events-auto card shadow-2xl p-3 w-[260px] text-xs z-[9]" style={{ left, top }} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} data-testid="pin-card">
            <div className="flex items-center gap-2">
              <TraderLink address={p.address} handle={p.user?.handle} displayName={p.user?.displayName} className="shrink-0 hover:no-underline">
                <Avatar address={p.address} url={p.user?.avatarUrl} handle={p.user?.handle ?? p.user?.displayName} size={28} />
              </TraderLink>
              <div className="min-w-0 flex-1 leading-tight">
                <TraderLink address={p.address} handle={p.user?.handle} displayName={p.user?.displayName} className="font-semibold text-[13px] truncate block" />
                <span className="text-dim num">{timeAgo(new Date(p.time).toISOString())}{p.followed ? " · following" : ""}</span>
              </div>
              <span className={`pill ${p.side === "LONG" ? "pill-up" : "pill-down"}`}>{p.side === "LONG" ? "Long" : "Short"} {p.leverage}x</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 num">
              <div><div className="text-dim text-[10px]">Size</div><div className="font-semibold">{fmtUsd(p.sizeUsd, { compact: true })}</div></div>
              <div><div className="text-dim text-[10px]">Entry</div><div className="font-semibold">{fmtPx(p.entryPx)}</div></div>
              <div><div className="text-dim text-[10px]">PnL</div><div className="font-semibold">{pnl === null ? "–" : <Pnl value={pnl} />}{roe !== null && <span className={`block text-[10px] ${roe >= 0 ? "text-up" : "text-down"}`}>{roe >= 0 ? "▲" : "▼"} {Math.abs(roe * 100).toFixed(1)}%</span>}</div></div>
            </div>
            {p.thesis && <p className="mt-2 text-[12px] leading-snug text-fg-2 line-clamp-3"><span className="text-thesis font-medium">Thesis · </span>{p.thesis}</p>}
            <div className="flex items-center gap-2 mt-2.5">
              <Link href={copyHrefFor(coin, p)} className="btn h-8 px-3 text-[12px] font-semibold border-brand/40 text-brand hover:bg-brand/10 flex-1 justify-center" data-testid="pin-copy"><Icon.copy /> Copy this trade</Link>
              <TraderLink address={p.address} handle={p.user?.handle} displayName={p.user?.displayName} className="btn h-8 px-3 text-[12px]">Profile</TraderLink>
            </div>
          </div>
        );
      })}
    </div>
  );
}
