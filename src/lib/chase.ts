"use client";
/**
 * chase orders, the way hyperliquid's "Chase" works: a post-only limit that sits at the best price on your side of the
 * book and follows it. every few seconds the order is re-priced to the current best bid (buys) or best ask (sells)
 * until it fills, is stopped, or its time is up. the loop runs in the browser; the orders themselves are plain
 * hyperliquid ALO limits placed and cancelled through the trading agent, so nothing is lost if the tab closes: the last
 * resting order simply stays on the book.
 */
import { useSyncExternalStore } from "react";
import { api } from "./client";

export type Chase = {
  id: string;
  coin: string;
  /** display name */
  label: string;
  side: "LONG" | "SHORT";
  sz: number;
  szDecimals: number;
  leverage: number;
  reduceOnly: boolean;
  oid: number | null;
  px: number | null;
  remaining: number;
  reprices: number;
  startedAt: number;
  maxMs: number;
  status: "running" | "filled" | "stopped" | "expired" | "error";
  error?: string;
  /** go one level deeper after a post-only reject */
  deeper: number;
};

const KEY = "sl:chases";
const TICK_MS = 2500;
let chases: Chase[] = [];
let loaded = false;
const subs = new Set<() => void>();
const emit = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(chases.slice(0, 50)));
  } catch {}
  for (const s of subs) s();
};
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(v)) chases = v;
  } catch {}
}
/** the server has no chases; one shared empty list, so react sees the same snapshot every render */
const NONE: Chase[] = [];
export function useChases(): Chase[] {
  return useSyncExternalStore(
    (cb) => {
      load();
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => chases,
    () => NONE,
  );
}
const patch = (id: string, p: Partial<Chase>) => {
  chases = chases.map((c) => (c.id === id ? { ...c, ...p } : c));
  emit();
};

export function startChase(o: { coin: string; label: string; side: "LONG" | "SHORT"; sz: number; szDecimals: number; leverage: number; reduceOnly: boolean; maxMinutes: number }): Chase {
  load();
  const c: Chase = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...o, oid: null, px: null, remaining: o.sz, reprices: 0, startedAt: Date.now(), maxMs: Math.max(1, o.maxMinutes) * 60_000, status: "running", deeper: 0 };
  chases = [c, ...chases];
  emit();
  void tick();
  return c;
}

export async function stopChase(id: string, status: Chase["status"] = "stopped") {
  const c = chases.find((x) => x.id === id);
  if (!c) return;
  if (c.oid !== null) await api("/api/trade/cancel", { method: "POST", json: { cancels: [{ coin: c.coin, oid: c.oid }] } }).catch(() => {});
  patch(id, { status, oid: null });
}

export function clearFinishedChases() {
  chases = chases.filter((c) => c.status === "running");
  emit();
}

type Book = { bids: { px: number; sz: number }[]; asks: { px: number; sz: number }[] };
type OpenOrder = { oid: number; coin: string; limitPx: number; sz: number };

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const active = chases.filter((c) => c.status === "running");
    if (!active.length) return;
    const orders = await api<{ orders: OpenOrder[] }>("/api/account/orders").then((r) => r.orders).catch(() => null);
    if (!orders) return;
    for (const c of active) {
      try {
        const open = c.oid !== null ? orders.find((o) => o.oid === c.oid && o.coin === c.coin) : undefined;
        if (c.oid !== null && !open) {
          // gone from the book: filled (or cancelled by hand), either way the chase is over
          patch(c.id, { status: "filled", remaining: 0, oid: null });
          continue;
        }
        if (Date.now() - c.startedAt > c.maxMs) {
          await stopChase(c.id, "expired");
          continue;
        }
        const book = await api<Book>(`/api/book?coin=${encodeURIComponent(c.coin)}`);
        const levels = c.side === "LONG" ? book.bids : book.asks;
        const lvl = levels[Math.min(c.deeper, levels.length - 1)];
        if (!lvl) continue;
        const target = lvl.px;
        const remaining = open ? open.sz : c.remaining;
        if (open && Math.abs(open.limitPx - target) < 1e-12) {
          if (remaining !== c.remaining) patch(c.id, { remaining });
          continue;
        }
        if (open) await api("/api/trade/cancel", { method: "POST", json: { cancels: [{ coin: c.coin, oid: c.oid }] } });
        const r = await api<{ order: { status: string; oid?: number; totalSz?: number } }>("/api/trade/order", {
          method: "POST",
          json: { coin: c.coin, side: c.side, type: "limit", sz: Number(remaining.toFixed(c.szDecimals)), leverage: c.leverage, limitPx: target, tif: "Alo", reduceOnly: c.reduceOnly },
        });
        if (r.order.status === "filled") patch(c.id, { status: "filled", remaining: 0, oid: null, px: target, reprices: c.reprices + (open ? 1 : 0) });
        else patch(c.id, { oid: r.order.oid ?? null, px: target, remaining, reprices: c.reprices + (open ? 1 : 0), deeper: 0 });
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        // post-only would have crossed: step one level deeper next time rather than giving up
        if (/immediately|post only|alo/i.test(msg)) patch(c.id, { oid: null, deeper: Math.min(c.deeper + 1, 3) });
        else patch(c.id, { status: "error", error: msg.slice(0, 160), oid: null });
      }
    }
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** start the loop once per page; safe to call repeatedly */
export function ensureChaseRunner() {
  load();
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}
