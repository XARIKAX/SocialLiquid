"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { fmtUsd, userLabel, userPath } from "@/lib/format";

/* ---------- identity ---------- */

/** a profile picture, or a glossy sphere tinted from the address (pass `initials` to print the handle's first letters on it) */
export function Avatar({ address, url, size = 28, handle, ring, initials }: { address: string; url?: string | null; size?: number; handle?: string | null; ring?: boolean; initials?: boolean }) {
  const h1 = (parseInt(address.slice(2, 8), 16) || 0) % 360;
  const h2 = (h1 + 40 + ((parseInt(address.slice(-4), 16) || 0) % 80)) % 360;
  const label = (handle ?? address.slice(2, 4)).slice(0, 2).toUpperCase();
  const cls = `rounded-full shrink-0 ${ring ? "ring-2 ring-bg" : ""}`;
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={size} height={size} className={`${cls} object-cover`} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className={`${cls} inline-flex items-center justify-center font-bold text-black/70`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.36),
        background: `radial-gradient(circle at 32% 26%, hsl(${h1} 95% 88% / 0.95), transparent 46%), linear-gradient(140deg, hsl(${h1} 72% 62%), hsl(${h2} 70% 38%))`,
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.16), inset 0 -2px 4px rgb(0 0 0 / 0.25), 0 2px 8px -2px rgb(0 0 0 / 0.45)",
      }}
    >
      {initials ? label : null}
    </span>
  );
}

const ICON_BASE = "https://app.hyperliquid.xyz/coins";

export function CoinIcon({ coin, size = 20, className = "" }: { coin: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const hue = (coin.charCodeAt(0) * 47 + (coin.charCodeAt(1) || 0) * 13) % 360;
  if (broken)
    return (
      <span className={`rounded-full inline-flex items-center justify-center font-bold text-white/90 shrink-0 ${className}`} style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 45% 32%)` }}>
        {coin.slice(0, 1)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${ICON_BASE}/${coin}.svg`} alt="" width={size} height={size} onError={() => setBroken(true)} className={`coin-icon rounded-full shrink-0 bg-panel-3 ${className}`} style={{ width: size, height: size }} />
  );
}

export function TraderLink({ address, handle, displayName, className = "", children }: { address: string; handle?: string | null; displayName?: string | null; className?: string; children?: ReactNode }) {
  return (
    <Link href={userPath({ handle, address })} className={`hover:underline underline-offset-2 ${className}`} onClick={(e) => e.stopPropagation()}>
      {children ?? userLabel({ handle, displayName, address })}
    </Link>
  );
}

/* ---------- numbers ---------- */

export function Pnl({ value, className = "", compact, pct, arrow }: { value: number | null | undefined; className?: string; compact?: boolean; pct?: number | null; arrow?: boolean }) {
  if (value === null || value === undefined) return <span className={`text-dim ${className}`}>–</span>;
  const c = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted";
  return (
    <span className={`num ${c} ${className}`}>
      {fmtUsd(value, { sign: true, compact })}
      {pct !== undefined && pct !== null && (
        <span className="ml-1 opacity-80 text-[0.9em]">
          {arrow ? (pct >= 0 ? "▲" : "▼") : ""} {Math.abs(pct * 100).toFixed(2)}%
        </span>
      )}
    </span>
  );
}

export function Pct({ value, className = "", digits = 2 }: { value: number | null | undefined; className?: string; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={`text-dim ${className}`}>–</span>;
  const c = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted";
  return (
    <span className={`num ${c} ${className}`}>
      {value > 0 ? "▲" : value < 0 ? "▼" : ""} {Math.abs(value * 100).toFixed(digits)}%
    </span>
  );
}

/* ---------- tags ---------- */

export function SidePill({ side, label }: { side: string; label?: string }) {
  const up = side === "LONG";
  return <span className={`pill ${up ? "pill-up" : "pill-down"}`}>{label ?? (up ? "Long" : "Short")}</span>;
}

export function EventPill({ type }: { type: string }) {
  const map: Record<string, [string, string]> = {
    LONG: ["Long", "pill-up"],
    SHORT: ["Short", "pill-down"],
    THESIS: ["Thesis", "pill-thesis"],
    CLOSED: ["Closed", "pill-neutral"],
    LIQUIDATED: ["Liquidated", "pill-liq"],
  };
  const [label, cls] = map[type] ?? [type, "pill-neutral"];
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function OutcomePill({ outcome }: { outcome: string }) {
  const map: Record<string, [string, string]> = {
    OPEN: ["Holding", "pill-brand"],
    PROFIT: ["Closed in profit", "pill-up"],
    LOSS: ["Closed at loss", "pill-down"],
    LIQUIDATED: ["Liquidated", "pill-liq"],
    DUMPED: ["Dumped < 1h", "pill-warn"],
  };
  const [label, cls] = map[outcome] ?? [outcome, "pill-neutral"];
  return <span className={`pill ${cls}`}>{label}</span>;
}

/* ---------- layout bits ---------- */

export function Card({ children, className = "", pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={`card ${pad ? "p-4" : ""} ${className}`}>{children}</section>;
}

export function Chip({ label, children, className = "", tone }: { label: string; children: ReactNode; className?: string; tone?: "up" | "down" | null }) {
  return (
    <div className={`chip ${className}`}>
      <span className="chip-label">{label}</span>
      <span className={`chip-value num ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`}>{children}</span>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={() => onChange(!on)} className={`toggle ${on ? "toggle-on" : ""}`}>
      <span className="toggle-box">{on && <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#04251f" strokeWidth="2.2"><path d="M1.5 5.5l2.5 2.5 4.5-5" /></svg>}</span>
      {label}
    </button>
  );
}

/** a pill switch with a lit knob; pass `label` to render it inline with text, or wire aria-label yourself */
export function Switch({ on, onChange, label, className = "", disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; className?: string; disabled?: boolean }) {
  const sw = <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="switch disabled:opacity-40" />;
  if (!label) return sw;
  return (
    <label className={`flex items-center justify-between gap-3 text-xs text-muted cursor-pointer select-none ${className}`}>
      <span>{label}</span>
      {sw}
    </label>
  );
}

export function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-10 h-10 rounded-full bg-panel-2 border border-line flex items-center justify-center text-muted mb-3">{icon ?? <Icon.spark />}</div>
      <div className="text-[13px] font-medium text-fg-2">{title}</div>
      {hint && <div className="text-xs text-dim mt-1 max-w-[260px] text-balance">{hint}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5, h = 56, className = "" }: { rows?: number; h?: number; className?: string }) {
  return (
    <div className={`p-3 space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: h, opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function Stat({ label, children, className = "", big }: { label: string; children: ReactNode; className?: string; big?: boolean }) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`num ${big ? "text-lg font-semibold" : "text-[13px] font-medium"}`}>{children}</span>
    </div>
  );
}

export { Icon } from "./icons";
import { Icon } from "./icons";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const s = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-[19px]";
  const px = size === "lg" ? 28 : size === "sm" ? 19 : 22;
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-[-0.03em] ${s} select-none`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mark.webp" alt="" aria-hidden width={Math.round(px * 0.8229)} height={px} decoding="async" draggable={false} className="logo-mark shrink-0" />
      <span>
        social<span className="text-brand">Liquid</span>
      </span>
    </span>
  );
}
