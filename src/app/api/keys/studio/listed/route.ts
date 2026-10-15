import { handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { readTrader } from "@/lib/keys-chain";
import { KEYS_PROGRAM } from "@/lib/keys";
import { liveOnly } from "@/lib/keys-guard";
import { getSession } from "@/lib/session";

/** after the creator listed their key from their linked Solana wallet: confirm it onchain and show it as buyable */
export const POST = handler(async () => {
  liveOnly();
  if (!KEYS_PROGRAM) throw new HttpError(400, "keys are not launched on this deployment yet");
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const creator = await prisma.creator.findUnique({ where: { userId: s.userId }, include: { user: { select: { solanaAddress: true } } } });
  if (!creator) throw new HttpError(400, "set up your subscription first");
  const wallet = creator.user.solanaAddress;
  if (!wallet) throw new HttpError(400, "link your Solana wallet first");
  // the transaction can take a moment to show up on the node
  let state = await readTrader(wallet);
  for (let i = 0; i < 4 && !state?.listed; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    state = await readTrader(wallet);
  }
  if (!state) throw new HttpError(503, "could not reach Solana, try again in a moment");
  if (!state.listed) return json({ listed: false });
  await prisma.creator.update({ where: { id: creator.id }, data: { keysListed: true } });
  return json({ listed: true });
});
