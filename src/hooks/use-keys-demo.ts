"use client";
/**
 * state for the keys preview: what the viewer subscribes to, the keys they hold, what they can claim and how
 * they priced their own feed. it lives in this browser only (nothing is bought or charged in the preview) and
 * survives a reload, so the demo can be walked through end to end: subscribe on a trader, see it in holdings.
 */
import { useSyncExternalStore } from "react";
import { DEMO_START } from "@/lib/keys-demo";
import { keysToast } from "./use-keys-toast";
import type { Cadence, OfferKey } from "@/lib/keys";

export type Holding = { qty: number; avgCost: number; earned: number };
export type Subscription = { since: string; renews: string; unread: number };
export type StudioSettings = { price: number; offers: OfferKey[]; cadence: Cadence; saved: boolean };
export type KeysDemoState = {
  keys: Record<string, Holding>;
  subs: Record<string, Subscription>;
  claimable: number;
  studio: StudioSettings;
};

const STORE = "sl:keys-preview";
const INITIAL: KeysDemoState = {
  keys: DEMO_START.keys,
  subs: DEMO_START.subs,
  claimable: DEMO_START.claimable,
  studio: { price: 29, offers: ["calls", "alerts"], cadence: "regular", saved: false },
};

let state = INITIAL;
let loaded = false;
const listeners = new Set<() => void>();

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const s = JSON.parse(raw) as Partial<KeysDemoState>;
    state = {
      keys: isObj(s.keys) ? (s.keys as KeysDemoState["keys"]) : INITIAL.keys,
      subs: isObj(s.subs) ? (s.subs as KeysDemoState["subs"]) : INITIAL.subs,
      claimable: typeof s.claimable === "number" ? s.claimable : INITIAL.claimable,
      studio: isObj(s.studio) ? { ...INITIAL.studio, ...(s.studio as StudioSettings) } : INITIAL.studio,
    };
  } catch {
    /* unreadable or blocked storage: start fresh */
  }
}

function set(patch: Partial<KeysDemoState>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* private window: the preview still works, it just forgets on reload */
  }
  listeners.forEach((f) => f());
}

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const keysDemo = {
  notify(text: string) {
    keysToast(text);
  },
  subscribe(handle: string, price: number) {
    const month = new Date().toLocaleDateString("en-GB", { month: "short" });
    set({ subs: { ...state.subs, [handle]: { since: month, renews: nextMonth(), unread: 0 } } });
    keysDemo.notify(price > 0 ? `Subscribed to ${handle}. In the live version this charges $${price} a month in USDC.` : `Following ${handle}'s free feed.`);
  },
  unsubscribe(handle: string) {
    const next = { ...state.subs };
    delete next[handle];
    set({ subs: next });
    keysDemo.notify(`Cancelled ${handle}.`);
  },
  markRead(handle: string) {
    const s = state.subs[handle];
    if (s && s.unread) set({ subs: { ...state.subs, [handle]: { ...s, unread: 0 } } });
  },
  buy(handle: string, qty: number, price: number) {
    const h = state.keys[handle] ?? { qty: 0, avgCost: 0, earned: 0 };
    const total = h.qty + qty;
    const avgCost = (h.qty * h.avgCost + qty * price) / total;
    set({ keys: { ...state.keys, [handle]: { ...h, qty: total, avgCost } } });
    keysDemo.notify(`Bought ${qty} ${handle} ${qty === 1 ? "key" : "keys"}. Nothing was charged — this is the preview.`);
  },
  sell(handle: string, qty: number) {
    const h = state.keys[handle];
    if (!h) return;
    const left = h.qty - qty;
    const next = { ...state.keys };
    if (left <= 0) delete next[handle];
    else next[handle] = { ...h, qty: left };
    set({ keys: next });
    keysDemo.notify(`Sold ${Math.min(qty, h.qty)} ${handle} ${qty === 1 ? "key" : "keys"}.`);
  },
  claim() {
    const amt = state.claimable;
    if (amt <= 0) return;
    set({ claimable: 0 });
    keysDemo.notify(`Claimed $${amt.toFixed(2)}. In the live version it lands in your Hyperliquid balance.`);
  },
  saveStudio(s: Omit<StudioSettings, "saved">) {
    set({ studio: { ...s, saved: true } });
    keysDemo.notify(s.price > 0 ? `Saved. Your subscription page now shows $${s.price} a month.` : "Saved. Your feed is free.");
  },
  reset() {
    set({ ...INITIAL });
    keysDemo.notify("Preview reset.");
  },
};

function subscribe(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function useKeysDemo(): KeysDemoState {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => INITIAL,
  );
}
