/**
 * keys and subscriptions: the economics in one place, so every screen (and later the server) agrees.
 *
 * a subscription is one tier per trader, priced by the trader: free up to SUB_PRICE_MAX a month in USDC.
 * a key is a share of a trader: the trader is paid the mint price, resales pay the trader and the protocol
 * a small fee each, and holders split HOLDER_SHARE of the builder fees the trader's followers generate.
 * a key buys no access; access is what the subscription is for.
 */

export const KEY_SUPPLY_CAP = 2000;
export const KEY_TRADER_FEE = 0.02;
export const KEY_PROTOCOL_FEE = 0.02;
export const KEY_FEE = KEY_TRADER_FEE + KEY_PROTOCOL_FEE;
/** share of the builder fees a trader's followers generate that goes to that trader's key holders */
export const HOLDER_SHARE = 0.4;
/** share of each subscription the trader keeps */
export const CREATOR_SHARE = 0.9;
export const SUB_PRICE_MAX = 500;

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

export const offerTitle = (k: OfferKey) => OFFERS.find((o) => o.key === k)?.title ?? k;

export type Cadence = "weekly" | "regular" | "daily" | "whenever";
export const CADENCES: { key: Cadence; label: string }[] = [
  { key: "weekly", label: "1–2 calls a week" },
  { key: "regular", label: "3–5 calls a week" },
  { key: "daily", label: "Daily" },
  { key: "whenever", label: "Whenever I trade" },
];
export const cadenceLabel = (c: Cadence) => CADENCES.find((x) => x.key === c)?.label ?? c;

export function keyBuy(price: number, qty: number) {
  const subtotal = price * qty;
  return { subtotal, fee: subtotal * KEY_FEE, total: subtotal * (1 + KEY_FEE) };
}

export function keySell(price: number, qty: number) {
  const subtotal = price * qty;
  return { subtotal, fee: subtotal * KEY_FEE, total: subtotal * (1 - KEY_FEE) };
}

/** USDC a year from holding `qty` keys at the trader's current fee flow */
export const keyYearly = (price: number, qty: number, yieldPct: number) => (price * qty * yieldPct) / 100;

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

export const subMonthly = (price: number, subscribers: number) => price * subscribers * CREATOR_SHARE;
