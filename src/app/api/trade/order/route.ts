import { z } from "zod";
import { body, handler, json, HttpError, plain } from "@/lib/api";
import { prisma } from "@/lib/db";
import { syncAddress } from "@/lib/indexer";
import { getSession, hasInvite } from "@/lib/session";
import { createThesis } from "@/lib/thesis";
import { placeOrder } from "@/lib/trade";

const Body = z
  .object({
    coin: z.string().min(1).max(48),
    side: z.enum(["LONG", "SHORT"]),
    type: z.enum(["market", "limit", "stopMarket", "stopLimit", "takeProfitMarket", "takeProfitLimit", "scale", "twap"]).default("market"),
    usd: z.number().positive().max(50_000_000).optional(),
    sz: z.number().positive().optional(),
    leverage: z.number().min(1).max(100),
    isCross: z.boolean().optional(),
    limitPx: z.number().positive().optional(),
    triggerPx: z.number().positive().optional(),
    tif: z.enum(["Gtc", "Ioc", "Alo"]).optional(),
    reduceOnly: z.boolean().optional(),
    tp: z.number().positive().optional(),
    sl: z.number().positive().optional(),
    scale: z.object({ startPx: z.number().positive(), endPx: z.number().positive(), count: z.number().int().min(2).max(20), skew: z.number().min(0.1).max(10) }).optional(),
    twap: z.object({ minutes: z.number().int().min(5).max(1440), randomize: z.boolean() }).optional(),
    thesis: z.string().trim().max(280).optional(),
    /** copy trade: the position being mirrored. recorded on the resulting position and shown on the feed. */
    copyOf: z.object({ positionId: z.string().min(1).max(40), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).optional(),
  })
  .refine((b) => b.usd !== undefined || b.sz !== undefined, { message: "usd or sz required" });

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  if (!(await hasInvite())) throw new HttpError(403, "invite required");
  const input = await body(req, Body);
  if ((input.type === "limit" || input.type === "stopLimit" || input.type === "takeProfitLimit") && !input.limitPx) throw new HttpError(400, "limit price required");
  if (input.type.startsWith("stop") || input.type.startsWith("takeProfit")) if (!input.triggerPx) throw new HttpError(400, "trigger price required");
  if (input.type === "scale" && !input.scale) throw new HttpError(400, "scale parameters required");
  if (input.type === "twap" && !input.twap) throw new HttpError(400, "twap parameters required");

  const result = await placeOrder(s.userId, s.address, input);

  let thesis = null;
  let positionId: string | null = null;
  if (result.status === "filled") {
    await syncAddress(s.address, { forceFills: true }).catch((e) => console.warn("[trade] sync after fill:", e.message));
    let pos = await prisma.position.findFirst({ where: { address: s.address, coin: input.coin, closedAt: null }, orderBy: { openedAt: "desc" } });
    positionId = pos?.id ?? null;
    if (pos && input.copyOf && !pos.copiedFromPositionId && input.copyOf.address.toLowerCase() !== s.address) {
      const src = await prisma.position.findUnique({ where: { id: input.copyOf.positionId }, select: { id: true, address: true, coin: true } });
      if (src && src.address === input.copyOf.address.toLowerCase() && src.coin === input.coin) {
        pos = await prisma.position.update({ where: { id: pos.id }, data: { copiedFromAddress: src.address, copiedFromPositionId: src.id } });
      }
    }
    if (input.thesis) thesis = await createThesis({ userId: s.userId, address: s.address, coin: input.coin, text: input.thesis, position: pos });
  } else if (input.thesis) {
    thesis = await createThesis({ userId: s.userId, address: s.address, coin: input.coin, text: input.thesis, position: null });
  }
  return json(plain({ order: result, positionId, thesis, copied: !!(positionId && input.copyOf) }));
});
