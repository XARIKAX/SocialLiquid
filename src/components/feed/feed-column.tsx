"use client";
import "./feed.css";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type UIEvent } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client";
import type { FeedItem, HlBoard, LeaderboardRow } from "@/lib/queries";
import type { MarketSummary } from "@/lib/hl-types";
import { fmtPct, fmtPx, fmtUsd, userPath } from "@/lib/format";
import { iconOf, useMarkets, useMids } from "@/hooks/use-market";
import { useAuth } from "@/hooks/use-auth";
import { useConnectModal } from "../connect-modal";
import { FeedCard, RailMoney, railName } from "./feed-card";
import { Avatar, CoinIcon, Icon, Toggle } from "../ui";

/* =====================================================================
   the rail: tokens, the live feed, the leaderboard and alerts. a panel
   mounts the first time it is opened and then stays, so its filters,
   search and scroll survive a trip to another tab; hidden panels stop
   polling. styles: ./feed.css (.tm-rail-*).
   ===================================================================== */

type Tab = "tokens" | "feed" | "leaderboard" | "alerts";
const TABS: Tab[] = ["tokens", "feed", "leaderboard", "alerts"];
const TAB_LABEL: Record<Tab, string> = { tokens: "Tokens", feed: "Feed", leaderboard: "Leaderboard", alerts: "Alerts" };
const TAB_KEY = "sl:rail-tab";
const MIN_SIZES = [0, 1000, 10_000, 100_000];
const PAGE = 30;
const MAX_ITEMS = 100;
/** how recent the newest card must be to carry the breathing live edge */
const LEAD_MS = 15 * 60_000;

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY) as Tab | null;
    if (t && TABS.includes(t)) return t;
  } catch {}
  return "tokens";
}

export function FeedColumn({ onNavigate, onCollapse }: { onNavigate?: () => void; onCollapse?: () => void }) {
  // markets first: a new visitor has no alerts and nobody followed yet. the shell mounts the rail only on the
  // client (after its media query resolves), so the remembered tab is read before the first paint, no flash.
  const [state, setState] = useState<{ tab: Tab; open: Tab[] }>(() => {
    const t = typeof window === "undefined" ? "tokens" : readTab();
    return { tab: t, open: [t] };
  });
  const { tab } = state;
  const uid = useId();
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const streaming = useFeedStreaming();

  const select = (t: Tab, focus = false) => {
    setState((s) => ({ tab: t, open: s.open.includes(t) ? s.open : [...s.open, t] }));
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
    if (focus) tabRefs.current[t]?.focus();
  };
  /* tabs pattern: arrows move along the row, home and end jump to the ends */
  const onTabsKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i - 1 + TABS.length) % TABS.length] : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : null;
    if (!next || !(e.target as HTMLElement).matches("[role=tab]")) return;
    e.preventDefault();
    select(next, true);
  };
  /* a soft shadow under a panel's sticky head once rows slide beneath it (set on the node, no re-render) */
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const on = el.scrollTop > 2;
    if (on !== el.hasAttribute("data-scrolled")) el.toggleAttribute("data-scrolled", on);
  };

  return (
    <div className="tm-rail">
      <div className="tm-rail-tabs">
        {/* the tablist holds only tabs; the collapse button sits beside it */}
        <div className="tm-rail-tablist" role="tablist" aria-label="Markets and traders" onKeyDown={onTabsKey}>
          {TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${t}`}
              aria-controls={`${uid}-panel-${t}`}
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              className="tm-rail-tab"
              onClick={() => select(t)}
            >
              {/* always there (no shift when it changes): lit and pinging while the stream answers, dim if it stops */}
              {t === "feed" && <span className="tm-rail-live" data-off={streaming ? undefined : ""} aria-hidden />}
              {t === "alerts" && <BellIcon size={13} />}
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {onCollapse && (
          <button type="button" className="tm-rail-collapse" onClick={onCollapse} title="Collapse panel" aria-label="Collapse panel">
            <Icon.collapse />
          </button>
        )}
      </div>
      {TABS.map(
        (t) =>
          state.open.includes(t) && (
            <div key={t} id={`${uid}-panel-${t}`} role="tabpanel" aria-labelledby={`${uid}-tab-${t}`} hidden={tab !== t} className="tm-rail-scroll" onScroll={onScroll}>
              {t === "tokens" && <Tokens onNavigate={onNavigate} active={tab === "tokens"} />}
              {t === "feed" && <Feed onNavigate={onNavigate} active={tab === "feed"} onBrowse={() => select("leaderboard")} />}
              {t === "leaderboard" && <MiniLeaderboard onNavigate={onNavigate} active={tab === "leaderboard"} />}
              {t === "alerts" && <Feed onNavigate={onNavigate} alerts active={tab === "alerts"} onBrowse={() => select("leaderboard")} />}
            </div>
          ),
      )}
    </div>
  );
}

/**
 * the feed tab's live dot. the stream is live unless the feed queries on screen say otherwise: it dims only when
 * every active one is failing or has not answered for a few polls. no feed query mounted (a profile, /tokens) is
 * not a dead stream, so the dot stays lit there.
 */
function useFeedStreaming() {
  const qc = useQueryClient();
  const [live, setLive] = useState(true);
  useEffect(() => {
    const cache = qc.getQueryCache();
    let raf = 0;
    const check = () => {
      raf = 0;
      const now = Date.now();
      const active = cache.findAll({ queryKey: ["feed"], type: "active" });
      setLive(!active.length || active.some((q) => q.state.status !== "error" && (q.state.dataUpdatedAt === 0 || now - q.state.dataUpdatedAt < 15_000)));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    const unsub = cache.subscribe(schedule);
    const iv = window.setInterval(check, 5_000);
    return () => {
      unsub();
      window.clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [qc]);
  return live;
}

/** a ui preference kept in localStorage (read lazily: the rail only renders on the client) */
function useStored<T>(key: string, init: T, ok: (v: unknown) => v is T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    if (typeof window === "undefined") return init;
    try {
      const raw = localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (ok(parsed)) return parsed;
    } catch {}
    return init;
  });
  const set = (n: T) => {
    setV(n);
    try {
      localStorage.setItem(key, JSON.stringify(n));
    } catch {}
  };
  return [v, set];
}

/** the market the terminal is showing, from the route: /m/<slug or coin>, and /trade is BTC. lowercased */
function useCurrentRef(): string | null {
  const path = usePathname();
  if (!path) return null;
  if (path === "/trade") return "btc";
  const m = path.match(/^\/m\/([^/?#]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}
/** the route resolves a market by its hyperliquid id or its slug, so either may be in the url */
const isRef = (m: MarketSummary, ref: string) => m.coin.toLowerCase() === ref || m.slug.toLowerCase() === ref;
const marketHref = (m: MarketSummary) => `/m/${encodeURIComponent(m.slug)}`;
/** the line under a market's name: leverage and what it is (perp, spot pair, or the builder dex's tradfi class) */
const kindLine = (m: MarketSummary) => (m.kind === "spot" ? "spot" : m.kind === "hip3" ? `${m.maxLeverage}x · ${m.category ?? m.dexName ?? m.dex}` : `${m.maxLeverage}x · perp`);

/* =====================================================================
   feed + alerts
   ===================================================================== */

export function useFeed(
  params: { coin?: string; minUsd: number; thesisOnly: boolean; following: boolean; address?: string; limit?: number },
  enabled = true,
  opts?: { keepPrevious?: boolean },
) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.coin) qs.set("coin", params.coin);
  if (params.minUsd) qs.set("minUsd", String(params.minUsd));
  if (params.thesisOnly) qs.set("thesis", "1");
  if (params.following) qs.set("following", "1");
  if (params.address) qs.set("address", params.address);
  return useQuery({
    queryKey: ["feed", qs.toString()],
    queryFn: () => api<{ items: FeedItem[] }>(`/api/feed?${qs}`).then((r) => r.items),
    refetchInterval: 3000,
    enabled,
    // the rail keeps the list on screen while a new filter or page loads instead of blanking to a skeleton
    placeholderData: opts?.keepPrevious ? keepPreviousData : undefined,
  });
}

type Filters = { minUsd: number; thesisOnly: boolean; following: boolean };
const DEFAULT_FILTERS: Filters = { minUsd: 1000, thesisOnly: false, following: false };
const isFilters = (v: unknown): v is Filters =>
  !!v && typeof v === "object" && MIN_SIZES.includes((v as Filters).minUsd) && typeof (v as Filters).thesisOnly === "boolean" && typeof (v as Filters).following === "boolean";

function Feed({ onNavigate, alerts, active = true, onBrowse }: { onNavigate?: () => void; alerts?: boolean; active?: boolean; onBrowse?: () => void }) {
  const { signedIn } = useAuth();
  // size, thesis and following are remembered; the market filter is not (a forgotten coin filter reads as a dead feed)
  const [filters, setFilters] = useStored<Filters>(alerts ? "sl:rail-alerts-filters" : "sl:rail-feed-filters", DEFAULT_FILTERS, isFilters);
  const [coin, setCoin] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const markets = useMarkets();
  const mids = useMids();
  const following = !!alerts || filters.following;
  const q = useFeed({ coin: coin || undefined, minUsd: filters.minUsd, thesisOnly: filters.thesisOnly, following, limit }, active, { keepPrevious: true });
  const gated = following && !signedIn;
  const narrowed = filters.minUsd > DEFAULT_FILTERS.minUsd || filters.thesisOnly || !!coin || (!alerts && filters.following);

  /* which cards are new since the last poll: compared only within the same filters and page,
     so changing a filter or loading more never lights the whole list up */
  const base = `${coin}|${filters.minUsd}|${filters.thesisOnly}|${following}`;
  const key = `${base}|${limit}`;
  const seen = useRef<{ key: string; ids: Set<string> } | null>(null);
  /* the filters each list on screen was fetched with, so a placeholder can tell "next page" from "new filters" */
  const baseOf = useRef(new WeakMap<FeedItem[], string>());
  const timers = useRef(new Set<number>());
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  /* scrolled down the stream when new events land: count them in a pill that takes you back up */
  const rootRef = useRef<HTMLDivElement>(null);
  const away = useRef(false);
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const sc = rootRef.current?.closest<HTMLElement>(".tm-rail-scroll");
    if (!sc) return;
    const on = () => {
      away.current = sc.scrollTop > 120;
      if (!away.current) setUnseen(0);
    };
    sc.addEventListener("scroll", on, { passive: true });
    return () => sc.removeEventListener("scroll", on);
  }, []);
  const toTop = () => {
    const sc = rootRef.current?.closest<HTMLElement>(".tm-rail-scroll");
    const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sc?.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
    setUnseen(0);
  };
  useEffect(() => {
    if (!q.data || q.isPlaceholderData) return;
    baseOf.current.set(q.data, base);
    const ids = q.data.map((i) => i.id);
    const prev = seen.current;
    seen.current = { key, ids: new Set(ids) };
    if (!prev || prev.key !== key) return;
    const n = ids.filter((id) => !prev.ids.has(id));
    if (!n.length) return;
    if (away.current) setUnseen((u) => u + n.length);
    setFresh((s) => new Set([...s, ...n]));
    // the glow runs 2.8s; then the cards drop the class
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      setFresh((s) => {
        const t = new Set(s);
        n.forEach((x) => t.delete(x));
        return t;
      });
    }, 3000);
    timers.current.add(id);
  }, [q.data, q.isPlaceholderData, key, base]);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);

  const setF = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
    setLimit(PAGE);
    setUnseen(0);
  };
  const reset = () => {
    setFilters(DEFAULT_FILTERS);
    setCoin("");
    setLimit(PAGE);
    setUnseen(0);
  };
  /* a placeholder from the same filters is the next page arriving under the list you are reading: it stays
     bright and the button says so. only new filters dim the old list and run the light along the head */
  const paging = q.isPlaceholderData && !!q.data && baseOf.current.get(q.data) === base;
  const refiltering = q.isPlaceholderData && !paging;
  const loadingNext = paging && q.isFetching;
  const items = q.data;
  const canMore = !!items && items.length >= limit && limit < MAX_ITEMS;
  // one page per request even if the observer and a click land in the same frame: a bump only counts from this render's limit
  const more = () => setLimit((l) => (l === limit ? Math.min(MAX_ITEMS, l + PAGE) : l));
  /* reaching the end of the stream loads the next page by itself (the button stays for keyboards and as a fallback) */
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = moreRef.current;
    const sc = rootRef.current?.closest<HTMLElement>(".tm-rail-scroll");
    if (!el || !sc || !active || !canMore || q.isPlaceholderData || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(), { root: sc, rootMargin: "0px 0px 240px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active, canMore, q.isPlaceholderData, limit]);

  let body: ReactNode;
  if (gated) body = <SignInEmpty alerts={alerts} onBrowse={onBrowse} onShowAll={() => setF({ following: false })} />;
  else if (!items && q.isError) body = <RailEmpty quiet icon={<PulseIcon />} title="The feed did not load" hint={(q.error as Error)?.message || "Hyperliquid or our indexer did not answer."} acts={<button type="button" className="btn btn-sm" onClick={() => q.refetch()}>Try again</button>} />;
  else if (!items) body = <FeedSkeleton />;
  else if (!items.length)
    body = alerts ? (
      <RailEmpty
        icon={<BellIcon size={20} />}
        title="Quiet so far"
        hint="Nothing from traders you follow yet. Follow a few from the leaderboard and their moves land here the moment they hit chain."
        acts={<button type="button" className="btn btn-primary btn-sm" onClick={onBrowse}>Browse the leaderboard</button>}
      />
    ) : filters.following && !coin && !filters.thesisOnly ? (
      <RailEmpty
        icon={<BellIcon size={20} />}
        title="Nobody followed yet"
        hint="Follow traders from the leaderboard and only their moves show up here."
        acts={
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={onBrowse}>
              Browse the leaderboard
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setF({ following: false })}>
              Show everyone
            </button>
          </>
        }
      />
    ) : narrowed ? (
      <RailEmpty quiet icon={<FilterIcon />} title="Nothing matches these filters" hint="Loosen the size or market filter to see more of the flow." acts={<button type="button" className="btn btn-sm" onClick={reset}>Reset filters</button>} />
    ) : (
      <RailEmpty icon={<PulseIcon />} title="Waiting for the first trade" hint="Positions appear here the moment a tracked trader opens or closes one on Hyperliquid." />
    );
  else
    body = (
      <div className={refiltering ? "tm-rail-stale" : undefined} aria-busy={q.isPlaceholderData || undefined}>
        {items.map((item, i) => (
          <FeedCard
            key={item.id}
            item={item}
            // only a still-open position reads the mid: closed cards then skip every price poll (the card is memoised)
            mid={mids.data && item.position && !item.position.closedAt ? Number(mids.data[item.coin]) : undefined}
            onNavigate={onNavigate}
            signedIn={signedIn}
            fresh={fresh.has(item.id)}
            // the live edge marks the head of a stream that is moving: not a five-hour-old card at the top of a filter
            lead={i === 0 && !refiltering && Date.now() - new Date(item.time).getTime() < LEAD_MS}
          />
        ))}
        {loadingNext || canMore ? (
          // one button for both states, so a keyboard user who pressed it keeps focus while the page arrives
          <button ref={moreRef} type="button" className="tm-rail-more" aria-disabled={loadingNext || undefined} onClick={() => !loadingNext && more()}>
            {loadingNext ? (
              <>
                <span className="tm-rail-more-spin" aria-hidden /> Loading
              </>
            ) : (
              <>
                Load more <ChevronDown />
              </>
            )}
          </button>
        ) : (
          <div className="tm-rail-endcap">{items.length >= MAX_ITEMS ? `Latest ${MAX_ITEMS} shown` : "End of feed"}</div>
        )}
      </div>
    );

  // signed out on alerts there is nothing to filter yet; on the feed the bar stays so "Following" can be turned off
  const filterBar = !(alerts && gated) && (
    <div className="tm-rail-head">
      <div className="tm-rail-filters" role="group" aria-label={alerts ? "Alert filters" : "Feed filters"}>
        <RailSelect label="Minimum size" value={String(filters.minUsd)} on={filters.minUsd > DEFAULT_FILTERS.minUsd} onChange={(v) => setF({ minUsd: Number(v) })}>
          {MIN_SIZES.map((m) => (
            <option key={m} value={m}>
              {m ? `≥ ${fmtUsd(m, { compact: true })}` : "Any size"}
            </option>
          ))}
        </RailSelect>
        <RailSelect
          label="Market"
          value={coin}
          on={!!coin}
          icon={coin ? <CoinIcon coin={(() => { const s = markets.data?.find((m) => m.coin === coin); return s ? iconOf(s) : coin; })()} size={14} /> : null}
          onChange={(v) => {
            setCoin(v);
            setLimit(PAGE);
            setUnseen(0);
          }}
        >
          <option value="">All markets</option>
          {markets.data?.map((m) => (
            <option key={m.coin} value={m.coin}>
              {m.name}
            </option>
          ))}
        </RailSelect>
        <Toggle on={filters.thesisOnly} onChange={(v) => setF({ thesisOnly: v })} label="Thesis" />
        {!alerts && <Toggle on={filters.following} onChange={(v) => setF({ following: v })} label="Following" />}
      </div>
      {refiltering && q.isFetching && <span className="tm-rail-loading-line" aria-hidden />}
      {unseen > 0 && (
        <button type="button" className="tm-rail-newpill" onClick={toTop}>
          <ArrowUp /> {unseen} new
        </button>
      )}
    </div>
  );

  return (
    <div ref={rootRef}>
      {filterBar}
      {body}
    </div>
  );
}

function RailSelect({ label, value, on, icon, onChange, children }: { label: string; value: string; on?: boolean; icon?: ReactNode; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <span className={`tm-rail-select ${icon ? "tm-rail-select-coin" : ""}`} data-on={on ? "" : undefined}>
      {icon}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="num">
        {children}
      </select>
      <ChevronDown size={10} />
    </span>
  );
}

/** signed out on alerts (or the following filter): the bell in a glowing ring and the one step that unlocks it */
function SignInEmpty({ alerts, onBrowse, onShowAll }: { alerts?: boolean; onBrowse?: () => void; onShowAll?: () => void }) {
  const { isConnected, needsSignIn, signIn, busy } = useAuth();
  const connect = useConnectModal();
  return (
    <RailEmpty
      icon={<BellIcon size={20} />}
      title={alerts ? "Alerts from traders you follow" : "Only the traders you follow"}
      hint={alerts ? "Follow a few traders and their opens, closes and liquidations land here the moment they hit chain." : "Sign in to narrow the feed to the traders you follow."}
      acts={
        <>
          {needsSignIn ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={signIn} disabled={busy}>
              {busy ? "Check your wallet…" : "Sign in"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={connect.open}>
              Connect wallet
            </button>
          )}
          {alerts ? (
            <button type="button" className="btn btn-sm" onClick={onBrowse}>
              Find traders
            </button>
          ) : (
            <button type="button" className="btn btn-sm" onClick={onShowAll}>
              Show everyone
            </button>
          )}
        </>
      }
      note={isConnected ? "One signature, no gas. It authorises nothing else." : "Free to sign in. No gas, no funds move."}
    />
  );
}

function FeedSkeleton() {
  return (
    <div className="tm-rail-skel" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="tm-rail-skel-row" style={{ opacity: 1 - i * 0.12, alignItems: "flex-start", paddingBlock: 13 }}>
          <span className="skeleton tm-rail-skel-dot" style={{ width: 28, height: 28 }} />
          <span className="tm-rail-skel-col" style={{ paddingTop: 3 }}>
            <span className="skeleton" style={{ height: 10, width: `${46 + ((i * 17) % 22)}%` }} />
            <span className="skeleton" style={{ height: 9, width: `${70 + ((i * 11) % 20)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* =====================================================================
   tokens (also the /tokens page, with `full`)
   ===================================================================== */

type SortKey = "default" | "coin" | "px" | "chg" | "vol" | "oi" | "fund";
type Sort = { key: SortKey; dir: "asc" | "desc" };
const SORT_STORE = "sl:tokens-sort";
/** market classes, named the way the market picker names them; hip3 = builder-dex tradfi perps */
type Kind = "all" | MarketSummary["kind"];
const KIND_STORE = "sl:tokens-kind";
const KINDS: [Kind, string][] = [
  ["all", "All"],
  ["perp", "Perps"],
  ["spot", "Spot"],
  ["hip3", "Tradfi"],
];
const SORT_KEYS: SortKey[] = ["default", "coin", "px", "chg", "vol", "oi", "fund"];
const sortValue: Record<Exclude<SortKey, "default" | "coin">, (m: MarketSummary) => number> = {
  px: (m) => m.markPx,
  chg: (m) => m.change24h,
  vol: (m) => m.volume24h,
  oi: (m) => m.openInterestUsd,
  fund: (m) => m.funding,
};

export function Tokens({ onNavigate, full, active = true }: { onNavigate?: () => void; full?: boolean; active?: boolean }) {
  const markets = useMarkets();
  const mids = useMids();
  const router = useRouter();
  const current = useCurrentRef();
  const [q, setQ] = useState("");
  const [sort, setSortState] = useState<Sort>({ key: "default", dir: "desc" });
  const [kind, setKindState] = useState<Kind>("all");
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // the sort is a remembered preference; read after mount because /tokens renders on the server too
  useLayoutEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SORT_STORE) ?? "null") as Sort | null;
      if (s && SORT_KEYS.includes(s.key) && (s.dir === "asc" || s.dir === "desc")) setSortState(s);
      const k = localStorage.getItem(KIND_STORE) as Kind | null;
      if (k && KINDS.some(([x]) => x === k)) setKindState(k);
    } catch {}
  }, []);
  const setKind = (k: Kind) => {
    setKindState(k);
    try {
      localStorage.setItem(KIND_STORE, k);
    } catch {}
  };
  /* how many markets each class holds; the class filter only shows when there is more than one class */
  const kindCounts = useMemo(() => {
    const c: Record<Kind, number> = { all: 0, perp: 0, spot: 0, hip3: 0 };
    for (const m of markets.data ?? []) {
      c.all++;
      c[m.kind]++;
    }
    return c;
  }, [markets.data]);
  const showKinds = (["perp", "spot", "hip3"] as const).filter((k) => kindCounts[k] > 0).length > 1;
  const activeKind: Kind = showKinds && (kind === "all" || kindCounts[kind] > 0) ? kind : "all";
  /* a head cycles: first look (high to low, a to z for names), the other way, then back to the default order */
  const toggleSort = (key: SortKey) => {
    const first: Sort["dir"] = key === "coin" ? "asc" : "desc";
    const next: Sort = sort.key !== key ? { key, dir: first } : sort.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : { key: "default", dir: "desc" };
    setSortState(next);
    try {
      localStorage.setItem(SORT_STORE, JSON.stringify(next));
    } catch {}
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (m: MarketSummary) => !needle || m.name.toLowerCase().includes(needle) || m.coin.toLowerCase().includes(needle) || m.base.toLowerCase().includes(needle) || (m.category ?? "").toLowerCase().includes(needle);
    let l = (markets.data ?? []).filter((m) => (activeKind === "all" || m.kind === activeKind) && hit(m));
    if (sort.key === "coin") l = [...l].sort((a, b) => a.name.localeCompare(b.name) * (sort.dir === "asc" ? 1 : -1));
    else if (sort.key !== "default") {
      const f = sortValue[sort.key];
      l = [...l].sort((a, b) => (f(a) - f(b)) * (sort.dir === "asc" ? 1 : -1));
    }
    // typing a symbol puts the exact match first, then the ones that start with it
    if (needle) {
      const rank = (m: MarketSummary) => {
        const n = m.name.toLowerCase();
        const b = m.base.toLowerCase();
        return n === needle || b === needle ? 0 : n.startsWith(needle) || b.startsWith(needle) ? 1 : 2;
      };
      l = [...l].sort((a, b) => rank(a) - rank(b));
    }
    return l;
  }, [markets.data, q, sort, activeKind]);

  /* bring the market you are on into view (inside the rail's own scroll, never the page) */
  const revealed = useRef<string | null>(null);
  const hasRows = list.length > 0;
  useEffect(() => {
    if (!active || !current || !hasRows || revealed.current === current) return;
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const sc = el?.closest<HTMLElement>(".tm-rail-scroll");
    if (!el || !sc) return;
    revealed.current = current;
    const head = sc.querySelector<HTMLElement>(".tm-rail-head")?.offsetHeight ?? 0;
    const r = el.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    if (r.top < s.top + head || r.bottom > s.bottom) sc.scrollTop += r.top - (s.top + head + (s.height - head) / 2 - r.height / 2);
  }, [active, current, hasRows]);

  const go = (m: MarketSummary) => {
    onNavigate?.();
    router.push(marketHref(m));
  };
  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-tok]") ?? []);
  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rows()[0]?.focus();
    } else if (e.key === "Enter" && list[0]) {
      e.preventDefault();
      go(list[0]);
    } else if (e.key === "Escape" && q) {
      e.preventDefault();
      setQ("");
    }
  };
  const onRowKey = (e: ReactKeyboardEvent<HTMLAnchorElement>) => {
    const r = rows();
    const i = r.indexOf(e.currentTarget);
    const to = e.key === "ArrowDown" ? r[i + 1] : e.key === "ArrowUp" ? (i > 0 ? r[i - 1] : inputRef.current) : e.key === "Home" ? r[0] : e.key === "End" ? r[r.length - 1] : e.key === "Escape" ? inputRef.current : undefined;
    if (to === undefined) return;
    e.preventDefault();
    to?.focus();
  };

  const head = (key: SortKey, label: string, end = true) => {
    const on = sort.key === key;
    return (
      <button
        type="button"
        className="tm-rail-colhead label-caps"
        data-on={on ? "" : undefined}
        data-dir={on ? sort.dir : undefined}
        onClick={() => toggleSort(key)}
        aria-label={`Sort by ${label}${on ? (sort.dir === "asc" ? ", ascending" : ", descending") : ""}`}
      >
        {end && <SortIcon />}
        {label}
        {!end && <SortIcon />}
      </button>
    );
  };

  return (
    <div className={`tm-rail-tokens ${full ? "tm-rail-tokens-full tm-rail-page" : ""}`}>
      <div className="tm-rail-head">
        <div className="tm-rail-tokens-top">
          <label className="tm-rail-search">
            <Icon.search />
            <input
              ref={inputRef}
              type="search"
              placeholder="Filter markets"
              aria-label="Filter markets"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="tm-rail-search-end">
              {q && (
                <button type="button" className="tm-rail-clear" onClick={() => (setQ(""), inputRef.current?.focus())} aria-label="Clear filter">
                  <XIcon />
                </button>
              )}
            </span>
          </label>
          {showKinds && (
            <div className="tm-rail-kinds seg" role="radiogroup" aria-label="Market type">
              {KINDS.map(([k, label]) =>
                k === "all" || kindCounts[k] > 0 ? (
                  <button key={k} type="button" role="radio" aria-checked={activeKind === k} className={`seg-item ${activeKind === k ? "seg-active" : ""}`} onClick={() => setKind(k)}>
                    {label}
                    <small>{kindCounts[k]}</small>
                  </button>
                ) : null,
              )}
            </div>
          )}
        </div>
        {/* over a skeleton the heads show the shape of what is coming; over an empty or failed list they step out */}
        <div className="tm-rail-cols" data-empty={!markets.isLoading && !hasRows ? "" : undefined}>
          <span>{head("coin", "Market", false)}</span>
          <span className="tm-rail-end">{head("px", "Price")}</span>
          <span className="tm-rail-end">{head("chg", "24h")}</span>
          {full && <span className="tm-rail-x tm-rail-x-vol tm-rail-end">{head("vol", "Volume")}</span>}
          {full && <span className="tm-rail-x tm-rail-x-oi tm-rail-end">{head("oi", "Open interest")}</span>}
          {full && <span className="tm-rail-x tm-rail-x-fund tm-rail-end">{head("fund", "Funding")}</span>}
        </div>
      </div>

      {markets.isLoading ? (
        <TokensSkeleton full={full} />
      ) : markets.isError && !markets.data ? (
        <RailEmpty quiet icon={<PulseIcon />} title="Markets did not load" hint={(markets.error as Error)?.message || "Hyperliquid did not answer."} acts={<button type="button" className="btn btn-sm" onClick={() => markets.refetch()}>Try again</button>} />
      ) : !list.length ? (
        <RailEmpty
          quiet
          icon={<Icon.search />}
          title={q ? `No ${activeKind === "all" ? "" : `${KINDS.find(([k]) => k === activeKind)?.[1].toLowerCase()} `}market matches “${q.trim()}”` : "No markets yet"}
          hint={q ? "Markets are listed by their Hyperliquid name, like BTC, SOL/USDC or GOLD." : undefined}
          acts={
            q ? (
              activeKind !== "all" ? (
                <button type="button" className="btn btn-sm" onClick={() => (setKind("all"), inputRef.current?.focus())}>
                  Search all markets
                </button>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => (setQ(""), inputRef.current?.focus())}>
                  Clear filter
                </button>
              )
            ) : undefined
          }
        />
      ) : (
        <ul ref={listRef} className="tm-rail-toklist">
          {list.map((m) => {
            const px = mids.data?.[m.coin] ? Number(mids.data[m.coin]) : m.markPx;
            const cur = !!current && isRef(m, current);
            const spot = m.kind === "spot";
            return (
              <li key={m.coin}>
                <Link href={marketHref(m)} data-tok="" onClick={onNavigate} onKeyDown={onRowKey} className="tm-rail-tok" aria-current={cur ? "page" : undefined}>
                  <span className="tm-rail-tok-id">
                    <span className="tm-rail-coin">
                      <CoinIcon coin={iconOf(m)} size={full ? 30 : 24} />
                    </span>
                    <span className="tm-rail-tok-name">
                      <b>{m.name}</b>
                      <small className="num">{kindLine(m)}</small>
                    </span>
                  </span>
                  <LivePx value={px} className="tm-rail-px num" />
                  <ChangePill v={m.change24h} />
                  {full && <span className="tm-rail-x tm-rail-x-vol tm-rail-num2 num">{usdBig(m.volume24h)}</span>}
                  {full && <span className="tm-rail-x tm-rail-x-oi tm-rail-num2 num">{spot ? "–" : usdBig(m.openInterestUsd)}</span>}
                  {full && (spot ? <span className="tm-rail-x tm-rail-x-fund tm-rail-num2 num">–</span> : <span className={`tm-rail-x tm-rail-x-fund tm-rail-num2 num ${m.funding >= 0 ? "tm-rail-fund-up" : "tm-rail-fund-down"}`}>{fmtPct(m.funding, 4)}</span>)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!!list.length && markets.data && (
        <div className="tm-rail-endcap num">
          {(() => {
            const total = activeKind === "all" ? markets.data.length : kindCounts[activeKind];
            const noun = activeKind === "all" ? (showKinds ? "markets" : "perps") : activeKind === "perp" ? "perps" : activeKind === "spot" ? "spot pairs" : "tradfi markets";
            return list.length === total ? `All ${total} ${noun}` : `${list.length} of ${total} ${noun}`;
          })()}
        </div>
      )}
    </div>
  );
}

/** compact usd that also knows billions ($2.27B rather than $2271.9M) */
function usdBig(v: number) {
  return Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : fmtUsd(v, { compact: true });
}

/** a price that tints toward the direction it just ticked, then settles back */
function LivePx({ value, className = "" }: { value: number; className?: string }) {
  const prev = useRef(value);
  const [tick, setTick] = useState<{ dir: "up" | "down"; n: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (!Number.isFinite(p) || !Number.isFinite(value) || value === p) return;
    setTick((t) => ({ dir: value > p ? "up" : "down", n: (t?.n ?? 0) + 1 }));
  }, [value]);
  return <span className={`${className} ${tick ? `tm-rail-tick-${tick.dir}${tick.n % 2}` : ""}`}>{fmtPx(value)}</span>;
}

function ChangePill({ v }: { v: number }) {
  // a move that rounds to 0.00% reads flat, not as a green "▲ 0.00%"
  const dir = !Number.isFinite(v) || Math.abs(v) < 0.00005 ? "flat" : v > 0 ? "up" : "down";
  return (
    <span className={`tm-rail-chg tm-rail-chg-${dir} num`}>
      {dir !== "flat" && <TriIcon up={dir === "up"} />}
      <span className="sr-only">{dir === "up" ? "up " : dir === "down" ? "down " : ""}</span>
      {Number.isFinite(v) ? fmtPct(Math.abs(v), 2, false) : "–"}
    </span>
  );
}

function TokensSkeleton({ full }: { full?: boolean }) {
  const d = full ? 30 : 24;
  return (
    <div className="tm-rail-skel" aria-hidden>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="tm-rail-skel-row" style={{ opacity: 1 - i * 0.085, minHeight: full ? 56 : 46, paddingBlock: 0 }}>
          <span className="skeleton tm-rail-skel-dot" style={{ width: d, height: d }} />
          <span className="tm-rail-skel-col">
            <span className="skeleton" style={{ height: 10, width: 44 }} />
            <span className="skeleton" style={{ height: 8, width: 62 }} />
          </span>
          <span className="skeleton" style={{ height: 10, width: 58 }} />
          <span className="skeleton" style={{ height: 18, width: 58, borderRadius: 6 }} />
        </div>
      ))}
    </div>
  );
}

/* =====================================================================
   leaderboard
   ===================================================================== */

const isSrc = (v: unknown): v is "hl" | "own" => v === "hl" || v === "own";

function MiniLeaderboard({ onNavigate, active = true }: { onNavigate?: () => void; active?: boolean }) {
  const [src, setSrc] = useStored<"hl" | "own">("sl:rail-board", "hl", isSrc);
  // same key and shape as the /leaderboard page so both can be mounted at once and share the cache
  const hlq = useQuery({ queryKey: ["leaderboard", "hl"], queryFn: () => api<HlBoard>("/api/leaderboard/hl"), refetchInterval: 60_000, enabled: active });
  const own = useQuery({ queryKey: ["leaderboard", "pnl7d"], queryFn: () => api<{ rows: LeaderboardRow[] }>("/api/leaderboard?by=pnl7d").then((r) => r.rows), refetchInterval: 30_000, enabled: active });

  let body: ReactNode;
  if (src === "hl") {
    const rows = hlq.data?.rows;
    if (hlq.isLoading) body = <BoardSkeleton />;
    else if (hlq.isError || !rows?.length)
      body = (
        <RailEmpty
          quiet
          icon={<TrophyIcon />}
          title="Leaderboard unavailable"
          hint={hlq.isError ? (hlq.error as Error).message : hlq.data?.error ? `Hyperliquid did not answer: ${hlq.data.error}` : "Hyperliquid's leaderboard is mirrored on the first request. Refresh in a moment."}
          acts={<button type="button" className="btn btn-sm" onClick={() => hlq.refetch()}>Try again</button>}
        />
      );
    else
      body = rows.map((r) => (
        <BoardRow key={r.rank} rank={r.rank} user={r.user} sub={`${fmtUsd(r.accountValue, { compact: true })} · ROI ${(r.roi30d * 100).toFixed(1)}%`} pnl={r.pnl30d} onNavigate={onNavigate} />
      ));
  } else {
    const rows = own.data;
    if (own.isLoading) body = <BoardSkeleton />;
    else if (!rows?.length)
      body = <RailEmpty quiet icon={<TrophyIcon />} title="Nobody ranks yet" hint="Our own board needs 5 closed trades per trader on record. It fills as the indexer catches up." />;
    else
      body = rows.slice(0, 30).map((r) => (
        <BoardRow
          key={r.user.address}
          rank={r.rank}
          user={r.user}
          sub={[r.stats.winRate !== null ? `${Math.round(r.stats.winRate * 100)}% win` : null, `${r.stats.closedTrades} trades`].filter(Boolean).join(" · ")}
          pnl={r.stats.pnl7d}
          onNavigate={onNavigate}
        />
      ));
  }

  return (
    <div>
      <div className="tm-rail-head tm-rail-lb-head">
        <span className="seg" role="group" aria-label="Ranking">
          <button type="button" className={`seg-item ${src === "hl" ? "seg-active" : ""}`} aria-pressed={src === "hl"} onClick={() => setSrc("hl")}>
            Hyperliquid 30D
          </button>
          <button type="button" className={`seg-item ${src === "own" ? "seg-active" : ""}`} aria-pressed={src === "own"} onClick={() => setSrc("own")}>
            7d PnL
          </button>
        </span>
        <Link href="/leaderboard" onClick={onNavigate} className="tm-rail-link">
          Full board <ArrowRight />
        </Link>
      </div>
      {body}
    </div>
  );
}

function BoardRow({ rank, user, sub, pnl, onNavigate }: { rank: number; user: { address: string; handle: string | null; displayName: string | null; avatarUrl: string | null }; sub: string; pnl: number; onNavigate?: () => void }) {
  const podium = rank <= 3;
  return (
    <Link href={userPath(user)} onClick={onNavigate} className="tm-rail-lb-row">
      <span className={`tm-rail-rank num ${podium ? `tm-rail-rank-${rank}` : ""}`}>
        <span className="sr-only">Rank </span>
        {rank}
      </span>
      <span className="tm-rail-av" aria-hidden>
        <Avatar address={user.address} url={user.avatarUrl} handle={user.handle ?? user.displayName} size={28} />
      </span>
      <span className="tm-rail-lb-who">
        <b>{railName(user, user.address)}</b>
        <small className="num">{sub}</small>
      </span>
      {/* the podium glows; below it the numbers keep their colour and drop the light */}
      <RailMoney v={pnl} compact glow={podium} className="tm-rail-lb-pnl" />
    </Link>
  );
}

function BoardSkeleton() {
  return (
    <div className="tm-rail-skel" aria-hidden>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="tm-rail-skel-row" style={{ opacity: 1 - i * 0.1, minHeight: 52, paddingBlock: 0, paddingInline: "12px 14px" }}>
          <span className="skeleton" style={{ width: 22, height: 22, borderRadius: 7, flex: "none" }} />
          <span className="skeleton tm-rail-skel-dot" style={{ width: 28, height: 28 }} />
          <span className="tm-rail-skel-col">
            <span className="skeleton" style={{ height: 10, width: `${40 + ((i * 13) % 30)}%` }} />
            <span className="skeleton" style={{ height: 8, width: "52%" }} />
          </span>
          <span className="skeleton" style={{ height: 11, width: 48 }} />
        </div>
      ))}
    </div>
  );
}

/* =====================================================================
   shared bits
   ===================================================================== */

function RailEmpty({ icon, title, hint, acts, note, quiet }: { icon: ReactNode; title: string; hint?: string; acts?: ReactNode; note?: string; quiet?: boolean }) {
  return (
    <div className="tm-rail-empty">
      <span className="tm-rail-empty-ring" data-quiet={quiet ? "" : undefined} aria-hidden>
        {icon}
      </span>
      <p className="tm-rail-empty-title">{title}</p>
      {hint && <p className="tm-rail-empty-hint">{hint}</p>}
      {acts && <div className="tm-rail-empty-acts">{acts}</div>}
      {note && <p className="tm-rail-empty-note">{note}</p>}
    </div>
  );
}

const SV = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;
function BellIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...SV} strokeWidth={1.8} aria-hidden>
      <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}
function ChevronDown({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...SV} strokeWidth={2.2} aria-hidden>
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}
function ArrowUp() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" {...SV} strokeWidth={2.4} aria-hidden>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...SV} strokeWidth={2} aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function SortIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
      <path d="M5 7.5 1.5 3h7z" />
    </svg>
  );
}
function TriIcon({ up }: { up: boolean }) {
  return (
    <svg width="7" height="7" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
      <path d={up ? "M5 1.5 9 8.5H1z" : "M5 8.5 1 1.5h8z"} />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...SV} strokeWidth={2.2} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...SV} strokeWidth={1.8} aria-hidden>
      <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
    </svg>
  );
}
function FilterIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" {...SV} strokeWidth={1.8} aria-hidden>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5" />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" {...SV} strokeWidth={1.8} aria-hidden>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" />
    </svg>
  );
}
