import { handler, json, plain } from "@/lib/api";
import { liveOnly } from "@/lib/keys-guard";
import { keysMe } from "@/lib/keys-server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** the caller's keys, subscriptions, claimable fee share and creator studio */
export const GET = handler(async () => {
  liveOnly();
  const s = await getSession();
  if (!s) return json(null);
  return json(plain(await keysMe(s.userId)));
});
