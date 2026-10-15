"use client";
/** the keys section's shared pieces: the section frame, avatar rings, the key card, charts and the stepper */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useKeys, useKeysActions } from "@/hooks/use-keys";
import { useKeysToast } from "@/hooks/use-keys-toast";
import type { KeysTrader } from "@/lib/keys-model";
import { fmtUsd } from "@/lib/format";
import { Icon } from "../ui";

/* ---------- section frame ---------- */

const TABS = [
  { href: "/keys", label: "Discover", match: (p: string) => p === "/keys" },
  { href: "/keys/market", label: "Keys", match: (p: string) => p.startsWith("/keys/market") },
  { href: "/keys/holdings", label: "Holdings", match: (p: string) => p.startsWith("/keys/holdings") },
  { href: "/keys/studio", label: "Studio", match: (p: string) => p.startsWith("/keys/studio") },
];

/** every keys page: the sub-nav, the preview notice and a container the layouts size themselves against */
export function KeysFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const data = useKeys();
  const toast = useKeysToast();
  const unread = Object.values(data.me.subs).reduce((a, s) => a + s.unread, 0);
  return (
    <div className="@container pb-10 overflow-x-clip" data-testid="keys-section">
      <div className="sticky top-0 z-20 -mx-px px-px pt-px pb-3 bg-bg/85 backdrop-blur">
        <div className="flex items-center gap-2 flex-wrap">
          <nav className="seg" aria-label="Keys">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={`seg-item inline-flex items-center h-8 px-3.5 text-[13px] ${t.match(pathname) ? "seg-active" : ""}`} aria-current={t.match(pathname) ? "page" : undefined}>
                {t.label}
                {t.href === "/keys/holdings" && unread > 0 && <i className="count ml-1.5">{unread}</i>}
              </Link>
            ))}
          </nav>
          {data.mode === "preview" ? (
            <span className="pill pill-warn ml-auto" title="Sample traders and numbers. Nothing in the preview is bought or charged.">Preview · sample data</span>
          ) : (
            <span className="pill pill-brand ml-auto" title="Subscriptions in USDC on Hyperliquid, keys on Solana">Live · USDC</span>
          )}
        </div>
      </div>
      {children}
      {toast && (
        <div key={toast.id} role={toast.tone === "error" ? "alert" : "status"} className="toast-in fixed bottom-20 md:bottom-16 left-1/2 -translate-x-1/2 z-50 pop px-4 py-3 flex items-center gap-3 max-w-[92vw]" data-testid="keys-toast">
          {toast.tone === "busy" ? (
            <span className="w-7 h-7 rounded-full border-2 border-brand/25 border-t-brand animate-spin shrink-0" aria-hidden="true" />
          ) : (
            <span className={`w-7 h-7 rounded-full inline-flex items-center justify-center shrink-0 ${toast.tone === "error" ? "bg-down/15 text-down" : "bg-brand/15 text-brand"}`}>{toast.tone === "error" ? "!" : <Icon.check />}</span>
          )}
          <span className="text-[13.5px] text-fg-2">{toast.text}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- people ---------- */

type Who = Pick<KeysTrader, "initials" | "colors"> & { avatarUrl?: string | null };

/** a trader's face: gradient initials, optionally inside the story ring that says they are live */
export function Face({ who, size, ring, live, square, className = "" }: { who: Who; size: number; ring?: "live" | "off"; live?: boolean; square?: boolean; className?: string }) {
  const vars = { "--a": who.colors[0], "--b": who.colors[1] } as CSSProperties;
  const font = Math.round(size * 0.3);
  const face = (
    <span className={`k-face ${square ? "k-square" : ""} ${ring ? "" : className}`} style={{ ...vars, ...(ring ? {} : { width: size, height: size }), fontSize: font }} aria-hidden="true">
      {who.avatarUrl ? <img src={who.avatarUrl} alt="" className="w-full h-full object-cover" style={{ borderRadius: "inherit" }} /> : who.initials}
    </span>
  );
  if (!ring) return face;
  return (
    <span className={`k-ring ${ring === "off" ? "k-ring-off" : ""} ${square ? "k-square" : ""} ${className}`} style={{ width: size, height: size }}>
      {face}
      {live && <span className="k-live-tag">LIVE</span>}
    </span>
  );
}

export function Verified({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Record verified onchain" className="shrink-0">
      <circle cx="12" cy="12" r="10" fill="var(--color-brand)" />
      <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="var(--color-bg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- the key card ---------- */

export function KeyCard({ t, size = "md", serial, className = "" }: { t: KeysTrader; size?: "sm" | "md" | "lg"; serial?: string; className?: string }) {
  const dims = { sm: "h-[168px] p-[18px]", md: "h-[200px] p-[22px]", lg: "h-[236px] p-[26px]" }[size];
  const up = t.key.change24h >= 0;
  return (
    <div className={`k-holo theme-dark ${className}`} data-testid={`key-card-${t.handle}`}>
      <div className={`k-holo-in ${dims}`}>
        <div className="flex items-center justify-between relative">
          <span className="k-holo-label">SOCIALLIQUID KEY</span>
          {serial ? <span className="num text-[12px] text-muted">{serial}</span> : <ChipMark />}
        </div>
        <div className="flex items-center gap-3 relative">
          <Face who={t} size={size === "lg" ? 52 : 44} square />
          <div className="min-w-0">
            <div className={`${size === "lg" ? "text-[22px]" : "text-[19px]"} font-bold tracking-tight truncate`}>{t.handle}</div>
            <div className={`num text-[12.5px] ${t.pnl30d >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(t.pnl30d, { compact: true, sign: true })} · 30d</div>
          </div>
        </div>
        <div className="flex items-end justify-between relative">
          <div>
            {size === "lg" && <div className="text-[12px] text-muted">Key price</div>}
            <div className={`num font-semibold tracking-tight ${size === "lg" ? "text-[30px]" : "text-[26px]"}`}>{fmtUsd(t.key.price)}</div>
          </div>
          {!t.key.listed ? (
            <span className="text-[12px] font-semibold text-muted">Not listed yet</span>
          ) : size === "sm" ? (
            <span className={`num text-[13px] font-semibold ${up ? "text-up" : "text-down"}`}>{up ? "+" : ""}{t.key.change24h}%</span>
          ) : (
            <span className="num text-[12.5px] font-bold text-[#04120e] bg-brand px-2.5 py-1 rounded-full">{t.key.yieldPct}% yield</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChipMark() {
  return (
    <svg width="30" height="22" viewBox="0 0 34 26" aria-hidden="true">
      <rect x="0.5" y="0.5" width="33" height="25" rx="6" fill="rgb(245 178 54 / 0.18)" stroke="rgb(245 178 54 / 0.55)" />
      <path d="M0 9h12M0 17h12M22 9h12M22 17h12M12 0v26M22 0v26" stroke="rgb(245 178 54 / 0.45)" />
    </svg>
  );
}

/* ---------- charts ---------- */

const DAY = 86_400_000;
function dayLabel(i: number, n: number) {
  return new Date(Date.now() - (n - 1 - i) * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** the key's 30-day price: one series, so no legend; a crosshair and a value tooltip on hover */
export function PriceChart({ data, height = 180, label }: { data: number[]; height?: number; label: string }) {
  const [hover, setHover] = useState(-1);
  const n = data.length;
  const W = 1000;
  const lo = Math.min(...data) * 0.94;
  const hi = Math.max(...data) * 1.03;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => height - 6 - ((v - lo) / (hi - lo)) * (height - 16);
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const on = hover >= 0;
  const pct = on ? (hover / (n - 1)) * 100 : 0;
  return (
    <div
      className="relative select-none"
      style={{ height }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (!r.width) return;
        setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
      }}
      onMouseLeave={() => setHover(-1)}
    >
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full block text-brand" style={{ height }} role="img" aria-label={label}>
        <defs>
          <linearGradient id="k-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${W} ${height} L0 ${height} Z`} fill="url(#k-area)" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {on && (
        <>
          <div className="absolute inset-y-0 w-px bg-line-2 pointer-events-none" style={{ left: `${pct}%` }} />
          <div className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-brand pointer-events-none" style={{ left: `${pct}%`, top: `${(y(data[hover]) / height) * 100}%`, boxShadow: "0 0 0 3px var(--surface-top), 0 0 16px rgb(77 227 193 / 0.6)" }} />
          <div className="absolute top-0 pop px-2.5 py-1.5 text-[12.5px] whitespace-nowrap pointer-events-none" style={{ left: `${pct}%`, transform: `translateX(${pct > 65 ? "calc(-100% - 10px)" : "10px"})` }}>
            <span className="num font-semibold">{fmtUsd(data[hover])}</span> <span className="text-muted">{dayLabel(hover, n)}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function Sparkline({ data, className = "w-[96px] h-7" }: { data: number[]; className?: string }) {
  const lo = Math.min(...data);
  const span = Math.max(...data) - lo || 1;
  const d = data.map((v, i) => `${i ? "L" : "M"}${((i / (data.length - 1)) * 100).toFixed(1)} ${(27 - ((v - lo) / span) * 24).toFixed(1)}`).join(" ");
  const down = data[data.length - 1] < data[0];
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`${className} ${down ? "text-down" : "text-brand"}`} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ---------- controls ---------- */

export function Stepper({ value, onChange, min = 1, max = 50, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="recess flex items-center p-1 rounded-[14px]" role="group" aria-label={label}>
      <button type="button" className="w-11 h-11 rounded-[10px] text-muted hover:text-fg hover:bg-[var(--row-hover)] text-xl disabled:opacity-40" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="One fewer">−</button>
      <span className="num min-w-9 text-center text-[18px] font-semibold" aria-live="polite">{value}</span>
      <button type="button" className="w-11 h-11 rounded-[10px] text-muted hover:text-fg hover:bg-[var(--row-hover)] text-xl disabled:opacity-40" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="One more">+</button>
    </div>
  );
}

/** the reset link that sits at the bottom of the preview pages; nothing in live mode */
export function ResetPreview() {
  const { mode } = useKeys();
  const actions = useKeysActions();
  if (mode === "live") return null;
  return (
    <p className="text-[12px] text-dim mt-10 text-center">
      Sample traders and numbers. Nothing in the preview is bought or charged.{" "}
      <button type="button" className="underline hover:text-fg" onClick={() => actions.reset()}>Reset the preview</button>
    </p>
  );
}

export const sidePill = (label: string) => (label.startsWith("LONG") ? "pill-up" : "pill-down");
export const priceLabel = (p: number) => (p > 0 ? `$${p}` : "Free");
/** fmtUsd compact, plus billions */
/** whole dollars for projections and totals where cents are noise */
export const usdWhole = (n: number) => `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
/** a percentage that may not exist yet (no closed trades, no history) */
export const pctOrDash = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);

/** live-mode states: loading, an error, or a section with nothing in it yet */
export function KeysState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card !rounded-[26px] px-8 py-14 text-center" data-testid="keys-state">
      <div className="text-[20px] font-bold tracking-tight">{title}</div>
      {body && <div className="text-[15px] text-muted mt-2 max-w-[460px] mx-auto leading-relaxed">{body}</div>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export const usdBig = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B` : fmtUsd(n, { compact: true }));
