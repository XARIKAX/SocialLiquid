/**
 * keys and subscriptions: the economics and the switches, in one place, so every screen, route and job agrees.
 *
 * subscriptions: one per trader, priced by the trader from free to SUB_PRICE_MAX a month in USDC. the subscriber
 * pays with Hyperliquid transfers straight to the trader (CREATOR_SHARE) and the platform (the rest); the server
 * checks both on Hyperliquid before granting a month. nothing is custodied and nothing auto-debits.
 *
 * keys: a share in a trader, on the SocialLiquidKeys contract on HyperEVM. the key curve below mirrors it exactly.
 * on each buy KEY_TRADER_CUT of the curve price goes to the trader and the rest stays in reserve, so any holder can
 * always sell back; buys and sells pay KEY_PROTOCOL_FEE. holders also earn HOLDER_SHARE of the builder fees their
 * trader's copiers generate, deposited into the contract and claimable there. a key buys no access.
 */

// ---------------------------------------------------------------- switches

/** live mode: real creators, payments and keys. off, the section is the preview on sample data */
export const KEYS_LIVE = process.env.NEXT_PUBLIC_KEYS_LIVE === "true";
/** SocialLiquidKeys on HyperEVM; without it subscriptions still work and keys show as not launched */
export const KEYS_CONTRACT = (process.env.NEXT_PUBLIC_KEYS_CONTRACT || null) as `0x${string}` | null;
/** USDC on HyperEVM, the token the contract trades in */
export const KEYS_USDC = (process.env.NEXT_PUBLIC_KEYS_USDC || null) as `0x${string}` | null;
/** where the platform's share of subscriptions goes on Hyperliquid. unset: creators keep the whole price */
export const SUBS_TREASURY = (process.env.NEXT_PUBLIC_SUBS_TREASURY || null)?.toLowerCase() ?? null;

// ---------------------------------------------------------------- subscriptions

export const SUB_PRICE_MAX = 500;
/** share of each subscription the trader keeps when a treasury is configured */
export const CREATOR_SHARE = 0.9;
export const SUB_PERIOD_DAYS = 30;
/** how long a payment quote stays valid; the transfers must land inside it */
export const SUB_INTENT_TTL_MIN = 20;

/** split a monthly price into what goes to the creator and what goes to the platform, to the cent */
export function subSplit(priceUsd: number, treasury: string | null = SUBS_TREASURY) {
  const cents = Math.round(priceUsd * 100);
  const platform = treasury && cents > 0 ? Math.round(cents * (1 - CREATOR_SHARE)) : 0;
  return { creator: (cents - platform) / 100, platform: platform / 100 };
}

/** what a trader keeps of each subscription, in percent: everything when no treasury takes a share */
export const CREATOR_KEEP_PCT = Math.round(subSplit(100).creator);

export type OfferKey = "calls" | "alerts" | "lessons" | "live" | "qa" | "reviews";

/** what a trader can choose to include in their subscription */
export const OFFERS: { key: OfferKey; title: string; detail: string }[] = [
  { key: "calls", title: "Pre-trade calls", detail: "The setup, posted before the entry" },
  { key: "alerts", title: "Entry and exit alerts", detail: "Sent the moment a position fills" },
  { key: "lessons", title: "Lessons", detail: "Sizing, invalidation, and every loss broken down" },
  { key: "live", title: "Weekly live session", detail: "The week ahead, questions answered live" },
  { key: "qa", title: "Direct questions", detail: "Subscribers can message the trader" },
  { key: "reviews", title: "Trade reviews", detail: "The trader reviews subscribers' positions" },
];
export const OFFER_KEYS = OFFERS.map((o) => o.key) as [OfferKey, ...OfferKey[]];
export const offerTitle = (k: OfferKey) => OFFERS.find((o) => o.key === k)?.title ?? k;

export type Cadence = "weekly" | "regular" | "daily" | "whenever";
export const CADENCES: { key: Cadence; label: string }[] = [
  { key: "weekly", label: "1–2 calls a week" },
  { key: "regular", label: "3–5 calls a week" },
  { key: "daily", label: "Daily" },
  { key: "whenever", label: "Whenever I trade" },
];
export const CADENCE_KEYS = CADENCES.map((c) => c.key) as [Cadence, ...Cadence[]];
export const cadenceLabel = (c: Cadence) => CADENCES.find((x) => x.key === c)?.label ?? c;

export type PostKind = "call" | "exit" | "lesson" | "loss" | "note";
export const POST_KINDS = ["call", "exit", "lesson", "loss", "note"] as const;

/**
 * a rough demand curve for the studio's projection: subscribers fall as the price rises (elasticity 0.9),
 * anchored at `baseAt29` subscribers for a $29 feed, lifted 8% for each offer beyond the first two, and
 * never more than the trader's followers. free reaches every follower. a guide for pricing, not a forecast.
 */
export function projectSubscribers(price: number, followers: number, offerCount: number, baseAt29: number): number {
  if (price <= 0) return followers;
  const lift = 1 + 0.08 * Math.max(0, offerCount - 2);
  return Math.min(followers, Math.round(baseAt29 * Math.pow(29 / price, 0.9) * lift));
}

export const subMonthly = (price: number, subscribers: number) => (price * subscribers * CREATOR_KEEP_PCT) / 100;

// ---------------------------------------------------------------- keys (mirrors contracts/src/SocialLiquidKeys.sol)

export const KEY_SUPPLY_CAP = 2000;
/** first key, USDC */
export const KEY_BASE_PRICE = 5;
/** added per key already in supply, USDC */
export const KEY_SLOPE = 0.25;
/** share of the curve price paid to the trader on every buy; fixed in the contract forever */
export const KEY_TRADER_CUT = 0.1;
/** on buys and sells; the contract owner can move it, up to 5% */
export const KEY_PROTOCOL_FEE = 0.02;

/** price of the next key at a given supply */
export const keyPrice = (supply: number) => KEY_BASE_PRICE + KEY_SLOPE * supply;

/** curve price of `n` keys starting at `supply`: the sum of each key's price */
export const keyCurve = (supply: number, n: number) => n * KEY_BASE_PRICE + KEY_SLOPE * (n * supply + (n * (n - 1)) / 2);

export function keyBuy(supply: number, n: number) {
  const curve = keyCurve(supply, n);
  const fee = curve * KEY_PROTOCOL_FEE;
  return { curve, traderCut: curve * KEY_TRADER_CUT, fee, total: curve + fee };
}

/** selling refunds what those keys put into the reserve, less the fee */
export function keySell(supply: number, n: number) {
  const refund = keyCurve(Math.max(0, supply - n), n) * (1 - KEY_TRADER_CUT);
  const fee = refund * KEY_PROTOCOL_FEE;
  return { refund, fee, net: refund - fee };
}

/** USDC a year from holding `qty` keys at the trader's current fee flow */
export const keyYearly = (price: number, qty: number, yieldPct: number) => (price * qty * yieldPct) / 100;

// ---------------------------------------------------------------- fee share (builder fees from a trader's copiers)

/** to that trader's key holders, deposited into the contract */
export const HOLDER_SHARE = 0.4;
/** to the trader */
export const CREATOR_FEE_SHARE = 0.3;
/** the protocol keeps the rest (0.3) */
