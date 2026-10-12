import { z } from "zod";
import { handler, json, HttpError } from "@/lib/api";
import { HL_MOCK } from "@/lib/env";
import { getSession } from "@/lib/session";
import { parseUnitResponse, unitAsset, unitDepositable, type UnitAddress } from "@/lib/unit";
import { UNIT_API, UNIT_HEADERS } from "@/lib/unit-server";

export const dynamic = "force-dynamic";

const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; value: UnitAddress }>();

/**
 * GET ?asset=SOL → the signed-in user's Unit deposit address for that asset on its native chain. the browser tries Unit
 * directly first; this is the fallback. the address is derived for the user's own Hyperliquid address and validated.
 */
export const GET = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { asset: symbol } = z.object({ asset: z.string().min(1).max(12) }).parse(Object.fromEntries(new URL(req.url).searchParams));
  const asset = unitAsset(symbol);
  if (!asset) throw new HttpError(400, "unsupported asset");
  if (!unitDepositable(asset)) throw new HttpError(400, `no verified minimum deposit for ${asset.symbol}; deposit it through Unit's app instead`);
  const dst = s.address.toLowerCase();
  // mock mode answers locally unless a stand-in Unit api is configured (used by the e2e suite)
  if (HL_MOCK && !process.env.UNIT_API_URL) {
    const fake = `${asset.chain}-mock-${dst.slice(2, 14)}`;
    return json({ asset: asset.symbol, chain: asset.chain, chainLabel: asset.chainLabel, address: fake, signatures: 2, min: asset.min!, fee: asset.fee ?? null, confirmations: asset.confirmations ?? null, via: "server", mock: true } satisfies UnitAddress);
  }
  const key = `${asset.chain}/${asset.symbol}/${dst}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return json(hit.value);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${UNIT_API}/gen/${asset.chain}/hyperliquid/${asset.symbol.toLowerCase()}/${dst}`, { signal: ctrl.signal, headers: UNIT_HEADERS, cache: "no-store" });
  } catch (e) {
    throw new HttpError(502, (e as Error).name === "AbortError" ? "Unit did not answer in time" : `Unit is not reachable from the server (${(e as Error).message})`);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not json: reported below */
  }
  if (!res.ok && typeof body.address !== "string") {
    const why = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    throw new HttpError(502, `Unit refused the server's request (${res.status}${why ? `: ${why}` : ""})`);
  }
  let value: UnitAddress;
  try {
    value = parseUnitResponse(asset, body, "server");
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
  cache.set(key, { at: Date.now(), value });
  return json(value);
});
