"use client";
import "../trade/bottom-panel.css";
import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fmtDuration, fmtPx, fmtUsd, shortAddr, timeAgo, userPath } from "@/lib/format";
import { livePnl } from "@/hooks/use-market";
import type { FeedItem, UserLite } from "@/lib/queries";
import { Avatar, Icon, Toggle, TraderLink } from "../ui";
import { useAuth } from "@/hooks/use-auth";
import { useConnectModal } from "../connect-modal";
import { FeedCard } from "../feed/feed-card";

export type MarketPosition = {
  id: string;
  address: string;
  user: UserLite | null;
  side: string;
  size: number;
  sizeUsd: number;
  leverage: number;
  entryPx: number;
  openedAt: string;
  unrealisedPnl: number;
  closedCount: number;
  avgHoldMs: number | null;
  thesis: { id: string; text: string; likes: number; outcome: string } | null;
};

export type MarketTrade = {
  id: string;
  address: string;
  user: UserLite | null;
  dir: string;
  side: string;
  px: number;
  sz: number;
  usd: number;
  closedPnl: number;
  liquidation: boolean;
  time: string;
};

type Sort = "pnl" | "size";
type Dir = "desc" | "asc";
type Tab = "positions" | "trades" | "thesis";
export type TradersView = Tab;

/* =====================================================================
   shared pieces of the bottom deck (bottom-panel.tsx imports these; the
   styles live in ../trade/bottom-panel.css under .tm-bp-*)
   ===================================================================== */

/* ---------- icons (inline, 24 grid, stroke 1.8, rounded) ---------- */
const ICO: Record<string, ReactNode> = {
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  pen: <path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />,
  pencil: <path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.5l3 3" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  receipt: <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17zM9.5 8.5h5M9.5 12.5h5" />,
  percent: <path d="M18.5 5.5l-13 13M8 9.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5zM16 18a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z" />,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  history: <path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3M3.5 4.5v4.5H8M12 7.5V12l3 2" />,
  bars: <path d="M5 19.5v-5M10 19.5v-9M15 19.5v-12M20 19.5v-7" />,
  radar: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12l5.5-5.5" />
    </>
  ),
  wallet: <path d="M3.5 7.5a2 2 0 0 1 2-2h12a1 1 0 0 1 1 1v2M3.5 7.5v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-14a2 2 0 0 1-2-2zM16.5 14.5h.01" />,
  layers: <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5zM3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />,
  users: <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.85M15.5 4.15a3.5 3.5 0 0 1 0 6.7" />,
  arrow: <path d="M12 5v13M7 13l5 5 5-5" />,
  chevL: <path d="m14.5 6-6 6 6 6" />,
  chevR: <path d="m9.5 6 6 6-6 6" />,
  check: <path d="m7 12.5 3.2 3.2L17 9" />,
};
export type BpIconName = keyof typeof ICO;

export function BpIcon({ n, size = 14, sw = 1.8, className }: { n: BpIconName; size?: number; sw?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {ICO[n]}
    </svg>
  );
}

/* ---------- formatting ---------- */

/** how the deck names a trader (as the mock and the rail do): @handle once claimed, else the hyperliquid name, else a short address */
export function bpName(u: { handle?: string | null; displayName?: string | null } | null | undefined, address: string): string {
  return u?.handle ? `@${u.handle}` : u?.displayName ?? shortAddr(address);
}

/** signed usd for pnl. `whole` drops the cents from $1k up (the mock's headline "+$1,139"); columns keep cents so they align */
export function fmtPnl(v: number, whole = false): string {
  const abs = Math.abs(v);
  const body = whole && abs >= 1000 ? `$${Math.round(abs).toLocaleString("en-US")}` : fmtUsd(abs);
  return v > 0 ? `+${body}` : v < 0 ? `-${body}` : body;
}

export function fmtSignedPct(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "–";
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v * 100).toFixed(digits)}%`;
}

/** a price with steady decimals so a column lines up: one place from 1,000 up (the shared fmtPx drops a trailing ".0") */
export function bpPx(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return fmtPx(v);
}

/** a contract quantity, to a sensible number of places */
export function fmtQty(v: number): string {
  const a = Math.abs(v);
  if (!Number.isFinite(a)) return "–";
  if (a === 0) return "0";
  if (a >= 1000) return a.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (a >= 1) return a.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return String(Number(a.toPrecision(4)));
}

/** a timestamp as a mono time over a dim date */
export function BpStamp({ ms }: { ms: number }) {
  const d = new Date(ms);
  return (
    <span className="tm-bp-2" title={d.toLocaleString("en-US", { hour12: false })}>
      <span className="num tm-bp-fg2">{d.toLocaleTimeString("en-US", { hour12: false })}</span>
      <span className="tm-bp-sub">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
    </span>
  );
}

/** a fill's direction as a pill: opens and flips in their side's colour, closes neutral, liquidations hot */
export function fillPill(dir: string, liquidation: boolean): { label: string; cls: string } {
  if (liquidation || /liquidat/i.test(dir)) return { label: /liquidat/i.test(dir) ? dir : "Liquidation", cls: "pill-liq" };
  const flip = dir.includes(">");
  const side = flip ? dir.split(">").pop() ?? "" : dir;
  if (/open/i.test(dir) || flip) return { label: dir, cls: /short/i.test(side) ? "pill-down" : "pill-up" };
  if (/long|short/i.test(dir)) return { label: dir, cls: "pill-neutral" };
  return { label: dir, cls: /sell|^a$/i.test(dir) ? "pill-down" : "pill-up" };
}

/* ---------- cells ---------- */

/** pnl that glows in its colour, return on equity under it */
export function BpPnl({ v, roe, glow = true }: { v: number | null | undefined; roe?: number | null; glow?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span className="tm-bp-dim">–</span>;
  const tone = v > 0 ? "up" : v < 0 ? "down" : "flat";
  return (
    <span className={`tm-bp-pnl tm-bp-${tone} ${glow ? "tm-bp-glow" : ""}`}>
      <b className="num">{fmtPnl(v)}</b>
      {roe !== undefined && roe !== null && Number.isFinite(roe) && <small className="num">{fmtSignedPct(roe)}</small>}
    </span>
  );
}

/** a single-line signed usd amount in its colour */
export function BpMoney({ v, glow, sign = true, dash = true }: { v: number | null | undefined; glow?: boolean; sign?: boolean; dash?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v) || (dash && v === 0)) return <span className="tm-bp-dim">–</span>;
  const tone = v > 0 ? "up" : v < 0 ? "down" : "flat";
  return <span className={`num tm-bp-${tone} ${glow ? "tm-bp-glow" : ""}`}>{fmtUsd(v, { sign })}</span>;
}

/** sphere avatar + handle + claim seal, with a mono sub line */
export function BpTrader({ address, user, sub, subClass = "", size = 28, extra }: { address: string; user: UserLite | null; sub?: ReactNode; subClass?: string; size?: number; extra?: ReactNode }) {
  const handle = user?.handle;
  const name = bpName(user, address);
  return (
    <div className="tm-bp-who">
      <Link href={userPath({ handle, address })} className="tm-bp-av-link" tabIndex={-1} aria-hidden onClick={(e) => e.stopPropagation()}>
        <span className="tm-bp-av">
          <Avatar address={address} url={user?.avatarUrl} handle={handle ?? user?.displayName} size={size} />
        </span>
      </Link>
      <div className="tm-bp-who-txt">
        <span className="tm-bp-name-row">
          <TraderLink address={address} handle={handle} displayName={user?.displayName} className="tm-bp-name">
            {name}
          </TraderLink>
          {user?.claimed && (
            <span className="tm-bp-seal" title="Claimed profile">
              <BpIcon n="check" size={9} sw={3} />
              <span className="sr-only">claimed</span>
            </span>
          )}
          {extra}
        </span>
        {sub && <span className={`tm-bp-sub ${subClass}`}>{sub}</span>}
      </div>
    </div>
  );
}

/** an empty view: the icon in a breathing glow ring, a title, a hint, an optional action */
export function BpEmpty({ icon, title, hint, tone = "mint", action }: { icon?: ReactNode; title: string; hint?: ReactNode; tone?: "mint" | "thesis" | "neutral"; action?: ReactNode }) {
  return (
    <div className="tm-bp-empty">
      <span className="tm-bp-ring" data-tone={tone} aria-hidden>
        {icon ?? <Icon.spark />}
      </span>
      <p className="tm-bp-empty-title">{title}</p>
      {hint && <p className="tm-bp-empty-hint">{hint}</p>}
      {action && <div className="tm-bp-empty-act">{action}</div>}
    </div>
  );
}

/**
 * placeholder rows while a table loads: lit glass bars with a slow light sweep, fading down the table, in the
 * shape of the rows to come (a sphere over two lines, a pill, a value over its sub line). pass `cells` (the
 * head's classes, column by column) so the rows span the same columns and drop out at the same widths.
 */
export function BpSkelRows({ cols, cells, rows = 6, avatar }: { cols?: number; cells?: string[]; rows?: number; avatar?: boolean }) {
  const list = cells ?? Array.from({ length: cols ?? 4 }, (_, j) => (j > 1 ? "r" : ""));
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="tm-bp-skel" style={{ opacity: 1 - i * 0.13 }} aria-hidden>
          {list.map((cls, j) => {
            const right = /\br\b/.test(cls);
            return (
              <td key={j} className={cls}>
                {j === 0 ? (
                  <span className="tm-bp-skel-who">
                    {avatar && <span className="skeleton tm-bp-skel-av" />}
                    <span className="tm-bp-skel-2">
                      <span className="skeleton" style={{ width: 88 - (i % 3) * 10 }} />
                      <span className="skeleton tm-bp-skel-sub" style={{ width: 52 }} />
                    </span>
                  </span>
                ) : j === 1 && avatar ? (
                  <span className="skeleton tm-bp-skel-pill" />
                ) : (
                  <span className={`tm-bp-skel-2 ${right ? "tm-bp-skel-r" : ""}`}>
                    <span className="skeleton" style={{ width: 58 - ((i + j) % 3) * 6 }} />
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/** connect (or finish signing in) from an empty state */
export function BpConnect({ label = "Connect wallet" }: { label?: string }) {
  const { needsSignIn, signIn, busy } = useAuth();
  const connect = useConnectModal();
  return needsSignIn ? (
    <button type="button" className="btn btn-sm btn-primary" onClick={() => void signIn()} disabled={busy}>
      <BpIcon n="check" size={13} sw={2.2} /> {busy ? "Check your wallet…" : "Sign in"}
    </button>
  ) : (
    <button type="button" className="btn btn-sm btn-primary" onClick={connect.open}>
      <Icon.wallet /> {label}
    </button>
  );
}

/** arrow keys, home and end across a row of tabs (the active one holds the focus stop) */
export function roveTabs<T extends string>(e: KeyboardEvent<HTMLElement>, ids: readonly T[], current: T, select: (t: T) => void) {
  const i = ids.indexOf(current);
  let next: number | null = null;
  if (e.key === "ArrowRight") next = (i + 1) % ids.length;
  else if (e.key === "ArrowLeft") next = (i - 1 + ids.length) % ids.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = ids.length - 1;
  if (next === null) return;
  e.preventDefault();
  select(ids[next]);
  e.currentTarget.querySelector<HTMLElement>(`[data-id="${ids[next]}"]`)?.focus({ preventScroll: true });
}

/**
 * rows that arrive after the first paint land with a mint wash. ids seen at (or before) the first
 * render, or right after `resetKey` changes (a filter flip), are treated as already there.
 */
export function useFreshRows(ids: string[] | null, resetKey: string, ms = 2000) {
  const seen = useRef<{ key: string; at: Map<string, number> } | null>(null);
  const now = Date.now();
  if (ids) {
    if (!seen.current || seen.current.key !== resetKey) seen.current = { key: resetKey, at: new Map(ids.map((id) => [id, 0])) };
    else for (const id of ids) if (!seen.current.at.has(id)) seen.current.at.set(id, now);
  }
  return (id: string) => {
    const t = seen.current?.at.get(id) ?? 0;
    return t > 0 && now - t < ms;
  };
}

/* =====================================================================
   the traders view: who is in this market, what they filled, and why
   ===================================================================== */

function SortHead({ k, label, sort, dir, onSort, className = "" }: { k: Sort; label: string; sort: Sort; dir: Dir; onSort: (k: Sort) => void; className?: string }) {
  const on = sort === k;
  return (
    <th className={className} aria-sort={on ? (dir === "desc" ? "descending" : "ascending") : "none"}>
      <button type="button" className="tm-bp-sort" data-on={on || undefined} data-dir={dir} onClick={() => onSort(k)} title={`Sort by ${label.toLowerCase()}`}>
        {label}
        <BpIcon n="arrow" size={10} sw={2.4} />
      </button>
    </th>
  );
}

const VIEWS: readonly Tab[] = ["positions", "trades", "thesis"];

export function PositionsTable({
  coin,
  positions,
  trades,
  theses,
  mid,
  loading,
  thesisOnly,
  following,
  setThesisOnly,
  setFollowing,
  initialTab = "positions",
  tab: tabProp,
  onTabChange,
}: {
  coin: string;
  initialTab?: Tab;
  positions: MarketPosition[] | undefined;
  trades: MarketTrade[] | undefined;
  theses: FeedItem[] | undefined;
  mid?: number;
  loading: boolean;
  thesisOnly: boolean;
  following: boolean;
  setThesisOnly: (v: boolean) => void;
  setFollowing: (v: boolean) => void;
  /** optional: drive the view from outside (the bottom panel keeps its own tabs in step) */
  tab?: Tab;
  onTabChange?: (t: Tab) => void;
}) {
  const [sort, setSort] = useState<Sort>("size");
  const [dir, setDir] = useState<Dir>("desc");
  const [tabState, setTabState] = useState<Tab>(initialTab);
  const tab = tabProp ?? tabState;
  const setTab = (t: Tab) => {
    setTabState(t);
    onTabChange?.(t);
  };
  const { signedIn } = useAuth();
  const rows = useMemo(() => {
    const list = (positions ?? []).map((p) => ({ ...p, pnl: livePnl(p, mid) ?? p.unrealisedPnl }));
    const k = dir === "desc" ? -1 : 1;
    return list.sort((a, b) => k * (sort === "pnl" ? a.pnl - b.pnl : a.sizeUsd - b.sizeUsd));
  }, [positions, mid, sort, dir]);
  const onSort = (k: Sort) => {
    if (k === sort) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(k);
      setDir("desc");
    }
  };
  const filterKey = `${coin}:${thesisOnly}:${following}`;
  /* undefined means "not here yet" (a filter flip starts a new query): show the sweep, never a false "no positions" */
  const posLoading = loading || positions === undefined;
  const fillsLoading = loading || trades === undefined;
  const freshPos = useFreshRows(positions ? positions.map((p) => p.id) : null, filterKey);
  const freshFill = useFreshRows(trades ? trades.map((t) => t.id) : null, filterKey);

  const counts: Record<Tab, number> = { positions: positions?.length ?? 0, trades: 0, thesis: theses?.length ?? 0 };
  const label: Record<Tab, string> = { positions: "Positions", trades: "Trades", thesis: "Thesis" };
  const panelId = `tm-bp-traders-${tab}`;

  return (
    <div className="tm-bp-view">
      <div className="tm-bp-bar">
        <div className="seg tm-bp-seg" role="tablist" aria-label="Traders view" onKeyDown={(e) => roveTabs(e, VIEWS, tab, setTab)}>
          {VIEWS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              data-id={t}
              id={`tm-bp-tv-${t}`}
              aria-selected={tab === t}
              aria-controls={`tm-bp-traders-${t}`}
              tabIndex={tab === t ? 0 : -1}
              className={`seg-item ${tab === t ? "seg-active" : ""}`}
              onClick={() => setTab(t)}
            >
              {label[t]}
              {/* the strip above already carries the bright lozenge: one level down the count stays tinted */}
              {counts[t] > 0 && <i className={`num tm-bp-q ${tab === t ? "tm-bp-q-live" : ""}`}>{counts[t]}</i>}
            </button>
          ))}
        </div>
        <div className="tm-bp-bar-end">
          {tab === "positions" && (
            <span className="tm-bp-sortctl">
              <span className="label-caps tm-bp-sort-l" aria-hidden>
                Sort
              </span>
              <span className="seg" role="group" aria-label="Sort positions by">
                {(["size", "pnl"] as Sort[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={sort === s}
                    className={`seg-item ${sort === s ? "seg-active" : ""}`}
                    onClick={() => {
                      setSort(s);
                      setDir("desc");
                    }}
                  >
                    {s === "size" ? "Size" : "PnL"}
                  </button>
                ))}
              </span>
            </span>
          )}
          {/* the market filters shape positions and fills; the thesis list is its own stream */}
          {tab !== "thesis" && (
            <>
              <Toggle on={thesisOnly} onChange={setThesisOnly} label="Thesis only" />
              <Toggle on={following} onChange={setFollowing} label="Following only" />
            </>
          )}
        </div>
      </div>

      <div className="tm-bp-scroll" role="tabpanel" id={panelId} aria-labelledby={`tm-bp-tv-${tab}`}>
        {tab === "positions" &&
          (following && !signedIn ? (
            <BpEmpty
              icon={<BpIcon n="users" />}
              title="Connect to filter by following"
              hint="Following lives on your wallet. Connect to see positions from the traders you follow."
              action={<BpConnect />}
            />
          ) : !posLoading && rows.length === 0 ? (
            following ? (
              <BpEmpty icon={<BpIcon n="users" />} title={`Nobody you follow is in ${coin}`} hint="Follow traders from the feed or the leaderboard and their positions show up here." />
            ) : thesisOnly ? (
              <BpEmpty tone="thesis" icon={<BpIcon n="pen" />} title={`No ${coin} positions with a thesis`} hint={`Nobody has explained a ${coin} trade yet. Write the first thesis in the order ticket.`} />
            ) : (
              <BpEmpty icon={<BpIcon n="radar" />} title={`No open ${coin} positions`} hint={`Tracked traders are flat on ${coin} right now. New positions appear here the moment they open.`} />
            )
          ) : (
            <table className="tm-bp-table">
              <thead>
                <tr>
                  <th className="tm-bp-c-who">Trader</th>
                  <th>Side</th>
                  <SortHead k="size" label="Size" sort={sort} dir={dir} onSort={onSort} className="r tm-bp-mid" />
                  <th className="r tm-bp-mid">Entry</th>
                  <th className="r tm-bp-xwide">Avg hold</th>
                  <th className="tm-bp-wide tm-bp-c-thesis">Thesis</th>
                  <SortHead k="pnl" label="PnL (ROE)" sort={sort} dir={dir} onSort={onSort} className="r" />
                </tr>
              </thead>
              <tbody>
                {posLoading ? (
                  <BpSkelRows cells={["tm-bp-c-who", "", "r tm-bp-mid", "r tm-bp-mid", "r tm-bp-xwide", "tm-bp-wide tm-bp-c-thesis", "r"]} avatar />
                ) : (
                  rows.map((p) => {
                    const long = p.side === "LONG";
                    const roe = p.sizeUsd ? (p.pnl * p.leverage) / p.sizeUsd : 0;
                    const href = p.thesis ? `/t/${p.user?.handle ?? p.address}/thesis/${p.thesis.id}` : null;
                    const hold = p.avgHoldMs ? `${fmtDuration(p.avgHoldMs)} avg. hold` : null;
                    return (
                      <tr key={p.id} className="row-hover" data-new={freshPos(p.id) || undefined}>
                        <td className="tm-bp-c-who">
                          <BpTrader
                            address={p.address}
                            user={p.user}
                            sub={
                              <span title={hold ?? undefined} suppressHydrationWarning>
                                {coin} · {timeAgo(p.openedAt)}
                              </span>
                            }
                            extra={
                              p.thesis &&
                              href && (
                                <Link href={href} className="tm-bp-tmark tm-bp-narrow" title={p.thesis.text} aria-label={`Thesis: ${p.thesis.text}`}>
                                  <BpIcon n="pen" size={9} sw={2.4} />
                                  <span className="tm-bp-tmark-l">Thesis</span>
                                </Link>
                              )
                            }
                          />
                        </td>
                        <td>
                          <span className={`pill num ${long ? "pill-up" : "pill-down"}`}>
                            {long ? "Long" : "Short"} {p.leverage}x
                          </span>
                        </td>
                        <td className="r tm-bp-mid">
                          <span className="tm-bp-2" title={fmtUsd(p.sizeUsd)}>
                            <span className="num tm-bp-val">{fmtUsd(p.sizeUsd, { compact: true })}</span>
                            <span className="tm-bp-sub num">
                              {fmtQty(p.size)} {coin}
                            </span>
                          </span>
                        </td>
                        <td className="r tm-bp-mid num tm-bp-fg2">{bpPx(p.entryPx)}</td>
                        <td className="r tm-bp-xwide">
                          <span className="tm-bp-2">
                            <span className="num tm-bp-fg2">{p.avgHoldMs ? fmtDuration(p.avgHoldMs) : "–"}</span>
                            <span className="tm-bp-sub">{p.closedCount} closed</span>
                          </span>
                        </td>
                        <td className="tm-bp-wide tm-bp-c-thesis">
                          {p.thesis && href ? (
                            <Link href={href} className="tm-bp-thesis" title={p.thesis.text}>
                              <span className="tm-bp-thesis-text">{p.thesis.text}</span>
                              <span className="tm-bp-likes num">
                                <Icon.heart /> {p.thesis.likes}
                              </span>
                            </Link>
                          ) : (
                            <span className="tm-bp-dim">–</span>
                          )}
                        </td>
                        <td className="r">
                          <BpPnl v={p.pnl} roe={roe} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ))}

        {tab === "trades" &&
          (!trades?.length ? (
            fillsLoading ? (
              <table className="tm-bp-table tm-bp-tape">
                <tbody>
                  <BpSkelRows cells={["tm-bp-c-who", "", "r", "r tm-bp-mid", "r tm-bp-mid", "r tm-bp-mid"]} avatar />
                </tbody>
              </table>
            ) : (
              <BpEmpty icon={<BpIcon n="receipt" />} title={`No ${coin} fills yet`} hint="Fills land here as tracked traders execute on Hyperliquid." />
            )
          ) : (
            <table className="tm-bp-table tm-bp-tape">
              <thead>
                <tr>
                  <th className="tm-bp-c-who">Trader</th>
                  <th>Action</th>
                  <th className="r">Amount</th>
                  <th className="r tm-bp-mid">Price</th>
                  <th className="r tm-bp-mid">Realised</th>
                  <th className="r tm-bp-mid">Time</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const pill = fillPill(t.dir, t.liquidation);
                  return (
                    <tr key={t.id} className="row-hover" data-new={freshFill(t.id) || undefined}>
                      <td className="tm-bp-c-who">
                        <BpTrader
                          address={t.address}
                          user={t.user}
                          size={24}
                          subClass="tm-bp-nsub-line"
                          sub={<span suppressHydrationWarning>{timeAgo(t.time)} ago</span>}
                        />
                      </td>
                      <td>
                        <span className={`pill ${pill.cls}`}>{pill.label}</span>
                      </td>
                      <td className="r num tm-bp-strong" title={`${fmtQty(t.sz)} ${coin}`}>
                        {fmtUsd(t.usd)}
                      </td>
                      <td className="r tm-bp-mid num tm-bp-fg2">{bpPx(t.px)}</td>
                      <td className="r tm-bp-mid">
                        <BpMoney v={t.closedPnl} glow />
                      </td>
                      <td className="r tm-bp-mid">
                        <span className="tm-bp-sub" title={new Date(t.time).toLocaleString("en-US", { hour12: false })} suppressHydrationWarning>
                          {timeAgo(t.time)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}

        {tab === "thesis" &&
          (theses === undefined ? (
            <table className="tm-bp-table">
              <tbody>
                <BpSkelRows cols={3} rows={4} avatar />
              </tbody>
            </table>
          ) : !theses.length ? (
            <BpEmpty
              tone="thesis"
              icon={<BpIcon n="pen" />}
              title={`No ${coin} theses yet`}
              hint="A thesis is a trade with the reason attached. Write one in the order ticket and it lands here with a live PnL badge."
            />
          ) : (
            <div className="tm-bp-theses">
              {theses.map((item) => (
                <FeedCard key={item.id} item={item} mid={mid} signedIn={signedIn} />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
