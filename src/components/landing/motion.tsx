"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { vars } from "./parts";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** text-level tags keep the blur-to-sharp reveal; anything else that is panel-sized reveals without a gpu blur */
const TEXTUAL = /^(H[1-6]|P|SPAN|A|EM|STRONG|B|SMALL|LABEL|BLOCKQUOTE|FIGCAPTION)$/;
const SOLID_AREA = 60_000;

/** one observer for the whole page: anything with [data-reveal] gets [data-in] when it scrolls into view */
export function RevealObserver() {
  useEffect(() => {
    // tells the no-hydration watchdog in <Landing> that reveals are handled
    (window as unknown as { __lpReveal?: boolean }).__lpReveal = true;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lp [data-reveal]:not([data-in])"));
    if (!("IntersectionObserver" in window) || reduced()) {
      els.forEach((el) => el.setAttribute("data-in", ""));
      return;
    }
    for (const el of els) {
      if (TEXTUAL.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > SOLID_AREA) el.setAttribute("data-reveal-solid", "");
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "");
          io.unobserve(e.target);
        }
      },
      // any pixel past the bottom 10% of the viewport counts, so very tall cards reveal as soon as they arrive
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    // keyboard focus reveals the block it lands in (and every reveal around it) at once
    const onFocus = (e: FocusEvent) => {
      let el = (e.target as Element | null)?.closest?.("[data-reveal]") ?? null;
      while (el) {
        el.setAttribute("data-in", "");
        io.unobserve(el);
        el = el.parentElement?.closest("[data-reveal]") ?? null;
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      io.disconnect();
      document.removeEventListener("focusin", onFocus);
    };
  }, []);
  return null;
}

/**
 * pauses every css loop in a section while it is more than 200px off screen (base.css: [data-off]).
 * play-state only, so intros keyed on [data-in] and hover pauses keep working.
 */
export function MotionGate() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.toggleAttribute("data-off", !e.isIntersecting);
      },
      { rootMargin: "200px 0px" },
    );
    document.querySelectorAll(".lp main > section, .lp > footer").forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  return null;
}

type Fmt = "usd" | "usd0" | "usdc" | "pct" | "int" | "fixed";
function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}
function format(v: number, f: Fmt, decimals: number) {
  if (f === "usd") return `$${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  if (f === "usd0") return `$${Math.round(v).toLocaleString("en-US")}`;
  if (f === "usdc") return `$${compact(v)}`;
  if (f === "pct") return `${v.toFixed(decimals)}%`;
  if (f === "fixed") return v.toFixed(decimals);
  return Math.round(v).toLocaleString("en-US");
}

/**
 * counts up to `to` once it is on screen. server html carries the final value,
 * so no-js and reduced-motion readers see the real number.
 */
export function CountUp({ to, from, format: f = "int", decimals = 0, duration = 1600, delay = 0, prefix = "", suffix = "", className }: { to: number; from?: number; format?: Fmt; decimals?: number; duration?: number; delay?: number; prefix?: string; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(() => format(to, f, decimals));
  useEffect(() => {
    if (reduced() || !Number.isFinite(to)) return;
    const el = ref.current;
    if (!el) return;
    const start = from ?? (to === 0 ? 0 : to * 0.42);
    let raf = 0;
    let timer = 0;
    setText(format(start, f, decimals));
    const run = () => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        const e = 1 - Math.pow(1 - p, 4);
        setText(format(start + (to - start) * e, f, decimals));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      timer = window.setTimeout(run, delay);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [to, from, f, decimals, duration, delay]);
  // the counting text is visual only; assistive tech and copy/paste get the final value
  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">
        {prefix}
        {text}
        {suffix}
      </span>
      <span className="sr-only select-none">
        {prefix}
        {format(to, f, decimals)}
        {suffix}
      </span>
    </span>
  );
}

/**
 * pointer-tracked light for any [data-spotlight] surface: sets --mx / --my (px, relative to the element).
 * pair with the .lp-spot class in base.css. one listener for the page.
 */
export function SpotlightTracker() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    let raf = 0;
    let ev: PointerEvent | null = null;
    const apply = () => {
      raf = 0;
      if (!ev) return;
      const el = (ev.target as Element | null)?.closest?.<HTMLElement>("[data-spotlight]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      el.style.setProperty("--my", `${ev.clientY - r.top}px`);
    };
    const on = (e: PointerEvent) => {
      ev = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    document.addEventListener("pointermove", on, { passive: true });
    return () => {
      document.removeEventListener("pointermove", on);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}

/** sets data-scrolled on the landing nav once the page leaves the top (lets <Nav> stay a server component) */
export function NavScrollFlag({ px = 12 }: { px?: number }) {
  useEffect(() => {
    const h = document.querySelector(".lp-nav");
    if (!h) return;
    const on = () => h.toggleAttribute("data-scrolled", window.scrollY > px);
    // the scrolled pill is 1120px wide where the resting row is 1240px: nav.css scales its surface by this ratio
    const size = () => {
      const w = h.clientWidth - 24;
      if (w > 0) (h as HTMLElement).style.setProperty("--pill-k", (Math.min(1120, w) / Math.min(1240, w)).toFixed(4));
    };
    on();
    size();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", size, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", size);
    };
  }, [px]);
  return null;
}

/** below 768px the nav links fold into a glass sheet behind a Menu pill */
export function NavMenu({ links, external }: { links: [string, string][]; external?: [string, string] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!sheet.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onWide = () => window.innerWidth >= 768 && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onWide);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      <button ref={btn} type="button" className="lp-nav-menu" aria-expanded={open} aria-controls={id} data-open={open ? "" : undefined} onClick={() => setOpen((o) => !o)}>
        <span className="lp-nav-menu-ico" aria-hidden>
          <i />
          <i />
        </span>
        Menu
      </button>
      <div ref={sheet} id={id} className="lp-nav-sheet lp-glass" hidden={!open}>
        <nav aria-label="Primary">
          {links.map(([l, h], i) =>
            h.startsWith("/") ? (
              <Link key={l} href={h} className="lp-nav-sheet-link" style={vars({ "--i": i })} onClick={close}>
                {l}
                <SheetChevron />
              </Link>
            ) : (
              <a key={l} href={h} className="lp-nav-sheet-link" style={vars({ "--i": i })} onClick={close}>
                {l}
                <SheetChevron />
              </a>
            ),
          )}
          {external && (
            <a href={external[1]} target="_blank" rel="noreferrer" className="lp-nav-sheet-link lp-nav-sheet-ext" style={vars({ "--i": links.length })} onClick={close}>
              {external[0]}
              <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </nav>
      </div>
    </>
  );
}

function SheetChevron() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
