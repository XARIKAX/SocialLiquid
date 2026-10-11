/* small shared pieces for the landing sections. server-safe (no hooks). */
import type { CSSProperties, ReactNode } from "react";

/** inline style helper for css custom properties (--d, --t, ...) */
export const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** the droplet mark: gradient body, a specular highlight, a soft glow */
export function Mark({ size = 22, id = "m" }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="lp-mark">
      <defs>
        <linearGradient id={`${id}-g`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#d4fff4" />
          <stop offset="0.45" stopColor="#6ff2d3" />
          <stop offset="1" stopColor="#1f9c84" />
        </linearGradient>
      </defs>
      <path d="M12 2.2s-7 7.6-7 12.6a7 7 0 0 0 14 0c0-5-7-12.6-7-12.6z" fill={`url(#${id}-g)`} />
      <path d="M8.6 14.6c0 2.1 1.4 3.7 3.2 4.1" fill="none" stroke="#f2fffb" strokeOpacity="0.85" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = "", size = 19, id }: { className?: string; size?: number; id?: string }) {
  return (
    <span className={`lp-wordmark ${className}`} style={{ fontSize: size }}>
      <Mark size={Math.round(size * 1.2)} id={id} />
      <span>
        social<span className="lp-wordmark-liquid">Liquid</span>
      </span>
    </span>
  );
}

export function Arrow({ className = "lp-arrow" }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function TrendArrow({ up, size = 13 }: { up: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {up ? <path d="M7 17 17 7M9 7h8v8" /> : <path d="M7 7l10 10M17 9v8H9" />}
    </svg>
  );
}

export function Check({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/** gradient identity disc derived from an address */
export function Disc({ a, size = 20, className = "" }: { a: string; size?: number; className?: string }) {
  const h1 = parseInt(a.slice(2, 8), 16) % 360;
  const h2 = (h1 + 60) % 360;
  return (
    <span
      aria-hidden
      className={`rounded-full shrink-0 inline-block ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 30% 25%, hsl(${h1} 90% 82% / 0.9), transparent 45%), linear-gradient(135deg, hsl(${h1} 72% 60%), hsl(${h2} 70% 38%))`,
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.18), 0 2px 8px -2px rgb(0 0 0 / 0.6)",
      }}
    />
  );
}

/** centred section heading block: eyebrow, lit h2, lead. pass `id` to label the section with aria-labelledby. */
export function SectionHead({ eyebrow, title, lead, id, align = "center", maxWidth = 760, className = "" }: { eyebrow: string; title: ReactNode; lead?: ReactNode; id?: string; align?: "center" | "left"; maxWidth?: number; className?: string }) {
  const c = align === "center";
  return (
    <div className={`${c ? "text-center mx-auto items-center" : "items-start"} flex flex-col ${className}`} style={{ maxWidth }}>
      <span data-reveal className={`lp-eyebrow ${c ? "lp-eyebrow-center" : ""}`}>{eyebrow}</span>
      <h2 id={id} data-reveal style={vars({ "--d": "0.08s" })} className="lp-h2 lp-lit mt-5">{title}</h2>
      {lead && (
        <p data-reveal style={vars({ "--d": "0.16s" })} className={`lp-lead mt-5 ${c ? "max-w-[600px]" : "max-w-[560px]"}`}>
          {lead}
        </p>
      )}
    </div>
  );
}
