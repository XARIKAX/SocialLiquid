"use client";
import "./layout.css";

/* small shared pieces of the side cards (styles: ./layout.css) */

/** compact dollars the way the header writes them: $2.27B, $908.75M, $122K, $16.4K, $0 */
export function money(v: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : opts.sign && v > 0 ? "+" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 1 : 2)}M`;
  if (a >= 1e5) return `${s}$${(a / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  if (a >= 1) return `${s}$${a.toFixed(0)}`;
  if (a === 0) return "$0";
  return `${s}$${a.toFixed(2)}`;
}

/**
 * long light on the left, short light on the right, a hair of dark between. `share` is the long
 * share (0..1), or null when there is nothing to split. a side with no weight is left out rather
 * than drawn as a sliver, and the side that trails dims so the eye lands on the one that leads.
 */
export function SplitBar({ share, label, small }: { share: number | null; label: string; small?: boolean }) {
  const cls = `tm-lay-bar ${small ? "tm-lay-bar-sm" : ""}`;
  if (share === null || !Number.isFinite(share))
    return (
      <div className={cls} data-empty="" role="img" aria-label={label}>
        <i />
        <i />
      </div>
    );
  // within half a percent of even, neither side leads (and neither dims)
  const lead = Math.abs(share - 0.5) < 0.005 ? undefined : share > 0.5 ? "long" : "short";
  return (
    <div className={cls} data-lead={lead} role="img" aria-label={label}>
      {share > 0 && <i className="tm-lay-bar-l" style={{ flexGrow: share }} />}
      {share < 1 && <i className="tm-lay-bar-r" style={{ flexGrow: 1 - share }} />}
    </div>
  );
}
