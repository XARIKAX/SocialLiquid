import { handler, json, plain, HttpError } from "@/lib/api";
import { liveOnly } from "@/lib/keys-guard";
import { keysTrader } from "@/lib/keys-server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** one trader's page. holder posts come back without their text unless the caller holds the key */
export const GET = handler(async (_req: Request, { params }: { params: Promise<{ handle: string }> }) => {
  liveOnly();
  const { handle } = await params;
  const s = await getSession();
  const t = await keysTrader(handle, s?.userId ?? null);
  if (!t) throw new HttpError(404, "no trader with that handle on keys");
  return json(plain(t));
});
