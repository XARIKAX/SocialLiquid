import { handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { readTrader } from "@/lib/keys-chain";
import { KEYS_CONTRACT } from "@/lib/keys";
import { liveOnly } from "@/lib/keys-guard";
import { getSession } from "@/lib/session";

/** after the creator signed list() on the keys contract: confirm it onchain and show their key as buyable */
export const POST = handler(async () => {
  liveOnly();
  if (!KEYS_CONTRACT) throw new HttpError(400, "keys are not launched on this deployment yet");
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const creator = await prisma.creator.findUnique({ where: { userId: s.userId } });
  if (!creator) throw new HttpError(400, "set up your subscription first");
  // the transaction can take a block or two to show up on the public node
  let state = await readTrader(s.address);
  for (let i = 0; i < 4 && !state?.listed; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    state = await readTrader(s.address);
  }
  if (!state) throw new HttpError(503, "could not reach HyperEVM, try again in a moment");
  if (!state.listed) return json({ listed: false });
  await prisma.creator.update({ where: { id: creator.id }, data: { keysListed: true } });
  return json({ listed: true });
});
