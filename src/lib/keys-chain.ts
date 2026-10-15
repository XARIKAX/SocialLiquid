/**
 * the keys contract on HyperEVM: reads for the server, and the event sync the worker runs. Trade and Claimed
 * events land in KeyTrade / KeyClaim, so supply, holders, price history and cost basis come from the database
 * instead of a node call per page view. Listed events flip Creator.keysListed.
 */
import type { Prisma } from "@prisma/client";
import { createPublicClient, defineChain, formatUnits, http, type Address, type PublicClient } from "viem";
import { prisma } from "./db";
import { KEYS_CONTRACT } from "./keys";
import { KEYS_ABI } from "./keys-abi";

export const HYPEREVM_RPC = process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm";
/** first block worth scanning: the deploy block. set it, or the first sync walks the chain from genesis */
const START_BLOCK = BigInt(process.env.KEYS_START_BLOCK ?? "0");
/** blocks per eth_getLogs call. hyperliquid's public rpc caps the range, so stay small */
const LOG_RANGE = BigInt(process.env.KEYS_LOG_RANGE ?? "1000");

/** HyperEVM, defined here rather than pulled from viem/chains (whose full chain list trips the server bundler) */
export const hyperEvm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hyperliquid.xyz/evm"] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 13051 } },
});

let _client: PublicClient | undefined;
export function evm(): PublicClient {
  return (_client ??= createPublicClient({ chain: hyperEvm, transport: http(HYPEREVM_RPC, { timeout: 10_000, retryCount: 1 }) }) as PublicClient);
}

export const usd6 = (v: bigint) => Number(formatUnits(v, 6));
const lower = (a: string) => a.toLowerCase();

/** a trader's state on the contract, or null when there is no contract or the node did not answer */
export async function readTrader(trader: string): Promise<{ listed: boolean; supply: number; reserve: number } | null> {
  if (!KEYS_CONTRACT) return null;
  try {
    const [listed, supply, reserve] = await evm().readContract({ address: KEYS_CONTRACT, abi: KEYS_ABI, functionName: "traders", args: [trader as Address] });
    return { listed, supply: Number(supply), reserve: usd6(reserve) };
  } catch {
    return null;
  }
}

/** what `holder` can claim from each trader right now, in one multicall. null when the node did not answer */
export async function readPending(holder: string, traders: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (!KEYS_CONTRACT || !traders.length) return out;
  try {
    const res = await evm().multicall({
      allowFailure: false,
      contracts: traders.map((t) => ({ address: KEYS_CONTRACT!, abi: KEYS_ABI, functionName: "pending" as const, args: [t as Address, holder as Address] as const })),
    });
    traders.forEach((t, i) => out.set(lower(t), usd6(res[i] as bigint)));
    return out;
  } catch {
    return null;
  }
}

const cursorKey = () => `keys:block:${lower(KEYS_CONTRACT ?? "")}`;

/**
 * index the contract's events from the last block seen, at most `maxRanges` log ranges per call so the worker
 * loop stays responsive while it catches up. idempotent: rows are keyed on (tx, log index).
 */
export async function syncKeyEvents(maxRanges = 20): Promise<{ trades: number; claims: number; listed: number; to: bigint } | null> {
  if (!KEYS_CONTRACT) return null;
  const client = evm();
  const cur = await prisma.syncCursor.findUnique({ where: { key: cursorKey() } });
  let from = cur ? BigInt(cur.value) + 1n : START_BLOCK;
  const head = await client.getBlockNumber();
  let trades = 0;
  let claims = 0;
  let listed = 0;
  const times = new Map<bigint, Date>();
  const timeOf = async (n: bigint) => {
    let t = times.get(n);
    if (!t) {
      const b = await client.getBlock({ blockNumber: n });
      times.set(n, (t = new Date(Number(b.timestamp) * 1000)));
    }
    return t;
  };
  for (let i = 0; i < maxRanges && from <= head; i++) {
    const to = from + LOG_RANGE - 1n < head ? from + LOG_RANGE - 1n : head;
    const logs = await client.getContractEvents({ address: KEYS_CONTRACT, abi: KEYS_ABI, fromBlock: from, toBlock: to });
    const tradeRows: Prisma.KeyTradeCreateManyInput[] = [];
    const claimRows: Prisma.KeyClaimCreateManyInput[] = [];
    const newlyListed: string[] = [];
    for (const l of logs) {
      if (l.blockNumber === null || l.logIndex === null || l.transactionHash === null) continue;
      if (l.eventName === "Trade") {
        const a = l.args;
        tradeRows.push({
          txHash: l.transactionHash,
          logIndex: l.logIndex,
          blockNumber: l.blockNumber,
          trader: lower(a.trader!),
          account: lower(a.account!),
          isBuy: a.isBuy!,
          amount: Number(a.amount!),
          curveUsd: usd6(a.curve!),
          traderCutUsd: usd6(a.traderCut!),
          feeUsd: usd6(a.protocolFee!),
          supply: Number(a.supply!),
          time: await timeOf(l.blockNumber),
        });
      } else if (l.eventName === "Claimed") {
        const a = l.args;
        claimRows.push({ txHash: l.transactionHash, logIndex: l.logIndex, blockNumber: l.blockNumber, trader: lower(a.trader!), holder: lower(a.holder!), amountUsd: usd6(a.amount!), time: await timeOf(l.blockNumber) });
      } else if (l.eventName === "Listed") {
        newlyListed.push(lower(l.args.trader!));
      }
    }
    await prisma.$transaction(async (tx) => {
      if (tradeRows.length) trades += (await tx.keyTrade.createMany({ data: tradeRows, skipDuplicates: true })).count;
      if (claimRows.length) claims += (await tx.keyClaim.createMany({ data: claimRows, skipDuplicates: true })).count;
      if (newlyListed.length) listed += (await tx.creator.updateMany({ where: { user: { address: { in: newlyListed } } }, data: { keysListed: true } })).count;
      await tx.syncCursor.upsert({ where: { key: cursorKey() }, create: { key: cursorKey(), value: to.toString() }, update: { value: to.toString() } });
    });
    from = to + 1n;
  }
  return { trades, claims, listed, to: from - 1n };
}
