"use client";
import "./layout.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useServerInsertedHTML } from "next/navigation";

/* =====================================================================
   the terminal's panes, tradingview style: a seam between the chart and
   the order book (drag sideways), and one between the chart row and the
   panel below it (drag up and down). sizes live in two css custom
   properties on <html>, so a drag repaints the grid without re-rendering
   a single child; the chart and the book follow through their own
   resize observers. double-click (or Enter) puts a seam back, arrows
   nudge it, Home / End take it to its limits. the book also folds away
   into a slim dock (the glass button at the top of its seam, a drag on
   past the edge, or → at its narrowest) and comes back with a click.
   ui preferences only.
   styles: ./layout.css (.tm-lay-split*, .tm-lay-foldbtn, .tm-lay-dock*)
   ===================================================================== */

const BOOK_KEY = "sl:lay-book";
const ROW_KEY = "sl:lay-row";
const FOLD_KEY = "sl:lay-book-fold";
const BOOK_PROP = "--tm-lay-book";
const ROW_PROP = "--tm-lay-row";
const FOLD_ATTR = "data-tm-lay-fold";
export const BOOK_MIN = 240;
export const BOOK_MAX = 420;
/** the chart never gets narrower than this when the book is dragged wider */
const CHART_MIN = 360;
export const ROW_MIN = 320;
/** dragging the book's seam this far past its narrowest folds the book on release */
const FOLD_PAST = 64;
/** the grid gap the seams live in (layout.css: --tm-lay-gap) */
const GAP = 12;
const rowMax = () => Math.max(ROW_MIN, Math.round(window.innerHeight * 0.75));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** runs before the terminal paints, so remembered pane sizes (and a folded book) never flash at their defaults */
const INIT = `(function(){try{var d=document.documentElement,s=d.style,b=parseInt(localStorage.getItem("${BOOK_KEY}")||"",10),r=parseInt(localStorage.getItem("${ROW_KEY}")||"",10);if(b>=${BOOK_MIN}&&b<=${BOOK_MAX})s.setProperty("${BOOK_PROP}",b+"px");if(r>=${ROW_MIN}&&r<=4000)s.setProperty("${ROW_PROP}",r+"px");if(localStorage.getItem("${FOLD_KEY}")==="1")d.setAttribute("${FOLD_ATTR}","")}catch(e){}})();`;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function read(key: string, lo: number, hi: number): number | null {
  try {
    const v = parseInt(localStorage.getItem(key) ?? "", 10);
    return v >= lo && v <= hi ? v : null;
  } catch {
    return null;
  }
}
function write(key: string, v: number | string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  } catch {}
}
function setProp(prop: string, px: number | null) {
  const s = document.documentElement.style;
  if (px === null) s.removeProperty(prop);
  else s.setProperty(prop, `${px}px`);
}

/* ---------- the book's fold: one small store, read by the market view (to unmount the book) and the seam ---------- */
const fold = {
  on: typeof window !== "undefined" && (() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } })(),
  subs: new Set<() => void>(),
};
function setFolded(on: boolean) {
  fold.on = on;
  write(FOLD_KEY, on ? "1" : null);
  document.documentElement.toggleAttribute(FOLD_ATTR, on);
  fold.subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  fold.subs.add(f);
  return () => fold.subs.delete(f);
};
/** whether the order book is folded into its dock (false on the server: the css hides it before hydration) */
export function useBookFold(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => fold.on, () => false);
  return [on, setFolded];
}

/** restores the remembered pane sizes before the first paint: an inline script on the server render, a layout effect on client navigations */
export function usePaneInit() {
  const sent = useRef(false);
  useServerInsertedHTML(() => {
    if (sent.current) return null;
    sent.current = true;
    return <script id="tm-lay-init" dangerouslySetInnerHTML={{ __html: INIT }} />;
  });
  useIsoLayoutEffect(() => {
    setProp(BOOK_PROP, read(BOOK_KEY, BOOK_MIN, BOOK_MAX));
    setProp(ROW_PROP, read(ROW_KEY, ROW_MIN, 4000));
    document.documentElement.toggleAttribute(FOLD_ATTR, fold.on);
  }, []);
}

type Kind = "book" | "row";
type Measure = { v: number; min: number; max: number };

/**
 * one seam. `deskRef` is the chart + book row; the book pane inside it carries [data-tm-lay-book].
 * the seam reads the real geometry on every gesture (the css clamps a remembered size to what fits),
 * so its aria values and its starting point are always the layout's, not a stale number.
 */
export function PaneSplit({ kind, deskRef, controls }: { kind: Kind; deskRef: RefObject<HTMLDivElement | null>; controls: string }) {
  const book = kind === "book";
  const prop = book ? BOOK_PROP : ROW_PROP;
  const key = book ? BOOK_KEY : ROW_KEY;
  const [m, setM] = useState<Measure>(book ? { v: 260, min: BOOK_MIN, max: BOOK_MAX } : { v: 480, min: ROW_MIN, max: 720 });
  const dragging = useRef(false);
  /** tears down a drag in flight: the veil, the listeners, the attributes (also run if the seam unmounts mid-drag) */
  const teardown = useRef<(() => void) | null>(null);
  useEffect(() => () => teardown.current?.(), []);

  const measure = useCallback((): Measure | null => {
    const desk = deskRef.current;
    if (!desk) return null;
    const r = desk.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (book) {
      const pane = desk.querySelector<HTMLElement>("[data-tm-lay-book]");
      const w = pane?.getBoundingClientRect().width ?? 0;
      if (!w) return null;
      return { v: Math.round(w), min: BOOK_MIN, max: Math.round(clamp(r.width - GAP - CHART_MIN, BOOK_MIN, BOOK_MAX)) };
    }
    // never taller than 75vh, and never so tall that the seam slips under the bottom of the frame
    const host = desk.closest<HTMLElement>("#tm-main");
    const bottom = host && getComputedStyle(host).overflowY !== "visible" ? host.getBoundingClientRect().bottom : window.innerHeight;
    const fit = Math.floor(bottom - r.top - GAP - 8);
    return { v: Math.round(r.height), min: ROW_MIN, max: Math.max(ROW_MIN, Math.min(rowMax(), fit)) };
  }, [deskRef, book]);

  const sync = useCallback(() => {
    const n = measure();
    if (n) setM((o) => (o.v === n.v && o.min === n.min && o.max === n.max ? o : n));
  }, [measure]);

  /* keep the aria values true to the layout: window resizes, the rail folding, the other seam, the book folding */
  useEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    const ro = new ResizeObserver(() => {
      if (!dragging.current) sync();
    });
    ro.observe(desk);
    const pane = desk.querySelector<HTMLElement>("[data-tm-lay-book]");
    if (book && pane) ro.observe(pane);
    return () => ro.disconnect();
  }, [deskRef, sync, book]);

  const commit = useCallback(
    (px: number | null) => {
      setProp(prop, px);
      write(key, px);
      requestAnimationFrame(sync);
    },
    [prop, key, sync],
  );

  /** fold the book. a focused seam hands its focus to the dock (the way the book comes back); a mouse fold leaves focus alone */
  const foldBook = (moveFocus: boolean) => {
    setFolded(true);
    if (moveFocus) requestAnimationFrame(() => document.querySelector<HTMLElement>(".tm-lay-dock")?.focus({ preventScroll: true }));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const desk = deskRef.current;
    const m0 = measure();
    if (!m0 || !desk) return;
    e.preventDefault();
    const el = e.currentTarget;
    const root = document.documentElement;
    // the press does not take focus (default prevented), so this says whether the keyboard was already here
    const hadFocus = document.activeElement === el;
    const start = book ? e.clientX : e.clientY;
    let pos = start;
    let raf = 0;
    let next = m0.v;
    let moved = false;
    let folding = false;
    dragging.current = true;
    el.setPointerCapture(e.pointerId);
    el.setAttribute("data-drag", "");
    // the drag cursor everywhere and no hover noise from the panes, from one fixed veil
    // (a rule on every element would restyle the whole document as the drag starts and ends)
    const veil = document.createElement("div");
    veil.className = "tm-lay-veil";
    veil.dataset.dir = book ? "col" : "row";
    document.body.appendChild(veil);
    // a signal on the row (not the document) that its panes are being dragged: anything heavy inside can wait for the release
    desk.setAttribute("data-tm-lay-drag", book ? "col" : "row");
    // while the seam moves, the row is sized with plain inline styles on itself: a custom property on
    // <html> would restyle every element on the page each frame. it is committed once, on release.
    const paint = (px: number) => {
      if (book) {
        desk.style.gridTemplateColumns = `minmax(0, 1fr) ${px}px`;
        el.style.right = `${px}px`;
      } else desk.style.height = `${px}px`;
    };
    const unpaint = () => {
      desk.style.removeProperty("grid-template-columns");
      desk.style.removeProperty("height");
      el.style.removeProperty("right");
    };
    const frame = () => {
      raf = 0;
      const d = pos - start;
      // the book sits right of its seam: dragging left widens it
      const raw = book ? m0.v - d : m0.v + d;
      next = Math.round(clamp(raw, m0.min, m0.max));
      paint(next);
      el.setAttribute("aria-valuenow", String(next));
      if (book) {
        const f = raw < BOOK_MIN - FOLD_PAST;
        if (f !== folding) {
          folding = f;
          el.toggleAttribute("data-fold", f);
          root.toggleAttribute("data-tm-lay-folding", f);
        }
      }
    };
    const move = (ev: PointerEvent) => {
      pos = book ? ev.clientX : ev.clientY;
      if (!moved && Math.abs(pos - start) < 2) return;
      moved = true;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const cleanup = () => {
      teardown.current = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
      el.removeAttribute("data-drag");
      el.removeAttribute("data-fold");
      root.removeAttribute("data-tm-lay-folding");
      veil.remove();
      desk.removeAttribute("data-tm-lay-drag");
      dragging.current = false;
    };
    const end = () => {
      cleanup();
      // a press without a drag (half of a double-click) leaves the remembered size alone
      if (!moved) return;
      frame();
      root.removeAttribute("data-tm-lay-folding");
      // hand the size back to the stylesheet in the same task, so no frame paints in between
      unpaint();
      // folding keeps the width the book had before the drag, for when it comes back
      if (book && folding) foldBook(hadFocus);
      else commit(next);
    };
    // unmounted mid-drag (a route change): drop the veil and the inline sizes, keep the stored size
    teardown.current = () => {
      cleanup();
      unpaint();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const n = measure();
    if (!n) return;
    const step = e.shiftKey ? 64 : 16;
    let to: number | null = null;
    if (book && e.key === "ArrowLeft") to = n.v + step;
    else if (book && e.key === "ArrowRight") {
      // already at its narrowest: one more step folds it away
      if (n.v <= n.min) {
        e.preventDefault();
        foldBook(true);
        return;
      }
      to = n.v - step;
    } else if (!book && e.key === "ArrowUp") to = n.v - step;
    else if (!book && e.key === "ArrowDown") to = n.v + step;
    else if (e.key === "Home") to = n.min;
    else if (e.key === "End") to = n.max;
    else if (e.key === "Enter") {
      e.preventDefault();
      commit(null);
      return;
    }
    if (to === null) return;
    e.preventDefault();
    commit(Math.round(clamp(to, n.min, n.max)));
  };

  return (
    <div
      className={`tm-lay-split ${book ? "tm-lay-split-v" : "tm-lay-split-h"}`}
      role="separator"
      aria-orientation={book ? "vertical" : "horizontal"}
      aria-controls={controls}
      aria-label={book ? "Order book width (drag past the edge or press right arrow at its narrowest to fold it)" : "Chart height"}
      aria-valuemin={m.min}
      aria-valuemax={m.max}
      aria-valuenow={m.v}
      aria-valuetext={`${m.v} pixels`}
      tabIndex={0}
      data-tip={book ? "Drag to resize · past the edge folds · double-click resets" : "Drag to resize · double-click resets"}
      onPointerDown={onPointerDown}
      onDoubleClick={() => commit(null)}
      onKeyDown={onKey}
    >
      <span className="tm-lay-split-grip" aria-hidden />
    </div>
  );
}

/**
 * the one-click way to fold the book, as tradingview hides a panel: a small glass button at the top of the
 * book's seam, shown while the seam is reached for (or the button has keyboard focus). the dock brings it back.
 */
export function BookFoldButton({ controls }: { controls: string }) {
  const fold = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const kb = e.detail === 0 || e.currentTarget.matches(":focus-visible");
    setFolded(true);
    if (kb) requestAnimationFrame(() => document.querySelector<HTMLElement>(".tm-lay-dock")?.focus({ preventScroll: true }));
  };
  return (
    <button type="button" className="tm-lay-foldbtn" aria-controls={controls} aria-expanded aria-label="Hide the order book" data-tip="Hide the order book" onClick={fold}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m10 6 6 6-6 6" />
      </svg>
    </button>
  );
}

/** the folded book: a slim glass dock in the book's place; a click (or Enter) brings the book back at its width */
export function BookDock({ controls }: { controls: string }) {
  const unfold = (e: ReactMouseEvent<HTMLButtonElement>) => {
    // a keyboard press keeps the keyboard where the book is: on its seam. a click needs no focus moved
    const kb = e.detail === 0 || e.currentTarget.matches(":focus-visible");
    setFolded(false);
    if (kb) requestAnimationFrame(() => document.querySelector<HTMLElement>(".tm-lay-split-v")?.focus({ preventScroll: true }));
  };
  return (
    <button type="button" className="tm-lay-dock" aria-controls={controls} aria-expanded={false} aria-label="Show the order book" data-tip="Show the order book" onClick={unfold}>
      <span className="tm-lay-dock-btn" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <path d="m14 6-6 6 6 6" />
        </svg>
      </span>
      <span className="tm-lay-dock-label" aria-hidden>
        <i className="tm-lay-live" />
        Order book
      </span>
    </button>
  );
}
