import { z } from "zod";
import { handler, json, HttpError } from "@/lib/api";
import { HL_MOCK } from "@/lib/env";
import * as mock from "@/lib/hl-mock";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** mock-only: credit or debit the synthetic balance so the deposit / withdraw flow can be exercised without a chain */
export const POST = handler(async (req: Request) => {
  if (!HL_MOCK) throw new HttpError(404, "not found");
  const s = await getSession();
  if (!s) throw new HttpError(401, "sign in first");
  const body = z.object({ kind: z.enum(["deposit", "withdraw", "spot", "spot-withdraw", "class-transfer"]), amount: z.coerce.number().positive().max(1_000_000), coin: z.string().min(1).max(12).optional(), toPerp: z.boolean().optional() }).parse(await req.json());
  if (body.kind === "spot") await mock.mockSpotDeposit(s.address, body.coin ?? "USOL", body.amount);
  else if (body.kind === "class-transfer") await mock.mockClassTransfer(s.address, body.amount, body.toPerp ?? true);
  else if (body.kind === "spot-withdraw") await mock.mockSpotDeposit(s.address, body.coin ?? "USOL", -body.amount);
  else await mock.mockFunds(s.address, body.kind === "deposit" ? body.amount : -body.amount);
  return json({ ok: true });
});
