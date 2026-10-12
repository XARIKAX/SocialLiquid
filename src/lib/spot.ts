/** spot balance helpers shared by the top bar, the balances tab and the ticket */
import type { Balance } from "@/hooks/use-me";
import { UNIT_ASSETS } from "./unit";

const UNIT_BY_SPOT = new Map(UNIT_ASSETS.filter((a) => a.spotCoin).map((a) => [a.spotCoin!, a.symbol]));
const UNIT_SYMBOLS = new Set(UNIT_ASSETS.map((a) => a.symbol));

/** hyperliquid names Unit's tokens with a U prefix (USOL, UBTC, UFART…); show them as the asset people deposited */
export function displayCoin(coin: string): string {
  const mapped = UNIT_BY_SPOT.get(coin);
  if (mapped) return mapped;
  if (/^U[A-Z0-9]{2,}$/.test(coin) && UNIT_SYMBOLS.has(coin.slice(1))) return coin.slice(1);
  if (coin === "UFART") return "FARTCOIN";
  return coin;
}

export type SpotRow = { coin: string; name: string; total: number; available: number; usd: number | null };

/** spot rows with a usd estimate from the perps mid of the same asset (USDC is 1:1), largest first */
export function spotRows(spot: Balance["spot"] | undefined, mids: Record<string, string> | undefined): SpotRow[] {
  if (!spot) return [];
  return spot
    .filter((b) => b.total > 0)
    .map((b) => {
      const name = displayCoin(b.coin);
      const px = name === "USDC" ? 1 : mids?.[name] ? Number(mids[name]) : null;
      return { coin: b.coin, name, total: b.total, available: Math.max(0, b.total - b.hold), usd: px !== null && Number.isFinite(px) ? b.total * px : null };
    })
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}

export const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 2 : 6 });

/** USDC sitting in the spot balance (free to move to perps) */
export const usdcSpotAvail = (spot: Balance["spot"] | undefined | null) => {
  const u = spot?.find((b) => b.coin === "USDC");
  return u ? Math.max(0, u.total - u.hold) : 0;
};
/** what hyperliquid's unified view calls cash: perps withdrawable plus spot USDC */
export const cashTotal = (b: Balance | undefined | null) => (b ? b.withdrawable + usdcSpotAvail(b.spot) : 0);
/** cents-floored decimal string for a hyperliquid transfer */
export const cents = (n: number) => (Math.floor(n * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
