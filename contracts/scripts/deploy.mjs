/**
 * deploy SocialLiquidKeys to HyperEVM.
 *
 *   KEYS_DEPLOYER_KEY=0x…        the deployer (becomes owner; transfer ownership to a multisig after)
 *   KEYS_USDC_ADDRESS=0x…        USDC on HyperEVM (6 decimals). required: no default, check it yourself
 *   KEYS_TREASURY=0x…            where protocol fees go
 *   KEYS_BASE_PRICE_USDC=5       first key, in USDC          (default 5)
 *   KEYS_SLOPE_USDC=0.25         added per key in supply      (default 0.25)
 *   KEYS_TRADER_CUT_BPS=1000     trader's share of each buy   (default 10%, fixed forever once deployed)
 *   KEYS_PROTOCOL_FEE_BPS=200    fee on buys and sells        (default 2%, owner-adjustable up to 5%)
 *   HYPEREVM_RPC=https://rpc.hyperliquid.xyz/evm
 *
 * run: npm run deploy   (from contracts/). the deploy needs ~1.4M gas, inside HyperEVM's small-block limit.
 * the contract has not been audited. get it audited before it holds real money.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseUnits, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hyperEvm } from "viem/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k}`);
  return v;
};

const key = need("KEYS_DEPLOYER_KEY");
const usdc = need("KEYS_USDC_ADDRESS");
const treasury = need("KEYS_TREASURY");
if (!isAddress(usdc) || !isAddress(treasury)) throw new Error("KEYS_USDC_ADDRESS and KEYS_TREASURY must be addresses");
const base = parseUnits(process.env.KEYS_BASE_PRICE_USDC ?? "5", 6);
const slope = parseUnits(process.env.KEYS_SLOPE_USDC ?? "0.25", 6);
const cut = BigInt(process.env.KEYS_TRADER_CUT_BPS ?? "1000");
const fee = BigInt(process.env.KEYS_PROTOCOL_FEE_BPS ?? "200");
if ((base * cut) % 10000n || (slope * cut) % 10000n) throw new Error("base price and slope must make the trader cut exact (the contract refuses otherwise)");

const { abi, bytecode } = JSON.parse(readFileSync(join(root, "build/SocialLiquidKeys.json"), "utf8"));
const account = privateKeyToAccount(key);
const transport = http(process.env.HYPEREVM_RPC ?? "https://rpc.hyperliquid.xyz/evm");
const wallet = createWalletClient({ account, chain: hyperEvm, transport });
const pub = createPublicClient({ chain: hyperEvm, transport });

console.log(`deploying from ${account.address}: base ${base}, slope ${slope}, trader cut ${cut} bps, fee ${fee} bps`);
const hash = await wallet.deployContract({ abi, bytecode, args: [usdc, treasury, base, slope, cut, fee] });
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`deployed at ${receipt.contractAddress} (tx ${hash})`);
console.log(`set NEXT_PUBLIC_KEYS_CONTRACT=${receipt.contractAddress} and NEXT_PUBLIC_KEYS_USDC=${usdc} on the web service, then redeploy it`);
