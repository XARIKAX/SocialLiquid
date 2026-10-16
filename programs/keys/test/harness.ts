/**
 * an in-process Solana (LiteSVM) with the keys program, a USDC-like mint and helpers to fund, send and read.
 * instructions come from the app's own client (src/lib/keys-sol.ts), so these tests cover its encoding too.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web3 from "@solana/web3.js";
import { FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";
import { KEYS_ERRORS, keysProgram, type KeysEvent, type KeysProgram } from "../../../src/lib/keys-sol.ts";

const { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } = web3;
export const SO = join(dirname(fileURLToPath(import.meta.url)), "../target/deploy/socialliquid_keys.so");
export const usd = (n: number) => BigInt(Math.round(n * 1e6));
export const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export type Result = { ok: true; events: KeysEvent[]; cu: bigint; logs: string[] } | { ok: false; reason: string; logs: string[] };

export function world(opts: { so?: string; base?: number; minBase?: number; slope?: number; cutBps?: number; feeBps?: number; init?: boolean } = {}) {
  const svm = new LiteSVM();
  const programId = Keypair.generate().publicKey;
  svm.addProgram(programId, readFileSync(opts.so ?? process.env.KEYS_SO ?? SO));
  const mintAuth = Keypair.generate();
  const mint = Keypair.generate();
  const k: KeysProgram = keysProgram(web3, programId.toBase58(), mint.publicKey.toBase58());

  const send = (ixs: web3.TransactionInstruction[], signers: web3.Keypair[]): Result => {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.add(...ixs);
    tx.sign(...signers);
    const keys = tx.compileMessage().accountKeys;
    const r = svm.sendTransaction(tx);
    svm.expireBlockhash();
    if (r instanceof FailedTransactionMetadata) {
      const e = r.err() as unknown as { index?: number; err?: () => unknown };
      let reason = r.toString();
      const inner = typeof e.err === "function" ? (e.err() as { code?: number }) : null;
      if (inner && typeof inner.code === "number") reason = KEYS_ERRORS[inner.code] ?? `custom ${inner.code}`;
      else if (inner) reason = String(inner);
      else reason = String(e);
      return { ok: false, reason, logs: r.meta().logs() };
    }
    const meta = r as TransactionMetadata;
    const events: KeysEvent[] = [];
    for (const group of meta.innerInstructions())
      for (const ii of group) {
        const ci = ii.instruction();
        if (!keys[ci.programIdIndex()].equals(programId)) continue;
        const ev = k.decodeEvent(ci.data());
        if (ev) events.push(ev);
      }
    return { ok: true, events, cu: meta.computeUnitsConsumed(), logs: meta.logs() };
  };
  const must = (ixs: web3.TransactionInstruction[], signers: web3.Keypair[]) => {
    const r = send(ixs, signers);
    if (!r.ok) throw new Error(`tx failed: ${r.reason}\n${r.logs.join("\n")}`);
    return r;
  };

  const user = (sol = 10) => {
    const kp = Keypair.generate();
    svm.airdrop(kp.publicKey, BigInt(sol * 1e9));
    return kp;
  };
  const admin = user(100);
  // the mint
  const rent = svm.minimumBalanceForRentExemption(82n);
  must(
    [
      SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, lamports: Number(rent), space: 82, programId: TOKEN }),
      new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }], data: Buffer.concat([Buffer.from([20, 6]), mintAuth.publicKey.toBuffer(), Buffer.from([0])]) }),
    ],
    [admin, mint],
  );
  const ata = (owner: web3.PublicKey) => k.ata(owner);
  // token accounts are written straight into the chain: litesvm's bundled associated-token program aborts the
  // process on the next instance (a litesvm bug). the real one runs in the app's end-to-end tests
  const tokenRent = svm.minimumBalanceForRentExemption(165n);
  const setToken = (owner: web3.PublicKey, amount: bigint) => {
    const d = Buffer.alloc(165);
    mint.publicKey.toBuffer().copy(d, 0);
    owner.toBuffer().copy(d, 32);
    d.writeBigUInt64LE(amount, 64);
    d[108] = 1;
    svm.setAccount(ata(owner), { lamports: Number(tokenRent), data: d, owner: TOKEN, executable: false });
  };
  const openUsdc = (owner: web3.Keypair) => {
    if (!svm.getAccount(ata(owner.publicKey))) setToken(owner.publicKey, 0n);
  };
  const fund = (owner: web3.Keypair, amount: bigint) => setToken(owner.publicKey, balance(ata(owner.publicKey)) + amount);
  const balance = (tokenAccount: web3.PublicKey) => {
    const a = svm.getAccount(tokenAccount);
    return a ? Buffer.from(a.data).readBigUInt64LE(64) : 0n;
  };
  const usdc = (owner: web3.PublicKey) => balance(ata(owner));
  const treasury = user();
  openUsdc(treasury);
  const treasuryUsdc = ata(treasury.publicKey);
  // the curve of a trader who lists at the default starting price (opts.base, $5)
  const curve = { basePrice: usd(opts.base ?? 5), slope: usd(opts.slope ?? 0.25), traderCutBps: BigInt(opts.cutBps ?? 1000), protocolFeeBps: BigInt(opts.feeBps ?? 200) };
  const init = { admin: admin.publicKey, treasuryUsdc, minBasePrice: usd(opts.minBase ?? 1), slope: curve.slope, traderCutBps: curve.traderCutBps, protocolFeeBps: curve.protocolFeeBps };
  if (opts.init !== false) must([k.initialize(init)], [admin]);

  const read = {
    config: () => k.decodeConfig(svm.getAccount(k.config)?.data),
    trader: (t: web3.PublicKey) => k.decodeTrader(svm.getAccount(k.traderPda(t))?.data),
    holder: (t: web3.PublicKey, h: web3.PublicKey) => k.decodeHolder(svm.getAccount(k.holderPda(t, h))?.data),
  };
  return { svm, k, programId, admin, treasury, treasuryUsdc, mint: mint.publicKey, curve, init, send, must, user, fund, openUsdc, usdc, balance, read, ata };
}

function u64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
