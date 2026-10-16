"use client";
/**
 * key trades from the browser: build the transaction, have the Solana wallet sign and send it, wait for it to
 * confirm. loaded on the first trade, not with the page (it carries @solana/web3.js).
 *
 * paying with SOL: Jupiter quotes an exact-out swap of SOL for the USDC the buy costs, and its swap goes in
 * the same transaction as the buy, so either both happen or neither does. when the two do not fit in one
 * transaction (a long swap route), the swap goes first and the buy right after.
 */
import { Buffer } from "buffer";
import bs58 from "bs58";
import * as web3 from "@solana/web3.js";
import { JUPITER_API, KEYS_LOOKUP_TABLE, KEYS_PROGRAM, KEYS_USDC_MINT, SOLANA_RPC } from "./keys";
import { buyQuote, curveOf, failedWith, keysErrorName, keysProgram, sellQuote, TOKEN_PROGRAM, WSOL_MINT } from "./keys-sol";
import { connectSolana, walletSend } from "./solana-wallet";

const { ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } = web3;
type Ix = web3.TransactionInstruction;
type Table = web3.AddressLookupTableAccount;

const conn = new Connection(SOLANA_RPC, "confirmed");
const k = KEYS_PROGRAM ? keysProgram(web3, KEYS_PROGRAM, KEYS_USDC_MINT) : null;
const program = () => {
  if (!k) throw new Error("Keys are not launched on this deployment yet.");
  return k;
};
const dollars = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;
/** what one transaction may weigh on the wire */
const MAX_TX = 1232;

/** the program's errors, and the usual Solana ones, as something a person can act on */
const FRIENDLY: Record<string, string> = {
  Slippage: "The price moved while you were confirming. Try again.",
  NotListed: "This trader has not listed a key.",
  SupplyCap: "All of this trader's keys are out.",
  Paused: "Buying keys is paused right now. Selling and claiming still work.",
  Insufficient: "You don't hold that many keys.",
  AlreadyListed: "Your key is already listed.",
  NoHolders: "Nobody holds this key yet.",
  BadPrice: "Pick a starting price between $1 and $1,000, in whole cents.",
};
export function friendly(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  const name = KEYS_PROGRAM ? keysErrorName(m, KEYS_PROGRAM) : null;
  if (name && FRIENDLY[name]) return FRIENDLY[name];
  const f = failedWith(m);
  if (f?.program === TOKEN_PROGRAM && f.code === 1) return "Not enough USDC in your Solana wallet for this.";
  if (/user rejected|rejected the request|user declined|denied/i.test(m)) return "Cancelled in your wallet.";
  if (/insufficient lamports|no record of a prior credit|insufficient funds for fee/i.test(m)) return "Your Solana wallet needs a little SOL for network fees.";
  if (/blockhash not found|block height exceeded|expired/i.test(m)) return "The transaction expired before it landed. Try again.";
  return m.split("\n")[0].slice(0, 220);
}

async function readConfig() {
  const c = program().decodeConfig((await conn.getAccountInfo(program().config))?.data);
  if (!c) throw new Error("Keys are not set up on this network yet.");
  return c;
}
async function readKey(trader: string) {
  const t = program().decodeTrader((await conn.getAccountInfo(program().traderPda(trader)))?.data);
  if (!t) throw new Error(FRIENDLY.NotListed);
  return t;
}
async function usdcOf(owner: web3.PublicKey): Promise<bigint> {
  const a = await conn.getAccountInfo(program().ata(owner));
  return a ? Buffer.from(a.data).readBigUInt64LE(64) : 0n;
}
async function tables(addresses: string[]): Promise<Table[]> {
  const out = await Promise.all(addresses.map((a) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)));
  return out.filter((t): t is Table => !!t);
}
const ownTables = () => tables(KEYS_LOOKUP_TABLE ? [KEYS_LOOKUP_TABLE] : []);

/** compile, check the size, have the wallet sign and send, wait for confirmation. null when it does not fit */
async function send(payer: web3.PublicKey, ixs: Ix[], luts: Table[] = [], dryRun = false): Promise<string | null> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  let bytes: Uint8Array;
  try {
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts);
    bytes = new VersionedTransaction(msg).serialize();
  } catch {
    return null;
  }
  if (bytes.length > MAX_TX) return null;
  if (dryRun) return "fits";
  const r = await walletSend(bytes);
  const sig = "signature" in r ? bs58.encode(r.signature) : await conn.sendRawTransaction(r.signed);
  const c = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (c.value.err) throw new Error(`the transaction failed: ${JSON.stringify(c.value.err)}`);
  return sig;
}
async function mustSend(payer: web3.PublicKey, ixs: Ix[], luts: Table[] = []) {
  const sig = await send(payer, ixs, luts);
  if (!sig) throw new Error("That transaction is too large for Solana. Try fewer at once.");
  return sig;
}

const units = (n: number) => ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(1_400_000, n) });

type JupIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
const fromJup = (i: JupIx) => new TransactionInstruction({ programId: new PublicKey(i.programId), keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(i.data, "base64") });

/** a Jupiter swap of SOL for exactly `usdcOut` USDC into the user's USDC account */
async function solToUsdc(user: web3.PublicKey, usdcOut: bigint) {
  const qs = new URLSearchParams({ inputMint: WSOL_MINT, outputMint: KEYS_USDC_MINT, amount: usdcOut.toString(), swapMode: "ExactOut", slippageBps: "100", maxAccounts: "40" });
  const quote = await fetch(`${JUPITER_API}/quote?${qs}`).then((r) => r.json()).catch(() => null);
  if (!quote || quote.error || !quote.inAmount) throw new Error("No SOL to USDC route right now. Pay with USDC, or try again shortly.");
  const r = await fetch(`${JUPITER_API}/swap-instructions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  }).then((x) => x.json());
  if (!r || r.error || !r.swapInstruction) throw new Error("Jupiter could not build the swap. Pay with USDC, or try again shortly.");
  // keep Jupiter's priority fee, but set the unit limit for the swap and the buy together
  let swapUnits = 0;
  const budget: Ix[] = [];
  for (const raw of (r.computeBudgetInstructions ?? []) as JupIx[]) {
    const ix = fromJup(raw);
    if (ix.data[0] === 2) swapUnits = ix.data.readUInt32LE(1);
    else budget.push(ix);
  }
  return {
    solIn: BigInt(quote.inAmount as string),
    swapUnits: swapUnits || 400_000,
    budget,
    swap: [...((r.otherInstructions ?? []) as JupIx[]), ...((r.setupInstructions ?? []) as JupIx[]), r.swapInstruction as JupIx, ...(r.cleanupInstruction ? [r.cleanupInstruction as JupIx] : [])].map(fromJup),
    luts: await tables((r.addressLookupTableAddresses ?? []) as string[]),
  };
}

export type PayWith = "USDC" | "SOL";

/** buy `qty` of a trader's keys, paying in USDC or SOL. returns a summary for the toast */
export async function buyKeys(trader: string, qty: number, payWith: PayWith, onStep: (s: string) => void): Promise<string> {
  const kp = program();
  const { account } = await connectSolana();
  const buyer = new PublicKey(account.address);
  const [c, t, bal, own] = await Promise.all([readConfig(), readKey(trader), usdcOf(buyer), ownTables()]);
  if (c.buysPaused) throw new Error(FRIENDLY.Paused);
  const q = buyQuote(curveOf(c, t), t.supply, BigInt(qty));
  // another buyer landing first raises the price: allow 3% before the program refuses
  const maxTotal = (q.total * 103n) / 100n;
  const buyIx = (max: bigint) => kp.buy({ buyer, trader, treasuryUsdc: c.treasuryUsdc, amount: BigInt(qty), maxTotal: max });
  const prep = [kp.createAtaIdempotent(buyer, trader), kp.createAtaIdempotent(buyer, buyer)];

  if (payWith === "USDC") {
    if (bal < q.total) throw new Error(`You need ${dollars(q.total)} USDC in your Solana wallet and have ${dollars(bal)}. Pay with SOL instead, or add USDC.`);
    onStep(`Confirm buying ${qty} ${qty === 1 ? "key" : "keys"} for ${dollars(q.total)} in your wallet.`);
    return mustSend(buyer, [units(200_000), ...prep, buyIx(maxTotal < bal ? maxTotal : bal)], own);
  }

  // paying with SOL swaps for the price plus 0.5%, so little USDC is left over; the swap and the buy revert
  // together if the price moves more than that before it lands
  const target = (q.total * 1005n) / 1000n;
  onStep("Getting a SOL price from Jupiter…");
  const s = await solToUsdc(buyer, target);
  const sol = (Number(s.solIn) / 1e9).toFixed(4);
  const one = [units(s.swapUnits + 150_000), ...s.budget, ...s.swap, ...prep, buyIx(target)];
  if (await send(buyer, one, [...s.luts, ...own], true)) {
    onStep(`Confirm in your wallet: about ${sol} SOL for ${qty} ${qty === 1 ? "key" : "keys"}.`);
    return mustSend(buyer, one, [...s.luts, ...own]);
  }
  // the route is too long to share a transaction with the buy: swap first, then buy with the USDC it brought
  onStep(`Confirm the swap in your wallet: about ${sol} SOL for ${dollars(target)} USDC (1 of 2).`);
  await mustSend(buyer, [units(s.swapUnits + 20_000), ...s.budget, ...s.swap], s.luts);
  onStep(`Confirm buying ${qty} ${qty === 1 ? "key" : "keys"} in your wallet (2 of 2).`);
  return mustSend(buyer, [units(200_000), ...prep, buyIx(target)], own);
}

export async function sellKeys(trader: string, qty: number, onStep: (s: string) => void) {
  const kp = program();
  const { account } = await connectSolana();
  const seller = new PublicKey(account.address);
  const [c, t] = await Promise.all([readConfig(), readKey(trader)]);
  const q = sellQuote(curveOf(c, t), t.supply, BigInt(qty));
  onStep(`Confirm selling ${qty} ${qty === 1 ? "key" : "keys"} for about ${dollars(q.net)} in your wallet.`);
  await mustSend(seller, [units(120_000), kp.createAtaIdempotent(seller, seller), kp.sell({ seller, trader, treasuryUsdc: c.treasuryUsdc, amount: BigInt(qty), minNet: (q.net * 97n) / 100n })], await ownTables());
  return q.net;
}

/** claim the fee share from every trader that has some, a few per transaction */
export async function claimAll(traders: string[], onStep: (s: string) => void) {
  const kp = program();
  const { account } = await connectSolana();
  const holder = new PublicKey(account.address);
  const own = await ownTables();
  for (let i = 0; i < traders.length; i += 4) {
    const chunk = traders.slice(i, i + 4);
    onStep(traders.length > 4 ? `Confirm the claim in your wallet (${i / 4 + 1} of ${Math.ceil(traders.length / 4)}).` : "Confirm the claim in your wallet.");
    await mustSend(holder, [units(60_000 + chunk.length * 40_000), kp.createAtaIdempotent(holder, holder), ...chunk.map((t) => kp.claim({ holder, trader: t }))], own);
  }
}

/**
 * list the connected wallet's key at a starting price (USDC), opening its USDC account first so buyers never pay
 * for it. the price is fixed from then on
 */
export async function listKey(startPrice: number, onStep: (s: string) => void) {
  const kp = program();
  const { account } = await connectSolana();
  const me = new PublicKey(account.address);
  onStep(`Confirm listing your key at $${startPrice.toFixed(2)} in your Solana wallet.`);
  await mustSend(me, [units(80_000), kp.createAtaIdempotent(me, me), kp.list(me, BigInt(Math.round(startPrice * 100)) * 10_000n)]);
}
