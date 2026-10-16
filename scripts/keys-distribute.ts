/**
 * pay out what the worker accrued from copier builder fees (KeyFeeAccrual):
 *  - the holder share goes into the keys program on Solana with deposit_fees, split there across that trader's
 *    holders by keys held right now. it is sent from KEYS_DISTRIBUTOR_KEY, a Solana wallet holding USDC (and a
 *    little SOL for fees). the builder earns in USDC on Hyperliquid: withdraw it and bridge it to that wallet with
 *    Circle's CCTP first; the dry run prints how much is needed.
 *  - the trader's share is sent on Hyperliquid with usdSend from the builder wallet (BUILDER_PRIVATE_KEY) to the
 *    creator's payout address.
 * a trader with no key holders yet (or no key) has nothing to deposit into: those rows are marked skipped and the
 * protocol keeps them, as it does for traders who never set up keys.
 *
 * run:  pnpm keys:distribute            dry run: what would be paid, and to whom
 *       pnpm keys:distribute --execute  send it
 * flags: --min 1     smallest payout per trader in USDC (smaller amounts wait for the next run)
 *        --only holders | creators
 */
import "dotenv/config";
import bs58 from "bs58";
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "../src/lib/db";
import { HL_MOCK, IS_TESTNET } from "../src/lib/env";
import { connection, program, readTrader } from "../src/lib/keys-chain";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const MIN = Number(flag("--min") ?? 1);
const only = flag("--only");
const usd = (n: number) => `$${n.toFixed(2)}`;

if (execute && HL_MOCK && only !== "holders") throw new Error("HL_MOCK is set: refusing to send real payouts on Hyperliquid from a mock environment");

/** a Solana secret key as base58 (what Phantom exports) or a JSON byte array (what solana-keygen writes) */
function solanaKey(v: string | undefined): Keypair | null {
  if (!v) return null;
  const t = v.trim();
  return Keypair.fromSecretKey(t.startsWith("[") ? Uint8Array.from(JSON.parse(t) as number[]) : bs58.decode(t));
}

async function holders() {
  const rows = await prisma.keyFeeAccrual.findMany({ where: { holderStatus: "pending" }, orderBy: { periodStart: "asc" } });
  const byTrader = new Map<string, { ids: string[]; amount: number }>();
  for (const r of rows) {
    const x = byTrader.get(r.traderAddress) ?? { ids: [], amount: 0 };
    x.ids.push(r.id);
    x.amount += Number(r.holderShareUsd);
    byTrader.set(r.traderAddress, x);
  }
  console.log(`\nholder share: ${byTrader.size} trader(s), ${usd([...byTrader.values()].reduce((a, b) => a + b.amount, 0))} pending`);
  if (!byTrader.size) return;
  const k = program();
  if (!k) {
    console.log("  NEXT_PUBLIC_KEYS_PROGRAM_ID not set: nothing can be deposited yet");
    return;
  }
  // accruals are by hyperliquid address; keys live under the Solana wallet each trader linked
  const users = await prisma.user.findMany({ where: { address: { in: [...byTrader.keys()] } }, select: { address: true, solanaAddress: true } });
  const walletOf = new Map(users.map((u) => [u.address, u.solanaAddress]));
  const plan: { trader: string; wallet: string; ids: string[]; amount: bigint }[] = [];
  for (const [trader, x] of byTrader) {
    const wallet = walletOf.get(trader) ?? null;
    const state = wallet ? await readTrader(wallet) : { listed: false, supply: 0, reserve: 0 };
    if (!state) throw new Error("could not reach Solana");
    if (!wallet || !state.listed || state.supply === 0) {
      console.log(`  ${trader}: no key holders, ${usd(x.amount)} stays with the protocol`);
      if (execute) await prisma.keyFeeAccrual.updateMany({ where: { id: { in: x.ids } }, data: { holderStatus: "skipped" } });
      continue;
    }
    if (x.amount < MIN) {
      console.log(`  ${trader}: ${usd(x.amount)} under the ${usd(MIN)} minimum, waits`);
      continue;
    }
    // floor to the cent so the deposit never exceeds what was accrued
    plan.push({ trader, wallet, ids: x.ids, amount: BigInt(Math.floor(x.amount * 100)) * 10_000n });
    console.log(`  ${trader}: deposit ${usd(x.amount)} for ${state.supply} key(s) of ${wallet}`);
  }
  if (!plan.length) return;
  const total = plan.reduce((a, p) => a + p.amount, 0n);
  const payer = solanaKey(process.env.KEYS_DISTRIBUTOR_KEY);
  if (!payer) {
    console.log(`  set KEYS_DISTRIBUTOR_KEY to deposit. it needs ${Number(total) / 1e6} USDC in its Solana wallet plus a little SOL for fees`);
    return;
  }
  const conn = connection();
  const from = k.ata(payer.publicKey);
  const info = await conn.getAccountInfo(from);
  const bal = info ? Buffer.from(info.data).readBigUInt64LE(64) : 0n;
  console.log(`  distributor ${payer.publicKey.toBase58()} holds ${Number(bal) / 1e6} USDC, needs ${Number(total) / 1e6}`);
  if (!execute) return;
  if (bal < total) throw new Error("the distributor is short of USDC on Solana; top it up and run again");
  for (const p of plan) {
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(k.depositFees({ depositor: payer.publicKey, trader: p.wallet, amount: p.amount })), [payer], { commitment: "confirmed" });
    await prisma.keyFeeAccrual.updateMany({ where: { id: { in: p.ids } }, data: { holderStatus: "deposited", holderTx: sig } });
    console.log(`  deposited for ${p.trader}: ${sig}`);
  }
}

async function creators() {
  const rows = await prisma.keyFeeAccrual.findMany({ where: { creatorStatus: "pending" }, orderBy: { periodStart: "asc" } });
  const byTrader = new Map<string, { ids: string[]; amount: number }>();
  for (const r of rows) {
    const x = byTrader.get(r.traderAddress) ?? { ids: [], amount: 0 };
    x.ids.push(r.id);
    x.amount += Number(r.creatorShareUsd);
    byTrader.set(r.traderAddress, x);
  }
  console.log(`\ntrader share: ${byTrader.size} trader(s), ${usd([...byTrader.values()].reduce((a, b) => a + b.amount, 0))} pending`);
  if (!byTrader.size) return;
  const key = process.env.BUILDER_PRIVATE_KEY as `0x${string}` | undefined;
  const ex = key ? new ExchangeClient({ transport: new HttpTransport({ isTestnet: IS_TESTNET }), wallet: privateKeyToAccount(key), signatureChainId: IS_TESTNET ? "0x66eee" : "0xa4b1" }) : null;
  const creatorRows = await prisma.creator.findMany({ where: { user: { address: { in: [...byTrader.keys()] } } }, select: { payoutAddress: true, user: { select: { address: true } } } });
  const payTo = new Map(creatorRows.map((c) => [c.user.address, c.payoutAddress]));
  for (const [trader, x] of byTrader) {
    const to = payTo.get(trader);
    if (!to) {
      console.log(`  ${trader}: no creator profile any more, ${usd(x.amount)} stays with the protocol`);
      if (execute) await prisma.keyFeeAccrual.updateMany({ where: { id: { in: x.ids } }, data: { creatorStatus: "skipped" } });
      continue;
    }
    if (x.amount < MIN) {
      console.log(`  ${trader}: ${usd(x.amount)} under the ${usd(MIN)} minimum, waits`);
      continue;
    }
    const amount = (Math.floor(x.amount * 100) / 100).toFixed(2);
    console.log(`  ${trader}: send $${amount} to ${to}`);
    if (!execute) continue;
    if (!ex) throw new Error("set BUILDER_PRIVATE_KEY (the builder wallet) to pay traders");
    await ex.usdSend({ destination: to as `0x${string}`, amount });
    await prisma.keyFeeAccrual.updateMany({ where: { id: { in: x.ids } }, data: { creatorStatus: "paid", creatorTx: `usdSend ${new Date().toISOString()}` } });
  }
  if (!ex && !execute) console.log("  set BUILDER_PRIVATE_KEY to send these");
}

console.log(execute ? "keys payouts: EXECUTING" : "keys payouts: dry run (add --execute to send)");
if (only !== "creators") await holders();
if (only !== "holders") await creators();
await prisma.$disconnect();
