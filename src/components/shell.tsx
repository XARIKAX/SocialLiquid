"use client";
import "./chrome.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { usePathname, useServerInsertedHTML } from "next/navigation";
import { TopBar } from "./top-bar";
import { FeedColumn } from "./feed/feed-column";
import { Ticker } from "./ticker";
import { Icon } from "./icons";
import { useAccount } from "wagmi";
import { FundsHost } from "./trade/funds";
import { ProfileHost } from "./profile-editor";
import { AlertToasts } from "./alerts";

/* =====================================================================
   the shell: the app bar, the rail and the page in one frame with even
   gaps, the footer tape, and on phones a glass Feed / Trade tab bar.
   the rail can be dragged wider or narrower (drag it closed to fold it),
   and folds into a slim glass column of its panels. styles: ./chrome.css
   ===================================================================== */

const COLLAPSE_KEY = "sl:feed-collapsed";
const WIDTH_KEY = "sl:rail-w";
/** the rail's remembered panel (owned by feed/feed-column.tsx, read on mount) */
const RAIL_TAB_KEY = "sl:rail-tab";
const RAIL_W = 320;
const RAIL_MIN = 296;
const RAIL_MAX = 460;
/** dragging this far past the minimum folds the rail on release */
const FOLD_AT = RAIL_MIN - 72;

/** runs before the shell paints, so a folded or resized rail never flashes at its default width */
const RAIL_INIT = `(function(){try{var d=document.documentElement;if(localStorage.getItem("${COLLAPSE_KEY}")==="1")d.dataset.rail="collapsed";var w=parseInt(localStorage.getItem("${WIDTH_KEY}")||"",10);if(w>=${RAIL_MIN}&&w<=${RAIL_MAX})d.style.setProperty("--tm-chrome-rail-w",w+"px")}catch(e){}})();`;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * on desktop the page scrolls inside #tm-main, which the router never resets: a new route would open at the
 * previous page's offset, tucked under the bar. so a new route starts at its top, back / forward return to where
 * you were on that page, and on phones the page tab comes forward (a search pick, a toast or an alert opens the page).
 */
function useRouteScroll(path: string, onRoute: () => void) {
  const last = useRef(path);
  const memo = useRef(new Map<string, number>());
  const popped = useRef(false);
  useEffect(() => {
    const main = document.getElementById("tm-main");
    const onScroll = () => {
      if (main) memo.current.set(last.current, main.scrollTop);
    };
    const onPop = () => {
      popped.current = true;
    };
    main?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      main?.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  // a layout effect: it runs after the router's own scroll-into-view in the same commit, so no frame shows the stale offset
  useIsoLayoutEffect(() => {
    if (last.current === path) return;
    last.current = path;
    const back = popped.current;
    popped.current = false;
    onRoute();
    const main = document.getElementById("tm-main");
    if (!main || getComputedStyle(main).overflowY === "visible") return;
    main.scrollTop = back ? (memo.current.get(path) ?? 0) : 0;
  }, [path]);
}

function useMediaQuery(q: string): boolean | undefined {
  const [m, setM] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Glyph = {
  tokens: (
    <svg width="17" height="17" viewBox="0 0 24 24" {...S} aria-hidden>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M14.6 4.3a5.5 5.5 0 1 1-1.9 10.6M9 6.8v4.4M7.2 9h3.6" />
    </svg>
  ),
  feed: (
    <svg width="17" height="17" viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M3 12h3.5l2.5-6.5 4.5 13 3-8.5H21" />
    </svg>
  ),
  board: (
    <svg width="17" height="17" viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M8 21h8M12 16.5V21M7 4h10v5.5a5 5 0 0 1-10 0V4zM17 6h2.5a2.5 2.5 0 0 1-2.6 4.2M7 6H4.5a2.5 2.5 0 0 0 2.6 4.2" />
    </svg>
  ),
  trade: (
    <svg width="17" height="17" viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M8 3.5v3M8 17.5v3M16 3v4M16 15.5V20M6 6.5h4v11H6zM14 7h4v8.5h-4z" />
    </svg>
  ),
  user: (
    <svg width="17" height="17" viewBox="0 0 24 24" {...S} aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  ),
};

type RailTab = "tokens" | "feed" | "leaderboard" | "alerts";
const MINI: { id: RailTab; label: string; icon: ReactNode }[] = [
  { id: "tokens", label: "Tokens", icon: Glyph.tokens },
  { id: "feed", label: "Feed", icon: Glyph.feed },
  { id: "leaderboard", label: "Leaderboard", icon: Glyph.board },
  { id: "alerts", label: "Alerts", icon: <Icon.bell /> },
];

/** what the page tab is called on a phone, by route */
function pageTab(path: string): { label: string; icon: ReactNode } {
  if (path.startsWith("/leaderboard")) return { label: "Leaderboard", icon: Glyph.board };
  if (path.startsWith("/tokens")) return { label: "Tokens", icon: Glyph.tokens };
  if (path.startsWith("/t/")) return { label: "Profile", icon: Glyph.user };
  return { label: "Trade", icon: Glyph.trade };
}

/** fomo layout: framed feed on the left, page content (centre + right) owned by the route. mobile: feed / trade tabs. */
export function Shell({ children }: { children: ReactNode }) {
  const { address: wallet } = useAccount();
  const [tab, setTab] = useState<"feed" | "page">("page");
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);
  const fold = useCallback((c: boolean) => {
    setCollapsed(c);
    try {
      localStorage.setItem(COLLAPSE_KEY, c ? "1" : "0");
    } catch {}
    const d = document.documentElement;
    if (c) d.dataset.rail = "collapsed";
    else delete d.dataset.rail;
  }, []);
  const toggleCollapsed = () => fold(!collapsed);
  /** unfold, optionally straight onto one of the rail's panels */
  const expand = (panel?: RailTab) => {
    if (panel) {
      try {
        localStorage.setItem(RAIL_TAB_KEY, panel);
      } catch {}
    }
    fold(false);
  };
  const switchTab = (t: "feed" | "page") => {
    setTab(t);
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  };
  const showPage = useCallback(() => setTab("page"), []);
  useRouteScroll(path, showPage);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const showFeed = isDesktop === true || (isDesktop === false && tab === "feed");
  const folded = collapsed && isDesktop === true;
  const page = pageTab(path);
  // server render only: the client never renders a script tag (react warns about those), and the first paint is already right
  const initSent = useRef(false);
  useServerInsertedHTML(() => {
    if (initSent.current) return null;
    initSent.current = true;
    return <script id="tm-rail-init" dangerouslySetInnerHTML={{ __html: RAIL_INIT }} />;
  });

  return (
    <div className="tm-chrome-shell">
      <TopBar onToggleFeed={() => setTab((t) => (t === "feed" ? "page" : "feed"))} />
      {wallet && <FundsHost address={wallet} />}
      <ProfileHost />
      <AlertToasts />
      <div className="tm-chrome-grid">
        <aside id="tm-rail" className={`${tab === "feed" ? "block" : "hidden"} md:block card tm-chrome-rail`} aria-label="Markets and traders">
          {folded ? (
            <MiniRail onExpand={expand} />
          ) : showFeed ? (
            <FeedColumn onNavigate={() => switchTab("page")} onCollapse={isDesktop ? toggleCollapsed : undefined} />
          ) : (
            <RailSkeleton />
          )}
        </aside>
        {isDesktop && !folded && <RailResizer onFold={() => fold(true)} />}
        <main id="tm-main" className={`${tab === "page" ? "block" : "hidden"} md:block tm-chrome-main`}>
          {children}
        </main>
      </div>
      <Ticker />
      <nav className="tm-chrome-tabbar" aria-label="mobile">
        <span className="tm-chrome-tabbar-ind" style={{ "--i": tab === "feed" ? 0 : 1 } as React.CSSProperties} aria-hidden />
        {/* the rail opens on the market list (tokens first: a new visitor has nothing in feed or alerts yet), so the tab
            says so. no dot on it: a dot that never goes away reads as an unread badge */}
        <button type="button" className="tm-chrome-tabbar-btn" data-on={tab === "feed" || undefined} aria-pressed={tab === "feed"} onClick={() => switchTab("feed")}>
          {Glyph.tokens}
          Markets
        </button>
        <button type="button" className="tm-chrome-tabbar-btn" data-on={tab === "page" || undefined} aria-pressed={tab === "page"} onClick={() => switchTab("page")}>
          {page.icon}
          {page.label}
        </button>
      </nav>
    </div>
  );
}

/** the folded rail: a slim glass column with a door into each of the rail's panels */
function MiniRail({ onExpand }: { onExpand: (panel?: RailTab) => void }) {
  const [last, setLast] = useState<RailTab>("tokens");
  useEffect(() => {
    try {
      const t = localStorage.getItem(RAIL_TAB_KEY) as RailTab | null;
      if (t && MINI.some((m) => m.id === t)) setLast(t);
    } catch {}
  }, []);
  return (
    <div className="tm-chrome-mini">
      <div className="tm-chrome-mini-head">
        <button type="button" className="tm-chrome-mini-btn" onClick={() => onExpand()} aria-label="Expand panel" data-tip="Expand panel" aria-controls="tm-rail" aria-expanded={false}>
          <Icon.collapse className="rotate-180" />
        </button>
      </div>
      <div
        className="tm-chrome-mini-list"
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Open a panel"
        onKeyDown={(e) => {
          // toolbar pattern: up / down walk the doors, home / end jump to the ends
          const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
          if (to < 0 || i < 0) return;
          e.preventDefault();
          items[to]?.focus();
        }}
      >
        {MINI.map((m) => (
          <button key={m.id} type="button" className="tm-chrome-mini-btn" data-on={last === m.id || undefined} data-tip={m.label} aria-label={`Open ${m.label}`} onClick={() => onExpand(m.id)}>
            {m.icon}
            {m.id === "feed" && <span className="tm-chrome-live" aria-hidden />}
          </button>
        ))}
      </div>
      <span className="tm-chrome-mini-label" aria-hidden>
        Markets · Traders
      </span>
    </div>
  );
}

/** the rail's silhouette until the client knows the viewport (no layout shift when it lands) */
function RailSkeleton() {
  return (
    <div className="tm-chrome-rail-sk" aria-hidden>
      <div className="tm-chrome-rail-sk-head" />
      <div className="tm-chrome-rail-sk-list">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton tm-chrome-rail-sk-row" style={{ opacity: 1 - i * 0.11 }} />
        ))}
      </div>
    </div>
  );
}

/** the seam between rail and page: drag to resize, drag past the edge to fold, double-click to reset */
function RailResizer({ onFold }: { onFold: () => void }) {
  const [w, setW] = useState(RAIL_W);
  useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
      if (v >= RAIL_MIN && v <= RAIL_MAX) setW(v);
    } catch {}
  }, []);
  // never leave the page stuck in "resizing" (col-resize cursor, no text selection) if the seam goes away mid-drag
  useEffect(() => () => document.documentElement.removeAttribute("data-tm-resizing"), []);
  const maxW = () => Math.max(RAIL_W, Math.min(RAIL_MAX, Math.round(window.innerWidth * 0.3)));
  /** the width the rail really has (a remembered width is capped by css on a narrower window) */
  const shown = () => Math.round(document.getElementById("tm-rail")?.getBoundingClientRect().width ?? w);
  const apply = (px: number) => document.documentElement.style.setProperty("--tm-chrome-rail-w", `${px}px`);
  const commit = (px: number) => {
    apply(px);
    setW(px);
    try {
      localStorage.setItem(WIDTH_KEY, String(px));
    } catch {}
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const grid = el.parentElement;
    const rail = grid?.querySelector<HTMLElement>(".tm-chrome-rail");
    if (!grid || !rail) return;
    e.preventDefault();
    const left = rail.getBoundingClientRect().left;
    const max = maxW();
    // keep the grab offset, so the seam does not jump under the pointer
    const grab = e.clientX - (left + rail.getBoundingClientRect().width);
    let x = e.clientX;
    let raf = 0;
    let next = Math.round(rail.getBoundingClientRect().width);
    let folding = false;
    el.setPointerCapture(e.pointerId);
    el.setAttribute("data-drag", "");
    document.documentElement.setAttribute("data-tm-resizing", "");
    const frame = () => {
      raf = 0;
      const raw = x - grab - left;
      folding = raw < FOLD_AT;
      next = Math.round(Math.min(max, Math.max(RAIL_MIN, raw)));
      apply(next);
      el.toggleAttribute("data-fold", folding);
    };
    const move = (ev: PointerEvent) => {
      x = ev.clientX;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const end = () => {
      if (raf) cancelAnimationFrame(raf);
      frame();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeAttribute("data-drag");
      el.removeAttribute("data-fold");
      document.documentElement.removeAttribute("data-tm-resizing");
      if (folding) {
        // fold, and keep the width it had before the drag for when it comes back
        apply(w);
        onFold();
      } else commit(next);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    const cur = shown();
    const to = e.key === "ArrowLeft" ? cur - step : e.key === "ArrowRight" ? cur + step : e.key === "Home" ? RAIL_MIN : e.key === "End" ? maxW() : null;
    if (e.key === "Enter") {
      e.preventDefault();
      onFold();
      return;
    }
    if (to === null) return;
    e.preventDefault();
    commit(Math.min(maxW(), Math.max(RAIL_MIN, to)));
  };
  // the seam only renders on the client (after the media query resolves), so the window is there
  const max = typeof window === "undefined" ? RAIL_MAX : maxW();

  return (
    <div
      className="tm-chrome-resize"
      role="separator"
      aria-orientation="vertical"
      aria-controls="tm-rail"
      aria-label="Resize the panel (drag past the edge or press Enter to fold it)"
      aria-valuemin={RAIL_MIN}
      aria-valuemax={max}
      aria-valuenow={Math.min(w, max)}
      aria-valuetext={`${Math.min(w, max)} pixels`}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => commit(RAIL_W)}
      onKeyDown={onKey}
    />
  );
}
