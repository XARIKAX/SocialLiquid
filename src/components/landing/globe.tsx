"use client";
import { useEffect, useRef } from "react";
import { LAND_B64, LAND_H, LAND_STEP, LAND_W } from "./world";

const RAD = Math.PI / 180;
const TILT = -22 * RAD; // north leans toward the viewer
const CITIES: [number, number][] = [
  [40.7, -74], [51.5, -0.1], [1.35, 103.8], [35.7, 139.7], [25.2, 55.3], [37.5, 127],
  [22.3, 114.2], [37.8, -122.4], [-23.5, -46.6], [52.5, 13.4], [-33.9, 151.2], [19.1, 72.9],
];
const ROUTES: [number, number][] = [[0, 1], [1, 4], [4, 2], [3, 7], [6, 3], [9, 11]];

type V = [number, number, number];
const vec = (lat: number, lon: number): V => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];

let LAND: V[] | null = null;
function land(): V[] {
  if (LAND) return LAND;
  const bin = atob(LAND_B64);
  const out: V[] = [];
  for (let r = 0; r < LAND_H; r++) {
    const lat = 90 - (r + 0.5) * LAND_STEP;
    const k = Math.max(1, Math.round(1 / Math.cos(lat * RAD)));
    for (let c = 0; c < LAND_W; c++) {
      if (c % k) continue;
      const i = r * LAND_W + c;
      if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) out.push(vec(lat, -180 + (c + 0.5) * LAND_STEP));
    }
  }
  return (LAND = out);
}

/** a slowly turning dotted earth with pings on trading hubs and arcs between them */
export function Globe({ size = 260, className }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    ctx.scale(dpr, dpr);
    const pts = land();
    const cities = CITIES.map(([a, b]) => vec(a, b));
    const R = size / 2 - 2;
    const cx = size / 2;
    const cy = size / 2;
    const cosT = Math.cos(TILT);
    const sinT = Math.sin(TILT);
    const project = (p: V, rot: number, lift = 1): V => {
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const x = p[0] * cr + p[2] * sr;
      const z0 = -p[0] * sr + p[2] * cr;
      const y = p[1] * cosT - z0 * sinT;
      const z = p[1] * sinT + z0 * cosT;
      return [cx + x * R * lift, cy - y * R * lift, z];
    };
    const slerp = (a: V, b: V, t: number): V => {
      const d = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const s = Math.sin(d) || 1;
      const ka = Math.sin((1 - t) * d) / s;
      const kb = Math.sin(t * d) / s;
      return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
    };

    const draw = (ms: number) => {
      const rot = 0.35 + ms * 0.00011; // opens over the atlantic, drifts west
      ctx.clearRect(0, 0, size, size);
      // land
      for (const p of pts) {
        const [x, y, z] = project(p, rot);
        if (z <= 0) continue;
        // lit from the upper left
        const lit = Math.max(0, (x - cx) / R * -0.35 + (cy - y) / R * 0.45 + z * 0.6);
        const a = Math.min(1, 0.22 + lit * 0.85) * Math.min(1, z * 3);
        ctx.fillStyle = `rgba(160,252,230,${a.toFixed(3)})`;
        const s = 0.9 + z * 0.9;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      // routes
      ROUTES.forEach(([ia, ib], k) => {
        const a = cities[ia];
        const b = cities[ib];
        const N = 40;
        const head = ((ms / 2600 + k * 0.37) % 1.6) / 1.2; // 0..1.33, pause after landing
        ctx.lineWidth = 1;
        let prev: V | null = null;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const p = project(slerp(a, b, t), rot, 1 + Math.sin(Math.PI * t) * 0.16);
          if (prev && p[2] > -0.05 && prev[2] > -0.05) {
            const near = Math.max(0, 1 - Math.abs(t - Math.min(head, 1)) * 5);
            const alpha = (0.12 + near * 0.75) * (head > t ? 1 : 0.35);
            ctx.strokeStyle = `rgba(151,252,228,${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(p[0], p[1]);
            ctx.stroke();
          }
          prev = p;
        }
      });
      // pings
      cities.forEach((c, i) => {
        const [x, y, z] = project(c, rot);
        if (z <= 0.12) return;
        const ph = ((ms / 2800 + i * 0.23) % 1);
        ctx.strokeStyle = `rgba(151,252,228,${((1 - ph) * 0.7 * z).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 2 + ph * 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(232,255,250,${(0.55 + z * 0.45).toFixed(3)})`;
        ctx.shadowColor = "rgba(77,227,193,0.9)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = false;
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    draw(performance.now());
    if (still) return;
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    });
    io.observe(cv);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(raf);
    };
  }, [size]);
  return <canvas ref={ref} aria-hidden className={className} style={{ width: size, height: size }} />;
}
