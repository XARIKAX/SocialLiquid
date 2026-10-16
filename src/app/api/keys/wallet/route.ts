import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { readTrader } from "@/lib/keys-chain";
import { liveOnly } from "@/lib/keys-guard";
import { consumeLinkNonce, isSolanaAddress, issueLinkNonce, linkMessage, verifyLink } from "@/lib/keys-wallet";
import { getSession } from "@/lib/session";

const Address = z.string().min(32).max(44).refine(isSolanaAddress, "not a Solana address");

/** step 1: the message the Solana wallet signs to link itself to the caller's account */
export const GET = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const solana = Address.parse(new URL(req.url).searchParams.get("address"));
  const nonce = await issueLinkNonce(solana, s.address);
  return json({ message: linkMessage(solana, s.address, nonce) });
});

/** step 2: the signed message. links the wallet; a creator whose key is listed keeps the wallet it is listed from */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const { address, signature } = await body(req, z.object({ address: Address, signature: z.string().min(80).max(100) }));
  const nonce = await consumeLinkNonce(address, s.address);
  if (!nonce) throw new HttpError(400, "the link request expired, try again");
  if (!verifyLink(address, linkMessage(address, s.address, nonce), signature)) throw new HttpError(401, "that signature is not from this wallet");
  const user = await prisma.user.findUnique({ where: { id: s.userId }, include: { creator: true } });
  if (!user) throw new HttpError(401, "sign in first");
  if (user.solanaAddress === address) return json({ solana: address });
  const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
  if (user.creator?.keysListed && user.solanaAddress) throw new HttpError(409, `your key is listed from ${short(user.solanaAddress)} and stays with that wallet`);
  if (user.solanaAddress) {
    // keys are tracked by the wallet that holds them: moving the link would hide them, so switch back instead
    const held = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (SELECT trader FROM "KeyTrade" WHERE account = ${user.solanaAddress} GROUP BY trader HAVING SUM(CASE WHEN "isBuy" THEN amount ELSE -amount END) > 0) h`;
    if (Number(held[0]?.n ?? 0) > 0) throw new HttpError(409, `your keys are in ${short(user.solanaAddress)}. switch your wallet back to it, or sell them first`);
  }
  const taken = await prisma.user.findFirst({ where: { solanaAddress: address, NOT: { id: user.id } }, select: { id: true } });
  if (taken) throw new HttpError(409, "that wallet is linked to another account");
  await prisma.user.update({ where: { id: user.id }, data: { solanaAddress: address } });
  // a trader who listed from this wallet before linking it
  if (user.creator && (await readTrader(address))?.listed) await prisma.creator.update({ where: { id: user.creator.id }, data: { keysListed: true } });
  return json({ solana: address });
});
