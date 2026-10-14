import { prisma } from "./db";
import * as HL from "./hl";

const d = (n: number) => n.toFixed(10);

/** mirror an address's spot balances into SpotHolding, the table behind the Holders tab on spot markets */
export async function syncSpotHoldings(addressRaw: string): Promise<void> {
  const address = addressRaw.toLowerCase();
  const spot = (await HL.spotBalances(address)).filter((b) => b.coin !== "USDC" && b.total > 0);
  await prisma.$transaction([
    prisma.spotHolding.deleteMany({ where: { address, coin: { notIn: spot.map((b) => b.coin) } } }),
    ...spot.map((b) => prisma.spotHolding.upsert({ where: { address_coin: { address, coin: b.coin } }, create: { address, coin: b.coin, total: d(b.total) }, update: { total: d(b.total), updatedAt: new Date() } })),
    prisma.trackedAddress.updateMany({ where: { address }, data: { spotSyncedAt: new Date() } }),
  ]);
}

/** after one of our own users trades spot: refresh their row right away instead of waiting for the next indexer pass */
export function refreshSpotHoldingsSoon(address: string, delayMs = 1500) {
  setTimeout(() => void syncSpotHoldings(address).catch((e) => console.warn("[spot-holdings] refresh failed", address.slice(0, 10), (e as Error).message)), delayMs);
}
