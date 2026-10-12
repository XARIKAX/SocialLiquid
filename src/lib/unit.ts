/**
 * native-asset deposits through Unit (hyperunit.xyz), the same rails Hyperliquid's own deposit dialog uses for BTC, ETH,
 * SOL and the rest. Unit's guardians derive a deposit address on the source chain for the user's Hyperliquid address;
 * whatever lands there is credited to the user's Hyperliquid spot balance. no custody on our side at any point.
 *
 * the address is asked for from the browser first (exactly what app.hyperliquid.xyz and app.hyperunit.xyz do), with
 * our server as a fallback; both validate the answer before it is shown.
 */
export type UnitAsset = {
  symbol: string;
  /** Unit's source chain id */
  chain: string;
  chainLabel: string;
  /**
   * minimum per Unit's docs and Hyperliquid's dialog; below it the deposit is LOST, so an asset without a verified
   * minimum is never given an address in-app (it links to Unit's app instead)
   */
  min?: string;
  /** Unit's fee as Hyperliquid quotes it, when known */
  fee?: string;
  /** the coin the deposit shows up as in the hyperliquid spot balance */
  spotCoin?: string;
  /**
   * minimum withdrawal. Unit publishes deposit minimums; its withdrawal floor is not published in the same place, so
   * these are the larger figures from Unit's lifecycle docs. too strict only inconveniences; too lax loses funds.
   */
  withdrawMin?: string;
  confirmations?: string;
};

/** Hyperliquid's asset dropdown, in its order, minus USDC which has its own routes */
export const UNIT_ASSETS: UnitAsset[] = [
  { symbol: "BTC", chain: "bitcoin", chainLabel: "Bitcoin", spotCoin: "UBTC", min: "0.0003 BTC", withdrawMin: "0.002 BTC", fee: "network fee, set by Unit", confirmations: "2 blocks (~20 min)" },
  { symbol: "ETH", chain: "ethereum", chainLabel: "Ethereum", spotCoin: "UETH", min: "0.007 ETH", withdrawMin: "0.05 ETH", fee: "network fee, set by Unit", confirmations: "14 blocks (~3 min)" },
  { symbol: "SOL", chain: "solana", chainLabel: "Solana", spotCoin: "USOL", min: "0.12 SOL", withdrawMin: "0.2 SOL", fee: "≈ $1.30, set by Unit", confirmations: "~1 minute" },
  { symbol: "2Z", chain: "solana", chainLabel: "Solana", confirmations: "32 slots (~15 s)" },
  { symbol: "ANSEM", chain: "solana", chainLabel: "Solana", confirmations: "32 slots (~15 s)" },
  { symbol: "AVAX", chain: "avalanche", chainLabel: "Avalanche" },
  { symbol: "BONK", chain: "solana", chainLabel: "Solana", confirmations: "32 slots (~15 s)" },
  { symbol: "FARTCOIN", chain: "solana", chainLabel: "Solana", confirmations: "32 slots (~15 s)" },
  { symbol: "MON", chain: "monad", chainLabel: "Monad" },
  { symbol: "PUMP", chain: "solana", chainLabel: "Solana", confirmations: "32 slots (~15 s)" },
  { symbol: "SPX", chain: "solana", chainLabel: "Solana", confirmations: "32 slots (~15 s)" },
  { symbol: "VIRTUAL", chain: "base", chainLabel: "Base" },
  { symbol: "XPL", chain: "plasma", chainLabel: "Plasma" },
  { symbol: "ZEC", chain: "zcash", chainLabel: "Zcash" },
];

/** assets we can hand an address for: a verified minimum is the condition */
export const unitDepositable = (a: UnitAsset) => !!a.min;
/** assets we can withdraw in-app: a spot coin to send and a withdrawal floor */
export const unitWithdrawable = (a: UnitAsset) => !!a.spotCoin && !!a.withdrawMin;
export const minNumber = (m: string | undefined) => Number((m ?? "0").split(" ")[0]) || 0;
export const unitAsset = (symbol: string) => UNIT_ASSETS.find((a) => a.symbol === symbol.toUpperCase()) ?? null;
export const UNIT_APP_URL = "https://app.hyperunit.xyz";
/** the browser calls Unit here; the server proxy uses UNIT_API_URL (same default) */
export const UNIT_API_URL_CLIENT = process.env.NEXT_PUBLIC_UNIT_API_URL ?? "https://api.hyperunit.xyz";
export const UNIT_MIN_SIGNATURES = 2;

/** does the returned deposit address look like an address on that chain? a wrong-shaped answer is never shown */
export function looksLikeAddress(chain: string, address: string): boolean {
  switch (chain) {
    case "solana":
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    case "bitcoin":
      return /^(bc1[02-9ac-hj-np-z]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address);
    case "ethereum":
    case "base":
    case "avalanche":
    case "monad":
    case "plasma":
      return /^0x[0-9a-fA-F]{40}$/.test(address);
    case "zcash":
      return /^(t1[a-km-zA-HJ-NP-Z1-9]{33}|t3[a-km-zA-HJ-NP-Z1-9]{33}|u1[a-z0-9]{20,})$/.test(address);
    default:
      return address.length >= 20 && !/\s/.test(address);
  }
}

export type UnitAddress = { asset: string; chain: string; chainLabel: string; address: string; signatures: number; min: string; fee: string | null; confirmations: string | null; via: "browser" | "server"; mock?: boolean };

type UnitGen = { address?: unknown; signatures?: unknown; status?: unknown; error?: unknown; message?: unknown };

/** turns Unit's generate-address response into a validated UnitAddress, or throws with a reason */
export function parseUnitResponse(asset: UnitAsset, body: UnitGen, via: UnitAddress["via"]): UnitAddress {
  if (!asset.min) throw new Error(`no verified minimum deposit for ${asset.symbol}; not handing out an address`);
  if (typeof body.address !== "string" || !body.address) throw new Error(typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "no address in Unit's reply");
  const sigs = body.signatures && typeof body.signatures === "object" ? Object.keys(body.signatures as object).length : 0;
  if (sigs < UNIT_MIN_SIGNATURES) throw new Error(`Unit returned the address with ${sigs} guardian signature${sigs === 1 ? "" : "s"}; ${UNIT_MIN_SIGNATURES} are required, so it is not shown`);
  if (!looksLikeAddress(asset.chain, body.address)) throw new Error(`Unit returned something that is not a ${asset.chainLabel} address; not showing it`);
  return { asset: asset.symbol, chain: asset.chain, chainLabel: asset.chainLabel, address: body.address, signatures: sigs, min: asset.min, fee: asset.fee ?? null, confirmations: asset.confirmations ?? null, via };
}

/** browser side: Unit directly (like Hyperliquid's own dialog), then our server proxy; the first validated answer wins */
export async function fetchUnitAddress(symbol: string, hlAddress: string, apiFetch: <T>(path: string) => Promise<T>): Promise<UnitAddress> {
  const asset = unitAsset(symbol);
  if (!asset) throw new Error("unsupported asset");
  if (!unitDepositable(asset)) throw new Error(`no verified minimum deposit for ${asset.symbol}; deposit it through Unit's app instead`);
  const errors: string[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(`${UNIT_API_URL_CLIENT}/gen/${asset.chain}/hyperliquid/${asset.symbol.toLowerCase()}/${hlAddress.toLowerCase()}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    clearTimeout(t);
    const body = (await res.json().catch(() => ({}))) as UnitGen;
    if (!res.ok && typeof body.address !== "string") throw new Error(`${typeof body.error === "string" ? body.error : "Unit error"} (${res.status})`);
    return parseUnitResponse(asset, body, "browser");
  } catch (e) {
    errors.push((e as Error).name === "AbortError" ? "Unit did not answer in time" : (e as Error).message);
  }
  try {
    return await apiFetch<UnitAddress>(`/api/funds/unit?asset=${asset.symbol}`);
  } catch (e) {
    errors.push((e as Error).message);
  }
  throw new Error(`Could not get your ${asset.symbol} address from Unit: ${errors.join(" · ")}`);
}

/** the spot-balance entry for a Unit asset: hyperliquid names Unit's tokens with a U prefix (USOL, UBTC, UETH) */
export function spotEntry(asset: UnitAsset, spot: { coin: string; total: number; hold: number }[] | null | undefined) {
  if (!spot) return null;
  const names = new Set([asset.spotCoin, asset.symbol, `U${asset.symbol}`].filter(Boolean) as string[]);
  return spot.find((b) => names.has(b.coin)) ?? null;
}

export type UnitWithdrawAddress = { asset: string; chain: string; chainLabel: string; destination: string; address: string; signatures: number; withdrawMin: string; via: "browser" | "server"; mock?: boolean };

/** Unit's generate-address answer for a withdrawal: the hyperliquid address to spotSend the coin to, for `destination` on the native chain */
export function parseUnitWithdrawResponse(asset: UnitAsset, destination: string, body: UnitGen, via: UnitWithdrawAddress["via"]): UnitWithdrawAddress {
  if (!asset.withdrawMin || !asset.spotCoin) throw new Error(`no verified minimum withdrawal for ${asset.symbol}`);
  if (typeof body.address !== "string" || !body.address) throw new Error(typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "no address in Unit's reply");
  const sigs = body.signatures && typeof body.signatures === "object" ? Object.keys(body.signatures as object).length : 0;
  if (sigs < UNIT_MIN_SIGNATURES) throw new Error(`Unit returned the address with ${sigs} guardian signature${sigs === 1 ? "" : "s"}; ${UNIT_MIN_SIGNATURES} are required, so it is not used`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(body.address)) throw new Error("Unit returned something that is not a Hyperliquid address; not using it");
  return { asset: asset.symbol, chain: asset.chain, chainLabel: asset.chainLabel, destination, address: body.address, signatures: sigs, withdrawMin: asset.withdrawMin, via };
}

/** browser side: Unit directly, then our server proxy. `destination` is the user's address on the asset's native chain. */
export async function fetchUnitWithdrawAddress(symbol: string, destination: string, apiFetch: <T>(path: string) => Promise<T>): Promise<UnitWithdrawAddress> {
  const asset = unitAsset(symbol);
  if (!asset) throw new Error("unsupported asset");
  if (!unitWithdrawable(asset)) throw new Error(`no verified minimum withdrawal for ${asset.symbol}; withdraw it through Unit's app instead`);
  if (!looksLikeAddress(asset.chain, destination)) throw new Error(`that is not a ${asset.chainLabel} address`);
  const errors: string[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(`${UNIT_API_URL_CLIENT}/gen/hyperliquid/${asset.chain}/${asset.symbol.toLowerCase()}/${destination}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    clearTimeout(t);
    const body = (await res.json().catch(() => ({}))) as UnitGen;
    if (!res.ok && typeof body.address !== "string") throw new Error(`${typeof body.error === "string" ? body.error : "Unit error"} (${res.status})`);
    return parseUnitWithdrawResponse(asset, destination, body, "browser");
  } catch (e) {
    errors.push((e as Error).name === "AbortError" ? "Unit did not answer in time" : (e as Error).message);
  }
  try {
    return await apiFetch<UnitWithdrawAddress>(`/api/funds/unit?asset=${asset.symbol}&direction=withdraw&dest=${encodeURIComponent(destination)}`);
  } catch (e) {
    errors.push((e as Error).message);
  }
  throw new Error(`Could not get a ${asset.symbol} withdrawal address from Unit: ${errors.join(" · ")}`);
}

export type UnitOperation = {
  id: string;
  asset: string;
  sourceChain: string;
  destinationChain: string;
  sourceAmount: string | null;
  destinationAmount: string | null;
  state: string;
  createdAt: string | null;
  sourceTx: string | null;
  destinationTx: string | null;
};

/** Unit's /operations/:address rows as we show them; unknown shapes are skipped rather than guessed at */
export function parseUnitOperations(body: unknown): UnitOperation[] {
  const rows = (body && typeof body === "object" && Array.isArray((body as { operations?: unknown }).operations) ? (body as { operations: unknown[] }).operations : Array.isArray(body) ? body : []) as Record<string, unknown>[];
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
  const out: UnitOperation[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const asset = str(r.asset);
    const state = str(r.state) ?? str(r.status);
    if (!asset || !state) continue;
    out.push({
      id: str(r.operationId) ?? str(r.id) ?? `${asset}-${str(r.opCreatedAt) ?? out.length}`,
      asset: asset.toUpperCase(),
      sourceChain: str(r.sourceChain) ?? "",
      destinationChain: str(r.destinationChain) ?? "",
      sourceAmount: str(r.sourceAmount),
      destinationAmount: str(r.destinationAmount),
      state,
      createdAt: str(r.opCreatedAt) ?? str(r.createdAt),
      sourceTx: str(r.sourceTxHash),
      destinationTx: str(r.destinationTxHash),
    });
  }
  return out;
}

/** human wording for Unit's operation states (its deposit lifecycle), falling back to the raw state */
export function unitStateLabel(state: string): { text: string; done: boolean } {
  const s = state.toLowerCase();
  if (s === "done" || s === "complete" || s === "completed" || s === "success") return { text: "Credited", done: true };
  if (s.includes("discover")) return { text: "Seen on chain, waiting for confirmations", done: false };
  if (s.includes("final")) return { text: "Waiting for source-chain finality", done: false };
  if (s.includes("build") || s.includes("sign") || s.includes("broadcast") || s.includes("dsttx") || s.includes("dst_tx")) return { text: "Guardians are crediting it", done: false };
  if (s.includes("fail") || s.includes("revert") || s.includes("reject")) return { text: `Failed (${state})`, done: false };
  return { text: state, done: false };
}

/** the user's recent Unit operations: browser first, then our server proxy */
export async function fetchUnitOperations(hlAddress: string, apiFetch: <T>(path: string) => Promise<T>): Promise<UnitOperation[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`${UNIT_API_URL_CLIENT}/operations/${hlAddress.toLowerCase()}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    clearTimeout(t);
    if (res.ok) return parseUnitOperations(await res.json());
  } catch {
    /* fall through to the server */
  }
  const r = await apiFetch<{ operations: UnitOperation[] }>("/api/funds/unit/ops");
  return r.operations;
}
