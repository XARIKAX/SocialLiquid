import { test } from "node:test";
import assert from "node:assert/strict";
import { acct, chain } from "./harness.mjs";

const USD = 1_000_000n; // 6 decimals
const BASE = 5n * USD; // first key $5
const SLOPE = 250_000n; // +$0.25 per key in supply
const CUT = 1000n; // 10% of the curve price to the trader
const FEE = 200n; // 2% protocol fee

const owner = acct(1);
const treasury = acct(2);
const trader = acct(3);
const alice = acct(4);
const bob = acct(5);
const carol = acct(6);
const distributor = acct(7);

const curve = (supply, n) => n * BASE + SLOPE * (n * supply + (n * (n - 1n)) / 2n);

async function setup() {
  const c = await chain();
  const usdc = await c.deploy("MockUSDC", []);
  const keys = await c.deploy("SocialLiquidKeys", [usdc.address, treasury, BASE, SLOPE, CUT, FEE], owner);
  for (const who of [alice, bob, carol, distributor, trader]) {
    await usdc.send(who, "mint", [who, 1_000_000n * USD]);
    await usdc.send(who, "approve", [keys.address, 2n ** 255n]);
  }
  const bal = (who) => usdc.read("balanceOf", [who]);
  return { c, usdc, keys, bal };
}

const rejects = async (p, reason) => {
  await assert.rejects(p, (e) => e.reason === reason || e.message === reason, `expected ${reason}`);
};

test("only a listed trader can be bought, and only the trader can list", async () => {
  const { keys } = await setup();
  await rejects(keys.send(alice, "buy", [trader, 1n, 10n ** 12n]), "NotListed");
  await keys.send(trader, "list");
  await rejects(keys.send(trader, "list"), "AlreadyListed");
  const [listed] = await keys.read("traders", [trader]);
  assert.equal(listed, true);
});

test("a buy pays the curve plus fee; the trader takes their cut, the reserve keeps the rest", async () => {
  const { keys, bal } = await setup();
  await keys.send(trader, "list");
  const [aliceBefore, traderBefore, treasuryBefore] = [await bal(alice), await bal(trader), await bal(treasury)];

  const cost = curve(0n, 10n);
  const [total, quoted, cut, fee] = await keys.read("buyQuote", [trader, 10n]);
  assert.equal(quoted, cost);
  assert.equal(cut, (cost * CUT) / 10_000n);
  assert.equal(fee, (cost * FEE) / 10_000n);
  assert.equal(total, cost + fee);

  await keys.send(alice, "buy", [trader, 10n, total]);
  assert.equal(aliceBefore - (await bal(alice)), total);
  assert.equal((await bal(trader)) - traderBefore, cut);
  assert.equal((await bal(treasury)) - treasuryBefore, fee);
  const [, supply, reserve] = await keys.read("traders", [trader]);
  assert.equal(supply, 10n);
  assert.equal(reserve, cost - cut);
  assert.equal(await keys.read("balanceOf", [trader, alice]), 10n);
  assert.equal(await keys.read("price", [trader]), BASE + SLOPE * 10n);
});

test("slippage guards reject a worse price than the caller accepted", async () => {
  const { keys } = await setup();
  await keys.send(trader, "list");
  const [total] = await keys.read("buyQuote", [trader, 5n]);
  await rejects(keys.send(alice, "buy", [trader, 5n, total - 1n]), "Slippage");
  await keys.send(alice, "buy", [trader, 5n, total]);
  const [net] = await keys.read("sellQuote", [trader, 5n]);
  await rejects(keys.send(alice, "sell", [trader, 5n, net + 1n]), "Slippage");
});

test("every holder can always sell out, and the reserve ends at exactly zero", async () => {
  const { keys, usdc } = await setup();
  await keys.send(trader, "list");
  for (const [who, n] of [[alice, 7n], [bob, 31n], [carol, 2n], [alice, 11n]]) {
    const [total] = await keys.read("buyQuote", [trader, n]);
    await keys.send(who, "buy", [trader, n, total]);
  }
  // sell in a different order and different chunks from the buys
  for (const [who, n] of [[bob, 30n], [alice, 18n], [carol, 2n], [bob, 1n]]) await keys.send(who, "sell", [trader, n, 0n]);
  const [, supply, reserve] = await keys.read("traders", [trader]);
  assert.equal(supply, 0n);
  assert.equal(reserve, 0n);
  assert.equal(await usdc.read("balanceOf", [keys.address]), 0n, "nothing stranded in the contract");
});

test("a round trip costs the trader cut plus the fee each way, nothing more", async () => {
  const { keys, bal } = await setup();
  await keys.send(trader, "list");
  const before = await bal(alice);
  const [total] = await keys.read("buyQuote", [trader, 20n]);
  await keys.send(alice, "buy", [trader, 20n, total]);
  await keys.send(alice, "sell", [trader, 20n, 0n]);
  const cost = curve(0n, 20n);
  const refund = cost - (cost * CUT) / 10_000n;
  const expectedLoss = (cost * FEE) / 10_000n + (cost - refund) + (refund * FEE) / 10_000n;
  assert.equal(before - (await bal(alice)), expectedLoss);
});

test("supply is capped at 2,000", async () => {
  const { keys } = await setup();
  await keys.send(trader, "list");
  const [total] = await keys.read("buyQuote", [trader, 2000n]);
  await keys.send(alice, "buy", [trader, 2000n, total]);
  await rejects(keys.send(bob, "buy", [trader, 1n, 10n ** 15n]), "SupplyCap");
});

test("deposited fees split pro rata to keys held at the time, and survive a sale", async () => {
  const { keys, bal } = await setup();
  await keys.send(trader, "list");
  const buy = async (who, n) => {
    const [total] = await keys.read("buyQuote", [trader, n]);
    await keys.send(who, "buy", [trader, n, total]);
  };
  await buy(alice, 30n);
  await buy(bob, 10n);
  await keys.send(distributor, "depositFees", [trader, 400n * USD]);
  assert.equal(await keys.read("pending", [trader, alice]), 300n * USD);
  assert.equal(await keys.read("pending", [trader, bob]), 100n * USD);

  // carol arrives after the deposit: she gets nothing from it
  await buy(carol, 40n);
  assert.equal(await keys.read("pending", [trader, carol]), 0n);
  await keys.send(distributor, "depositFees", [trader, 80n * USD]);
  assert.equal(await keys.read("pending", [trader, carol]), 40n * USD);
  assert.equal(await keys.read("pending", [trader, alice]), 330n * USD);

  // alice sells everything; what she earned stays claimable
  await keys.send(alice, "sell", [trader, 30n, 0n]);
  assert.equal(await keys.read("pending", [trader, alice]), 330n * USD);
  const before = await bal(alice);
  await keys.send(alice, "claim", [trader]);
  assert.equal((await bal(alice)) - before, 330n * USD);
  assert.equal(await keys.read("pending", [trader, alice]), 0n);
  // claiming twice pays nothing more
  await keys.send(alice, "claim", [trader]);
  assert.equal((await bal(alice)) - before, 330n * USD);
});

test("buying more keys keeps what you already earned", async () => {
  const { keys } = await setup();
  await keys.send(trader, "list");
  const buy = async (who, n) => {
    const [total] = await keys.read("buyQuote", [trader, n]);
    await keys.send(who, "buy", [trader, n, total]);
  };
  await buy(alice, 10n);
  await buy(bob, 10n);
  await keys.send(distributor, "depositFees", [trader, 100n * USD]);
  await buy(alice, 20n);
  assert.equal(await keys.read("pending", [trader, alice]), 50n * USD);
  await keys.send(distributor, "depositFees", [trader, 40n * USD]);
  // alice now holds 30 of 40
  assert.equal(await keys.read("pending", [trader, alice]), 80n * USD);
  assert.equal(await keys.read("pending", [trader, bob]), 60n * USD);
});

test("a holder who never sells is paid everything on claim", async () => {
  const { keys, bal } = await setup();
  await keys.send(trader, "list");
  const [total] = await keys.read("buyQuote", [trader, 8n]);
  await keys.send(alice, "buy", [trader, 8n, total]);
  await keys.send(distributor, "depositFees", [trader, 24n * USD]);
  await keys.send(distributor, "depositFees", [trader, 16n * USD]);
  const before = await bal(alice);
  await keys.send(alice, "claim", [trader]);
  assert.equal((await bal(alice)) - before, 40n * USD);
});

test("fees cannot be deposited for a trader nobody holds", async () => {
  const { keys } = await setup();
  await keys.send(trader, "list");
  await rejects(keys.send(distributor, "depositFees", [trader, USD]), "NoHolders");
});

test("pausing stops buys but never sells or claims", async () => {
  const { keys } = await setup();
  await keys.send(trader, "list");
  const [total] = await keys.read("buyQuote", [trader, 4n]);
  await keys.send(alice, "buy", [trader, 4n, total]);
  await keys.send(distributor, "depositFees", [trader, 8n * USD]);
  await rejects(keys.send(alice, "setBuysPaused", [true]), "NotOwner");
  await keys.send(owner, "setBuysPaused", [true]);
  await rejects(keys.send(bob, "buy", [trader, 1n, 10n ** 12n]), "Paused");
  await keys.send(alice, "sell", [trader, 4n, 0n]);
  await keys.send(alice, "claim", [trader]);
});

test("the owner can lower or raise the protocol fee within the cap, and nobody else can", async () => {
  const { keys } = await setup();
  await rejects(keys.send(alice, "setProtocolFee", [100n]), "NotOwner");
  await rejects(keys.send(owner, "setProtocolFee", [501n]), "BadConfig");
  await keys.send(owner, "setProtocolFee", [500n]);
  assert.equal(await keys.read("protocolFeeBps"), 500n);
});

test("the constructor refuses prices where the trader cut would not be exact", async () => {
  const c = await chain();
  const usdc = await c.deploy("MockUSDC", []);
  await assert.rejects(c.deploy("SocialLiquidKeys", [usdc.address, treasury, BASE + 1n, SLOPE, CUT, FEE], owner));
  await assert.rejects(c.deploy("SocialLiquidKeys", [usdc.address, treasury, BASE, SLOPE + 3n, CUT, FEE], owner));
});

test("each seller is refunded exactly what their keys put into the reserve", async () => {
  const { keys, bal } = await setup();
  await keys.send(trader, "list");
  const buy = async (who, n) => {
    const [total] = await keys.read("buyQuote", [trader, n]);
    await keys.send(who, "buy", [trader, n, total]);
  };
  await buy(alice, 10n);
  await buy(bob, 10n);
  const reservePart = (cost) => cost - (cost * CUT) / 10_000n;
  const net = (refund) => refund - (refund * FEE) / 10_000n;
  // alice sells first, so she sells the top of the curve (keys 10..19)
  let before = await bal(alice);
  await keys.send(alice, "sell", [trader, 10n, 0n]);
  assert.equal((await bal(alice)) - before, net(reservePart(curve(10n, 10n))));
  before = await bal(bob);
  await keys.send(bob, "sell", [trader, 10n, 0n]);
  assert.equal((await bal(bob)) - before, net(reservePart(curve(0n, 10n))));
});

test("random trading never leaves the contract short", async () => {
  const { keys, usdc } = await setup();
  const people = [alice, bob, carol];
  const held = new Map(people.map((p) => [p, 0n]));
  // an exact model of the fee-share accumulator: what each holder is owed, independent of the contract
  const ACC = 10n ** 18n;
  let acc = 0n;
  const owed = new Map(people.map((p) => [p, 0n]));
  const debt = new Map(people.map((p) => [p, 0n]));
  const settle = (p) => owed.set(p, owed.get(p) + (held.get(p) * acc) / ACC - debt.get(p));
  const checkpoint = (p) => debt.set(p, (held.get(p) * acc) / ACC);
  await keys.send(trader, "list");
  let seed = 42;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let i = 0; i < 160; i++) {
    const who = people[rnd(3)];
    const action = rnd(10);
    if (action < 5) {
      const n = BigInt(1 + rnd(25));
      const [, supply] = await keys.read("traders", [trader]);
      if (supply + n > 2000n) continue;
      const [total] = await keys.read("buyQuote", [trader, n]);
      await keys.send(who, "buy", [trader, n, total]);
      settle(who);
      held.set(who, held.get(who) + n);
      checkpoint(who);
    } else if (action < 8 && held.get(who) > 0n) {
      const n = BigInt(1 + rnd(Number(held.get(who))));
      await keys.send(who, "sell", [trader, n, 0n]);
      settle(who);
      held.set(who, held.get(who) - n);
      checkpoint(who);
    } else if (action === 8) {
      const [, supply] = await keys.read("traders", [trader]);
      if (supply > 0n) {
        const amount = BigInt(1 + rnd(5000)) * 1000n;
        await keys.send(distributor, "depositFees", [trader, amount]);
        acc += (amount * ACC) / supply;
      }
    } else {
      const before = await usdc.read("balanceOf", [who]);
      await keys.send(who, "claim", [trader]);
      settle(who);
      checkpoint(who);
      assert.equal((await usdc.read("balanceOf", [who])) - before, owed.get(who), `step ${i}: claim paid the wrong amount`);
      owed.set(who, 0n);
    }
    for (const p of people) {
      const model = owed.get(p) + (held.get(p) * acc) / ACC - debt.get(p);
      assert.equal(await keys.read("pending", [trader, p]), model, `step ${i}: ${p} is owed ${model}`);
    }
    // invariant: the contract always holds the reserve plus every unclaimed fee share
    const [, supplyNow, reserve] = await keys.read("traders", [trader]);
    const full = curve(0n, supplyNow);
    assert.equal(reserve, full - (full * CUT) / 10_000n, `step ${i}: reserve drifted from what the outstanding keys put in`);
    let unclaimed = 0n;
    for (const p of people) unclaimed += await keys.read("pending", [trader, p]);
    const balance = await usdc.read("balanceOf", [keys.address]);
    assert.ok(balance >= reserve + unclaimed, `step ${i}: holds ${balance}, owes ${reserve + unclaimed}`);
  }
  // and everyone can still leave
  for (const p of people) {
    if (held.get(p) > 0n) await keys.send(p, "sell", [trader, held.get(p), 0n]);
    await keys.send(p, "claim", [trader]);
  }
  const [, supply, reserve] = await keys.read("traders", [trader]);
  assert.equal(supply, 0n);
  assert.equal(reserve, 0n);
});
