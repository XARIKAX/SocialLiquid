"use client";
/**
 * the keys section's data and actions. with NEXT_PUBLIC_KEYS_LIVE off the screens run on the sample traders and a
 * browser-only store; on, they read /api/keys and the actions move real money: subscriptions are USDC transfers
 * on Hyperliquid signed by the viewer's wallet, keys are trades on the keys program on Solana, signed by a Solana
 * wallet the viewer links to their account once.
 * the screens call the same hooks either way.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { useConnectModal } from "@/components/connect-modal";
import { api } from "@/lib/client";
import { KEYS_LIVE, type PostKind } from "@/lib/keys";
import { DEMO_FEED, DEMO_PAYOUTS, DEMO_PLATFORM, DEMO_STUDIO, DEMO_TRADERS, DEMO_VIEWER } from "@/lib/keys-demo";
import type { KeysIndex, KeysMe, KeysStudioSettings, KeysTrader } from "@/lib/keys-model";
import { connectSolana, signSolanaMessage } from "@/lib/solana-wallet";
import { useAuth } from "./use-auth";
import { keysDemo, useKeysDemo } from "./use-keys-demo";
import { keysToast } from "./use-keys-toast";
import { useSigner } from "./use-signer";

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
  subs: {},
  claimable: 0,
  claimFrom: [],
  payouts: [],
  studio: { key: { price: 5, holders: 0, raised: 0 }, earnedThisMonth: 0, months: [], isCreator: false, listed: false, subscribers: 0, positions: [] },
  settings: { price: 29, offers: ["calls", "alerts"], cadence: "regular", pinned: "", saved: false },
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
      me: { viewer: DEMO_VIEWER, keys: demo.keys, subs: demo.subs, claimable: demo.claimable, claimFrom: [], payouts: DEMO_PAYOUTS, studio: DEMO_STUDIO, settings: demo.studio, traders: [] },
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// the signing code (hyperliquid sdk, @solana/web3.js) loads on the first payment or trade, not with the page
const hlSigning = () => import("@/lib/hl-client");
const solanaTrades = () => import("@/lib/keys-solana-client");

/** a wallet or api error, in one line a person can act on */
export function why(e: unknown): string {
  const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error)?.message ?? String(e);
  if (/user rejected|user denied|rejected the request|request rejected|user declined/i.test(m)) return "Cancelled in your wallet.";
  return m.split("\n")[0].slice(0, 220);
}

const PENDING = (handle: string) => `sl:keys-pay:${handle.toLowerCase()}`;
const pendingIntent = {
  get(handle: string): { id: string; exp: number } | null {
    try {
      const v = JSON.parse(localStorage.getItem(PENDING(handle)) ?? "null") as { id: string; exp: number } | null;
      return v && v.exp > Date.now() ? v : null;
    } catch {
      return null;
    }
  },
  set(handle: string, id: string, exp: number) {
    try {
      localStorage.setItem(PENDING(handle), JSON.stringify({ id, exp }));
    } catch {
      /* no storage: a second press would ask for a new transfer, the server still never grants twice */
    }
  },
  clear(handle: string) {
    try {
      localStorage.removeItem(PENDING(handle));
    } catch {
      /* ignore */
    }
  },
};

type Quote = { subscribed: true; paidUntil: string } | { subscribed: false; intentId: string; method: "usdSend" | "spotSend"; token: string | null; transfers: { to: string; amount: string; label: "creator" | "platform" }[]; total: number; expiresAt: string };
const until = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export type PayWith = "USDC" | "SOL";
export type KeysActions = {
  subscribe: (t: KeysTrader) => Promise<void>;
  unsubscribe: (t: KeysTrader) => Promise<void>;
  markRead: (handle: string) => void;
  buy: (t: KeysTrader, qty: number, payWith?: PayWith) => Promise<void>;
  sell: (t: KeysTrader, qty: number) => Promise<void>;
  claim: () => Promise<void>;
  saveStudio: (s: Omit<KeysStudioSettings, "saved">) => Promise<void>;
  listKey: () => Promise<void>;
  post: (p: { kind: PostKind; text: string; coin?: string; positionId?: string; subscribersOnly: boolean }) => Promise<boolean>;
  reset: () => void;
};

const previewActions: KeysActions = {
  subscribe: async (t) => keysDemo.subscribe(t.handle, t.sub.price),
  unsubscribe: async (t) => keysDemo.unsubscribe(t.handle),
  markRead: (h) => keysDemo.markRead(h),
  buy: async (t, qty) => keysDemo.buy(t.handle, qty, t.key.price),
  sell: async (t, qty) => keysDemo.sell(t.handle, qty),
  claim: async () => keysDemo.claim(),
  saveStudio: async (s) => keysDemo.saveStudio(s),
  listKey: async () => keysDemo.notify("In the live version this lists your key on Solana."),
  post: async () => (keysDemo.notify("In the live version this posts to your subscribers."), true),
  reset: () => keysDemo.reset(),
};

function useLiveActions(): KeysActions {
  const qc = useQueryClient();
  const auth = useAuth();
  const connect = useConnectModal();
  const { wallet } = useSigner();
  const chainId = useChainId();
  const mock = auth.me?.network === "mock";

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
   * the connected Solana wallet, linked to this account: keys and their fee share are tracked by the wallet that
   * holds them, so the first trade asks for one signature proving the wallet is yours
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

  const confirmPay = useCallback(
    async (t: KeysTrader, intentId: string) => {
      keysToast("Checking the payment on Hyperliquid…", "busy");
      for (let i = 0; i < 15; i++) {
        const r = await api<{ confirmed: boolean; paidUntil?: string }>("/api/keys/subscribe/confirm", { method: "POST", json: { intentId, mockPaid: mock || undefined } });
        if (r.confirmed) {
          pendingIntent.clear(t.handle);
          keysToast(`Subscribed to ${t.handle} until ${until(r.paidUntil!)}.`);
          refresh();
          return true;
        }
        await sleep(2000);
      }
      return false;
    },
    [mock, refresh],
  );

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
      subscribe: run(async (t: KeysTrader) => {
        if (!(await ready())) return;
        // a payment sent earlier that had not shown up yet: finish that one instead of asking for a second
        const earlier = pendingIntent.get(t.handle);
        if (earlier && (await confirmPay(t, earlier.id))) return;
        const q = await api<Quote>("/api/keys/subscribe", { method: "POST", json: { handle: t.handle } });
        if (q.subscribed) {
          keysToast(`Following ${t.handle}'s free feed.`);
          refresh();
          return;
        }
        pendingIntent.set(t.handle, q.intentId, new Date(q.expiresAt).getTime());
        if (!mock) {
          if (!wallet) throw new Error("Connect your wallet first.");
          const { spotSendWithWallet, usdSendWithWallet } = await hlSigning();
          for (const [i, x] of q.transfers.entries()) {
            keysToast(`Confirm in your wallet${q.transfers.length > 1 ? ` (${i + 1} of ${q.transfers.length})` : ""}: $${x.amount} USDC to ${x.label === "creator" ? t.handle : "socialLiquid"}`, "busy");
            if (q.method === "spotSend") await spotSendWithWallet(wallet, chainId, x.to, q.token!, x.amount);
            else await usdSendWithWallet(wallet, chainId, x.to, x.amount);
          }
        }
        if (!(await confirmPay(t, q.intentId))) keysToast("Sent. Hyperliquid has not shown the transfer yet: press Subscribe again in a minute to finish. You will not be charged twice.", "error");
      }),

      unsubscribe: run(async (t: KeysTrader) => {
        const r = await api<{ removed: boolean; paidUntil?: string }>("/api/keys/subscribe/cancel", { method: "POST", json: { handle: t.handle } });
        keysToast(r.removed ? `Unfollowed ${t.handle}.` : `Cancelled. You keep ${t.handle}'s feed until ${until(r.paidUntil!)} and will not be asked to renew.`);
        refresh();
      }),

      markRead: (handle: string) => {
        void api("/api/keys/read", { method: "POST", json: { handle } })
          .then(() => qc.invalidateQueries({ queryKey: ["keys", "me"] }))
          .catch(() => {});
      },

      buy: run(async (t: KeysTrader, qty: number, payWith: PayWith = "USDC") => {
        if (!(await ready())) return;
        const trader = keyOf(t);
        await linkedSolana();
        const { buyKeys } = await solanaTrades();
        await buyKeys(trader, qty, payWith, step);
        keysToast(`Bought ${qty} ${t.handle} ${qty === 1 ? "key" : "keys"}.`);
        refresh(true);
      }),

      sell: run(async (t: KeysTrader, qty: number) => {
        if (!(await ready())) return;
        const trader = keyOf(t);
        await linkedSolana();
        const { sellKeys } = await solanaTrades();
        const net = await sellKeys(trader, qty, step);
        keysToast(`Sold ${qty} ${t.handle} ${qty === 1 ? "key" : "keys"} for about $${(Number(net) / 1e6).toFixed(2)} USDC, in your Solana wallet.`);
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
        await api("/api/keys/studio", { method: "POST", json: { price: s.price, offers: s.offers, cadence: s.cadence, pinned: s.pinned || undefined } });
        keysToast(s.price > 0 ? `Saved. Your page now charges $${s.price} a month.` : "Saved. Your feed is free.");
        refresh();
      }),

      listKey: run(async () => {
        if (!(await ready())) return;
        await linkedSolana();
        const { listKey } = await solanaTrades();
        await listKey(step);
        const r = await api<{ listed: boolean }>("/api/keys/studio/listed", { method: "POST" });
        keysToast(r.listed ? "Your key is live. Anyone can buy it from your page." : "Listed onchain. It will show on your page in a moment.");
        refresh(true);
      }),

      post: async (p) => {
        try {
          const r = await api<{ notified: number }>("/api/keys/posts", { method: "POST", json: p });
          keysToast(r.notified ? `Posted. ${r.notified} ${r.notified === 1 ? "subscriber" : "subscribers"} alerted.` : "Posted.");
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
    [run, ready, linkedSolana, confirmPay, refresh, mock, wallet, chainId, qc],
  );
}

/** what the buttons do: the preview's local store, or wallets and the Solana program in live mode */
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


