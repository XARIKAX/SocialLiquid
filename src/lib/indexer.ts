/**
 * position / fill / feed indexer. shared by the worker (polling loop) and the trade route
 * (immediate sync after an order so a thesis can be bound to the position id).
 * positions and fills are mirrored from hyperliquid, never trusted from the client.
 */
import type { HlLeaderboardRow } from "./hl-types";
import { featuredAddresses } from "./featured";
import { Prisma, type FeedEventType, type ThesisOutcome } from "@prisma/client";
import { prisma } from "./db";
import * as HL from "./hl";
import type { HlFill, HlPosition } from "./hl-types";

const DUMP_WINDOW_MS = 60 * 60 * 1000;
const FILLS_REFRESH_MS = 10 * 60 * 1000;
const lastFillsFetch = new Map<string, number>();

export type SyncResult = { address: string; opened: number; closed: number; fills: number; weight: number };

function d(n: string | number): Prisma.Decimal {
  return new Prisma.Decimal(String(n));
}

function isLiqFill(f: HlFill) {
  return !!f.liquidation || /liquidat/i.test(f.dir);
}

function isCloseFill(f: HlFill) {
  return /close|>|liquidat/i.test(f.dir);
}

export async function syncAddress(addressRaw: string, opts: { forceFills?: boolean } = {}): Promise<SyncResult> {
  const address = addressRaw.toLowerCase();
  let weight = HL.WEIGHT.clearinghouseState;
  const state = await HL.clearinghouseState(address);
  const chain = new Map<string, HlPosition>();
  for (const ap of state.assetPositions) {
    if (Number(ap.position.szi) !== 0) chain.set(ap.position.coin, ap.position);
  }

  const tracked = await prisma.trackedAddress.findUnique({ where: { address } });
  const open = await prisma.position.findMany({ where: { address, closedAt: null } });
  const openByCoin = new Map(open.map((p) => [p.coin, p]));

  const toClose = open.filter((p) => {
    const c = chain.get(p.coin);
    return !c || HL.sideOf(c.szi) !== p.side;
  });
  const toOpen = [...chain.values()].filter((c) => {
    const p = openByCoin.get(c.coin);
    return !p || p.side !== HL.sideOf(c.szi);
  });

  const now = Date.now();
  const needFills =
    opts.forceFills ||
    toClose.length > 0 ||
    toOpen.length > 0 ||
    now - (lastFillsFetch.get(address) ?? 0) > FILLS_REFRESH_MS;

  let fills: HlFill[] = [];
  if (needFills) {
    weight += HL.WEIGHT.userFills;
    const since = tracked?.lastFillTime ? Number(tracked.lastFillTime) - 60_000 : undefined;
    // first time we see an address: pull recent history (api caps at 2000 fills) so closes have pnl context
    fills = await HL.userFills(address, since && since > 0 ? since : undefined);
    lastFillsFetch.set(address, now);
    if (fills.length) {
      await prisma.fill.createMany({
        data: fills.map((f) => ({
          hlFillId: BigInt(f.tid),
          address,
          coin: f.coin,
          side: f.side,
          dir: f.dir,
          px: d(f.px),
          sz: d(f.sz),
          fee: d(f.fee),
          builderFee: f.builderFee !== undefined ? d(f.builderFee) : null,
          closedPnl: d(f.closedPnl),
          hash: f.hash,
          oid: BigInt(f.oid),
          liquidation: isLiqFill(f),
          time: new Date(f.time),
        })),
        skipDuplicates: true,
      });
    }
  }
  const fillsAsc = [...fills].sort((a, b) => a.time - b.time);

  let closed = 0;
  for (const p of toClose) {
    const closeFills = fillsAsc.filter((f) => f.coin === p.coin && f.time >= p.openedAt.getTime() - 5_000 && isCloseFill(f));
    const last = closeFills.at(-1);
    const realised = closeFills.reduce((acc, f) => acc + Number(f.closedPnl), 0);
    const liquidated = closeFills.some(isLiqFill);
    const closedAt = last ? new Date(last.time) : new Date(now);
    const closePx = last ? d(last.px) : null;
    await prisma.$transaction(async (tx) => {
      await tx.position.update({
        where: { id: p.id },
        data: { closedAt, closePx, realisedPnl: d(realised), liquidated, unrealisedPnl: d(0) },
      });
      await tx.feedEvent.create({
        data: {
          type: (liquidated ? "LIQUIDATED" : "CLOSED") as FeedEventType,
          address,
          coin: p.coin,
          positionId: p.id,
          time: closedAt,
          payload: {
            side: p.side,
            sizeUsd: Number(p.sizeUsd),
            leverage: p.leverage,
            entryPx: Number(p.entryPx),
            closePx: closePx ? Number(closePx) : null,
            realisedPnl: realised,
            holdMs: closedAt.getTime() - p.openedAt.getTime(),
          },
        },
      });
      // receipts: a thesis bound to this position gets its outcome now
      const theses = await tx.thesis.findMany({ where: { positionId: p.id, outcome: "OPEN" } });
      for (const t of theses) {
        let outcome: ThesisOutcome;
        if (liquidated) outcome = "LIQUIDATED";
        else if (closedAt.getTime() - t.createdAt.getTime() < DUMP_WINDOW_MS) outcome = "DUMPED";
        else outcome = realised >= 0 ? "PROFIT" : "LOSS";
        await tx.thesis.update({ where: { id: t.id }, data: { outcome } });
      }
    });
    closed++;
  }

  let opened = 0;
  for (const c of toOpen) {
    const side = HL.sideOf(c.szi);
    const openFills = fillsAsc.filter((f) => f.coin === c.coin && /open|>/i.test(f.dir));
    // position opened at the first open fill after the last close fill for this coin
    const lastCloseIdx = fillsAsc.map((f) => f.coin === c.coin && /close|liquidat/i.test(f.dir) && !/>/.test(f.dir)).lastIndexOf(true);
    const first = openFills.find((f) => fillsAsc.indexOf(f) > lastCloseIdx);
    const openedAt = new Date(first?.time ?? now);
    const size = Math.abs(Number(c.szi));
    const pos = await prisma.position.create({
      data: {
        address,
        coin: c.coin,
        side,
        size: d(size),
        sizeUsd: d(Number(c.positionValue)),
        leverage: c.leverage.value,
        entryPx: d(c.entryPx),
        openedAt,
        unrealisedPnl: d(c.unrealizedPnl),
      },
    });
    await prisma.feedEvent.create({
      data: {
        type: side as FeedEventType,
        address,
        coin: c.coin,
        positionId: pos.id,
        time: openedAt,
        payload: {
          side,
          sizeUsd: Number(c.positionValue),
          size,
          leverage: c.leverage.value,
          entryPx: Number(c.entryPx),
          liquidationPx: c.liquidationPx ? Number(c.liquidationPx) : null,
        },
      },
    });
    opened++;
  }

  // refresh still-open positions (size changes, live unrealised pnl)
  for (const p of open) {
    if (toClose.includes(p)) continue;
    const c = chain.get(p.coin);
    if (!c) continue;
    await prisma.position.update({
      where: { id: p.id },
      data: {
        size: d(Math.abs(Number(c.szi))),
        sizeUsd: d(Number(c.positionValue)),
        entryPx: d(c.entryPx),
        leverage: c.leverage.value,
        unrealisedPnl: d(c.unrealizedPnl),
      },
    });
  }

  const maxFillTime = fills.reduce((m, f) => Math.max(m, f.time), Number(tracked?.lastFillTime ?? 0));
  await prisma.trackedAddress.upsert({
    where: { address },
    create: { address, source: "DISCOVERED", lastPolledAt: new Date(), lastFillTime: BigInt(maxFillTime) },
    update: { lastPolledAt: new Date(), lastFillTime: BigInt(maxFillTime) },
  });

  return { address, opened, closed, fills: fills.length, weight };
}

/** seed TrackedAddress with the top N leaderboard addresses (by weekly pnl) so the feed is live before we have users. */
/** hyperliquid's own leaderboard rule: hide accounts under 100k account value with under 10M 30d volume */
export function hlLeaderboardEligible(r: HlLeaderboardRow): boolean {
  const m = r.windowPerformances.find(([k]) => k === "month")?.[1];
  return Number(r.accountValue) >= 100_000 || Number(m?.vlm ?? 0) >= 10_000_000;
}

/** same ordering as app.hyperliquid.xyz/leaderboard (30D, PnL desc) */
export function hlLeaderboardRanked(rows: HlLeaderboardRow[]): HlLeaderboardRow[] {
  return rows.filter(hlLeaderboardEligible).sort((a, b) => HL.leaderboardPnl(b, "month") - HL.leaderboardPnl(a, "month"));
}

/**
 * mirror the top N of hyperliquid's leaderboard (30D) into HlLeaderboardEntry and make sure they are tracked.
 * figures are stored exactly as the stats endpoint reports them. returns rows written, 0 if the fetch failed.
 */
export async function refreshHlLeaderboard(topN = 10): Promise<number> {
  let ranked: HlLeaderboardRow[];
  try {
    ranked = hlLeaderboardRanked(await HL.leaderboard()).slice(0, topN);
  } catch (e) {
    console.warn("[indexer] hl leaderboard refresh failed:", (e as Error).message);
    return 0;
  }
  if (!ranked.length) return 0;
  const perf = (r: HlLeaderboardRow, w: "week" | "month") => r.windowPerformances.find(([k]) => k === w)?.[1] ?? { pnl: "0", roi: "0", vlm: "0" };
  const now = new Date();
  const data = ranked.map((r, i) => {
    const m = perf(r, "month");
    return {
      rank: i + 1,
      address: r.ethAddress.toLowerCase(),
      displayName: r.displayName,
      accountValue: r.accountValue,
      pnl30d: m.pnl,
      roi30d: m.roi,
      vlm30d: m.vlm,
      pnl7d: perf(r, "week").pnl,
      updatedAt: now,
    };
  });
  await prisma.$transaction([prisma.hlLeaderboardEntry.deleteMany({}), prisma.hlLeaderboardEntry.createMany({ data })]);
  await prisma.trackedAddress.createMany({
    data: data.map((d) => ({ address: d.address, source: "DISCOVERED" as const, displayName: d.displayName })),
    skipDuplicates: true,
  });
  return data.length;
}

export async function seedTrackedAddresses(count: number): Promise<number> {
  let rows: { address: string; displayName: string | null }[] = [];
  try {
    rows = hlLeaderboardRanked(await HL.leaderboard())
      .slice(0, count)
      .map((r) => ({ address: r.ethAddress.toLowerCase(), displayName: r.displayName }));
  } catch (e) {
    console.warn("[indexer] leaderboard fetch failed, falling back to SEED_ADDRESSES:", (e as Error).message);
  }
  if (rows.length === 0 && process.env.SEED_ADDRESSES) {
    rows = process.env.SEED_ADDRESSES.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[0-9a-f]{40}$/.test(s))
      .map((address) => ({ address, displayName: null }));
  }
  if (rows.length === 0) return 0;
  const res = await prisma.trackedAddress.createMany({
    data: rows.map((r) => ({ address: r.address, source: "DISCOVERED" as const, displayName: r.displayName })),
    skipDuplicates: true,
  });
  return res.count;
}

/** featured traders (lib/featured.ts + PINNED_ADDRESSES) are always tracked as MANUAL, which polls ahead of DISCOVERED */
export async function trackFeatured(): Promise<number> {
  const addrs = featuredAddresses();
  if (!addrs.length) return 0;
  const res = await prisma.trackedAddress.createMany({
    data: addrs.map((address) => ({ address, source: "MANUAL" as const })),
    skipDuplicates: true,
  });
  await prisma.trackedAddress.updateMany({ where: { address: { in: addrs }, source: "DISCOVERED" }, data: { source: "MANUAL" } });
  return res.count;
}

/** every registered user is tracked with source USER */
export async function trackUsers(): Promise<number> {
  const users = await prisma.user.findMany({ select: { address: true } });
  if (!users.length) return 0;
  const res = await prisma.trackedAddress.createMany({
    data: users.map((u) => ({ address: u.address, source: "USER" as const })),
    skipDuplicates: true,
  });
  await prisma.trackedAddress.updateMany({
    where: { address: { in: users.map((u) => u.address) }, source: { not: "USER" } },
    data: { source: "USER" },
  });
  return res.count;
}
