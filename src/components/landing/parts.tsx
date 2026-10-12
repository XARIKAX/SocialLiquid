/* small shared pieces for the landing sections. server-safe (no hooks). */
import type { CSSProperties, ReactNode } from "react";

/** inline style helper for css custom properties (--d, --t, ...) */
export const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** the brand mark, the glass "S" (public/brand/mark.webp, 192px tall). `size` is its height in px */
export const MARK_RATIO = 0.8229;
export function Mark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/mark.webp" alt="" aria-hidden width={Math.round(size * MARK_RATIO)} height={size} decoding="async" draggable={false} className={`lp-mark ${className}`} />
  );
}

export function Wordmark({ className = "", size = 19 }: { className?: string; size?: number }) {
  return (
    <span className={`lp-wordmark ${className}`} style={{ fontSize: size }}>
      <Mark size={Math.round(size * 1.18)} />
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

/** compact dollars that scale past millions: $812K, $4.07M, $3.24B */
export function usdCompact(v: number) {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** gradient identity disc derived from an address */
export function Disc({ a, size = 20, className = "" }: { a: string; size?: number; className?: string }) {
  const h1 = (parseInt(a.slice(2, 8), 16) || 0) % 360;
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
