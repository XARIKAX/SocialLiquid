import { handler, json, HttpError } from "@/lib/api";
import { HL_MOCK } from "@/lib/env";
import { getSession } from "@/lib/session";
import { parseUnitOperations } from "@/lib/unit";
import { UNIT_API, UNIT_HEADERS } from "@/lib/unit-server";

export const dynamic = "force-dynamic";

/** the signed-in user's recent Unit operations (deposits and withdrawals in flight), server fallback for the browser call */
export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  if (HL_MOCK && !process.env.UNIT_API_URL) return json({ operations: [] });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${UNIT_API}/operations/${s.address.toLowerCase()}`, { signal: ctrl.signal, headers: UNIT_HEADERS, cache: "no-store" });
    if (!res.ok) throw new HttpError(502, `Unit answered ${res.status} for the operations list`);
    return json({ operations: parseUnitOperations(await res.json()) });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, (e as Error).name === "AbortError" ? "Unit did not answer in time" : `Unit is not reachable from the server (${(e as Error).message})`);
  } finally {
    clearTimeout(t);
  }
});
