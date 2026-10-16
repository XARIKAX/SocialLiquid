import { z } from "zod";
import { body, handler, json, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { POST_KINDS } from "@/lib/keys";
import { liveOnly } from "@/lib/keys-guard";
import { getSession } from "@/lib/session";

const MAX_PER_DAY = 40;

const Post = z.object({
  kind: z.enum(POST_KINDS),
  text: z.string().trim().min(1).max(1000),
  coin: z.string().trim().min(1).max(24).optional(),
  positionId: z.string().min(1).max(64).optional(),
  /** false: everyone can read it, a teaser for the feed */
  holdersOnly: z.boolean().default(true),
});

/** a creator posts to their feed; everyone holding their key gets an alert */
export const POST = handler(async (req: Request) => {
  liveOnly();
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const input = await body(req, Post);
  const creator = await prisma.creator.findUnique({ where: { userId: s.userId }, include: { user: { select: { address: true, handle: true, solanaAddress: true } } } });
  if (!creator?.active) throw new HttpError(403, "set up your page in the studio first");
  const today = await prisma.creatorPost.count({ where: { creatorId: creator.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
  if (today >= MAX_PER_DAY) throw new HttpError(429, `${MAX_PER_DAY} posts a day at most`);
  let coin = input.coin ?? null;
  if (input.positionId) {
    // a post can only point at one of the creator's own positions
    const p = await prisma.position.findUnique({ where: { id: input.positionId }, select: { address: true, coin: true } });
    if (!p || p.address !== creator.user.address) throw new HttpError(400, "that position is not yours");
    coin ??= p.coin;
  }
  const post = await prisma.creatorPost.create({ data: { creatorId: creator.id, kind: input.kind, text: input.text, coin, positionId: input.positionId ?? null, holdersOnly: input.holdersOnly } });
  // everyone whose linked Solana wallet holds the key, as the indexer has it
  const wallets = creator.user.solanaAddress
    ? (await prisma.$queryRaw<{ account: string }[]>`SELECT account FROM "KeyTrade" WHERE trader = ${creator.user.solanaAddress} GROUP BY account HAVING SUM(CASE WHEN "isBuy" THEN amount ELSE -amount END) > 0`).map((r) => r.account)
    : [];
  const holders = wallets.length ? await prisma.user.findMany({ where: { solanaAddress: { in: wallets }, NOT: { id: s.userId } }, select: { id: true } }) : [];
  if (holders.length) {
    await prisma.notification.createMany({
      data: holders.map((h) => ({ userId: h.id, type: "CREATOR_POST" as const, actorAddress: creator.user.address, coin, positionId: post.positionId, payload: { postId: post.id, kind: post.kind, handle: creator.user.handle, text: post.text.slice(0, 140) } })),
    });
  }
  return json({ ok: true, id: post.id, notified: holders.length });
});
