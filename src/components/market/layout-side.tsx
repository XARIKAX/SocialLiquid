"use client";
import "./layout.css";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";

/* =====================================================================
   the ticket column on the desk is sticky and scrolls on its own, so the
   cards under the ticket can sit below its fold (at 1440x900 the ticket
   alone fills it). two small pieces finish that column:
   - SideMap: a slim map in the gutter beside the ticket. a hairline
     track, a lit thumb for the part in view, a dot for each section
     (hover names it, click glides there, the thumb drags). it shows only
     while the column holds more than it can show, so nothing below the
     ticket is ever out of sight without a sign. it also marks the edges
     the column has scrolled past (data-fade) for its soft top edge.
   - SideDefer: a card mounts when it nears the column's own viewport (a
     window-rooted observer cannot look ahead past the scroller's clip, so
     the cards used to pop in as skeletons the moment they scrolled into
     view) and, for the light ones on the desk, once the page is idle, so
     they are ready before anyone scrolls to them. a card that polls (About
     and its candles) waits for the column to come near it.
   pointer conveniences only: the map is aria-hidden, the cards stay in
   the tab order and the column scrolls to whatever takes focus.
   styles: ./layout.css (.tm-lay-map*)
   ===================================================================== */

const MARK = "data-tm-lay-mark";
/** the track's inset from the column's top and bottom */
const INSET = 10;
const THUMB_MIN = 28;

/** a live scroll container (the desk), rather than part of the page's flow (phones, tablets) */
function scrolls(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false;
  const o = getComputedStyle(el).overflowY;
  return o === "auto" || o === "scroll";
}

const smooth = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/** a card that mounts near the column's viewport (and, with `idle`, once the desk is idle); `mark` names it on the map */
export function SideDefer({ scrollRef, minHeight, mark, idle = false, children }: { scrollRef: RefObject<HTMLElement | null>; minHeight: number; mark: string; idle?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (show || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const sc = scrollRef.current;
    const desk = scrolls(sc);
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((x) => x.isIntersecting)) setShow(true);
      },
      desk ? { root: sc, rootMargin: "480px 0px" } : { rootMargin: "300px" },
    );
    io.observe(el);
    let rid = 0;
    let timer = 0;
    if (desk && idle) {
      if (typeof window.requestIdleCallback === "function") rid = window.requestIdleCallback(() => setShow(true), { timeout: 3000 });
      else timer = window.setTimeout(() => setShow(true), 1500);
    }
    return () => {
      io.disconnect();
      if (rid) window.cancelIdleCallback(rid);
      if (timer) window.clearTimeout(timer);
    };
  }, [show, scrollRef, idle]);
  return (
    <div ref={ref} data-tm-lay-mark={mark} style={show ? undefined : { minHeight }}>
      {show ? children : <div className="card skeleton h-full" style={{ minHeight }} />}
    </div>
  );
}

type Geo = { live: boolean; H: number; S: number; T: number; th: number; tops: number[]; ends: number[] };

/**
 * the map for the column `scrollRef` (the elements inside it carrying data-tm-lay-mark, in order, are its
 * sections; `labels` names them). all of it is written straight to the dom from scroll and resize
 * callbacks: nothing re-renders while the column moves.
 */
export function SideMap({ scrollRef, labels }: { scrollRef: RefObject<HTMLElement | null>; labels: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const geo = useRef<Geo>({ live: false, H: 0, S: 0, T: 0, th: 0, tops: [], ends: [] });
  const drop = useRef<(() => void) | null>(null);

  useEffect(() => {
    const sc = scrollRef.current;
    const map = ref.current;
    if (!sc || !map) return;
    const thumb = map.querySelector<HTMLElement>(".tm-lay-map-thumb");
    const dots = Array.from(map.querySelectorAll<HTMLElement>(".tm-lay-map-dot"));
    let raf = 0;
    let quiet = 0;

    const measure = () => {
      const g = geo.current;
      g.H = sc.clientHeight;
      g.S = sc.scrollHeight;
      g.live = scrolls(sc) && g.S > g.H + 2;
      g.T = Math.max(0, g.H - 2 * INSET);
      g.th = g.live ? Math.min(g.T, Math.max(THUMB_MIN, Math.round((g.T * g.H) / g.S))) : 0;
      const els = Array.from(sc.querySelectorAll<HTMLElement>(`[${MARK}]`));
      const origin = sc.getBoundingClientRect().top - sc.scrollTop;
      g.tops = els.map((el) => el.getBoundingClientRect().top - origin);
      g.ends = els.map((el, i) => g.tops[i] + el.offsetHeight);
      map.toggleAttribute("data-on", g.live);
      if (thumb) thumb.style.height = `${g.th}px`;
      dots.forEach((d, i) => {
        // a section with nothing in it (a card with no rows) gets no dot
        const ok = g.live && i < els.length && g.ends[i] - g.tops[i] > 0;
        d.style.display = ok ? "" : "none";
        if (ok) d.style.top = `${INSET + Math.round((Math.min(g.S, Math.max(0, g.tops[i])) / g.S) * g.T)}px`;
      });
    };
    const paint = () => {
      raf = 0;
      const g = geo.current;
      const y = sc.scrollTop;
      // the edges it has scrolled past, for the column's soft top edge
      const fade = `${g.live && y > 2 ? "t" : ""}${g.live && y + g.H < g.S - 2 ? "b" : ""}`;
      if ((sc.dataset.fade ?? "") !== fade) {
        if (fade) sc.dataset.fade = fade;
        else delete sc.dataset.fade;
      }
      if (!g.live) return;
      const k = g.S > g.H ? Math.min(1, Math.max(0, y / (g.S - g.H))) : 0;
      if (thumb) thumb.style.transform = `translate3d(0, ${Math.round((g.T - g.th) * k)}px, 0)`;
      dots.forEach((d, i) => d.toggleAttribute("data-in", g.tops[i] < y + g.H - 24 && g.ends[i] > y + 24));
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onScroll = () => {
      // lit while it moves, quiet again a beat after it stops
      map.setAttribute("data-active", "");
      window.clearTimeout(quiet);
      quiet = window.setTimeout(() => map.removeAttribute("data-active"), 900);
      queue();
    };
    // the map sits outside the scroller: a wheel over its dots and thumb still moves the column
    const onWheel = (e: WheelEvent) => {
      if (!geo.current.live) return;
      e.preventDefault();
      sc.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * sc.clientHeight : e.deltaY });
    };
    const ro = new ResizeObserver(() => {
      measure();
      queue();
    });
    ro.observe(sc);
    for (const c of Array.from(sc.children)) ro.observe(c);
    for (const el of Array.from(sc.querySelectorAll(`[${MARK}]`))) ro.observe(el);
    sc.addEventListener("scroll", onScroll, { passive: true });
    map.addEventListener("wheel", onWheel, { passive: false });
    measure();
    paint();
    return () => {
      ro.disconnect();
      sc.removeEventListener("scroll", onScroll);
      map.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(quiet);
      drop.current?.();
    };
  }, [scrollRef, labels.length]);

  /** glide to a section */
  const go = (i: number) => {
    const sc = scrollRef.current;
    const g = geo.current;
    if (!sc || !g.live) return;
    sc.scrollTo({ top: i === 0 ? 0 : Math.max(0, g.tops[i] ?? 0), behavior: smooth() });
  };

  /** the thumb drags like a scrollbar's */
  const onThumb = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const sc = scrollRef.current;
    const g = geo.current;
    if (e.button !== 0 || !sc || !g.live) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const y0 = e.clientY;
    const top0 = sc.scrollTop;
    const ratio = (g.S - g.H) / Math.max(1, g.T - g.th);
    el.setPointerCapture(e.pointerId);
    el.setAttribute("data-drag", "");
    const move = (ev: PointerEvent) => {
      sc.scrollTop = top0 + (ev.clientY - y0) * ratio;
    };
    const end = () => {
      drop.current = null;
      el.removeAttribute("data-drag");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
    };
    drop.current = end;
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  };

  /** a press on the track pages toward it, as a scrollbar's track does */
  const onTrack = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const sc = scrollRef.current;
    const g = geo.current;
    const thumb = ref.current?.querySelector<HTMLElement>(".tm-lay-map-thumb");
    if (e.button !== 0 || !sc || !thumb || !g.live) return;
    e.preventDefault();
    const r = thumb.getBoundingClientRect();
    const dir = e.clientY < r.top ? -1 : e.clientY > r.bottom ? 1 : 0;
    if (dir) sc.scrollBy({ top: dir * g.H * 0.85, behavior: smooth() });
  };

  return (
    <div ref={ref} className="tm-lay-map" aria-hidden>
      <span className="tm-lay-map-track" onPointerDown={onTrack} />
      <span className="tm-lay-map-thumb" onPointerDown={onThumb} />
      {labels.map((label, i) => (
        // keyed by place, not name: the effect holds these nodes, and "About BTC" becomes "About ETH"
        <span key={i} className="tm-lay-map-dot" data-tip={label} onClick={() => go(i)} />
      ))}
    </div>
  );
}
