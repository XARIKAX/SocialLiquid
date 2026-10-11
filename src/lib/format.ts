export function fmtUsd(n: number | string | null | undefined, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (n === null || n === undefined || n === "") return "–";
  const v = Number(n);
  if (!Number.isFinite(v)) return "–";
  const abs = Math.abs(v);
  let body: string;
  if (opts.compact && abs >= 1_000_000) body = `$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}m`;
  else if (opts.compact && abs >= 10_000) body = `$${(abs / 1_000).toFixed(1)}k`;
  else body = `$${abs.toLocaleString("en-US", { minimumFractionDigits: abs < 1 ? 4 : 2, maximumFractionDigits: abs < 1 ? 4 : 2 })}`;
  if (v < 0) return `-${body}`;
  return opts.sign && v > 0 ? `+${body}` : body;
}

export function fmtPx(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "–";
  const v = Number(n);
  if (!Number.isFinite(v)) return "–";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (v >= 0.01) return v.toFixed(4);
  return v.toPrecision(3);
}

export function fmtPct(n: number | string | null | undefined, digits = 2, sign = true): string {
  if (n === null || n === undefined) return "–";
  const v = Number(n) * 100;
  if (!Number.isFinite(v)) return "–";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function fmtNum(n: number | string, digits = 2): string {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function timeAgo(d: Date | string | number): string {
  const t = typeof d === "number" ? d : new Date(d).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `${dd}d`;
  return `${Math.floor(dd / 30)}mo`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "–";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

/** label for a trader: claimed handle, else hyperliquid display name, else short address */
export function userLabel(u: { handle?: string | null; address: string; displayName?: string | null }): string {
  return u.handle ?? u.displayName ?? shortAddr(u.address);
}

/** profile path: only a claimed handle resolves, otherwise the address */
export function userPath(u: { handle?: string | null; address: string }): string {
  return `/t/${u.handle ?? u.address}`;
}
