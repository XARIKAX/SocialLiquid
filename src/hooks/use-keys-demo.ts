"use client";
/**
 * state for the keys preview: the keys the viewer holds (each one the pass to that trader's feed), what they can
 * claim, and how they set up their own key. it lives in this browser only (nothing is bought or charged in the
 * preview) and survives a reload, so the demo can be walked through end to end: buy a key on a trader, see their
 * feed unlock and the key show up in holdings.
 */
import { useSyncExternalStore } from "react";
import { DEMO_START } from "@/lib/keys-demo";
import { keysToast } from "./use-keys-toast";
import type { Cadence, OfferKey } from "@/lib/keys";

export type Holding = { qty: number; avgCost: number; earned: number; unread: number };
export type StudioSettings = { startPrice: number; offers: OfferKey[]; cadence: Cadence; pinned?: string; saved: boolean };
export type KeysDemoState = {
  keys: Record<string, Holding>;
  claimable: number;
  studio: StudioSettings;
};

// v2: keys are the pass now; an older stored preview (with subscriptions) starts over
const STORE = "sl:keys-preview-v2";
const INITIAL: KeysDemoState = {
  keys: DEMO_START.keys,
  claimable: DEMO_START.claimable,
  studio: { startPrice: 10, offers: ["calls", "alerts"], cadence: "regular", pinned: "", saved: false },
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

export const keysDemo = {
  notify(text: string) {
    keysToast(text);
  },
  markRead(handle: string) {
    const h = state.keys[handle];
    if (h && h.unread) set({ keys: { ...state.keys, [handle]: { ...h, unread: 0 } } });
  },
  buy(handle: string, qty: number, price: number) {
    const h = state.keys[handle] ?? { qty: 0, avgCost: 0, earned: 0, unread: 0 };
    const total = h.qty + qty;
    const avgCost = (h.qty * h.avgCost + qty * price) / total;
    set({ keys: { ...state.keys, [handle]: { ...h, qty: total, avgCost } } });
    keysDemo.notify(h.qty ? `Bought ${qty} more ${handle} ${qty === 1 ? "key" : "keys"}. Nothing was charged — this is the preview.` : `You hold ${handle}'s key: their feed is unlocked. Nothing was charged — this is the preview.`);
  },
  sell(handle: string, qty: number) {
    const h = state.keys[handle];
    if (!h) return;
    const left = h.qty - qty;
    const next = { ...state.keys };
    if (left <= 0) delete next[handle];
    else next[handle] = { ...h, qty: left };
    set({ keys: next });
    keysDemo.notify(left <= 0 ? `Sold your ${handle} keys. Their feed is locked again.` : `Sold ${Math.min(qty, h.qty)} ${handle} ${qty === 1 ? "key" : "keys"}.`);
  },
  claim() {
    const amt = state.claimable;
    if (amt <= 0) return;
    set({ claimable: 0 });
    keysDemo.notify(`Claimed $${amt.toFixed(2)}. In the live version it lands in your Solana wallet as USDC.`);
  },
  saveStudio(s: Omit<StudioSettings, "saved">) {
    set({ studio: { ...s, saved: true } });
    keysDemo.notify(`Saved. Your key starts at $${s.startPrice}.`);
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
