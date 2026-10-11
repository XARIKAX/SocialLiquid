"use client";
import { useEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** one observer for the whole page: anything with [data-reveal] gets [data-in] when it scrolls into view */
export function RevealObserver() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lp [data-reveal]:not([data-in])"));
    if (!("IntersectionObserver" in window) || reduced()) {
      els.forEach((el) => el.setAttribute("data-in", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
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
  return (
    <span ref={ref} className={className}>
      {prefix}
      {text}
      {suffix}
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

/** toggles data-scrolled on the nav once the page leaves the top */
export function useScrolled(px = 12) {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > px);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [px]);
  return s;
}
