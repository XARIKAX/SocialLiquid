import { handler, json, HttpError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { inviteSummary } from "@/lib/invites";

export const dynamic = "force-dynamic";

/** the signed-in user's personal code, the people it brought in and what that earned */
export const GET = handler(async () => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  return json(await inviteSummary(s.userId));
});
