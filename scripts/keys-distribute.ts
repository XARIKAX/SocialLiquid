/**
 * pay out what the worker accrued from copier builder fees (KeyFeeAccrual):
 *  - the holder share goes into the keys contract with depositFees(trader, amount), split there across that
 *    trader's holders by keys held right now. it is sent from KEYS_DISTRIBUTOR_KEY, a HyperEVM wallet holding
 *    USDC (and a little HYPE for gas). move the builder's earnings to it first; the dry run prints how much.
 *  - the trader's share is sent on Hyperliquid with usdSend from the builder wallet (BUILDER_PRIVATE_KEY) to the
 *    creator's payout address.
 * a trader with no key holders yet has nothing to deposit into: those rows are marked skipped and the protocol
 * keeps them, as it does for traders who never set up keys.
 *
 * run:  pnpm keys:distribute            dry run: what would be paid, and to whom
 *       pnpm keys:distribute --execute  send it
 * flags: --min 1     smallest payout per trader in USDC (smaller amounts wait for the next run)
 *        --only holders | creators
 */
import "dotenv/config";
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { createWalletClient, erc20Abi, http, maxUint256, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "../src/lib/db";
import { HL_MOCK, IS_TESTNET } from "../src/lib/env";
import { KEYS_CONTRACT, KEYS_USDC } from "../src/lib/keys";
import { KEYS_ABI } from "../src/lib/keys-abi";
import { evm, hyperEvm, HYPEREVM_RPC, readTrader } from "../src/lib/keys-chain";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const MIN = Number(flag("--min") ?? 1);
const only = flag("--only");
const usd = (n: number) => `$${n.toFixed(2)}`;

if (execute && HL_MOCK) throw new Error("HL_MOCK is set: refusing to send real payouts from a mock environment");

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
  if (!KEYS_CONTRACT || !KEYS_USDC) {
    console.log("  NEXT_PUBLIC_KEYS_CONTRACT / NEXT_PUBLIC_KEYS_USDC not set: nothing can be deposited yet");
    return;
  }
  const key = process.env.KEYS_DISTRIBUTOR_KEY as `0x${string}` | undefined;
  const account = key ? privateKeyToAccount(key) : null;
  const wallet = account ? createWalletClient({ account, chain: hyperEvm, transport: http(HYPEREVM_RPC) }) : null;
  const plan: { trader: string; ids: string[]; amount: bigint }[] = [];
  for (const [trader, x] of byTrader) {
    const state = await readTrader(trader);
    if (!state) throw new Error("could not reach HyperEVM");
    if (!state.listed || state.supply === 0) {
      console.log(`  ${trader}: no key holders, ${usd(x.amount)} stays with the protocol`);
      if (execute) await prisma.keyFeeAccrual.updateMany({ where: { id: { in: x.ids } }, data: { holderStatus: "skipped" } });
      continue;
    }
    if (x.amount < MIN) {
      console.log(`  ${trader}: ${usd(x.amount)} under the ${usd(MIN)} minimum, waits`);
      continue;
    }
    // floor to the cent so the deposit never exceeds what was accrued
    plan.push({ trader, ids: x.ids, amount: parseUnits((Math.floor(x.amount * 100) / 100).toFixed(2), 6) });
    console.log(`  ${trader}: deposit ${usd(x.amount)} for ${state.supply} key(s)`);
  }
  const total = plan.reduce((a, p) => a + p.amount, 0n);
  if (!plan.length) return;
  if (!wallet || !account) {
    console.log(`  set KEYS_DISTRIBUTOR_KEY to deposit. it needs ${Number(total) / 1e6} USDC on HyperEVM plus HYPE for gas`);
    return;
  }
  const bal = await evm().readContract({ address: KEYS_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  console.log(`  distributor ${account.address} holds ${Number(bal) / 1e6} USDC, needs ${Number(total) / 1e6}`);
  if (!execute) return;
  if (bal < total) throw new Error("distributor is short of USDC on HyperEVM; top it up and run again");
  const allowance = await evm().readContract({ address: KEYS_USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, KEYS_CONTRACT] });
  if (allowance < total) {
    const h = await wallet.writeContract({ address: KEYS_USDC, abi: erc20Abi, functionName: "approve", args: [KEYS_CONTRACT, maxUint256] });
    await evm().waitForTransactionReceipt({ hash: h });
    console.log(`  approved the keys contract (${h})`);
  }
  for (const p of plan) {
    const h = await wallet.writeContract({ address: KEYS_CONTRACT, abi: KEYS_ABI, functionName: "depositFees", args: [p.trader as Address, p.amount] });
    const r = await evm().waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error(`deposit for ${p.trader} reverted (${h})`);
    await prisma.keyFeeAccrual.updateMany({ where: { id: { in: p.ids } }, data: { holderStatus: "deposited", holderTx: h } });
    console.log(`  deposited for ${p.trader}: ${h}`);
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
