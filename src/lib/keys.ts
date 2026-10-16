/**
 * keys: the economics and the switches, in one place, so every screen, route and job agrees.
 *
 * a key is a share in a trader and the pass to their private feed: hold one and their calls, alerts and lessons
 * unlock. keys live on the socialLiquid keys program on Solana (programs/keys), priced in USDC and payable in USDC
 * or SOL (swapped to USDC in the same transaction). each trader picks their key's starting price when they list;
 * from there every key costs KEY_SLOPE more than the last. on each buy KEY_TRADER_CUT of the curve price goes to the
 * trader and the rest stays in reserve, so any holder can always sell back; buys and sells pay KEY_PROTOCOL_FEE.
 * holders also earn HOLDER_SHARE of the builder fees their trader's copiers generate, deposited into the program
 * and claimable there. the curve below mirrors the program exactly.
 */

// ---------------------------------------------------------------- switches

/** live mode: real traders and keys. off, the section is the preview on sample data */
export const KEYS_LIVE = process.env.NEXT_PUBLIC_KEYS_LIVE === "true";
/** the keys program on Solana; without it traders can set up their page and keys show as opening soon */
export const KEYS_PROGRAM = process.env.NEXT_PUBLIC_KEYS_PROGRAM_ID || null;
/** the USDC mint the program trades in (mainnet USDC unless set, e.g. for devnet) */
export const KEYS_USDC_MINT = process.env.NEXT_PUBLIC_KEYS_USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** the browser's Solana node. the public one rate-limits hard: use a dedicated rpc in production */
export const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
/** which cluster wallets sign for: mainnet, devnet or localnet */
export const SOLANA_CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet") as "mainnet" | "devnet" | "localnet";
/** an address lookup table holding the program's fixed accounts, so a SOL swap and a buy fit in one transaction */
export const KEYS_LOOKUP_TABLE = process.env.NEXT_PUBLIC_KEYS_LOOKUP_TABLE || null;
/** Jupiter's swap api, for paying with SOL */
export const JUPITER_API = process.env.NEXT_PUBLIC_JUPITER_API || "https://lite-api.jup.ag/swap/v1";

// ---------------------------------------------------------------- what a key unlocks

export type OfferKey = "calls" | "alerts" | "lessons" | "live" | "qa" | "reviews";

/** what a trader can choose to give their key holders */
export const OFFERS: { key: OfferKey; title: string; detail: string }[] = [
  { key: "calls", title: "Pre-trade calls", detail: "The setup, posted before the entry" },
  { key: "alerts", title: "Entry and exit alerts", detail: "Sent the moment a position fills" },
  { key: "lessons", title: "Lessons", detail: "Sizing, invalidation, and every loss broken down" },
  { key: "live", title: "Weekly live session", detail: "The week ahead, questions answered live" },
  { key: "qa", title: "Direct questions", detail: "Holders can message the trader" },
  { key: "reviews", title: "Trade reviews", detail: "The trader reviews holders' positions" },
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

// ---------------------------------------------------------------- keys (mirrors programs/keys/src/lib.rs)

export const KEY_SUPPLY_CAP = 2000;
/** a trader's starting price: their choice, between these, in whole cents. fixed once the key is listed */
export const KEY_START_MIN = 1;
export const KEY_START_MAX = 1000;
/** what the studio suggests to a trader who has not picked */
export const KEY_START_DEFAULT = 5;
/** added per key already in supply, USDC, the same for every trader */
export const KEY_SLOPE = 0.25;
/** share of the curve price paid to the trader on every buy; fixed in the program forever */
export const KEY_TRADER_CUT = 0.1;
/** on buys and sells; the program admin can move it, up to 5% */
export const KEY_PROTOCOL_FEE = 0.02;

/** price of the next key at a given supply, for a key that started at `start` */
export const keyPrice = (supply: number, start: number) => start + KEY_SLOPE * supply;

/** curve price of `n` keys starting at `supply`: the sum of each key's price */
export const keyCurve = (supply: number, n: number, start: number) => n * start + KEY_SLOPE * (n * supply + (n * (n - 1)) / 2);

export function keyBuy(supply: number, n: number, start: number) {
  const curve = keyCurve(supply, n, start);
  const fee = curve * KEY_PROTOCOL_FEE;
  return { curve, traderCut: curve * KEY_TRADER_CUT, fee, total: curve + fee };
}

/** selling refunds what those keys put into the reserve, less the fee */
export function keySell(supply: number, n: number, start: number) {
  const refund = keyCurve(Math.max(0, supply - n), n, start) * (1 - KEY_TRADER_CUT);
  const fee = refund * KEY_PROTOCOL_FEE;
  return { refund, fee, net: refund - fee };
}

/** what a trader makes from the first `n` keys sold at a starting price: their cut of the curve */
export const traderTakeFromKeys = (n: number, start: number) => keyCurve(0, n, start) * KEY_TRADER_CUT;

/** USDC a year from holding `qty` keys at the trader's current fee flow */
export const keyYearly = (price: number, qty: number, yieldPct: number) => (price * qty * yieldPct) / 100;

// ---------------------------------------------------------------- fee share (builder fees from a trader's copiers)

/** to that trader's key holders, deposited into the program */
export const HOLDER_SHARE = 0.4;
/** to the trader */
export const CREATOR_FEE_SHARE = 0.3;
/** the protocol keeps the rest (0.3) */
