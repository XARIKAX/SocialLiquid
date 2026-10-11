import type { Position } from "@prisma/client";
import { prisma } from "./db";

/** a thesis is bound to a position id at post time. the worker settles its outcome when that position closes. */
export async function createThesis(args: { userId: string; address: string; coin: string; text: string; position: Position | null }) {
  const { userId, address, coin, text, position } = args;
  return prisma.$transaction(async (tx) => {
    const thesis = await tx.thesis.create({ data: { userId, coin, text, positionId: position?.id ?? null } });
    await tx.feedEvent.create({
      data: {
        type: "THESIS",
        address,
        coin,
        positionId: position?.id ?? null,
        thesisId: thesis.id,
        payload: position
          ? { side: position.side, sizeUsd: Number(position.sizeUsd), leverage: position.leverage, entryPx: Number(position.entryPx), size: Number(position.size), text }
          : { text },
      },
    });
    return thesis;
  });
}
