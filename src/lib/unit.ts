/**
 * native-asset deposits through Unit (hyperunit.xyz), the same rails Hyperliquid's own deposit dialog uses for BTC, ETH,
 * SOL and the rest. Unit's guardians derive a deposit address on the source chain for the user's Hyperliquid address;
 * whatever lands there is credited to the user's Hyperliquid spot balance. no custody on our side at any point.
 */
export type UnitAsset = {
  symbol: string;
  /** Unit's source chain id */
  chain: string;
  chainLabel: string;
  /** minimum per Unit's docs; below it a deposit is not credited */
  min?: string;
  confirmations?: string;
};

/** Hyperliquid's asset dropdown, in its order, minus USDC which has its own routes */
export const UNIT_ASSETS: UnitAsset[] = [
  { symbol: "BTC", chain: "bitcoin", chainLabel: "Bitcoin", min: "0.0003 BTC", confirmations: "2 blocks" },
  { symbol: "ETH", chain: "ethereum", chainLabel: "Ethereum", min: "0.007 ETH", confirmations: "14 blocks" },
  { symbol: "SOL", chain: "solana", chainLabel: "Solana", min: "0.12 SOL", confirmations: "32 slots" },
  { symbol: "2Z", chain: "solana", chainLabel: "Solana" },
  { symbol: "ANSEM", chain: "solana", chainLabel: "Solana" },
  { symbol: "AVAX", chain: "avalanche", chainLabel: "Avalanche" },
  { symbol: "BONK", chain: "solana", chainLabel: "Solana" },
  { symbol: "FARTCOIN", chain: "solana", chainLabel: "Solana" },
  { symbol: "MON", chain: "monad", chainLabel: "Monad" },
  { symbol: "PUMP", chain: "solana", chainLabel: "Solana" },
  { symbol: "SPX", chain: "solana", chainLabel: "Solana" },
  { symbol: "VIRTUAL", chain: "base", chainLabel: "Base" },
  { symbol: "XPL", chain: "plasma", chainLabel: "Plasma" },
  { symbol: "ZEC", chain: "zcash", chainLabel: "Zcash" },
];

export const unitAsset = (symbol: string) => UNIT_ASSETS.find((a) => a.symbol === symbol.toUpperCase()) ?? null;
export const UNIT_APP_URL = "https://app.hyperunit.xyz";
