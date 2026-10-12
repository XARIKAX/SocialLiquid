import { z } from "zod";
import { handler, json, HttpError } from "@/lib/api";
import { HL_MOCK } from "@/lib/env";
import { getSession } from "@/lib/session";
import { unitAsset } from "@/lib/unit";

export const dynamic = "force-dynamic";

const UNIT_API = process.env.UNIT_API_URL ?? "https://api.hyperunit.xyz";
const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; address: string; signatures: number }>();

/**
 * GET ?asset=BTC → the signed-in user's Unit deposit address for that asset on its native chain.
 * proxied so the browser never needs third-party CORS; the address is derived for the user's own Hyperliquid address.
 */
export const GET = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { asset: symbol } = z.object({ asset: z.string().min(1).max(12) }).parse(Object.fromEntries(new URL(req.url).searchParams));
  const asset = unitAsset(symbol);
  if (!asset) throw new HttpError(400, "unsupported asset");
  const dst = s.address.toLowerCase();
  if (HL_MOCK) {
    const fake = `${asset.chain}-mock-${dst.slice(2, 14)}`;
    return json({ asset: asset.symbol, chain: asset.chain, chainLabel: asset.chainLabel, address: fake, signatures: 2, min: asset.min ?? null, confirmations: asset.confirmations ?? null, mock: true });
  }
  const key = `${asset.chain}/${asset.symbol}/${dst}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return json({ asset: asset.symbol, chain: asset.chain, chainLabel: asset.chainLabel, address: hit.address, signatures: hit.signatures, min: asset.min ?? null, confirmations: asset.confirmations ?? null });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${UNIT_API}/gen/${asset.chain}/hyperliquid/${asset.symbol.toLowerCase()}/${dst}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
  } catch {
    throw new HttpError(502, "Unit is not reachable right now; try again in a moment or deposit from app.hyperunit.xyz");
  } finally {
    clearTimeout(t);
  }
  const body = (await res.json().catch(() => ({}))) as { address?: string; signatures?: Record<string, unknown>; error?: string; message?: string };
  if (!res.ok || typeof body.address !== "string" || !body.address) {
    throw new HttpError(502, body.error ?? body.message ?? `Unit could not generate a ${asset.symbol} address (${res.status})`);
  }
  const signatures = body.signatures ? Object.keys(body.signatures).length : 0;
  if (signatures < 2) throw new HttpError(502, "Unit returned an address without enough guardian signatures; not showing it");
  cache.set(key, { at: Date.now(), address: body.address, signatures });
  return json({ asset: asset.symbol, chain: asset.chain, chainLabel: asset.chainLabel, address: body.address, signatures, min: asset.min ?? null, confirmations: asset.confirmations ?? null });
});
