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
import { syncSpotHoldings } from "./spot-holdings";
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

const SPOT_SYNC_MS = 10 * 60_000;

export async function syncAddress(addressRaw: string, opts: { forceFills?: boolean } = {}): Promise<SyncResult> {
  const address = addressRaw.toLowerCase();
  let weight = HL.WEIGHT.clearinghouseState;
  const state = await HL.clearinghouseState(address);
  const chain = new Map<string, HlPosition>();
  for (const ap of state.assetPositions) {
    if (Number(ap.position.szi) !== 0) chain.set(ap.position.coin, ap.position);
  }

  const tracked = await prisma.trackedAddress.findUnique({ where: { address } });
  // spot holdings for holder lists: one extra call every 10 minutes per address, never on every poll
  if (tracked && (!tracked.spotSyncedAt || Date.now() - tracked.spotSyncedAt.getTime() > SPOT_SYNC_MS)) {
    try {
      await syncSpotHoldings(address);
      weight += HL.WEIGHT.clearinghouseState;
    } catch (e) {
      console.warn("[indexer] spot holdings failed", address.slice(0, 10), (e as Error).message);
    }
  }
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
        await tx.notification.create({ data: { userId: t.userId, type: "THESIS_SETTLED", coin: p.coin, thesisId: t.id, positionId: p.id, payload: { outcome, realisedPnl: realised, side: p.side, text: t.text.slice(0, 140) } } });
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

/** hyperliquid's leaderboard page hides vaults even though the feed lists them; check the top candidates and keep the first n real accounts */
export async function dropVaults(ranked: HlLeaderboardRow[], n: number): Promise<HlLeaderboardRow[]> {
  const out: HlLeaderboardRow[] = [];
  for (const r of ranked.slice(0, n * 4)) {
    if (out.length >= n) break;
    if (!(await HL.isVault(r.ethAddress))) out.push(r);
  }
  return out;
}

export const HL_WINDOWS = ["day", "week", "month", "allTime"] as const;
export type HlWindow = (typeof HL_WINDOWS)[number];

/**
 * the pool hyperliquid's leaderboard page can show: the top n eligible accounts of every window (24h, 7d, 30d, all time),
 * so switching windows ranks real leaders instead of re-sorting the 30d top. vaults are dropped (checked in parallel, cached).
 */
export async function hlLeaderboardPool(rows: HlLeaderboardRow[], n: number): Promise<HlLeaderboardRow[]> {
  const eligible = rows.filter(hlLeaderboardEligible);
  const picked = new Map<string, HlLeaderboardRow>();
  for (const w of HL_WINDOWS) {
    const ranked = [...eligible].sort((a, b) => HL.leaderboardPnl(b, w) - HL.leaderboardPnl(a, w));
    // take a little extra so vaults dropped below still leave n real accounts
    for (const r of ranked.slice(0, Math.ceil(n * 1.3))) picked.set(r.ethAddress.toLowerCase(), r);
  }
  const list = [...picked.values()];
  const flags: boolean[] = [];
  for (let i = 0; i < list.length; i += 8) flags.push(...(await Promise.all(list.slice(i, i + 8).map((r) => HL.isVault(r.ethAddress).catch(() => false)))));
  return list.filter((_, i) => !flags[i]);
}

/** same ordering as app.hyperliquid.xyz/leaderboard (30D, PnL desc) */
export function hlLeaderboardRanked(rows: HlLeaderboardRow[]): HlLeaderboardRow[] {
  return rows.filter(hlLeaderboardEligible).sort((a, b) => HL.leaderboardPnl(b, "month") - HL.leaderboardPnl(a, "month"));
}

export type HlBoardStatus = { lastError: string | null; lastSource: "leaderboard" | "portfolio" | null; lastAttemptAt: number };
const hlBoardStatus: HlBoardStatus = { lastError: null, lastSource: null, lastAttemptAt: 0 };
export function getHlBoardStatus(): HlBoardStatus {
  return { ...hlBoardStatus };
}

type BoardRow = {
  rank: number; address: string; displayName: string | null; accountValue: string; source: string;
  pnl30d: string; roi30d: string; vlm30d: string;
  pnl7d: string; roi7d: string; vlm7d: string;
  pnl1d: string; roi1d: string; vlm1d: string;
  pnlAll: string; roiAll: string; vlmAll: string;
};

/** rows ranked by 30d pnl (hyperliquid's default), every window stored */
function rowsFromLeaderboard(pool: HlLeaderboardRow[]): BoardRow[] {
  const perf = (r: HlLeaderboardRow, w: HlWindow) => r.windowPerformances.find(([k]) => k === w)?.[1] ?? { pnl: "0", roi: "0", vlm: "0" };
  const ranked = [...pool].sort((a, b) => HL.leaderboardPnl(b, "month") - HL.leaderboardPnl(a, "month"));
  return ranked.map((r, i) => {
    const m = perf(r, "month"), w = perf(r, "week"), d = perf(r, "day"), a = perf(r, "allTime");
    return {
      rank: i + 1, address: r.ethAddress.toLowerCase(), displayName: r.displayName, accountValue: r.accountValue, source: "leaderboard",
      pnl30d: m.pnl, roi30d: m.roi, vlm30d: m.vlm, pnl7d: w.pnl, roi7d: w.roi, vlm7d: w.vlm, pnl1d: d.pnl, roi1d: d.roi, vlm1d: d.vlm, pnlAll: a.pnl, roiAll: a.roi, vlmAll: a.vlm,
    };
  });
}

/**
 * rebuild the board for the featured traders from the portfolio api (the data hyperliquid's leaderboard is computed from).
 * pnl and volume are exact; roi is pnl / max(100, account value at the start of the window), which matches hyperliquid
 * unless the account deposited or withdrew during the window.
 */
async function rowsFromPortfolio(addresses: string[]): Promise<BoardRow[]> {
  const out: Omit<BoardRow, "rank">[] = [];
  for (const address of addresses) {
    try {
      const [p, st] = await Promise.all([HL.portfolio(address), HL.clearinghouseState(address)]);
      const last = (h: [number, string][]) => Number(h[h.length - 1]?.[1] ?? 0);
      const first = (h: [number, string][]) => Number(h[0]?.[1] ?? 0);
      const m = p.month;
      if (!m) continue;
      const win = (k: string) => {
        const x = p[k];
        if (!x) return { pnl: "0", roi: "0", vlm: "0" };
        const pnl = last(x.pnlHistory);
        return { pnl: String(pnl), roi: String(pnl / Math.max(100, first(x.accountValueHistory))), vlm: x.vlm };
      };
      const M = win("month"), W = win("week"), D = win("day"), A = win("allTime");
      out.push({
        address,
        displayName: null,
        accountValue: st.marginSummary.accountValue,
        source: "portfolio",
        pnl30d: M.pnl, roi30d: M.roi, vlm30d: M.vlm, pnl7d: W.pnl, roi7d: W.roi, vlm7d: W.vlm, pnl1d: D.pnl, roi1d: D.roi, vlm1d: D.vlm, pnlAll: A.pnl, roiAll: A.roi, vlmAll: A.vlm,
      });
    } catch (e) {
      console.warn(`[indexer] portfolio fetch failed for ${address.slice(0, 10)}:`, (e as Error).message);
    }
  }
  return out.sort((a, b) => Number(b.pnl30d) - Number(a.pnl30d)).map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * mirror the top N of hyperliquid's leaderboard (30D) into HlLeaderboardEntry and make sure they are tracked.
 * primary source is hyperliquid's leaderboard feed, stored verbatim. if that feed is unreachable (or
 * HL_LEADERBOARD_SOURCE=portfolio), the board is rebuilt for the featured traders from the portfolio api instead.
 * returns rows written, 0 if nothing could be fetched.
 */
export async function refreshHlLeaderboard(topN = 100): Promise<number> {
  hlBoardStatus.lastAttemptAt = Date.now();
  let rows: BoardRow[] = [];
  if (process.env.HL_LEADERBOARD_SOURCE !== "portfolio") {
    try {
      rows = rowsFromLeaderboard(await hlLeaderboardPool(await HL.leaderboardTop(topN), topN));
      if (!rows.length) throw new Error("leaderboard feed returned no eligible rows");
    } catch (e) {
      hlBoardStatus.lastError = `leaderboard feed: ${(e as Error).message}`;
      console.warn("[indexer] hl leaderboard feed failed, falling back to portfolio api:", (e as Error).message);
      rows = [];
    }
  }
  if (!rows.length) {
    rows = (await rowsFromPortfolio(featuredAddresses())).slice(0, topN);
    if (!rows.length) {
      hlBoardStatus.lastError = (hlBoardStatus.lastError ?? "") + " · portfolio api: no rows for the featured traders";
      return 0;
    }
  }
  const now = new Date();
  const data = rows.map((r) => ({ ...r, updatedAt: now }));
  await prisma.$transaction([prisma.hlLeaderboardEntry.deleteMany({}), prisma.hlLeaderboardEntry.createMany({ data })]);
  await prisma.trackedAddress.createMany({
    data: data.map((d) => ({ address: d.address, source: "DISCOVERED" as const, displayName: d.displayName })),
    skipDuplicates: true,
  });
  hlBoardStatus.lastSource = rows[0].source as "leaderboard" | "portfolio";
  if (hlBoardStatus.lastSource === "leaderboard") hlBoardStatus.lastError = null;
  return data.length;
}

export async function seedTrackedAddresses(count: number): Promise<number> {
  let rows: { address: string; displayName: string | null }[] = [];
  try {
    rows = hlLeaderboardRanked(await HL.leaderboardTop(count))
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
