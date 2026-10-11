import { handler, json } from "@/lib/api";
import { issueNonce, signInMessage } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const address = (new URL(req.url).searchParams.get("address") ?? "").toLowerCase();
  const nonce = await issueNonce();
  return json({ nonce, message: signInMessage(address, nonce) });
});
