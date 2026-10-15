/**
 * sample traders for the keys preview. these are composites of trader archetypes, not real accounts: the
 * section says so on every page, and nothing here can be bought or charged. the live version reads traders,
 * records and positions from the indexer like the rest of the app.
 */
import { keyPrice } from "./keys";
import type { KeysCall, KeysFeedPost, KeysPayout, KeysPlatform, KeysPosition, KeysStudio, KeysTrader, KeysViewer } from "./keys-model";

export type DemoPosition = KeysPosition;
export type DemoCall = KeysCall;
export type DemoTrader = KeysTrader;

/** a deterministic wandering line from `a` to `b`: the 30-day key history */
function walk(a: number, b: number, n: number, seed: number, vol = 0.035): number[] {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280) - 0.5;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = a + (b - a) * t;
    out.push(i === n - 1 ? b : Math.max(0.5, base * (1 + rnd() * vol * 2)));
  }
  return out;
}


/** a sample key on the real curve: the price is what the contract would charge at that supply */
function key(minted: number, start: number, change24h: number, holders: number, yieldPct: number, seed: number, vol?: number) {
  const price = keyPrice(minted);
  return { listed: true, price, change24h, holders: Math.min(holders, minted), minted, yieldPct, history: walk(start, price, 30, seed, vol) };
}

export const DEMO_TRADERS: DemoTrader[] = [
  {
    handle: "basedwhale",
    initials: "BW",
    colors: ["#0e8f75", "#163e6e"],
    style: "BTC and ETH perps · high conviction",
    bio: "BTC and ETH perps. High conviction, low frequency. Every call posted before the entry, every loss posted after.",
    wallet: "0x8a3f…41c2",
    since: "2023",
    followers: 48200,
    pnl30d: 12_400_000,
    pnlAllTime: 38_200_000,
    winRate: 68,
    maxDrawdown: -14,
    live: { side: "LONG", coin: "BTC", leverage: 25, size: 41_200_000, entry: 79_812, mark: 83_420, liq: 76_930, pnl: 1_860_000, opened: "6h ago", copiers: 1920 },
    key: key(1631, 210, 18.2, 1204, 16.4, 7),
    sub: { price: 99, subscribers: 3180, renewRate: 96, cadence: "regular", leadTime: "about 2h before entry", offers: ["calls", "alerts", "lessons", "live"], pinned: "How I size: never more than 3% of the account at risk on one idea. Leverage is how I express it, not how much I risk. Read this before you copy anything I post." },
    calls: [
      { kind: "call", when: "6 hours ago", text: "Adding to the BTC long. Funding negative, open interest flushed, spot bid stepping up at 79.2k. Invalidation 78.4k, first target 84k.", position: { label: "LONG BTC 25x", pnl: 1_860_000, open: true } },
      { kind: "exit", when: "Yesterday", text: "Closing the ETH long. ETH/BTC broke down on the daily and I would rather hold the stronger asset. Rotating the size into BTC.", position: { label: "LONG ETH 10x", pnl: 412_000, open: false } },
      { kind: "lesson", when: "2 days ago", text: "Why I take partial profit at 1R and leave the rest running with the stop at entry — walked through with the actual fills from last week's SOL trade." },
      { kind: "loss", when: "3 days ago", text: "Took the loss on the SOL short. I misread the spot flows; the thesis was wrong, not unlucky. Here is exactly where I went wrong.", position: { label: "SHORT SOL 12x", pnl: -684_000, open: false } },
    ],
  },
  {
    handle: "kairos",
    initials: "KA",
    colors: ["#3d5fcf", "#0e7f69"],
    style: "HYPE, funding and basis",
    bio: "HYPE and the Hyperliquid ecosystem. Funding, basis and unlock trades, sized small and held patiently.",
    wallet: "0x41be…9d07",
    since: "2023",
    followers: 22400,
    pnl30d: 3_100_000,
    pnlAllTime: 9_800_000,
    winRate: 61,
    maxDrawdown: -9,
    live: { side: "LONG", coin: "HYPE", leverage: 10, size: 2_400_000, entry: 38.12, mark: 39.64, liq: 34.6, pnl: 96_000, opened: "2h ago", copiers: 866 },
    key: key(726, 132, 6.1, 512, 19.8, 11),
    sub: { price: 49, subscribers: 2410, renewRate: 93, cadence: "regular", leadTime: "the night before", offers: ["calls", "alerts", "lessons"], pinned: "Most of my edge is patience. If funding is not paying me to wait, I am not in the trade." },
    calls: [
      { kind: "call", when: "2 hours ago", text: "Tomorrow's unlock is already priced into funding. Here is the basis trade I am putting on tonight, with the exact entries.", position: { label: "LONG HYPE 10x", pnl: 96_000, open: true } },
      { kind: "lesson", when: "3 days ago", text: "Reading funding properly: why a negative rate on a rising price is the most important number on the screen." },
      { kind: "exit", when: "5 days ago", text: "Out of the PURR basis trade. Funding normalised, the edge is gone, so the position is too.", position: { label: "SHORT PURR 3x", pnl: 48_200, open: false } },
    ],
  },
  {
    handle: "memewitch",
    initials: "MW",
    colors: ["#b0307f", "#5a33b8"],
    style: "Memecoin perps · early entries",
    bio: "Memecoin perps before they trend. Small size, tight stops, and I tell you when I am wrong.",
    wallet: "0xc0de…77aa",
    since: "2024",
    followers: 61800,
    pnl30d: 860_000,
    pnlAllTime: 2_400_000,
    winRate: 44,
    maxDrawdown: -22,
    live: { side: "LONG", coin: "kPEPE", leverage: 5, size: 310_000, entry: 0.01182, mark: 0.01345, liq: 0.00968, pnl: 42_800, opened: "1h ago", copiers: 4310 },
    key: key(357, 41, 31.6, 288, 9.2, 23, 0.07),
    sub: { price: 19, subscribers: 9840, renewRate: 81, cadence: "daily", leadTime: "minutes before entry", offers: ["calls", "alerts"], pinned: "I lose more trades than I win. The winners pay for it. Size so that being wrong five times in a row is boring." },
    calls: [
      { kind: "call", when: "1 hour ago", text: "kPEPE reclaiming the range high on rising open interest. Small size, tight stop. This is a 5x, not a 50x — size accordingly.", position: { label: "LONG kPEPE 5x", pnl: 42_800, open: true } },
      { kind: "loss", when: "Yesterday", text: "Stopped out of the WIF long. The breakout failed on the retest. Exactly the trade I said I would take, exactly the stop I said I would use.", position: { label: "LONG WIF 5x", pnl: -12_400, open: false } },
    ],
  },
  {
    handle: "nyx",
    initials: "NX",
    colors: ["#24304a", "#4c6fe0"],
    style: "Macro and stock perps · patient",
    bio: "Macro, rates and stock perps on Hyperliquid. Few trades, long reasoning, full sizing in every call.",
    wallet: "0x0b5e…c2f1",
    since: "2024",
    followers: 9600,
    pnl30d: 1_900_000,
    pnlAllTime: 6_100_000,
    winRate: 72,
    maxDrawdown: -7,
    live: { side: "SHORT", coin: "NVDA", leverage: 3, size: 5_800_000, entry: 182.4, mark: 175.6, liq: 238.1, pnl: 214_000, opened: "1d ago", copiers: 402 },
    key: key(892, 198, 2.4, 610, 12.1, 31, 0.02),
    sub: { price: 249, subscribers: 380, renewRate: 98, cadence: "weekly", leadTime: "a day ahead", offers: ["calls", "lessons", "live", "qa"], pinned: "Fewer, better trades. Each one comes with the macro view, the sizing and the exact level that proves me wrong." },
    calls: [
      { kind: "call", when: "22 minutes ago", text: "Positioning into the print: short the NVDA perp, hedged with a QQQ long. Full sizing, the levels I care about and what makes me wrong.", position: { label: "SHORT NVDA 3x", pnl: 214_000, open: true } },
      { kind: "lesson", when: "4 days ago", text: "How I hedge a single-stock perp with an index perp, and why the hedge ratio matters more than the entry." },
    ],
  },
  {
    handle: "tokyodrift",
    initials: "TD",
    colors: ["#c4482a", "#7a1c42"],
    style: "Asia session scalps",
    bio: "Asia session scalps on majors. Many small trades, alerts only, no essays.",
    wallet: "0x7d11…08be",
    since: "2024",
    followers: 18900,
    pnl30d: 740_000,
    pnlAllTime: 1_900_000,
    winRate: 57,
    maxDrawdown: -11,
    live: { side: "SHORT", coin: "SOL", leverage: 15, size: 1_100_000, entry: 196.8, mark: 194.1, liq: 208.4, pnl: 15_100, opened: "40m ago", copiers: 288 },
    key: key(213, 61, -3.1, 174, 8.8, 43, 0.03),
    sub: { price: 9, subscribers: 6120, renewRate: 74, cadence: "whenever", leadTime: null, offers: ["alerts"], pinned: "Alerts only. If you want essays, follow someone else." },
    calls: [{ kind: "call", when: "40 minutes ago", text: "Short SOL into the Asia open. Scalp, out within the hour either way.", position: { label: "SHORT SOL 15x", pnl: 15_100, open: true } }],
  },
  {
    handle: "sigmaflow",
    initials: "SF",
    colors: ["#2f6bc4", "#1a3a6b"],
    style: "BTC trend following",
    bio: "Systematic trend following on BTC. The rules are public; subscribers get the signals as they fire.",
    wallet: "0x2c90…ae43",
    since: "2023",
    followers: 7400,
    pnl30d: 1_200_000,
    pnlAllTime: 3_300_000,
    winRate: 39,
    maxDrawdown: -16,
    live: { side: "LONG", coin: "BTC", leverage: 8, size: 6_400_000, entry: 80_950, mark: 83_420, liq: 71_200, pnl: 195_000, opened: "3d ago", copiers: 351 },
    key: key(268, 48, 9.8, 201, 11.6, 53),
    sub: { price: 39, subscribers: 690, renewRate: 89, cadence: "weekly", leadTime: "as signals fire", offers: ["alerts", "lessons"], pinned: "I am wrong 60% of the time and still up. That is what trend following is." },
    calls: [{ kind: "call", when: "3 days ago", text: "Trend signal fired long on the daily close above 80.9k. Position on, stop at the 20-day low.", position: { label: "LONG BTC 8x", pnl: 195_000, open: true } }],
  },
  {
    handle: "liquidmaxi",
    initials: "LM",
    colors: ["#0d8a80", "#0b4f55"],
    style: "Funding and basis",
    bio: "Funding and basis on majors. Every call posted with the position attached.",
    wallet: "0x55a0…13cd",
    since: "2024",
    followers: 5200,
    pnl30d: 520_000,
    pnlAllTime: 1_100_000,
    winRate: 63,
    maxDrawdown: -8,
    live: { side: "LONG", coin: "ETH", leverage: 4, size: 2_100_000, entry: 2318, mark: 2366, liq: 1790, pnl: 43_500, opened: "8h ago", copiers: 140 },
    key: key(317, 70, 4.4, 312, 14.2, 61, 0.025),
    sub: { price: 39, subscribers: 233, renewRate: 91, cadence: "regular", leadTime: "an hour before entry", offers: ["calls", "alerts", "lessons"], pinned: "I only trade when someone is paying me to hold the position." },
    calls: [{ kind: "call", when: "8 hours ago", text: "Long ETH while shorts pay funding. Small, patient, out if funding flips.", position: { label: "LONG ETH 4x", pnl: 43_500, open: true } }],
  },
  {
    handle: "vol_surface",
    initials: "VS",
    colors: ["#9a6a12", "#5c340a"],
    style: "Volatility",
    bio: "Volatility trades on majors. The feed is free while I build a record here.",
    wallet: "0x9e44…b1f0",
    since: "2025",
    followers: 3100,
    pnl30d: 210_000,
    pnlAllTime: 380_000,
    winRate: 58,
    maxDrawdown: -6,
    live: null,
    key: key(144, 40, 0.4, 96, 6.1, 71, 0.015),
    sub: { price: 0, subscribers: 3100, renewRate: 100, cadence: "weekly", leadTime: null, offers: ["calls", "lessons"], pinned: "Free while I build a record. When the record is good enough, I will charge for it." },
    calls: [{ kind: "lesson", when: "2 days ago", text: "Realised versus implied: why I stay flat when the market is pricing more movement than it is delivering." }],
  },
  {
    handle: "degenrev",
    initials: "DR",
    colors: ["#9a2626", "#401212"],
    style: "High leverage majors",
    bio: "High leverage on majors. The record is public, including this month.",
    wallet: "0x6f3c…2207",
    since: "2024",
    followers: 4100,
    pnl30d: -1_200_000,
    pnlAllTime: -600_000,
    winRate: 31,
    maxDrawdown: -62,
    live: null,
    key: key(5, 21, -24.8, 4, 2.4, 83, 0.05),
    sub: { price: 14, subscribers: 41, renewRate: 52, cadence: "whenever", leadTime: null, offers: ["alerts"], pinned: "Rough month. Every trade is still posted." },
    calls: [{ kind: "loss", when: "Yesterday", text: "Liquidated on the ETH long. Added into a falling position and moved my stop. Posting it so nobody copies the next one blindly.", position: { label: "LONG ETH 40x", pnl: -820_000, open: false } }],
  },
];

export const traderByHandle = (h: string) => DEMO_TRADERS.find((t) => t.handle.toLowerCase() === h.toLowerCase());

/** the hub feed: some public, some for subscribers only */
export const DEMO_FEED: KeysFeedPost[] = [
  { handle: "basedwhale", when: "4 minutes ago", locked: false, likes: "2.4k", replies: "318", copied: 1920, text: "Funding flipped negative with open interest still 6% under the flush. Adding to the BTC long here. Invalidation 78.4k, first target 84k." },
  { handle: "nyx", when: "22 minutes ago", locked: true, likes: "611", replies: "94", copied: 402, text: "Positioning into the print: short the NVDA perp, hedged with a QQQ long. Full sizing, the levels I care about and what makes me wrong." },
  { handle: "memewitch", when: "1 hour ago", locked: false, likes: "5.1k", replies: "882", copied: 4310, text: "kPEPE reclaiming the range high on rising open interest. Small size, tight stop. This is a 5x, not a 50x — size accordingly." },
  { handle: "kairos", when: "2 hours ago", locked: true, likes: "1.2k", replies: "207", copied: 866, text: "Tomorrow's unlock is already priced into funding. Here is the basis trade I am putting on tonight, with the exact entries." },
];

/** the viewer used across the preview. holdings and subscriptions start here and change as you click */
export const DEMO_VIEWER: KeysViewer = { handle: "nightbid", initials: "NB", colors: ["#3d5fcf", "#0e7f69"], pnl30dPct: 41, followers: 1140 };

export const DEMO_START = {
  keys: {
    basedwhale: { qty: 24, avgCost: 294.5, earned: 3912 },
    kairos: { qty: 40, avgCost: 156.9, earned: 2406 },
    memewitch: { qty: 11, avgCost: 104, earned: 522 },
  } as Record<string, { qty: number; avgCost: number; earned: number }>,
  subs: {
    kairos: { since: "Sep", renews: "28 Oct", unread: 3 },
    nyx: { since: "Aug", renews: "2 Nov", unread: 1 },
    memewitch: { since: "Oct", renews: "30 Oct", unread: 14 },
  } as Record<string, { since: string; renews: string; unread: number }>,
  claimable: 1284.4,
};

export const DEMO_PAYOUTS: KeysPayout[] = [
  { from: "basedwhale", when: "2 hours ago", amount: 84.2 },
  { from: "kairos", when: "6 hours ago", amount: 51.1 },
  { from: "basedwhale", when: "Yesterday", amount: 112.6 },
  { from: "memewitch", when: "Yesterday", amount: 18.4 },
  { from: "kairos", when: "2 days ago", amount: 66.9 },
];

export const DEMO_PLATFORM: KeysPlatform = { live: 1284, traders: 61_400, paidToCreators: 6_200_000, routed: 4_800_000_000, paidToHolders30d: 412_900, heldInKeys: 38_600_000, avgYield: 13.2 };

/** the studio's own numbers: the viewer as a trader */
export const DEMO_STUDIO: KeysStudio = {
  key: { price: 31.8, holders: 187, raised: 5940 },
  earnedThisMonth: 13_920,
  months: [
    { month: "May", sub: 2100, key: 900, fee: 320 },
    { month: "Jun", sub: 3800, key: 1400, fee: 460 },
    { month: "Jul", sub: 5200, key: 1900, fee: 610 },
    { month: "Aug", sub: 7900, key: 2600, fee: 780 },
    { month: "Sep", sub: 9600, key: 1500, fee: 940 },
    { month: "Oct", sub: 10960, key: 1840, fee: 1120 },
  ],
};
