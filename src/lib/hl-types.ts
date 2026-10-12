/** typed subset of hyperliquid info responses we rely on. mirrors @nktkas/hyperliquid types. */

export type HlMetaAsset = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
};

export type HlMeta = { universe: HlMetaAsset[] };

export type HlAssetCtx = {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
  impactPxs: string[] | null;
};

export type HlLeverage =
  | { type: "cross"; value: number }
  | { type: "isolated"; value: number; rawUsd: string };

export type HlPosition = {
  coin: string;
  /** signed size. >0 long, <0 short */
  szi: string;
  leverage: HlLeverage;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
};

export type HlClearinghouseState = {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMaintenanceMarginUsed?: string;
  withdrawable: string;
  assetPositions: { type: "oneWay"; position: HlPosition }[];
  time: number;
};

export type HlFill = {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  startPosition: string;
  /** "Open Long" | "Close Long" | "Open Short" | "Close Short" | "Long > Short" | "Short > Long" | "Liquidated ..." */
  dir: string;
  closedPnl: string;
  hash: `0x${string}`;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
  builderFee?: string;
  liquidation?: { liquidatedUser?: `0x${string}`; markPx: string; method: "market" | "backstop" };
};

export type HlCandle = {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
};

export type HlCandleInterval =
  | "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "8h" | "12h" | "1d" | "3d" | "1w" | "1M";

export type HlLeaderboardRow = {
  ethAddress: `0x${string}`;
  accountValue: string;
  displayName: string | null;
  prize: number;
  windowPerformances: [
    "day" | "week" | "month" | "allTime",
    { pnl: string; roi: string; vlm: string },
  ][];
};

export type HlAllMids = Record<string, string>;

/** derived market summary used by the UI */
export type MarketKind = "perp" | "spot" | "hip3";
export type MarketSummary = {
  /** hyperliquid's id for api calls: "BTC", "@107" (spot pair), "xyz:BRENTOIL" (builder dex) */
  coin: string;
  /** url slug: "BTC", "spot:USOL", "xyz:BRENTOIL" */
  slug: string;
  /** display: "BTC", "SOL/USDC", "BRENTOIL" */
  name: string;
  /** symbol for the icon */
  base: string;
  kind: MarketKind;
  /** builder dex short name; "" for the main perps dex and spot */
  dex: string;
  dexName?: string;
  /** tradfi grouping for builder-dex markets: Stocks · Indices · Commodities · FX · Pre-IPO */
  category?: string;
  /** spot only: the base token as hyperliquid names it (USOL) */
  token?: string;
  /** asset id for the order endpoint */
  assetId: number;
  szDecimals: number;
  maxLeverage: number;
  markPx: number;
  midPx: number;
  prevDayPx: number;
  change24h: number;
  volume24h: number;
  openInterestUsd: number;
  funding: number;
  oraclePx: number;
};

export type HlBookLevel = { px: string; sz: string; n: number };
export type HlL2Book = { coin: string; time: number; levels: [bids: HlBookLevel[], asks: HlBookLevel[]] };
export type HlRecentTrade = { coin: string; side: "B" | "A"; px: string; sz: string; time: number; hash: string; tid: number };
export type HlOpenOrder = {
  coin: string;
  side: "B" | "A";
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz: string;
  triggerCondition: string;
  isTrigger: boolean;
  triggerPx: string;
  children: HlOpenOrder[];
  isPositionTpsl: boolean;
  reduceOnly: boolean;
  orderType: string;
  tif: string | null;
  cloid: string | null;
};
export type HlHistoricalOrder = { order: HlOpenOrder; status: string; statusTimestamp: number };
export type HlFundingPayment = { time: number; hash: string; delta: { type: "funding"; coin: string; usdc: string; szi: string; fundingRate: string } };
export type HlFundingRate = { coin: string; fundingRate: string; premium: string; time: number };
export type HlTwap = { time: number; state: { coin: string; executedNtl: string; executedSz: string; minutes: number; reduceOnly: boolean; randomize: boolean; side: "B" | "A"; sz: string; timestamp: number; user: string }; status: { status: string; description?: string }; twapId?: number };
