/**
 * the shapes the keys screens render. the preview fills them from sample data (keys-demo.ts), live mode from the
 * /api/keys routes (keys-server.ts), so the screens never know which one they are looking at.
 */
import type { Cadence, OfferKey, PostKind } from "./keys";

export type KeysPosition = {
  /** the indexed position, so a copy can credit this trader (and their key holders) with the fees it pays */
  id?: string;
  side: "LONG" | "SHORT";
  coin: string;
  leverage: number;
  /** notional, USD */
  size: number;
  entry: number;
  mark: number;
  liq: number | null;
  pnl: number;
  opened: string;
  /** people who copied this position */
  copiers: number;
};

export type KeysCall = {
  id?: string;
  kind: PostKind;
  when: string;
  /** empty when locked: the server never sends a subscriber post to someone who has not paid */
  text: string;
  locked?: boolean;
  coin?: string | null;
  position?: { label: string; pnl: number; open: boolean };
};

export type KeysTrader = {
  handle: string;
  /** lowercase hyperliquid address; the sample traders have none */
  address?: string;
  initials: string;
  /** avatar gradient, also the base of the banner */
  colors: [string, string];
  avatarUrl?: string | null;
  style: string;
  bio: string;
  wallet: string;
  since: string;
  followers: number;
  pnl30d: number;
  pnlAllTime: number;
  winRate: number | null;
  maxDrawdown: number | null;
  live: KeysPosition | null;
  key: {
    /** the trader called list() on the keys contract, so their key can be bought */
    listed: boolean;
    price: number;
    change24h: number;
    holders: number;
    minted: number;
    yieldPct: number;
    history: number[];
  };
  sub: { price: number; subscribers: number; renewRate: number | null; cadence: Cadence; leadTime: string | null; offers: OfferKey[]; pinned: string };
  calls: KeysCall[];
};

export type KeysFeedPost = { id?: string; handle: string; when: string; text: string; locked: boolean; kind?: PostKind; likes?: string; replies?: string; copied: number };

export type KeysPlatform = { live: number; traders: number; paidToCreators: number; routed: number; paidToHolders30d: number; heldInKeys: number; avgYield: number };

export type KeysHolding = { qty: number; avgCost: number; earned: number };
export type KeysSub = { since: string; renews: string; unread: number; cancelled?: boolean; paidUntil?: string };
export type KeysPayout = { from: string; when: string; amount: number };

export type KeysViewer = { handle: string; initials: string; colors: [string, string]; avatarUrl?: string | null; address?: string; followers: number; pnl30dPct: number | null; pnl30d?: number };

export type KeysStudioSettings = { price: number; offers: OfferKey[]; cadence: Cadence; pinned?: string; saved: boolean };
export type KeysStudio = {
  key: { price: number; holders: number; raised: number };
  earnedThisMonth: number;
  months: { month: string; sub: number; key: number; fee: number }[];
  /** live mode: the viewer has a creator profile, and has listed their key onchain */
  isCreator?: boolean;
  listed?: boolean;
  subscribers?: number;
  /** the creator's open and recent positions, to attach to a post */
  positions?: { id: string; label: string; open: boolean }[];
};

/** everything about the signed-in viewer */
export type KeysMe = {
  viewer: KeysViewer | null;
  keys: Record<string, KeysHolding>;
  subs: Record<string, KeysSub>;
  claimable: number;
  /** trader addresses with something to claim, for claimMany */
  claimFrom: string[];
  payouts: KeysPayout[];
  studio: KeysStudio;
  settings: KeysStudioSettings;
  /** traders the viewer holds or subscribes to that are not in the public list */
  traders: KeysTrader[];
};

export type KeysIndex = { traders: KeysTrader[]; feed: KeysFeedPost[]; platform: KeysPlatform };
