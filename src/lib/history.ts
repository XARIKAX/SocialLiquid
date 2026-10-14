import { createHash } from "node:crypto";
import { prisma } from "./db";
import * as HL from "./hl";
import type { HlFill } from "./hl-types";

const MAX_PAGES = 5;
const d = (n: number | string) => Number(n).toFixed(10);
const isLiq = (f: HlFill) => /liquidat/i.test(f.dir);

/** every fill the exchange still has for an address (its last 10000 at most), oldest first, no duplicates */
export async function fetchFillHistory(address: string): Promise<{ fills: HlFill[]; pages: number }> {
  const seen = new Set<number>();
  const fills: HlFill[] = [];
  let start = 0;
  let pages = 0;
  while (pages < MAX_PAGES) {
    const page = await HL.userFillsRange(address, start);
    pages++;
    let added = 0;
    for (const f of page) {
      if (seen.has(f.tid)) continue;
      seen.add(f.tid);
      fills.push(f);
      added++;
    }
    if (page.length < 2000 || added === 0) break;
    start = page[page.length - 1].time + 1;
  }
  fills.sort((a, b) => a.time - b.time || a.tid - b.tid);
  return { fills, pages };
}

export type BuiltPosition = { coin: string; side: "LONG" | "SHORT"; size: number; sizeUsd: number; entryPx: number; openedAt: number; closedAt: number | null; closePx: number | null; realisedPnl: number; liquidated: boolean; fills: number };

type Acc = { side: "LONG" | "SHORT"; openedAt: number; entryNotional: number; entrySz: number; maxSize: number; closeNotional: number; closeSz: number; pnl: number; liq: boolean; fills: number };

/**
 * walk fills oldest → newest and cut them into positions: a position starts when the coin goes from flat (or flips),
 * grows on adds, and ends when it is flat again. pnl is the exchange's closedPnl per fill, so fees and funding match hyperliquid's own numbers.
 */
export function positionsFromFills(fills: HlFill[]): { closed: BuiltPosition[]; open: BuiltPosition[] } {
  const acc = new Map<string, Acc>();
  const closed: BuiltPosition[] = [];
  const finish = (coin: string, a: Acc, closedAt: number | null): BuiltPosition => ({
    coin,
    side: a.side,
    size: a.maxSize,
    sizeUsd: a.entrySz > 0 ? (a.maxSize * a.entryNotional) / a.entrySz : 0,
    entryPx: a.entrySz > 0 ? a.entryNotional / a.entrySz : 0,
    openedAt: a.openedAt,
    closedAt,
    closePx: a.closeSz > 0 ? a.closeNotional / a.closeSz : null,
    realisedPnl: a.pnl,
    liquidated: a.liq,
    fills: a.fills,
  });
  const openAcc = (side: "LONG" | "SHORT", sz: number, px: number, t: number): Acc => ({ side, openedAt: t, entryNotional: sz * px, entrySz: sz, maxSize: sz, closeNotional: 0, closeSz: 0, pnl: 0, liq: false, fills: 1 });
  for (const f of [...fills].sort((a, b) => a.time - b.time || a.tid - b.tid)) {
    const sz = Number(f.sz);
    const px = Number(f.px);
    if (!(sz > 0) || !(px > 0)) continue;
    const start = Number(f.startPosition);
    const delta = f.side === "B" ? sz : -sz;
    const end = start + delta;
    const cur = acc.get(f.coin);
    const sideOf = (n: number): "LONG" | "SHORT" => (n > 0 ? "LONG" : "SHORT");
    const flat = Math.abs(end) < 1e-9;
    if (Math.abs(start) < 1e-9) {
      // flat → position
      if (cur) closed.push(finish(f.coin, cur, f.time));
      acc.set(f.coin, openAcc(sideOf(end), sz, px, f.time));
      continue;
    }
    if (!cur) {
      // first fill we see is mid-position: start an accumulator from what the fill tells us
      acc.set(f.coin, { ...openAcc(sideOf(start), Math.abs(start), px, f.time), fills: 0 });
    }
    const a = acc.get(f.coin)!;
    a.fills++;
    const sameSide = Math.sign(start) === Math.sign(end);
    if (!flat && sameSide && Math.abs(end) > Math.abs(start)) {
      a.entryNotional += sz * px;
      a.entrySz += sz;
      a.maxSize = Math.max(a.maxSize, Math.abs(end));
      continue;
    }
    // reducing, closing or flipping
    const closedSz = Math.min(Math.abs(start), sz);
    a.closeNotional += closedSz * px;
    a.closeSz += closedSz;
    a.pnl += Number(f.closedPnl);
    if (isLiq(f)) a.liq = true;
    if (flat) {
      closed.push(finish(f.coin, a, f.time));
      acc.delete(f.coin);
    } else if (!sameSide) {
      closed.push(finish(f.coin, a, f.time));
      acc.set(f.coin, openAcc(sideOf(end), Math.abs(end), px, f.time));
    }
  }
  const open = [...acc.entries()].map(([coin, a]) => finish(coin, a, null));
  return { closed, open };
}

const idFor = (address: string, p: BuiltPosition) => "hx" + createHash("sha1").update(`${address}|${p.coin}|${p.side}|${p.openedAt}`).digest("hex").slice(0, 22);

/**
 * first sight of an address: rebuild the positions it closed before we started watching, so win rate, trade count and
 * top trades reflect its real history instead of the two days we happened to be around. idempotent.
 */
export async function reconstructHistory(address: string, leverageByCoin: Map<string, number> = new Map()): Promise<{ inserted: number; fills: number; pages: number; openFixed: number }> {
  const { fills, pages } = await fetchFillHistory(address);
  if (!fills.length) return { inserted: 0, fills: 0, pages, openFixed: 0 };
  const { closed, open } = positionsFromFills(fills);
  // only history from before our own rows begin: anything later the live indexer already recorded
  const existing = await prisma.position.findMany({ where: { address }, select: { id: true, coin: true, side: true, openedAt: true, closedAt: true, reconstructed: true }, orderBy: { openedAt: "asc" } });
  const firstLive = existing.find((e) => !e.reconstructed)?.openedAt.getTime() ?? Number.POSITIVE_INFINITY;
  const rows = closed.filter((p) => p.closedAt !== null && p.closedAt < firstLive);
  const res = rows.length
    ? await prisma.position.createMany({
        data: rows.map((p) => ({
          id: idFor(address, p),
          address,
          coin: p.coin,
          side: p.side,
          size: d(p.size),
          sizeUsd: d(p.sizeUsd),
          leverage: leverageByCoin.get(p.coin) ?? 1,
          entryPx: d(p.entryPx),
          openedAt: new Date(p.openedAt),
          closedAt: new Date(p.closedAt!),
          closePx: p.closePx === null ? null : d(p.closePx),
          realisedPnl: d(p.realisedPnl),
          unrealisedPnl: d(0),
          liquidated: p.liquidated,
          reconstructed: true,
        })),
        skipDuplicates: true,
      })
    : { count: 0 };
  // a position that was already open when we first saw the wallet: give the live row its real open time and entry
  let openFixed = 0;
  for (const o of open) {
    const live = existing.find((e) => e.coin === o.coin && e.side === o.side && e.closedAt === null && !e.reconstructed);
    if (live && o.openedAt < live.openedAt.getTime()) {
      await prisma.position.update({ where: { id: live.id }, data: { openedAt: new Date(o.openedAt), ...(o.entryPx > 0 ? { entryPx: d(o.entryPx) } : {}) } });
      openFixed++;
    }
  }
  // the fill list on the profile should show history too
  await prisma.fill.createMany({
    data: fills.map((f) => ({ hlFillId: BigInt(f.tid), address, coin: f.coin, side: f.side, dir: f.dir, px: d(f.px), sz: d(f.sz), fee: d(f.fee), builderFee: f.builderFee !== undefined ? d(f.builderFee) : null, closedPnl: d(f.closedPnl), hash: f.hash, oid: BigInt(f.oid), liquidation: isLiq(f), time: new Date(f.time) })),
    skipDuplicates: true,
  });
  return { inserted: res.count, fills: fills.length, pages, openFixed };
}
