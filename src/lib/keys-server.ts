/**
 * live data for the keys section, in the shapes of keys-model.ts. traders come from the indexer (positions,
 * fills, follows), subscriptions and posts from their tables, and keys from the KeyTrade / KeyClaim rows the
 * worker indexes off the contract. subscriber posts are gated here, on the server: a locked post leaves without
 * its text.
 */
import type { CreatorPost } from "@prisma/client";
import { prisma } from "./db";
import { shortAddr, timeAgo } from "./format";
import { portfolio } from "./hl";
import { keyPrice, type Cadence, type OfferKey, type PostKind } from "./keys";
import { readPending } from "./keys-chain";
import type { KeysCall, KeysFeedPost, KeysHolding, KeysIndex, KeysMe, KeysPlatform, KeysStudio, KeysSub, KeysTrader } from "./keys-model";
import { traderStatsBulk } from "./queries";

const DAY = 86_400_000;
const lower = (a: string) => a.toLowerCase();
const num = (v: unknown) => Number(v ?? 0);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
export const ago = (d: Date) => (Date.now() - d.getTime() < 60_000 ? "just now" : `${timeAgo(d)} ago`);
const dayMonth = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthShort = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

/* ---------- faces ---------- */

const PALETTE: [string, string][] = [
  ["#0e8f75", "#163e6e"],
  ["#3d5fcf", "#0e7f69"],
  ["#b0466e", "#3a2a7a"],
  ["#c08322", "#7a2f3a"],
  ["#16a88c", "#2c4fa8"],
  ["#6a4bd0", "#1d7d8c"],
  ["#d0644b", "#5a2a6e"],
  ["#2a8fd0", "#16a070"],
];
/** a stable avatar gradient per address */
export const colorsFor = (address: string): [string, string] => PALETTE[parseInt(address.slice(2, 10), 16) % PALETTE.length];
export const initialsOf = (handle: string) => (handle.replace(/^0x/, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2) || "SL").toUpperCase();

/* ---------- keys ---------- */

type KeyStat = { minted: number; holders: number; price: number; change24h: number; history: number[]; raised: number; yieldPct: number };

/** supply, holders, a 30-day price line and the fee yield of each trader's key, from the indexed trades */
async function keyStats(addrs: string[]): Promise<Map<string, KeyStat>> {
  const out = new Map<string, KeyStat>();
  if (!addrs.length) return out;
  const now = Date.now();
  const since = new Date(now - 30 * DAY);
  const [last, before, recent, holders, raised, fees] = await Promise.all([
    prisma.$queryRaw<{ trader: string; supply: number }[]>`SELECT DISTINCT ON (trader) trader, supply FROM "KeyTrade" WHERE trader = ANY(${addrs}) ORDER BY trader, "blockNumber" DESC, "logIndex" DESC`,
    prisma.$queryRaw<{ trader: string; supply: number }[]>`SELECT DISTINCT ON (trader) trader, supply FROM "KeyTrade" WHERE trader = ANY(${addrs}) AND time < ${since} ORDER BY trader, "blockNumber" DESC, "logIndex" DESC`,
    prisma.keyTrade.findMany({ where: { trader: { in: addrs }, time: { gte: since } }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }], select: { trader: true, supply: true, time: true } }),
    prisma.$queryRaw<{ trader: string; n: bigint }[]>`SELECT trader, COUNT(*) AS n FROM (SELECT trader, account FROM "KeyTrade" WHERE trader = ANY(${addrs}) GROUP BY trader, account HAVING SUM(CASE WHEN "isBuy" THEN amount ELSE -amount END) > 0) h GROUP BY trader`,
    prisma.keyTrade.groupBy({ by: ["trader"], where: { trader: { in: addrs }, isBuy: true }, _sum: { traderCutUsd: true } }),
    prisma.keyFeeAccrual.groupBy({ by: ["traderAddress"], where: { traderAddress: { in: addrs }, periodStart: { gte: since }, holderStatus: { in: ["pending", "deposited"] } }, _sum: { holderShareUsd: true } }),
  ]);
  const lastBy = new Map(last.map((r) => [r.trader, Number(r.supply)]));
  const beforeBy = new Map(before.map((r) => [r.trader, Number(r.supply)]));
  const holdersBy = new Map(holders.map((r) => [r.trader, Number(r.n)]));
  const raisedBy = new Map(raised.map((r) => [r.trader, num(r._sum.traderCutUsd)]));
  const feesBy = new Map(fees.map((r) => [r.traderAddress, num(r._sum.holderShareUsd)]));
  const recentBy = new Map<string, { supply: number; time: Date }[]>();
  for (const r of recent) (recentBy.get(r.trader) ?? recentBy.set(r.trader, []).get(r.trader)!).push(r);
  for (const a of addrs) {
    const trades = recentBy.get(a) ?? [];
    const supplyAt = (t: number) => {
      let s = beforeBy.get(a) ?? 0;
      for (const x of trades) if (x.time.getTime() <= t) s = x.supply;
      return s;
    };
    const minted = lastBy.get(a) ?? 0;
    const price = keyPrice(minted);
    const history = Array.from({ length: 30 }, (_, i) => keyPrice(supplyAt(now - (29 - i) * DAY)));
    history[29] = price;
    const dayAgo = keyPrice(supplyAt(now - DAY));
    const yearly = (feesBy.get(a) ?? 0) * (365 / 30);
    out.set(a, {
      minted,
      price,
      holders: holdersBy.get(a) ?? 0,
      change24h: round(((price - dayAgo) / dayAgo) * 100),
      history,
      raised: raisedBy.get(a) ?? 0,
      yieldPct: minted > 0 ? round((yearly / (minted * price)) * 100) : 0,
    });
  }
  return out;
}

/* ---------- traders ---------- */

/** trader views for a set of addresses, creators or not, in the order given */
export async function buildTraders(addresses: string[]): Promise<KeysTrader[]> {
  const addrs = [...new Set(addresses.map(lower))];
  if (!addrs.length) return [];
  const now = new Date();
  const users = await prisma.user.findMany({ where: { address: { in: addrs } }, include: { creator: true } });
  const userBy = new Map(users.map((u) => [u.address, u]));
  const creatorIds = users.flatMap((u) => (u.creator ? [u.creator.id] : []));
  const [stats, keys, open, mix, followers, subs] = await Promise.all([
    traderStatsBulk(addrs),
    keyStats(addrs),
    prisma.position.findMany({ where: { address: { in: addrs }, closedAt: null }, orderBy: { sizeUsd: "desc" } }),
    prisma.position.groupBy({ by: ["address", "coin"], where: { address: { in: addrs } }, _count: { _all: true }, _min: { openedAt: true } }),
    prisma.follow.groupBy({ by: ["followingId"], where: { followingId: { in: users.map((u) => u.id) } }, _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ["creatorId"], where: { creatorId: { in: creatorIds }, paidUntil: { gt: now } }, _count: { _all: true } }),
  ]);
  const top = new Map<string, (typeof open)[number]>();
  for (const p of open) if (!top.has(p.address)) top.set(p.address, p);
  const copies = top.size
    ? await prisma.position.groupBy({ by: ["copiedFromPositionId"], where: { copiedFromPositionId: { in: [...top.values()].map((p) => p.id) } }, _count: { _all: true } })
    : [];
  const copiesBy = new Map(copies.map((c) => [c.copiedFromPositionId!, c._count._all]));
  const followersBy = new Map(followers.map((f) => [f.followingId, f._count._all]));
  const subsBy = new Map(subs.map((s) => [s.creatorId, s._count._all]));
  const mixBy = new Map<string, { coin: string; n: number; first: Date | null }[]>();
  for (const m of mix) (mixBy.get(m.address) ?? mixBy.set(m.address, []).get(m.address)!).push({ coin: m.coin, n: m._count._all, first: m._min.openedAt });

  return addrs.map((a) => {
    const u = userBy.get(a);
    const c = u?.creator ?? null;
    const st = stats.get(a);
    const k = keys.get(a)!;
    const coins = (mixBy.get(a) ?? []).sort((x, y) => y.n - x.n);
    const firsts = coins.map((x) => x.first?.getTime() ?? Infinity);
    const first = Math.min(...firsts, u?.createdAt.getTime() ?? Infinity);
    const handle = u?.claimedAt && u.handle ? u.handle : a;
    const p = top.get(a);
    const size = p ? num(p.size) : 0;
    const entry = p ? num(p.entryPx) : 0;
    const pnl = p ? num(p.unrealisedPnl) : 0;
    const mark = p && size > 0 ? entry + (p.side === "LONG" ? pnl / size : -pnl / size) : entry;
    const style = (u?.claimedAt && u.style) || (coins.length ? `${coins.slice(0, 2).map((x) => x.coin).join(" and ")} on Hyperliquid` : "Trader on Hyperliquid");
    return {
      handle,
      address: a,
      initials: initialsOf(handle),
      colors: colorsFor(a),
      avatarUrl: u?.claimedAt ? u.avatarUrl : null,
      style,
      bio: (u?.claimedAt && u.bio) || "",
      wallet: shortAddr(a),
      since: Number.isFinite(first) ? String(new Date(first).getUTCFullYear()) : String(now.getUTCFullYear()),
      followers: u ? (followersBy.get(u.id) ?? 0) : 0,
      pnl30d: st?.pnl30d ?? 0,
      pnlAllTime: st?.pnlAll ?? 0,
      winRate: st?.winRate !== null && st?.winRate !== undefined ? Math.round(st.winRate * 100) : null,
      maxDrawdown: null,
      live: p
        ? { id: p.id, side: p.side === "SHORT" ? "SHORT" : "LONG", coin: p.coin, leverage: p.leverage, size: num(p.sizeUsd), entry, mark, liq: null, pnl, opened: ago(p.openedAt), copiers: copiesBy.get(p.id) ?? 0 }
        : null,
      key: { listed: !!c?.keysListed, price: k.price, change24h: k.change24h, holders: k.holders, minted: k.minted, yieldPct: k.yieldPct, history: k.history },
      sub: {
        price: c ? num(c.priceUsd) : 0,
        subscribers: c ? (subsBy.get(c.id) ?? 0) : 0,
        renewRate: null,
        cadence: (c?.cadence ?? "whenever") as Cadence,
        leadTime: null,
        offers: (c?.offers ?? []) as OfferKey[],
        pinned: c?.pinned || (u?.claimedAt && u.bio) || "",
      },
      calls: [],
    } satisfies KeysTrader;
  });
}

/** creators first by what people have put behind them: key value, then subscribers, then followers */
const rank = (t: KeysTrader) => t.key.minted * t.key.price * 10 + t.sub.subscribers * Math.max(t.sub.price, 1) + t.followers;

/* ---------- access ---------- */

/** the creators whose subscriber posts `viewerId` may read: their own, free feeds, and paid-up subscriptions */
async function unlockedFor(viewerId: string | null, creators: { id: string; userId: string; priceUsd: unknown }[]): Promise<Set<string>> {
  const open = new Set(creators.filter((c) => num(c.priceUsd) === 0 || c.userId === viewerId).map((c) => c.id));
  if (!viewerId) return open;
  const subs = await prisma.subscription.findMany({ where: { subscriberId: viewerId, creatorId: { in: creators.map((c) => c.id) }, paidUntil: { gt: new Date() } }, select: { creatorId: true } });
  for (const s of subs) open.add(s.creatorId);
  return open;
}

async function toCalls(posts: CreatorPost[], unlocked: Set<string>): Promise<KeysCall[]> {
  const ids = posts.flatMap((p) => (p.positionId ? [p.positionId] : []));
  const positions = ids.length ? await prisma.position.findMany({ where: { id: { in: ids } } }) : [];
  const posBy = new Map(positions.map((p) => [p.id, p]));
  return posts.map((p) => {
    const open = unlocked.has(p.creatorId) || !p.subscribersOnly;
    const pos = p.positionId ? posBy.get(p.positionId) : undefined;
    return {
      id: p.id,
      kind: p.kind as PostKind,
      when: ago(p.createdAt),
      text: open ? p.text : "",
      locked: !open,
      coin: open ? p.coin : null,
      position: open && pos ? { label: `${pos.side} ${pos.coin} ${pos.leverage}x`, pnl: pos.closedAt ? num(pos.realisedPnl) : num(pos.unrealisedPnl), open: !pos.closedAt } : undefined,
    };
  });
}

/* ---------- index ---------- */

export async function keysIndex(viewerId: string | null): Promise<KeysIndex> {
  const creators = await prisma.creator.findMany({ where: { active: true, user: { claimedAt: { not: null }, handle: { not: null } } }, select: { id: true, userId: true, priceUsd: true, user: { select: { address: true, handle: true } } }, take: 300 });
  const traders = (await buildTraders(creators.map((c) => c.user.address))).sort((a, b) => rank(b) - rank(a));
  const posts = creators.length ? await prisma.creatorPost.findMany({ where: { creatorId: { in: creators.map((c) => c.id) } }, orderBy: { createdAt: "desc" }, take: 12 }) : [];
  const unlocked = await unlockedFor(viewerId, creators);
  const calls = await toCalls(posts, unlocked);
  const handleOf = new Map(creators.map((c) => [c.id, c.user.handle!]));
  const posIds = posts.flatMap((p) => (p.positionId ? [p.positionId] : []));
  const copied = posIds.length ? await prisma.position.groupBy({ by: ["copiedFromPositionId"], where: { copiedFromPositionId: { in: posIds } }, _count: { _all: true } }) : [];
  const copiedBy = new Map(copied.map((c) => [c.copiedFromPositionId!, c._count._all]));
  const feed: KeysFeedPost[] = posts.map((p, i) => ({ id: p.id, handle: handleOf.get(p.creatorId)!, when: calls[i].when, text: calls[i].text, locked: !!calls[i].locked, kind: calls[i].kind, copied: p.positionId ? (copiedBy.get(p.positionId) ?? 0) : 0 }));
  return { traders, feed, platform: await platformStats(traders) };
}

async function platformStats(traders: KeysTrader[]): Promise<KeysPlatform> {
  const since = new Date(Date.now() - 30 * DAY);
  const [tracked, subPaid, cuts, feePaid, routed, holders30, reserve] = await Promise.all([
    prisma.trackedAddress.count(),
    prisma.paymentIntent.aggregate({ where: { usedAt: { not: null } }, _sum: { amountCreator: true } }),
    prisma.keyTrade.aggregate({ where: { isBuy: true }, _sum: { traderCutUsd: true } }),
    prisma.keyFeeAccrual.aggregate({ where: { creatorStatus: "paid" }, _sum: { creatorShareUsd: true } }),
    prisma.position.aggregate({ where: { copiedFromAddress: { not: null } }, _sum: { sizeUsd: true } }),
    prisma.keyFeeAccrual.aggregate({ where: { holderStatus: "deposited", periodStart: { gte: since } }, _sum: { holderShareUsd: true } }),
    prisma.$queryRaw<{ r: unknown }[]>`SELECT COALESCE(SUM(CASE WHEN "isBuy" THEN "curveUsd" - "traderCutUsd" ELSE -"curveUsd" END), 0) AS r FROM "KeyTrade"`,
  ]);
  const withKeys = traders.filter((t) => t.key.minted > 0);
  return {
    live: traders.filter((t) => t.live).length,
    traders: tracked,
    paidToCreators: num(subPaid._sum.amountCreator) + num(cuts._sum.traderCutUsd) + num(feePaid._sum.creatorShareUsd),
    routed: num(routed._sum.sizeUsd),
    paidToHolders30d: num(holders30._sum.holderShareUsd),
    heldInKeys: num(reserve[0]?.r),
    avgYield: withKeys.length ? round(withKeys.reduce((a, t) => a + t.key.yieldPct, 0) / withKeys.length) : 0,
  };
}

/* ---------- one trader ---------- */

const pfCache = new Map<string, { at: number; v: { pnl30d: number; pnlAll: number; maxDrawdown: number | null } | null }>();

/** 30-day and all-time pnl and the worst peak-to-trough fall, from hyperliquid's own portfolio history */
async function record(address: string) {
  const hit = pfCache.get(address);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.v;
  let v: { pnl30d: number; pnlAll: number; maxDrawdown: number | null } | null = null;
  try {
    const pf = await portfolio(address);
    const all = pf.allTime;
    const month = pf.month;
    const lastPnl = (w?: { pnlHistory: [number, string][] }) => (w?.pnlHistory.length ? Number(w.pnlHistory[w.pnlHistory.length - 1][1]) - Number(w.pnlHistory[0][1]) : 0);
    let dd: number | null = null;
    if (all?.pnlHistory.length && all.accountValueHistory.length === all.pnlHistory.length) {
      let peak = -Infinity;
      let peakValue = 0;
      dd = 0;
      for (let i = 0; i < all.pnlHistory.length; i++) {
        const p = Number(all.pnlHistory[i][1]);
        if (p > peak) {
          peak = p;
          peakValue = Number(all.accountValueHistory[i][1]);
        }
        if (peakValue > 0) dd = Math.min(dd, (p - peak) / peakValue);
      }
      dd = Math.round(dd * 100);
    }
    v = { pnl30d: lastPnl(month), pnlAll: all?.pnlHistory.length ? Number(all.pnlHistory[all.pnlHistory.length - 1][1]) : 0, maxDrawdown: dd };
  } catch {
    v = null;
  }
  pfCache.set(address, { at: Date.now(), v });
  return v;
}

/** how far ahead of the entry this trader's calls usually land: each call on a coin against the next position they opened on it */
function leadTime(posts: CreatorPost[], positions: { coin: string; openedAt: Date }[]): string | null {
  const leads: number[] = [];
  for (const p of posts) {
    if (p.kind !== "call" || !p.coin) continue;
    const t = p.createdAt.getTime();
    const next = positions.find((x) => x.coin === p.coin && x.openedAt.getTime() >= t && x.openedAt.getTime() - t <= DAY);
    if (next) leads.push(next.openedAt.getTime() - t);
  }
  if (leads.length < 3) return null;
  const m = leads.sort((a, b) => a - b)[Math.floor(leads.length / 2)];
  if (m < 5 * 60_000) return "minutes before entry";
  if (m < 60 * 60_000) return `about ${Math.round(m / 60_000)}m before entry`;
  return `about ${Math.round(m / 3_600_000)}h before entry`;
}

/** a trader's page: the record, the subscription with its posts gated for this viewer, and the key */
export async function keysTrader(handleOrAddress: string, viewerId: string | null): Promise<KeysTrader | null> {
  const s = decodeURIComponent(handleOrAddress);
  const user = /^0x[0-9a-fA-F]{40}$/.test(s)
    ? await prisma.user.findUnique({ where: { address: lower(s) }, include: { creator: true } })
    : await prisma.user.findFirst({ where: { handle: { equals: s, mode: "insensitive" }, claimedAt: { not: null } }, include: { creator: true } });
  const address = user?.address ?? (/^0x[0-9a-fA-F]{40}$/.test(s) ? lower(s) : null);
  if (!address) return null;
  // only creators have a page, plus any address with a key in circulation so its holders can still find it
  if (!user?.creator && !(await prisma.keyTrade.findFirst({ where: { trader: address }, select: { id: true } }))) return null;
  const [t] = await buildTraders([address]);
  const c = user?.creator;
  if (c) {
    const since90 = new Date(Date.now() - 90 * DAY);
    const [posts, unlocked, recentPositions, eligible] = await Promise.all([
      prisma.creatorPost.findMany({ where: { creatorId: c.id }, orderBy: { createdAt: "desc" }, take: 30 }),
      unlockedFor(viewerId, [c]),
      prisma.position.findMany({ where: { address, openedAt: { gte: since90 } }, select: { coin: true, openedAt: true }, orderBy: { openedAt: "asc" } }),
      prisma.subscription.findMany({ where: { creatorId: c.id, createdAt: { lt: new Date(Date.now() - 30 * DAY) } }, select: { paidUntil: true } }),
    ]);
    t.calls = await toCalls(posts, unlocked);
    t.sub.leadTime = leadTime(posts.filter((p) => p.createdAt >= since90), recentPositions);
    if (eligible.length >= 5) t.sub.renewRate = Math.round((eligible.filter((e) => e.paidUntil > new Date()).length / eligible.length) * 100);
  }
  const r = await record(address);
  if (r) {
    t.pnl30d = r.pnl30d;
    t.pnlAllTime = r.pnlAll;
    t.maxDrawdown = r.maxDrawdown;
  }
  return t;
}

/* ---------- the viewer ---------- */

export const DEFAULT_SETTINGS = { price: 29, offers: ["calls", "alerts"] as OfferKey[], cadence: "regular" as Cadence, pinned: "", saved: false };

export async function keysMe(userId: string): Promise<KeysMe | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { creator: true } });
  if (!user) return null;
  const me = user.address;
  const now = new Date();
  const [stats, followers, subs, trades, claims] = await Promise.all([
    traderStatsBulk([me]),
    prisma.follow.count({ where: { followingId: user.id } }),
    prisma.subscription.findMany({ where: { subscriberId: user.id, paidUntil: { gt: now } }, include: { creator: { select: { id: true, user: { select: { address: true } } } } } }),
    prisma.keyTrade.findMany({ where: { account: me }, orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] }),
    prisma.keyClaim.findMany({ where: { holder: me }, orderBy: { time: "desc" } }),
  ]);

  // cost basis: a running average over buys; a sale takes keys out at the average, leaving it unchanged
  const pos = new Map<string, { qty: number; avgCost: number }>();
  for (const t of trades) {
    const h = pos.get(t.trader) ?? { qty: 0, avgCost: 0 };
    if (t.isBuy) {
      const paid = num(t.curveUsd) + num(t.feeUsd);
      h.avgCost = (h.qty * h.avgCost + paid) / (h.qty + t.amount);
      h.qty += t.amount;
    } else {
      h.qty = Math.max(0, h.qty - t.amount);
      if (h.qty === 0) h.avgCost = 0;
    }
    pos.set(t.trader, h);
  }
  const everHeld = [...pos.keys()];
  const pending = (await readPending(me, everHeld)) ?? new Map<string, number>();
  const claimedBy = new Map<string, number>();
  for (const c of claims) claimedBy.set(c.trader, (claimedBy.get(c.trader) ?? 0) + num(c.amountUsd));

  const subAddrs = subs.map((s) => s.creator.user.address);
  const traders = await buildTraders([...everHeld, ...subAddrs]);
  const handleOf = new Map(traders.map((t) => [t.address!, t.handle]));

  const keys: Record<string, KeysHolding> = {};
  for (const [a, h] of pos) if (h.qty > 0) keys[handleOf.get(a) ?? a] = { qty: h.qty, avgCost: h.avgCost, earned: (claimedBy.get(a) ?? 0) + (pending.get(a) ?? 0) };

  const unread = subs.length
    ? await Promise.all(subs.map((s) => prisma.creatorPost.count({ where: { creatorId: s.creator.id, createdAt: { gt: s.readAt } } })))
    : [];
  const subsOut: Record<string, KeysSub> = {};
  subs.forEach((s, i) => {
    subsOut[handleOf.get(s.creator.user.address) ?? s.creator.user.address] = { since: monthShort(s.createdAt), renews: dayMonth(s.paidUntil), unread: unread[i], cancelled: !!s.cancelledAt, paidUntil: s.paidUntil.toISOString() };
  });

  const handle = user.handle ?? shortAddr(me);
  const c = user.creator;
  return {
    viewer: { handle, initials: initialsOf(handle), colors: colorsFor(me), avatarUrl: user.avatarUrl, address: me, followers, pnl30dPct: null, pnl30d: stats.get(me)?.pnl30d ?? 0 },
    keys,
    subs: subsOut,
    claimable: [...pending.values()].reduce((a, b) => a + b, 0),
    claimFrom: [...pending.entries()].filter(([, v]) => v > 0).map(([k]) => k),
    payouts: claims.slice(0, 8).map((c) => ({ from: handleOf.get(c.trader) ?? shortAddr(c.trader), when: ago(c.time), amount: num(c.amountUsd) })),
    studio: await studioFor(user.address, c?.id ?? null, !!c?.keysListed),
    settings: c ? { price: num(c.priceUsd), offers: c.offers as OfferKey[], cadence: c.cadence as Cadence, pinned: c.pinned ?? "", saved: true } : DEFAULT_SETTINGS,
    traders,
  };
}

/** a creator's own numbers: key stats, this month's earnings and the last six months by source */
async function studioFor(address: string, creatorId: string | null, listed: boolean): Promise<KeysStudio> {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)));
  const start = months[0];
  const [k, payments, cuts, fees, subscribers, positions] = await Promise.all([
    keyStats([address]),
    creatorId ? prisma.subscriptionPayment.findMany({ where: { subscription: { creatorId }, createdAt: { gte: start } }, select: { createdAt: true, intent: { select: { amountCreator: true } } } }) : [],
    prisma.keyTrade.findMany({ where: { trader: address, isBuy: true, time: { gte: start } }, select: { time: true, traderCutUsd: true } }),
    prisma.keyFeeAccrual.findMany({ where: { traderAddress: address, periodStart: { gte: start }, creatorStatus: { not: "skipped" } }, select: { periodStart: true, creatorShareUsd: true } }),
    creatorId ? prisma.subscription.count({ where: { creatorId, paidUntil: { gt: now } } }) : 0,
    prisma.position.findMany({ where: { address, OR: [{ closedAt: null }, { closedAt: { gt: new Date(now.getTime() - 7 * DAY) } }] }, orderBy: { openedAt: "desc" }, take: 12, select: { id: true, side: true, coin: true, leverage: true, closedAt: true } }),
  ]);
  const idx = (d: Date) => (d.getUTCFullYear() - start.getUTCFullYear()) * 12 + d.getUTCMonth() - start.getUTCMonth();
  const rows = months.map((m) => ({ month: monthShort(m), sub: 0, key: 0, fee: 0 }));
  for (const p of payments) rows[idx(p.createdAt)] && (rows[idx(p.createdAt)].sub += num(p.intent.amountCreator));
  for (const c of cuts) rows[idx(c.time)] && (rows[idx(c.time)].key += num(c.traderCutUsd));
  for (const f of fees) rows[idx(f.periodStart)] && (rows[idx(f.periodStart)].fee += num(f.creatorShareUsd));
  const ks = k.get(address)!;
  const cur = rows[rows.length - 1];
  return { key: { price: ks.price, holders: ks.holders, raised: ks.raised }, earnedThisMonth: cur.sub + cur.key + cur.fee, months: rows, isCreator: !!creatorId, listed, subscribers, positions: positions.map((p) => ({ id: p.id, label: `${p.side} ${p.coin} ${p.leverage}x`, open: !p.closedAt })) };
}
