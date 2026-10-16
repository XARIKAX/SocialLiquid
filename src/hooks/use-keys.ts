"use client";
/**
 * the keys section's data and actions. with NEXT_PUBLIC_KEYS_LIVE off the screens run on the sample traders and a
 * browser-only store; on, they read /api/keys and the actions move real money: keys are trades on the keys program
 * on Solana, signed by a Solana wallet the viewer links to their account once. a key is the pass to a trader's feed.
 * the screens call the same hooks either way.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnectModal } from "@/components/connect-modal";
import { api } from "@/lib/client";
import { KEY_START_DEFAULT, KEYS_LIVE, type PostKind } from "@/lib/keys";
import { DEMO_FEED, DEMO_PAYOUTS, DEMO_PLATFORM, DEMO_STUDIO, DEMO_TRADERS, DEMO_VIEWER } from "@/lib/keys-demo";
import type { KeysIndex, KeysMe, KeysStudioSettings, KeysTrader } from "@/lib/keys-model";
import { connectSolana, signSolanaMessage } from "@/lib/solana-wallet";
import { useAuth } from "./use-auth";
import { keysDemo, useKeysDemo } from "./use-keys-demo";
import { keysToast } from "./use-keys-toast";

export type KeysData = KeysIndex & {
  mode: "preview" | "live";
  /** live: the first load finished */
  ready: boolean;
  error: string | null;
  me: KeysMe;
  signedIn: boolean;
  byHandle: (handle: string) => KeysTrader | undefined;
};

const EMPTY_ME: KeysMe = {
  viewer: null,
  keys: {},
  claimable: 0,
  claimFrom: [],
  payouts: [],
  studio: { key: { price: KEY_START_DEFAULT, holders: 0, raised: 0, minted: 0 }, earnedThisMonth: 0, months: [], isCreator: false, listed: false, positions: [] },
  settings: { startPrice: KEY_START_DEFAULT, offers: ["calls", "alerts"], cadence: "regular", pinned: "", saved: false },
  traders: [],
};
const EMPTY_INDEX: KeysIndex = { traders: [], feed: [], platform: { live: 0, traders: 0, paidToCreators: 0, routed: 0, paidToHolders30d: 0, heldInKeys: 0, avgYield: 0 } };

const lookup = (lists: KeysTrader[][]) => {
  const m = new Map<string, KeysTrader>();
  for (const l of lists) for (const t of l) if (!m.has(t.handle.toLowerCase())) m.set(t.handle.toLowerCase(), t);
  return (h: string) => m.get(h.toLowerCase());
};

function usePreview(): KeysData {
  const demo = useKeysDemo();
  return useMemo(
    () => ({
      mode: "preview" as const,
      ready: true,
      error: null,
      traders: DEMO_TRADERS,
      feed: DEMO_FEED,
      platform: DEMO_PLATFORM,
      signedIn: true,
      me: { viewer: DEMO_VIEWER, keys: demo.keys, claimable: demo.claimable, claimFrom: [], payouts: DEMO_PAYOUTS, studio: DEMO_STUDIO, settings: demo.studio, traders: [] },
      byHandle: lookup([DEMO_TRADERS]),
    }),
    [demo],
  );
}

function useLive(): KeysData {
  const { signedIn } = useAuth();
  const index = useQuery({ queryKey: ["keys", "index"], queryFn: () => api<KeysIndex>("/api/keys"), staleTime: 15_000, refetchInterval: 30_000 });
  const me = useQuery({ queryKey: ["keys", "me"], queryFn: () => api<KeysMe | null>("/api/keys/me"), enabled: signedIn, staleTime: 10_000, refetchInterval: 30_000 });
  return useMemo(() => {
    const ix = index.data ?? EMPTY_INDEX;
    const m = (signedIn && me.data) || EMPTY_ME;
    return {
      mode: "live" as const,
      ready: !!index.data,
      error: index.error ? (index.error as Error).message : null,
      ...ix,
      me: m,
      signedIn,
      byHandle: lookup([ix.traders, m.traders]),
    };
  }, [index.data, index.error, me.data, signedIn]);
}

/** everything the keys screens show */
export const useKeys: () => KeysData = KEYS_LIVE ? useLive : usePreview;

/** one trader's page. live, it carries their posts (gated by the server for this viewer) */
export function useKeysTrader(handle: string): { t: KeysTrader | undefined; loading: boolean; missing: boolean } {
  const { signedIn } = useAuth();
  const q = useQuery({
    queryKey: ["keys", "trader", handle.toLowerCase(), signedIn],
    queryFn: () => api<KeysTrader>(`/api/keys/creators/${encodeURIComponent(handle)}`),
    enabled: KEYS_LIVE,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: (n, e) => n < 2 && !/no trader/i.test((e as Error).message),
  });
  if (!KEYS_LIVE) {
    const t = DEMO_TRADERS.find((x) => x.handle.toLowerCase() === handle.toLowerCase());
    return { t, loading: false, missing: !t };
  }
  return { t: q.data, loading: q.isLoading, missing: !!q.error };
}

/* ---------- actions ---------- */

// the signing code (@solana/web3.js) loads on the first trade, not with the page
const solanaTrades = () => import("@/lib/keys-solana-client");

/** a wallet or api error, in one line a person can act on */
export function why(e: unknown): string {
  const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error)?.message ?? String(e);
  if (/user rejected|user denied|rejected the request|request rejected|user declined/i.test(m)) return "Cancelled in your wallet.";
  return m.split("\n")[0].slice(0, 220);
}

export type PayWith = "USDC" | "SOL";
export type KeysActions = {
  markRead: (handle: string) => void;
  /** buy keys; the first one unlocks the trader's feed */
  buy: (t: KeysTrader, qty: number, payWith?: PayWith) => Promise<void>;
  sell: (t: KeysTrader, qty: number) => Promise<void>;
  claim: () => Promise<void>;
  saveStudio: (s: Omit<KeysStudioSettings, "saved">) => Promise<void>;
  /** list the viewer's own key at the starting price saved in the studio */
  listKey: () => Promise<void>;
  post: (p: { kind: PostKind; text: string; coin?: string; positionId?: string; holdersOnly: boolean }) => Promise<boolean>;
  reset: () => void;
};

const previewActions: KeysActions = {
  markRead: (h) => keysDemo.markRead(h),
  buy: async (t, qty) => keysDemo.buy(t.handle, qty, t.key.price),
  sell: async (t, qty) => keysDemo.sell(t.handle, qty),
  claim: async () => keysDemo.claim(),
  saveStudio: async (s) => keysDemo.saveStudio(s),
  listKey: async () => keysDemo.notify("In the live version this lists your key on Solana at your starting price."),
  post: async () => (keysDemo.notify("In the live version this posts to your key holders."), true),
  reset: () => keysDemo.reset(),
};

function useLiveActions(): KeysActions {
  const qc = useQueryClient();
  const auth = useAuth();
  const connect = useConnectModal();

  const refresh = useCallback(
    (later = false) => {
      qc.invalidateQueries({ queryKey: ["keys"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      // the worker indexes the program's finalized transactions every 15s: look again once it has
      if (later) for (const ms of [8_000, 20_000, 35_000]) setTimeout(() => qc.invalidateQueries({ queryKey: ["keys"] }), ms);
    },
    [qc],
  );

  /** signed in with the connected wallet, or prompted to be; false means stop here */
  const ready = useCallback(async () => {
    if (!auth.isConnected) {
      connect.open();
      return false;
    }
    if (!auth.signedIn) {
      keysToast("Sign the message in your wallet to sign in.", "busy");
      await auth.signIn();
      keysToast("Signed in. Press again to continue.");
      return false;
    }
    return true;
  }, [auth, connect]);

  /**
   * the connected Solana wallet, linked to this account: keys, the feeds they unlock and their fee share are
   * tracked by the wallet that holds them, so the first trade asks for one signature proving the wallet is yours
   */
  const linkedSolana = useCallback(async () => {
    keysToast("Connecting your Solana wallet…", "busy");
    const { account } = await connectSolana();
    const me = qc.getQueryData<KeysMe | null>(["keys", "me"]);
    if (me?.viewer?.solana === account.address) return account.address;
    const { message } = await api<{ message: string }>(`/api/keys/wallet?address=${encodeURIComponent(account.address)}`);
    keysToast("Sign the message in your Solana wallet to link it to your account. It costs nothing.", "busy");
    const signature = await signSolanaMessage(message);
    await api("/api/keys/wallet", { method: "POST", json: { address: account.address, signature } });
    await qc.invalidateQueries({ queryKey: ["keys", "me"] });
    return account.address;
  }, [qc]);

  const run = useCallback(
    <A extends unknown[]>(fn: (...a: A) => Promise<void>) =>
      async (...a: A) => {
        try {
          await fn(...a);
        } catch (e) {
          const { friendly } = await solanaTrades().catch(() => ({ friendly: why }));
          keysToast(friendly(e), "error");
        }
      },
    [],
  );
  const step = (s: string) => keysToast(s, "busy");
  const keyOf = (t: KeysTrader) => {
    if (!t.solana || !t.key.listed) throw new Error(`${t.handle} has not listed a key.`);
    return t.solana;
  };

  return useMemo<KeysActions>(
    () => ({
      markRead: (handle: string) => {
        void api("/api/keys/read", { method: "POST", json: { handle } })
          .then(() => qc.invalidateQueries({ queryKey: ["keys", "me"] }))
          .catch(() => {});
      },

      buy: run(async (t: KeysTrader, qty: number, payWith: PayWith = "USDC") => {
        if (!(await ready())) return;
        const trader = keyOf(t);
        await linkedSolana();
        const holdsAlready = (qc.getQueryData<KeysMe | null>(["keys", "me"])?.keys[t.handle]?.qty ?? 0) > 0;
        const { buyKeys } = await solanaTrades();
        await buyKeys(trader, qty, payWith, step);
        keysToast(holdsAlready ? `Bought ${qty} more ${t.handle} ${qty === 1 ? "key" : "keys"}.` : `You hold ${t.handle}'s key. Their feed is unlocked.`);
        refresh(true);
      }),

      sell: run(async (t: KeysTrader, qty: number) => {
        if (!(await ready())) return;
        const trader = keyOf(t);
        await linkedSolana();
        const held = qc.getQueryData<KeysMe | null>(["keys", "me"])?.keys[t.handle]?.qty ?? 0;
        const { sellKeys } = await solanaTrades();
        const net = await sellKeys(trader, qty, step);
        keysToast(`Sold ${qty} ${t.handle} ${qty === 1 ? "key" : "keys"} for about $${(Number(net) / 1e6).toFixed(2)} USDC.${held > 0 && qty >= held ? " Their feed is locked again." : ""}`);
        refresh(true);
      }),

      claim: run(async () => {
        if (!(await ready())) return;
        const me = qc.getQueryData<KeysMe | null>(["keys", "me"]);
        if (!me?.claimFrom.length) throw new Error("Nothing to claim yet.");
        await linkedSolana();
        const { claimAll } = await solanaTrades();
        await claimAll(me.claimFrom, step);
        keysToast(`Claimed $${me.claimable.toFixed(2)} USDC to your Solana wallet.`);
        refresh(true);
      }),

      saveStudio: run(async (s: Omit<KeysStudioSettings, "saved">) => {
        if (!(await ready())) return;
        await api("/api/keys/studio", { method: "POST", json: { startPrice: s.startPrice, offers: s.offers, cadence: s.cadence, pinned: s.pinned || undefined } });
        keysToast(`Saved. Your key starts at $${s.startPrice}.`);
        refresh();
      }),

      listKey: run(async () => {
        if (!(await ready())) return;
        const me = qc.getQueryData<KeysMe | null>(["keys", "me"]);
        if (!me?.settings.saved) throw new Error("Save your page first.");
        await linkedSolana();
        const { listKey } = await solanaTrades();
        await listKey(me.settings.startPrice, step);
        const r = await api<{ listed: boolean }>("/api/keys/studio/listed", { method: "POST" });
        keysToast(r.listed ? `Your key is live at $${me.settings.startPrice}. Anyone who buys one unlocks your feed.` : "Listed onchain. It will show on your page in a moment.");
        refresh(true);
      }),

      post: async (p) => {
        try {
          const r = await api<{ notified: number }>("/api/keys/posts", { method: "POST", json: p });
          keysToast(r.notified ? `Posted. ${r.notified} ${r.notified === 1 ? "holder" : "holders"} alerted.` : "Posted.");
          refresh();
          return true;
        } catch (e) {
          keysToast(why(e), "error");
          return false;
        }
      },

      reset: () => {},
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, ready, linkedSolana, refresh, qc],
  );
}

/** what the buttons do: the preview's local store, or the Solana wallet and program in live mode */
export const useKeysActions: () => KeysActions = KEYS_LIVE ? useLiveActions : () => previewActions;

/** run an action with a busy flag for its button */
export function useBusy(): [boolean, (fn: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const go = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, go];
}


