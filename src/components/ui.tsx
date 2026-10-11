"use client";
import Link from "next/link";
import { fmtUsd, shortAddr, userLabel, userPath } from "@/lib/format";
import type { ReactNode } from "react";

export function Avatar({ address, url, size = 24, handle }: { address: string; url?: string | null; size?: number; handle?: string | null }) {
  const hue = parseInt(address.slice(2, 8), 16) % 360;
  const hue2 = parseInt(address.slice(-6), 16) % 360;
  const label = (handle ?? address.slice(2, 4)).slice(0, 2).toUpperCase();
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={size} height={size} className="rounded-full shrink-0 object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="rounded-full shrink-0 inline-flex items-center justify-center font-bold text-black/80"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue} 70% 60%), hsl(${hue2} 70% 45%))` }}
    >
      {label}
    </span>
  );
}

export function TraderLink({ address, handle, displayName, className = "", children }: { address: string; handle?: string | null; displayName?: string | null; className?: string; children?: ReactNode }) {
  return (
    <Link href={userPath({ handle, address })} className={`hover:underline ${className}`} onClick={(e) => e.stopPropagation()}>
      {children ?? userLabel({ handle, displayName, address })}
    </Link>
  );
}

export function Pnl({ value, className = "", compact, pct }: { value: number | null | undefined; className?: string; compact?: boolean; pct?: number | null }) {
  if (value === null || value === undefined) return <span className={`text-dim ${className}`}>–</span>;
  const c = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted";
  return (
    <span className={`num ${c} ${className}`}>
      {fmtUsd(value, { sign: true, compact })}
      {pct !== undefined && pct !== null && <span className="opacity-70 ml-1">({pct > 0 ? "+" : ""}{(pct * 100).toFixed(1)}%)</span>}
    </span>
  );
}

export function SidePill({ side }: { side: string }) {
  const up = side === "LONG";
  return <span className={`pill ${up ? "bg-up/15 text-up" : "bg-down/15 text-down"}`}>{side.toLowerCase()}</span>;
}

export function OutcomePill({ outcome }: { outcome: string }) {
  const map: Record<string, string> = {
    OPEN: "bg-accent/15 text-accent",
    PROFIT: "bg-up/15 text-up",
    LOSS: "bg-down/15 text-down",
    LIQUIDATED: "bg-down/25 text-down",
    DUMPED: "bg-warn/20 text-warn",
  };
  const label: Record<string, string> = { OPEN: "held", PROFIT: "closed in profit", LOSS: "closed at loss", LIQUIDATED: "liquidated", DUMPED: "dumped <1h" };
  return <span className={`pill ${map[outcome] ?? ""}`}>{label[outcome] ?? outcome.toLowerCase()}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 text-muted">
      <div className="text-sm">{title}</div>
      {hint && <div className="text-xs text-dim mt-1 max-w-xs">{hint}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5, h = 56 }: { rows?: number; h?: number }) {
  return (
    <div className="p-2 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: h }} />
      ))}
    </div>
  );
}

export function Stat({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="text-[10px] uppercase tracking-wide text-dim">{label}</span>
      <span className="num text-xs">{children}</span>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className={`btn h-6 px-2 text-[11px] ${on ? "border-accent/60 text-accent bg-accent/10" : "text-muted"}`}>
      {label}
    </button>
  );
}
