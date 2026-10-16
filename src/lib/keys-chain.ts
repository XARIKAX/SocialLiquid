/**
 * the keys program on Solana, server side: account reads for the api, and the event sync the worker runs. Trade
 * and Claimed events land in KeyTrade / KeyClaim, so supply, holders, price history and cost basis come from the
 * database instead of an rpc call per page view. Listed events flip Creator.keysListed and record the starting price.
 *
 * events are self-CPIs into the program (see programs/keys), read from each transaction's inner instructions:
 * unlike logs they are never truncated, and only the program, signing as its event authority, can produce one.
 */
import bs58 from "bs58";
import * as web3 from "@solana/web3.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { KEYS_PROGRAM, KEYS_USDC_MINT, SOLANA_RPC as PUBLIC_RPC } from "./keys";
import { keysProgram, pendingOf, type KeysProgram } from "./keys-sol";

/** the server's Solana node: SOLANA_RPC, else the browser's */
export const SOLANA_RPC = process.env.SOLANA_RPC || PUBLIC_RPC;
/** transactions to read per sync call, so the worker loop stays responsive while it catches up */
const TX_PER_SYNC = Number(process.env.KEYS_TX_PER_SYNC ?? 150);

let _conn: web3.Connection | undefined;
export function connection(): web3.Connection {
  return (_conn ??= new web3.Connection(SOLANA_RPC, { commitment: "confirmed" }));
}

let _program: KeysProgram | undefined;
/** the program client, or null when no program is configured */
export function program(): KeysProgram | null {
  if (!KEYS_PROGRAM) return null;
  return (_program ??= keysProgram(web3, KEYS_PROGRAM, KEYS_USDC_MINT));
}

export const usd6 = (v: bigint) => Number(v) / 1e6;
const isSolana = (a: string | null | undefined): a is string => !!a && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

/** a trader's key on the program, or null when there is no program or the node did not answer */
export async function readTrader(wallet: string | null | undefined): Promise<{ listed: boolean; supply: number; reserve: number; start: number } | null> {
  const k = program();
  if (!k || !isSolana(wallet)) return null;
  try {
    const t = k.decodeTrader((await connection().getAccountInfo(k.traderPda(wallet)))?.data);
    return t ? { listed: true, supply: Number(t.supply), reserve: usd6(t.reserve), start: usd6(t.basePrice) } : { listed: false, supply: 0, reserve: 0, start: 0 };
  } catch {
    return null;
  }
}

/** how many of `trader`'s keys `holder` has right now, read from the chain. null when unknown */
export async function readHolding(trader: string | null | undefined, holder: string | null | undefined): Promise<number | null> {
  const k = program();
  if (!k || !isSolana(trader) || !isSolana(holder)) return null;
  try {
    const h = k.decodeHolder((await connection().getAccountInfo(k.holderPda(trader, holder)))?.data);
    return h ? Number(h.balance) : 0;
  } catch {
    return null;
  }
}

/** what `holder` can claim from each trader right now, in one batched read. null when the node did not answer */
export async function readPending(holder: string | null | undefined, traders: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  const k = program();
  if (!k || !isSolana(holder) || !traders.length) return out;
  try {
    const keys = traders.flatMap((t) => [k.traderPda(t), k.holderPda(t, holder)]);
    const infos = await connection().getMultipleAccountsInfo(keys);
    traders.forEach((t, i) => {
      const tr = k.decodeTrader(infos[2 * i]?.data);
      const h = k.decodeHolder(infos[2 * i + 1]?.data);
      out.set(t, tr && h ? usd6(pendingOf(tr, h)) : 0);
    });
    return out;
  } catch {
    return null;
  }
}

const cursorKey = () => `keys:sig:${KEYS_PROGRAM ?? ""}`;

/**
 * index the program's events since the last transaction seen, oldest first, at most TX_PER_SYNC per call.
 * finalized transactions only, so nothing indexed is ever rolled back. idempotent: rows are keyed on
 * (signature, event index).
 */
export async function syncKeyEvents(): Promise<{ trades: number; claims: number; listed: number; txs: number } | null> {
  const k = program();
  if (!k) return null;
  const conn = connection();
  const cur = await prisma.syncCursor.findUnique({ where: { key: cursorKey() } });
  // walk back from the newest signature to the cursor; the rpc pages newest first, 1000 at a time
  const fresh: web3.ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await conn.getSignaturesForAddress(k.programId, { until: cur?.value, before, limit: 1000 }, "finalized");
    fresh.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  const batch = fresh.reverse().slice(0, TX_PER_SYNC);
  let trades = 0;
  let claims = 0;
  let listed = 0;
  for (const s of batch) {
    const tradeRows: Prisma.KeyTradeCreateManyInput[] = [];
    const claimRows: Prisma.KeyClaimCreateManyInput[] = [];
    const newlyListed: { trader: string; start: number }[] = [];
    if (!s.err) {
      const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "finalized" });
      if (!tx?.meta) throw new Error(`transaction ${s.signature} not available yet`);
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      const time = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000);
      let n = 0;
      for (const group of tx.meta.innerInstructions ?? [])
        for (const ii of group.instructions) {
          if (!keys.get(ii.programIdIndex)?.equals(k.programId)) continue;
          const ev = k.decodeEvent(bs58.decode(ii.data));
          if (!ev) continue;
          const base = { signature: s.signature, eventIndex: n++, slot: BigInt(tx.slot), time };
          if (ev.kind === "trade")
            tradeRows.push({ ...base, trader: ev.trader, account: ev.account, isBuy: ev.isBuy, amount: Number(ev.amount), curveUsd: usd6(ev.curve), traderCutUsd: usd6(ev.traderCut), feeUsd: usd6(ev.fee), supply: Number(ev.supply) });
          else if (ev.kind === "claim") claimRows.push({ ...base, trader: ev.trader, holder: ev.holder, amountUsd: usd6(ev.amount) });
          else if (ev.kind === "listed") newlyListed.push({ trader: ev.trader, start: usd6(ev.basePrice) });
        }
    }
    await prisma.$transaction(async (db) => {
      if (tradeRows.length) trades += (await db.keyTrade.createMany({ data: tradeRows, skipDuplicates: true })).count;
      if (claimRows.length) claims += (await db.keyClaim.createMany({ data: claimRows, skipDuplicates: true })).count;
      // the starting price onchain is the one that counts, whatever the studio had saved
      for (const l of newlyListed) listed += (await db.creator.updateMany({ where: { user: { solanaAddress: l.trader } }, data: { keysListed: true, keyStartPrice: l.start } })).count;
      await db.syncCursor.upsert({ where: { key: cursorKey() }, create: { key: cursorKey(), value: s.signature }, update: { value: s.signature } });
    });
  }
  return { trades, claims, listed, txs: batch.length };
}
