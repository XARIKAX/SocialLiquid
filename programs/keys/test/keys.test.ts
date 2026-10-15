import { test } from "node:test";
import assert from "node:assert/strict";
import * as web3 from "@solana/web3.js";
import { buyQuote, curveCost, pendingOf, sellQuote } from "../../../src/lib/keys-sol.ts";
import { usd, world } from "./harness.ts";

const { Keypair, SystemProgram, TransactionInstruction } = web3;

/** a listed trader with their USDC account open, as the app sets it up */
function listed(w: ReturnType<typeof world>) {
  const t = w.user();
  w.openUsdc(t);
  w.must([w.k.list(t.publicKey)], [t]);
  return t;
}
const buyIx = (w: ReturnType<typeof world>, buyer: web3.Keypair, trader: web3.PublicKey, amount: bigint, maxTotal?: bigint) => {
  const supply = w.read.trader(trader)?.supply ?? 0n;
  return w.k.buy({ buyer: buyer.publicKey, trader, treasuryUsdc: w.treasuryUsdc, amount, maxTotal: maxTotal ?? buyQuote(w.curve, supply, amount).total });
};
const buy = (w: ReturnType<typeof world>, buyer: web3.Keypair, trader: web3.PublicKey, amount: bigint) => w.must([buyIx(w, buyer, trader, amount)], [buyer]);
const sell = (w: ReturnType<typeof world>, seller: web3.Keypair, trader: web3.PublicKey, amount: bigint, minNet = 0n) => w.send([w.k.sell({ seller: seller.publicKey, trader, treasuryUsdc: w.treasuryUsdc, amount, minNet })], [seller]);
const claim = (w: ReturnType<typeof world>, holder: web3.Keypair, trader: web3.PublicKey) => w.send([w.k.claim({ holder: holder.publicKey, trader })], [holder]);
const deposit = (w: ReturnType<typeof world>, from: web3.Keypair, trader: web3.PublicKey, amount: bigint) => w.send([w.k.depositFees({ depositor: from.publicKey, trader, amount })], [from]);

test("initialize refuses an inexact trader cut, a fee over 5%, and a second run", () => {
  const bad = world({ init: false, base: 5.000001 });
  const r1 = bad.send([bad.k.initialize({ admin: bad.admin.publicKey, treasuryUsdc: bad.treasuryUsdc, ...bad.curve })], [bad.admin]);
  assert.equal(r1.ok ? "" : r1.reason, "BadConfig");
  const r2 = bad.send([bad.k.initialize({ admin: bad.admin.publicKey, treasuryUsdc: bad.treasuryUsdc, ...bad.curve, basePrice: usd(5), protocolFeeBps: 501n })], [bad.admin]);
  assert.equal(r2.ok ? "" : r2.reason, "BadConfig");
  const w = world();
  const again = w.send([w.k.initialize({ admin: w.admin.publicKey, treasuryUsdc: w.treasuryUsdc, ...w.curve })], [w.admin]);
  assert.equal(again.ok ? "" : again.reason, "AlreadyInitialized");
  const c = w.read.config()!;
  assert.equal(c.basePrice, usd(5));
  assert.equal(c.treasuryUsdc, w.treasuryUsdc.toBase58());
});

test("listing: once, by the trader's own wallet; buying an unlisted key fails", () => {
  const w = world();
  const t = listed(w);
  const again = w.send([w.k.list(t.publicKey)], [t]);
  assert.equal(again.ok ? "" : again.reason, "AlreadyListed");
  const nobody = w.user();
  w.openUsdc(nobody);
  const b = w.user();
  w.fund(b, usd(100));
  const r = w.send([buyIx(w, b, nobody.publicKey, 1n, usd(100))], [b]);
  assert.equal(r.ok ? "" : r.reason, "NotListed");
});

test("a buy splits the price: 10% to the trader, 90% to the reserve, 2% fee to the treasury", () => {
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(100));
  const r = buy(w, b, t.publicKey, 3n);
  // 5 + 5.25 + 5.5
  assert.equal(curveCost(w.curve, 0n, 3n), usd(15.75));
  assert.equal(w.usdc(t.publicKey), usd(1.575));
  assert.equal(w.balance(w.k.vault), usd(14.175));
  assert.equal(w.balance(w.treasuryUsdc), usd(0.315));
  assert.equal(w.usdc(b.publicKey), usd(100) - usd(16.065));
  assert.deepEqual(w.read.trader(t.publicKey), { trader: t.publicKey.toBase58(), supply: 3n, reserve: usd(14.175), accPerKey: 0n });
  assert.equal(w.read.holder(t.publicKey, b.publicKey)!.balance, 3n);
  assert.deepEqual(r.events, [{ kind: "trade", trader: t.publicKey.toBase58(), account: b.publicKey.toBase58(), isBuy: true, amount: 3n, curve: usd(15.75), traderCut: usd(1.575), fee: usd(0.315), supply: 3n }]);
  assert.ok(r.cu < 60_000n, `buy used ${r.cu} CU`);
});

test("slippage: a buy over max_total and a sale under min_net both revert", () => {
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(100));
  const q = buyQuote(w.curve, 0n, 2n);
  const r = w.send([buyIx(w, b, t.publicKey, 2n, q.total - 1n)], [b]);
  assert.equal(r.ok ? "" : r.reason, "Slippage");
  buy(w, b, t.publicKey, 2n);
  const s = sellQuote(w.curve, 2n, 1n);
  const r2 = sell(w, b, t.publicKey, 1n, s.net + 1n);
  assert.equal(r2.ok ? "" : r2.reason, "Slippage");
});

test("everyone selling out empties the reserve exactly, and each seller gets exactly their keys' reserve share", () => {
  const w = world();
  const t = listed(w);
  const hs = [w.user(), w.user(), w.user()];
  for (const h of hs) w.fund(h, usd(1000));
  buy(w, hs[0], t.publicKey, 4n);
  buy(w, hs[1], t.publicKey, 7n);
  buy(w, hs[2], t.publicKey, 2n);
  buy(w, hs[0], t.publicKey, 5n);
  for (const [h, n] of [[hs[1], 7n], [hs[0], 9n], [hs[2], 2n]] as const) {
    const before = w.usdc(h.publicKey);
    const supply = w.read.trader(t.publicKey)!.supply;
    const q = sellQuote(w.curve, supply, n);
    const r = sell(w, h, t.publicKey, n);
    assert.ok(r.ok, r.ok ? "" : r.reason);
    assert.equal(w.usdc(h.publicKey) - before, q.net);
    assert.equal(r.events[0].kind === "trade" && r.events[0].curve, q.refund);
  }
  assert.equal(w.read.trader(t.publicKey)!.reserve, 0n);
  assert.equal(w.balance(w.k.vault), 0n);
});

test("a round trip costs the trader cut plus the fee both ways", () => {
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(1000));
  buy(w, b, t.publicKey, 10n);
  sell(w, b, t.publicKey, 10n);
  const c = curveCost(w.curve, 0n, 10n);
  const lost = usd(1000) - w.usdc(b.publicKey);
  const refund = c - (c * 1000n) / 10000n;
  assert.equal(lost, c + (c * 200n) / 10000n - (refund - (refund * 200n) / 10000n));
});

test("the supply caps at 2000 keys", () => {
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(600_000));
  buy(w, b, t.publicKey, 2000n);
  const r = w.send([buyIx(w, b, t.publicKey, 1n, usd(10_000))], [b]);
  assert.equal(r.ok ? "" : r.reason, "SupplyCap");
});

test("fee share: pro rata at deposit time, kept through a sale and a later buy, paid in full on claim", () => {
  const w = world();
  const t = listed(w);
  const [a, b, d] = [w.user(), w.user(), w.user()];
  w.fund(a, usd(1000));
  w.fund(b, usd(1000));
  w.fund(d, usd(1000));
  buy(w, a, t.publicKey, 3n);
  buy(w, b, t.publicKey, 1n);
  assert.ok(deposit(w, d, t.publicKey, usd(40)).ok);
  // a sells everything: the 30 they earned stays theirs
  assert.ok(sell(w, a, t.publicKey, 3n).ok);
  // b buys more: their 10 stays theirs, and the next deposit is shared over b's 4 keys
  buy(w, b, t.publicKey, 3n);
  assert.ok(deposit(w, d, t.publicKey, usd(8)).ok);
  const tr = w.read.trader(t.publicKey)!;
  assert.equal(pendingOf(tr, w.read.holder(t.publicKey, a.publicKey)!), usd(30));
  assert.equal(pendingOf(tr, w.read.holder(t.publicKey, b.publicKey)!), usd(18));
  const before = w.usdc(a.publicKey);
  const r = claim(w, a, t.publicKey);
  assert.ok(r.ok);
  assert.equal(w.usdc(a.publicKey) - before, usd(30));
  assert.deepEqual(r.events, [{ kind: "claim", trader: t.publicKey.toBase58(), holder: a.publicKey.toBase58(), amount: usd(30) }]);
  // claiming again pays nothing and emits nothing
  const again = claim(w, a, t.publicKey);
  assert.ok(again.ok && again.events.length === 0);
  // a holder who never sold is paid everything
  const bb = w.usdc(b.publicKey);
  claim(w, b, t.publicKey);
  assert.equal(w.usdc(b.publicKey) - bb, usd(18));
});

test("depositing with no holders fails, so fees are never stranded", () => {
  const w = world();
  const t = listed(w);
  const d = w.user();
  w.fund(d, usd(10));
  const r = deposit(w, d, t.publicKey, usd(5));
  assert.equal(r.ok ? "" : r.reason, "NoHolders");
});

test("admin: pausing stops buys only; the fee is capped; only the admin can change anything", () => {
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(100));
  buy(w, b, t.publicKey, 2n);
  const stranger = w.user();
  const r0 = w.send([w.k.admin(stranger.publicKey, { pauseBuys: true })], [stranger]);
  assert.equal(r0.ok ? "" : r0.reason, "NotAdmin");
  w.must([w.k.admin(w.admin.publicKey, { pauseBuys: true })], [w.admin]);
  const r1 = w.send([buyIx(w, b, t.publicKey, 1n)], [b]);
  assert.equal(r1.ok ? "" : r1.reason, "Paused");
  assert.ok(sell(w, b, t.publicKey, 1n).ok);
  const r2 = w.send([w.k.admin(w.admin.publicKey, { setProtocolFee: 501 })], [w.admin]);
  assert.equal(r2.ok ? "" : r2.reason, "BadConfig");
  w.must([w.k.admin(w.admin.publicKey, { setProtocolFee: 0 })], [w.admin]);
  w.must([w.k.admin(w.admin.publicKey, { pauseBuys: false })], [w.admin]);
  const fresh = w.user();
  w.openUsdc(fresh);
  w.must([w.k.admin(w.admin.publicKey, { setTreasury: w.ata(fresh.publicKey) })], [w.admin]);
  assert.equal(w.read.config()!.treasuryUsdc, w.ata(fresh.publicKey).toBase58());
  const next = w.user();
  w.must([w.k.admin(w.admin.publicKey, { setAdmin: next.publicKey })], [w.admin]);
  const r3 = w.send([w.k.admin(w.admin.publicKey, { pauseBuys: true })], [w.admin]);
  assert.equal(r3.ok ? "" : r3.reason, "NotAdmin");
});

test("security: the cut only goes to the trader's account, fees only to the treasury, money only through the vault", () => {
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(100));
  const thief = w.user();
  w.openUsdc(thief);
  const base = buyIx(w, b, t.publicKey, 1n);
  const swap = (i: number, to: web3.PublicKey) => new TransactionInstruction({ programId: base.programId, data: base.data, keys: base.keys.map((k, j) => (j === i ? { ...k, pubkey: to } : k)) });
  for (const [i, label] of [[5, "trader usdc"], [6, "treasury"], [7, "vault"]] as const) {
    const r = w.send([swap(i, w.ata(thief.publicKey))], [b]);
    assert.equal(r.ok ? "" : r.reason, "BadAccount", label);
  }
  buy(w, b, t.publicKey, 2n);
  // the thief cannot sell or claim with someone else's holder record
  const s = w.k.sell({ seller: thief.publicKey, trader: t.publicKey, treasuryUsdc: w.treasuryUsdc, amount: 1n, minNet: 0n });
  const forged = new TransactionInstruction({ programId: s.programId, data: s.data, keys: s.keys.map((k, j) => (j === 3 ? { ...k, pubkey: w.k.holderPda(t.publicKey, b.publicKey) } : k)) });
  const r = w.send([forged], [thief]);
  assert.equal(r.ok ? "" : r.reason, "BadAccount");
});

test("security: nobody outside the program can emit an event", () => {
  const w = world();
  const fake = Keypair.generate();
  const payer = w.user();
  const ev = new TransactionInstruction({ programId: w.programId, data: Buffer.from([255, 0, ...fake.publicKey.toBuffer()]), keys: [{ pubkey: fake.publicKey, isSigner: true, isWritable: false }] });
  const r = w.send([ev], [payer, fake]);
  assert.ok(!r.ok, "a self-signed event authority must be refused");
  const ev2 = new TransactionInstruction({ programId: w.programId, data: Buffer.from([255, 0, ...fake.publicKey.toBuffer()]), keys: [{ pubkey: w.k.eventAuthority, isSigner: false, isWritable: false }] });
  assert.ok(!w.send([ev2], [payer]).ok, "the real authority, unsigned, must be refused");
});

test("lamports sent to a holder address before the first buy do not block it", () => {
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(100));
  const griefer = w.user();
  w.must([SystemProgram.transfer({ fromPubkey: griefer.publicKey, toPubkey: w.k.holderPda(t.publicKey, b.publicKey), lamports: Number(w.svm.minimumBalanceForRentExemption(0n)) })], [griefer]);
  buy(w, b, t.publicKey, 1n);
  assert.equal(w.read.holder(t.publicKey, b.publicKey)!.balance, 1n);
});

test("closing an empty holder record returns its rent; a non-empty one cannot be closed", () => {
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(100));
  buy(w, b, t.publicKey, 1n);
  const r1 = w.send([w.k.closeHolder({ holder: b.publicKey, trader: t.publicKey })], [b]);
  assert.equal(r1.ok ? "" : r1.reason, "NotEmpty");
  sell(w, b, t.publicKey, 1n);
  const before = w.svm.getBalance(b.publicKey)!;
  w.must([w.k.closeHolder({ holder: b.publicKey, trader: t.publicKey })], [b]);
  assert.ok(w.svm.getBalance(b.publicKey)! > before);
  assert.equal(w.read.holder(t.publicKey, b.publicKey), null);
  // and buying again recreates it
  buy(w, b, t.publicKey, 1n);
  assert.equal(w.read.holder(t.publicKey, b.publicKey)!.balance, 1n);
});

test("random walk against an exact model: reserves, every holder's earnings, payouts and solvency", () => {
  const w = world();
  const traders = [listed(w), listed(w)];
  const people = Array.from({ length: 4 }, () => w.user(50));
  for (const p of people) w.fund(p, usd(200_000));
  const dist = w.user();
  w.fund(dist, usd(100_000));
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  const ACC = 10n ** 18n;
  type M = { supply: bigint; reserve: bigint; acc: bigint; bal: bigint[]; debt: bigint[]; owed: bigint[] };
  const model: M[] = traders.map(() => ({ supply: 0n, reserve: 0n, acc: 0n, bal: [0n, 0n, 0n, 0n], debt: [0n, 0n, 0n, 0n], owed: [0n, 0n, 0n, 0n] }));
  const settle = (m: M, i: number) => {
    m.owed[i] += (m.bal[i] * m.acc) / ACC - m.debt[i];
  };
  const cp = (m: M, i: number) => {
    m.debt[i] = (m.bal[i] * m.acc) / ACC;
  };
  for (let step = 0; step < 160; step++) {
    const ti = rnd(2);
    const t = traders[ti].publicKey;
    const m = model[ti];
    const pi = rnd(4);
    const p = people[pi];
    const op = rnd(10);
    if (op < 4) {
      const n = BigInt(1 + rnd(12));
      if (m.supply + n > 2000n) continue;
      const q = buyQuote(w.curve, m.supply, n);
      buy(w, p, t, n);
      settle(m, pi);
      m.supply += n;
      m.reserve += q.curve - q.traderCut;
      m.bal[pi] += n;
      cp(m, pi);
    } else if (op < 7) {
      if (m.bal[pi] === 0n) continue;
      const n = BigInt(1 + rnd(Number(m.bal[pi])));
      const q = sellQuote(w.curve, m.supply, n);
      const before = w.usdc(p.publicKey);
      assert.ok(sell(w, p, t, n).ok);
      assert.equal(w.usdc(p.publicKey) - before, q.net);
      settle(m, pi);
      m.supply -= n;
      m.reserve -= q.refund;
      m.bal[pi] -= n;
      cp(m, pi);
    } else if (op < 9) {
      if (m.supply === 0n) continue;
      const amt = BigInt(1 + rnd(5_000_000));
      assert.ok(deposit(w, dist, t, amt).ok);
      m.acc += (amt * ACC) / m.supply;
    } else {
      const before = w.usdc(p.publicKey);
      const exists = !!w.read.holder(t, p.publicKey);
      const r = claim(w, p, t);
      if (!exists) {
        assert.ok(!r.ok);
        continue;
      }
      settle(m, pi);
      cp(m, pi);
      assert.equal(w.usdc(p.publicKey) - before, m.owed[pi]);
      m.owed[pi] = 0n;
    }
    const st = w.read.trader(t)!;
    assert.equal(st.supply, m.supply);
    assert.equal(st.reserve, m.reserve);
    assert.equal(st.accPerKey, m.acc);
    for (let i = 0; i < 4; i++) {
      const h = w.read.holder(t, people[i].publicKey);
      const expected = m.owed[i] + (m.bal[i] * m.acc) / ACC - m.debt[i];
      assert.equal(h ? pendingOf(st, h) : 0n, expected, `step ${step} holder ${i}`);
    }
  }
  // solvency: the vault holds every reserve and every unclaimed payout, give or take rounding dust in the program's favour
  let owe = 0n;
  traders.forEach((tr, ti) => {
    const st = w.read.trader(tr.publicKey)!;
    owe += st.reserve;
    for (const p of people) {
      const h = w.read.holder(tr.publicKey, p.publicKey);
      if (h) owe += pendingOf(st, h);
    }
    void ti;
  });
  const vault = w.balance(w.k.vault);
  assert.ok(vault >= owe, `vault ${vault} < owed ${owe}`);
  assert.ok(vault - owe < 1000n, `dust ${vault - owe}`);
});

test("defence in depth: program-owned look-alikes at the wrong address are refused", () => {
  // the chain never lets anyone but the program create accounts it owns, so these are planted directly: they show
  // the address checks hold even if a look-alike somehow existed
  const w = world();
  const t = listed(w);
  const b = w.user();
  w.fund(b, usd(100));
  const attacker = w.user();
  const plant = (data: Uint8Array) => {
    const at = Keypair.generate().publicKey;
    w.svm.setAccount(at, { lamports: 10_000_000, data, owner: w.programId, executable: false });
    return at;
  };
  // a config copy naming the attacker as admin
  const cfg = Buffer.from(w.svm.getAccount(w.k.config)!.data);
  attacker.publicKey.toBuffer().copy(cfg, 8);
  const fakeConfig = plant(cfg);
  const pause = w.k.admin(attacker.publicKey, { pauseBuys: true });
  const r1 = w.send([new TransactionInstruction({ programId: pause.programId, data: pause.data, keys: pause.keys.map((k, j) => (j === 1 ? { ...k, pubkey: fakeConfig } : k)) })], [attacker]);
  assert.equal(r1.ok ? "" : r1.reason, "BadAccount");
  // a trader record claiming a huge reserve, at an address that is not the trader's
  const tr = Buffer.from(w.svm.getAccount(w.k.traderPda(t.publicKey))!.data);
  tr.writeBigUInt64LE(10n ** 12n, 48);
  const fakeTrader = plant(tr);
  const bi = buyIx(w, b, t.publicKey, 1n);
  const r2 = w.send([new TransactionInstruction({ programId: bi.programId, data: bi.data, keys: bi.keys.map((k, j) => (j === 2 ? { ...k, pubkey: fakeTrader } : k)) })], [b]);
  assert.equal(r2.ok ? "" : r2.reason, "BadAccount");
});
