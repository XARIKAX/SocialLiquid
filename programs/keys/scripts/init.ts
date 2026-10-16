/**
 * set up a freshly deployed keys program: its config and USDC vault, the treasury's USDC account, and an address
 * lookup table of the program's fixed accounts (so paying with SOL fits the swap and the buy in one transaction).
 *
 *   SOLANA_RPC=https://…                  the cluster (default mainnet)
 *   KEYS_PROGRAM_ID=…                     from `solana program deploy`
 *   KEYS_ADMIN_KEY=~/.config/solana/id.json   keypair file or base58 secret: pays, and becomes the program admin
 *   KEYS_TREASURY=…                       wallet that receives protocol fees (its USDC account is created here)
 *   KEYS_USDC_MINT=EPjF…                  default: mainnet USDC
 *   KEYS_MIN_BASE_PRICE_USDC=1   the lowest starting price a trader may pick for their key (they choose when listing)
 *   KEYS_SLOPE_USDC=0.25  KEYS_TRADER_CUT_BPS=1000  KEYS_PROTOCOL_FEE_BPS=200
 *
 * run: npm run init (from programs/keys). prints the NEXT_PUBLIC_* values for the app.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import bs58 from "bs58";
import * as web3 from "@solana/web3.js";
import { ATA_PROGRAM, keysProgram, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MAINNET } from "../../../src/lib/keys-sol.ts";

const { AddressLookupTableProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = web3;
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k}`);
  return v;
};
const usd = (k: string, d: string) => BigInt(Math.round(Number(process.env[k] ?? d) * 1e6));
function keypair(v: string) {
  const path = v.replace(/^~/, homedir());
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
  return Keypair.fromSecretKey(bs58.decode(v));
}

const rpc = process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpc, "confirmed");
const admin = keypair(need("KEYS_ADMIN_KEY"));
const programId = need("KEYS_PROGRAM_ID");
const mint = process.env.KEYS_USDC_MINT ?? USDC_MAINNET;
const treasury = new PublicKey(need("KEYS_TREASURY"));
const k = keysProgram(web3, programId, mint);
const curve = {
  minBasePrice: usd("KEYS_MIN_BASE_PRICE_USDC", "1"),
  slope: usd("KEYS_SLOPE_USDC", "0.25"),
  traderCutBps: BigInt(process.env.KEYS_TRADER_CUT_BPS ?? "1000"),
  protocolFeeBps: BigInt(process.env.KEYS_PROTOCOL_FEE_BPS ?? "200"),
};
if ((curve.slope * curve.traderCutBps) % 10000n) throw new Error("the slope must make the trader cut exact (the program refuses otherwise)");

const send = (ixs: web3.TransactionInstruction[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [admin], { commitment: "confirmed" });

console.log(`program ${programId} on ${rpc}, admin ${admin.publicKey.toBase58()}`);
const treasuryUsdc = k.ata(treasury);
if (k.decodeConfig((await conn.getAccountInfo(k.config))?.data)) {
  console.log("already initialised");
} else {
  const sig = await send([k.createAtaIdempotent(admin.publicKey, treasury), k.initialize({ admin: admin.publicKey, treasuryUsdc, ...curve })]);
  console.log(`initialised: starting prices from $${Number(curve.minBasePrice) / 1e6}, slope $${Number(curve.slope) / 1e6}, trader cut ${curve.traderCutBps} bps, fee ${curve.protocolFeeBps} bps (${sig})`);
}

const slot = await conn.getSlot("finalized");
const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: admin.publicKey, payer: admin.publicKey, recentSlot: slot });
const addresses = [k.config, k.vault, k.eventAuthority, k.programId, treasuryUsdc, k.usdcMint, new PublicKey(TOKEN_PROGRAM), new PublicKey(SYSTEM_PROGRAM), new PublicKey(ATA_PROGRAM)];
await send([create, AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: admin.publicKey, payer: admin.publicKey, addresses })]);
console.log(`lookup table ${table.toBase58()}`);

console.log(`\nset on the web service and the worker, then redeploy:\n  NEXT_PUBLIC_KEYS_PROGRAM_ID=${programId}\n  NEXT_PUBLIC_KEYS_USDC_MINT=${mint}\n  NEXT_PUBLIC_KEYS_LOOKUP_TABLE=${table.toBase58()}`);
console.log("\nthe program is unaudited: get it audited before it holds real money, then hand the upgrade authority to a multisig or make it immutable.");
