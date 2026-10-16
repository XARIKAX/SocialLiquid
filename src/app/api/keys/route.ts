import { handler, json, plain } from "@/lib/api";
import { liveOnly } from "@/lib/keys-guard";
import { keysIndex } from "@/lib/keys-server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** every creator with their record, key and feed, the latest posts (gated on the caller holding a key) and platform totals */
export const GET = handler(async () => {
  liveOnly();
  const s = await getSession();
  return json(plain(await keysIndex(s?.userId ?? null)));
});
