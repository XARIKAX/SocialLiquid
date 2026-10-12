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
  const body = z.object({ kind: z.enum(["deposit", "withdraw"]), amount: z.coerce.number().positive().max(1_000_000) }).parse(await req.json());
  await mock.mockFunds(s.address, body.kind === "deposit" ? body.amount : -body.amount);
  return json({ ok: true });
});
