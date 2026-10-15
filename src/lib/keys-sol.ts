/**
 * the socialLiquid keys program on Solana (programs/keys): addresses, instructions, account and event decoding,
 * and the curve math, all mirroring programs/keys/src/lib.rs byte for byte. the app, the worker, the payout script
 * and the program's own tests use this one file, so the tests check the encoding the app sends.
 *
 * @solana/web3.js is passed in rather than imported, so the browser can load it lazily and the program's tests
 * can use their own copy.
 */
import { Buffer } from "buffer";
import type * as Web3 from "@solana/web3.js";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
/** USDC on Solana mainnet */
export const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const SUPPLY_CAP = 2000n;
const BPS = 10_000n;
const ACC = 10n ** 18n;

/** the program's custom error codes, in order */
export const KEYS_ERRORS = ["NotAdmin", "NotListed", "AlreadyListed", "ZeroAmount", "SupplyCap", "Slippage", "Insufficient", "NoHolders", "Paused", "BadConfig", "BadAccount", "Math", "NotEmpty", "AlreadyInitialized"] as const;

export type CurveConfig = { basePrice: bigint; slope: bigint; traderCutBps: bigint; protocolFeeBps: bigint };
export type ConfigState = CurveConfig & { admin: string; treasuryUsdc: string; usdcMint: string; buysPaused: boolean; bump: number; vaultBump: number; eventBump: number };
export type TraderState = { trader: string; supply: bigint; reserve: bigint; accPerKey: bigint };
export type HolderState = { trader: string; holder: string; balance: bigint; rewardDebt: bigint; owed: bigint };
export type KeysEvent =
  | { kind: "listed"; trader: string }
  | { kind: "trade"; trader: string; account: string; isBuy: boolean; amount: bigint; curve: bigint; traderCut: bigint; fee: bigint; supply: bigint }
  | { kind: "deposit"; trader: string; from: string; amount: bigint }
  | { kind: "claim"; trader: string; holder: string; amount: bigint };

/* ---------- curve math (exactly the program's integer arithmetic) ---------- */

export function curveCost(c: CurveConfig, supply: bigint, amount: bigint): bigint {
  const steps = amount * supply + (amount * (amount > 0n ? amount - 1n : 0n)) / 2n;
  return amount * c.basePrice + c.slope * steps;
}
export const traderCutOf = (c: CurveConfig, cost: bigint) => (cost * c.traderCutBps) / BPS;
export const feeOf = (c: CurveConfig, amount: bigint) => (amount * c.protocolFeeBps) / BPS;

export function buyQuote(c: CurveConfig, supply: bigint, amount: bigint) {
  const curve = curveCost(c, supply, amount);
  const fee = feeOf(c, curve);
  return { curve, traderCut: traderCutOf(c, curve), fee, total: curve + fee };
}
export function sellQuote(c: CurveConfig, supply: bigint, amount: bigint) {
  const curve = curveCost(c, supply - amount, amount);
  const refund = curve - traderCutOf(c, curve);
  const fee = feeOf(c, refund);
  return { refund, fee, net: refund - fee };
}

/** what a holder can claim right now: settled earnings plus everything accrued since the last checkpoint */
export const pendingOf = (t: Pick<TraderState, "accPerKey">, h: Pick<HolderState, "balance" | "rewardDebt" | "owed">) => h.owed + (h.balance * t.accPerKey) / ACC - h.rewardDebt;

/* ---------- byte helpers ---------- */

const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const u16 = (v: bigint | number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(Number(v));
  return b;
};
const rd64 = (d: Uint8Array, at: number) => Buffer.from(d.buffer, d.byteOffset, d.byteLength).readBigUInt64LE(at);
const rd128 = (d: Uint8Array, at: number) => rd64(d, at) + (rd64(d, at + 8) << 64n);
const rd16 = (d: Uint8Array, at: number) => Buffer.from(d.buffer, d.byteOffset, d.byteLength).readUInt16LE(at);
const tag = (d: Uint8Array, s: string) => Buffer.from(d.slice(0, 8)).toString("latin1") === s;

/** everything that needs @solana/web3.js, bound to one deployment of the program */
export function keysProgram(web3: typeof Web3, programId: string, usdcMint: string) {
  const { PublicKey, TransactionInstruction } = web3;
  type Key = Web3.PublicKey;
  const P = new PublicKey(programId);
  const USDC = new PublicKey(usdcMint);
  const TOKEN = new PublicKey(TOKEN_PROGRAM);
  const ATA = new PublicKey(ATA_PROGRAM);
  const SYSTEM = new PublicKey(SYSTEM_PROGRAM);
  const key = (k: Key | string) => (typeof k === "string" ? new PublicKey(k) : k);
  const b58 = (d: Uint8Array, at: number) => new PublicKey(d.slice(at, at + 32)).toBase58();
  const find = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, P)[0];

  const config = find([Buffer.from("config")]);
  const vault = find([Buffer.from("vault")]);
  const eventAuthority = find([Buffer.from("__event_authority")]);
  const traderPda = (trader: Key | string) => find([Buffer.from("trader"), key(trader).toBuffer()]);
  const holderPda = (trader: Key | string, holder: Key | string) => find([Buffer.from("holder"), key(trader).toBuffer(), key(holder).toBuffer()]);
  /** the associated token account of `owner` for `mint` (USDC unless given) */
  const ata = (owner: Key | string, mint: Key | string = USDC) => PublicKey.findProgramAddressSync([key(owner).toBuffer(), TOKEN.toBuffer(), key(mint).toBuffer()], ATA)[0];

  const ix = (data: Buffer, keys: [Key, boolean, boolean][]) =>
    new TransactionInstruction({ programId: P, data, keys: keys.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })) });
  const events: [Key, boolean, boolean][] = [
    [eventAuthority, false, false],
    [P, false, false],
  ];

  return {
    programId: P,
    usdcMint: USDC,
    config,
    vault,
    eventAuthority,
    traderPda,
    holderPda,
    ata,

    /** create the owner's associated token account if it does not exist yet; a no-op when it does */
    createAtaIdempotent(payer: Key | string, owner: Key | string, mint: Key | string = USDC) {
      return new TransactionInstruction({
        programId: ATA,
        data: Buffer.from([1]),
        keys: [
          { pubkey: key(payer), isSigner: true, isWritable: true },
          { pubkey: ata(owner, mint), isSigner: false, isWritable: true },
          { pubkey: key(owner), isSigner: false, isWritable: false },
          { pubkey: key(mint), isSigner: false, isWritable: false },
          { pubkey: SYSTEM, isSigner: false, isWritable: false },
          { pubkey: TOKEN, isSigner: false, isWritable: false },
        ],
      });
    },

    initialize(a: { admin: Key | string; treasuryUsdc: Key | string } & CurveConfig) {
      return ix(Buffer.concat([Buffer.from([0]), u64(a.basePrice), u64(a.slope), u16(a.traderCutBps), u16(a.protocolFeeBps)]), [
        [key(a.admin), true, true],
        [config, false, true],
        [vault, false, true],
        [USDC, false, false],
        [key(a.treasuryUsdc), false, false],
        [SYSTEM, false, false],
        [TOKEN, false, false],
      ]);
    },

    list(trader: Key | string) {
      return ix(Buffer.from([1]), [[key(trader), true, true], [config, false, false], [traderPda(trader), false, true], [SYSTEM, false, false], ...events]);
    },

    buy(a: { buyer: Key | string; trader: Key | string; treasuryUsdc: Key | string; amount: bigint; maxTotal: bigint; buyerUsdc?: Key | string }) {
      return ix(Buffer.concat([Buffer.from([2]), u64(a.amount), u64(a.maxTotal)]), [
        [key(a.buyer), true, true],
        [config, false, false],
        [traderPda(a.trader), false, true],
        [holderPda(a.trader, a.buyer), false, true],
        [a.buyerUsdc ? key(a.buyerUsdc) : ata(a.buyer), false, true],
        [ata(a.trader), false, true],
        [key(a.treasuryUsdc), false, true],
        [vault, false, true],
        [TOKEN, false, false],
        [SYSTEM, false, false],
        ...events,
      ]);
    },

    sell(a: { seller: Key | string; trader: Key | string; treasuryUsdc: Key | string; amount: bigint; minNet: bigint; sellerUsdc?: Key | string }) {
      return ix(Buffer.concat([Buffer.from([3]), u64(a.amount), u64(a.minNet)]), [
        [key(a.seller), true, false],
        [config, false, false],
        [traderPda(a.trader), false, true],
        [holderPda(a.trader, a.seller), false, true],
        [a.sellerUsdc ? key(a.sellerUsdc) : ata(a.seller), false, true],
        [key(a.treasuryUsdc), false, true],
        [vault, false, true],
        [TOKEN, false, false],
        ...events,
      ]);
    },

    depositFees(a: { depositor: Key | string; trader: Key | string; amount: bigint; from?: Key | string }) {
      return ix(Buffer.concat([Buffer.from([4]), u64(a.amount)]), [
        [key(a.depositor), true, false],
        [config, false, false],
        [traderPda(a.trader), false, true],
        [a.from ? key(a.from) : ata(a.depositor), false, true],
        [vault, false, true],
        [TOKEN, false, false],
        ...events,
      ]);
    },

    claim(a: { holder: Key | string; trader: Key | string; holderUsdc?: Key | string }) {
      return ix(Buffer.from([5]), [
        [key(a.holder), true, false],
        [config, false, false],
        [traderPda(a.trader), false, false],
        [holderPda(a.trader, a.holder), false, true],
        [a.holderUsdc ? key(a.holderUsdc) : ata(a.holder), false, true],
        [vault, false, true],
        [TOKEN, false, false],
        ...events,
      ]);
    },

    /** admin: 0 set treasury, 1 protocol fee (bps), 2 pause buys, 3 hand over admin */
    admin(admin: Key | string, op: { setTreasury: Key | string } | { setProtocolFee: number } | { pauseBuys: boolean } | { setAdmin: Key | string }) {
      const base: [Key, boolean, boolean][] = [
        [key(admin), true, false],
        [config, false, true],
      ];
      if ("setTreasury" in op) return ix(Buffer.from([6, 0]), [...base, [key(op.setTreasury), false, false]]);
      if ("setProtocolFee" in op) return ix(Buffer.concat([Buffer.from([6, 1]), u16(op.setProtocolFee)]), base);
      if ("pauseBuys" in op) return ix(Buffer.from([6, 2, op.pauseBuys ? 1 : 0]), base);
      return ix(Buffer.concat([Buffer.from([6, 3]), key(op.setAdmin).toBuffer()]), base);
    },

    closeHolder(a: { holder: Key | string; trader: Key | string }) {
      return ix(Buffer.from([7]), [
        [key(a.holder), true, true],
        [traderPda(a.trader), false, false],
        [holderPda(a.trader, a.holder), false, true],
      ]);
    },

    /* ---------- decoding ---------- */

    decodeConfig(d: Uint8Array | null | undefined): ConfigState | null {
      if (!d || d.length !== 128 || !tag(d, "SLKCONF1")) return null;
      return {
        admin: b58(d, 8),
        treasuryUsdc: b58(d, 40),
        usdcMint: b58(d, 72),
        basePrice: rd64(d, 104),
        slope: rd64(d, 112),
        traderCutBps: BigInt(rd16(d, 120)),
        protocolFeeBps: BigInt(rd16(d, 122)),
        buysPaused: d[124] !== 0,
        bump: d[125],
        vaultBump: d[126],
        eventBump: d[127],
      };
    },
    decodeTrader(d: Uint8Array | null | undefined): TraderState | null {
      if (!d || d.length !== 80 || !tag(d, "SLKTRDR1")) return null;
      return { trader: b58(d, 8), supply: rd64(d, 40), reserve: rd64(d, 48), accPerKey: rd128(d, 56) };
    },
    decodeHolder(d: Uint8Array | null | undefined): HolderState | null {
      if (!d || d.length !== 112 || !tag(d, "SLKHLDR1")) return null;
      return { trader: b58(d, 8), holder: b58(d, 40), balance: rd64(d, 72), rewardDebt: rd128(d, 80), owed: rd64(d, 96) };
    },
    /** an event from the data of a self-CPI (instruction 255) */
    decodeEvent(d: Uint8Array): KeysEvent | null {
      if (d[0] !== 255) return null;
      const e = d.slice(1);
      switch (e[0]) {
        case 0:
          return e.length === 33 ? { kind: "listed", trader: b58(e, 1) } : null;
        case 1:
          return e.length === 106
            ? { kind: "trade", trader: b58(e, 1), account: b58(e, 33), isBuy: e[65] === 1, amount: rd64(e, 66), curve: rd64(e, 74), traderCut: rd64(e, 82), fee: rd64(e, 90), supply: rd64(e, 98) }
            : null;
        case 2:
          return e.length === 73 ? { kind: "deposit", trader: b58(e, 1), from: b58(e, 33), amount: rd64(e, 65) } : null;
        case 3:
          return e.length === 73 ? { kind: "claim", trader: b58(e, 1), holder: b58(e, 33), amount: rd64(e, 65) } : null;
        default:
          return null;
      }
    },
  };
}

export type KeysProgram = ReturnType<typeof keysProgram>;

/**
 * where a failed transaction broke, from its logs: the first program that failed with a custom error, and the
 * code. the first one matters: a token-program failure inside the keys program surfaces as the keys program
 * failing with the token program's code, so a bare "custom program error" says nothing about whose error it is.
 */
export function failedWith(message: string): { program: string; code: number } | null {
  const m = /Program (\w+) failed: custom program error: 0x([0-9a-f]+)/i.exec(message);
  return m ? { program: m[1], code: parseInt(m[2], 16) } : null;
}

/** the keys program's error name, when the keys program itself is what failed */
export function keysErrorName(message: string, programId: string): string | null {
  const f = failedWith(message);
  return f && f.program === programId ? (KEYS_ERRORS[f.code] ?? null) : null;
}
