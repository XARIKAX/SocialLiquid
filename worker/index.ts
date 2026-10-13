/**
 * socialLiquid indexer worker.
 * polls every tracked address, diffs positions, writes Position / Fill / FeedEvent.
 * stays under the published info api limit (1200 weight / min / ip) with a token bucket.
 * run: pnpm worker
 */
import "dotenv/config";
import * as hl from "@nktkas/hyperliquid";
import { prisma } from "../src/lib/db";
import { HL_MOCK, IS_TESTNET } from "../src/lib/env";
import { refreshHlLeaderboard, seedTrackedAddresses, syncAddress, trackFeatured, trackUsers } from "../src/lib/indexer";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const WEIGHT_BUDGET_PER_MIN = Number(process.env.HL_WEIGHT_BUDGET_PER_MIN ?? 1000);
const SEED_COUNT = Number(process.env.SEED_COUNT ?? 200);
const HL_TOP_N = Number(process.env.HL_LEADERBOARD_TOP_N ?? 100);
const HL_LEADERBOARD_REFRESH_MS = Number(process.env.HL_LEADERBOARD_REFRESH_MS ?? 60 * 60_000);
const CONCURRENCY = 4;
/** hyperliquid allows 10 unique users across user-specific ws subscriptions per ip */
const WS_USER_CAP = 10;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), "[worker]", ...a);

// ---------- token bucket for api weight ----------
class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private perMin: number) {
    this.tokens = perMin;
  }
  async take(weight: number) {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.perMin, this.tokens + ((now - this.last) / 60_000) * this.perMin);
      this.last = now;
      if (this.tokens >= weight) {
        this.tokens -= weight;
        return;
      }
      await sleep(Math.ceil(((weight - this.tokens) / this.perMin) * 60_000));
    }
  }
}
const bucket = new Bucket(WEIGHT_BUDGET_PER_MIN);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const inflight = new Set<string>();
const pending = new Set<string>();

async function pollOne(address: string, reason: string) {
  if (inflight.has(address)) {
    pending.add(address);
    return;
  }
  inflight.add(address);
  try {
    // reserve the common case up front; userFills weight is taken after the fact when it happened
    await bucket.take(2);
    const r = await syncAddress(address);
    if (r.weight > 2) await bucket.take(r.weight - 2);
    if (r.opened || r.closed) log(`${reason} ${address.slice(0, 10)} opened=${r.opened} closed=${r.closed} fills=${r.fills}`);
  } catch (e) {
    log(`error ${address.slice(0, 10)}: ${(e as Error).message}`);
    await prisma.trackedAddress.update({ where: { address }, data: { lastPolledAt: new Date() } }).catch(() => {});
  } finally {
    inflight.delete(address);
    if (pending.delete(address)) void pollOne(address, "ws");
  }
}

async function pollLoop() {
  for (;;) {
    const due = await prisma.trackedAddress.findMany({
      where: { OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(Date.now() - POLL_INTERVAL_MS) } }] },
      // USER > MANUAL > DISCOVERED (enum sorts alphabetically, so desc), then least recently polled
      orderBy: [{ source: "desc" }, { lastPolledAt: { sort: "asc", nulls: "first" } }],
      take: CONCURRENCY * 4,
    });
    if (due.length === 0) {
      await sleep(500);
      continue;
    }
    const queue = [...due];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let a = queue.shift(); a; a = queue.shift()) await pollOne(a.address, "poll");
      }),
    );
  }
}

// ---------- websocket fills for our own users (fast path) ----------
let subs: hl.SubscriptionClient | undefined;
const wsSubscribed = new Set<string>();

async function syncWs() {
  if (HL_MOCK) return;
  const users = await prisma.trackedAddress.findMany({ where: { source: "USER" }, take: WS_USER_CAP, orderBy: { createdAt: "desc" } });
  const want = users.map((u) => u.address);
  if (!subs && want.length) {
    const t = new hl.WebSocketTransport({ url: IS_TESTNET ? "wss://api.hyperliquid-testnet.xyz/ws" : "wss://api.hyperliquid.xyz/ws" });
    subs = new hl.SubscriptionClient({ transport: t });
  }
  for (const a of want) {
    if (wsSubscribed.has(a)) continue;
    wsSubscribed.add(a);
    try {
      await subs!.userFills({ user: a as `0x${string}` }, (ev) => {
        if (ev.isSnapshot) return;
        log(`ws fills for ${a.slice(0, 10)} (${ev.fills.length})`);
        void pollOne(a, "ws");
      });
    } catch (e) {
      wsSubscribed.delete(a);
      log(`ws subscribe failed ${a.slice(0, 10)}: ${(e as Error).message}`);
    }
  }
}

let lastHlRefresh = 0;
async function refreshHlBoard(reason: string) {
  const n = await refreshHlLeaderboard(HL_TOP_N);
  lastHlRefresh = Date.now();
  log(`${reason}: mirrored hyperliquid leaderboard, ${n} accounts across 24h / 7d / 30d / all-time top ${HL_TOP_N}`);
}

async function housekeeping() {
  for (;;) {
    try {
      if (Date.now() - lastHlRefresh >= HL_LEADERBOARD_REFRESH_MS) await refreshHlBoard("refresh");
      const added = await trackUsers();
      if (added) log(`tracking ${added} new user address(es)`);
      const pinned = await trackFeatured();
      if (pinned) log(`tracking ${pinned} new featured address(es)`);
      await syncWs();
    } catch (e) {
      log("housekeeping error", (e as Error).message);
    }
    await sleep(30_000);
  }
}

async function main() {
  log(`starting. network=${HL_MOCK ? "mock" : IS_TESTNET ? "testnet" : "mainnet"} budget=${WEIGHT_BUDGET_PER_MIN}w/min floor=${POLL_INTERVAL_MS}ms`);
  if (/^0x0{40}$/i.test(process.env.BUILDER_ADDRESS ?? "")) log("WARNING: BUILDER_ADDRESS is the zero address; builder fees will not accrue until it is set to a wallet you control");
  const featured = await trackFeatured();
  log(`featured traders tracked (+${featured} new)`);
  await refreshHlBoard("startup");
  const tracked = await prisma.trackedAddress.count();
  if (tracked < SEED_COUNT) {
    const n = await seedTrackedAddresses(SEED_COUNT);
    log(`seeded ${n} leaderboard address(es)`);
  }
  const total = await prisma.trackedAddress.count();
  const perCycleWeight = total * 2;
  const minCycleSec = (perCycleWeight / WEIGHT_BUDGET_PER_MIN) * 60;
  log(`tracking ${total} address(es). budget-bound full cycle ≈ ${Math.max(POLL_INTERVAL_MS / 1000, minCycleSec).toFixed(0)}s`);
  await Promise.all([pollLoop(), housekeeping()]);
}

/** a failed startup (database unreachable, hyperliquid down) logs the reason and retries instead of crash-looping the service */
async function boot() {
  for (let attempt = 1; ; attempt++) {
    try {
      await main();
      return;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      log(`startup attempt ${attempt} failed: ${msg.split("\n").filter(Boolean).slice(-1)[0]}`);
      if (/DATABASE_URL|Can't reach database|ECONNREFUSED|P1001/i.test(msg)) log("hint: the worker needs the same DATABASE_URL as the web service (Variables → Raw Editor on the web service, paste into the worker)");
      await sleep(Math.min(60_000, 5_000 * attempt));
    }
  }
}
boot();
