import { z } from "zod";
import { body, handler, json, HttpError, plain } from "@/lib/api";
import { prisma } from "@/lib/db";
import { syncAddress } from "@/lib/indexer";
import { getSession, hasInvite } from "@/lib/session";
import { createThesis } from "@/lib/thesis";
import { placeOrder } from "@/lib/trade";

const Body = z.object({
  coin: z.string().min(1).max(20),
  side: z.enum(["LONG", "SHORT"]),
  usd: z.number().min(10).max(10_000_000),
  leverage: z.number().min(1).max(100),
  type: z.enum(["market", "limit"]).default("market"),
  limitPx: z.number().positive().optional(),
  tp: z.number().positive().optional(),
  sl: z.number().positive().optional(),
  thesis: z.string().trim().max(280).optional(),
});

export const POST = handler(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  if (!(await hasInvite())) throw new HttpError(403, "invite required");
  const input = await body(req, Body);
  if (input.type === "limit" && !input.limitPx) throw new HttpError(400, "limit price required");

  const result = await placeOrder(s.userId, s.address, input);

  // mirror the new position right away so the thesis can bind to its id
  let thesis = null;
  let positionId: string | null = null;
  if (result.status === "filled") {
    await syncAddress(s.address, { forceFills: true }).catch((e) => console.warn("[trade] sync after fill:", e.message));
    const pos = await prisma.position.findFirst({ where: { address: s.address, coin: input.coin, closedAt: null }, orderBy: { openedAt: "desc" } });
    positionId = pos?.id ?? null;
    if (input.thesis) thesis = await createThesis({ userId: s.userId, address: s.address, coin: input.coin, text: input.thesis, position: pos });
  } else if (input.thesis) {
    // resting limit order: post the thesis unbound; it binds when the user has a position (see /api/thesis)
    thesis = await createThesis({ userId: s.userId, address: s.address, coin: input.coin, text: input.thesis, position: null });
  }
  return json(plain({ order: result, positionId, thesis }));
});
