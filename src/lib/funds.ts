"use client";
/**
 * deposits and withdrawals never touch socialLiquid: every route below moves USDC from the user's own wallet straight
 * into their own Hyperliquid account, signed by the user. the routes mirror Hyperliquid's deposit dialog:
 *
 *   Arbitrum                      Circle CCTP V2: burn on Arbitrum, Circle's forwarder on HyperEVM credits perps. 0.2 USDC fee.
 *   Arbitrum (Legacy Bridge)      plain USDC transfer to Hyperliquid's Bridge2. free, min 5 USDC, ~1 minute.
 *   Arbitrum (Swap USDT for USDC) Uniswap v3 USDT→USDC on Arbitrum, then the CCTP route.
 *   HyperEVM                      Circle's CoreDepositWallet moves USDC from HyperEVM into HyperCore perps. free.
 *   Ethereum / Base / Optimism / Polygon / Avalanche   the same CCTP route from other chains Circle supports.
 *
 * withdrawals are signed by the main wallet (never the agent key) and land on Arbitrum a few minutes later.
 */
import { createPublicClient, erc20Abi, http, pad, parseAbi, parseUnits, type Address, type Chain, type Hex, type WalletClient } from "viem";
import { arbitrum, arbitrumSepolia, avalanche, base, hyperEvm, mainnet, optimism, polygon } from "wagmi/chains";
import { IS_TESTNET_CLIENT } from "./wagmi";

export const DEPOSIT_CHAIN = IS_TESTNET_CLIENT ? arbitrumSepolia : arbitrum;
/** native USDC on arbitrum (USDC2 on arbitrum sepolia for testnet) */
export const USDC_ADDRESS = (IS_TESTNET_CLIENT ? "0x1baAbB04529D43a73232B713C0FE471f7c7334d5" : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831") as Address;
/** hyperliquid bridge2 */
export const HL_BRIDGE_ADDRESS = (IS_TESTNET_CLIENT ? "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89" : "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7") as Address;
export const EXPLORER = IS_TESTNET_CLIENT ? "https://sepolia.arbiscan.io" : "https://arbiscan.io";
/** bridge2 silently keeps anything under 5 USDC */
export const MIN_DEPOSIT = 5;
export const MIN_WITHDRAW = 2;
export const WITHDRAW_FEE = 1;

/* ---------------- Circle CCTP V2 → HyperCore ---------------- */
/** TokenMessengerV2: the same address on every EVM chain with CCTP V2 */
export const CCTP_TOKEN_MESSENGER = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address;
/** Circle's CctpForwarder on HyperEVM: mintRecipient AND destinationCaller of the burn; it credits HyperCore from the hook */
export const CCTP_FORWARDER = "0xb21D281DEdb17AE5B501F6AA8256fe38C4e45757" as Address;
export const HYPEREVM_DOMAIN = 19;
/** Circle's forwarding fee into HyperCore, the "0.2 USDC fee" Hyperliquid's own dialog quotes */
export const CCTP_FORWARD_FEE = Number(process.env.NEXT_PUBLIC_CCTP_FORWARD_FEE ?? "0.2");
/** USDC on HyperEVM (Circle) and Circle's CoreDepositWallet that moves it into HyperCore */
export const HYPEREVM_USDC = "0xb88339CB7199b77E23DB6E890353E22632Ba630f" as Address;
export const CORE_DEPOSIT_WALLET = "0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24" as Address;
/** USDT on arbitrum and uniswap v3 there, for the "swap USDT for USDC" route */
export const USDT_ARBITRUM = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" as Address;
export const UNISWAP_ROUTER_ARBITRUM = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as Address;
export const UNISWAP_QUOTER_ARBITRUM = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" as Address;
/** 0.5%: USDT/USDC is a stable pair, anything worse than this is a bad quote */
const SWAP_SLIPPAGE_BPS = 50n;
const CCTP_FAST = 1000;
const CCTP_STANDARD = 2000;
const CORE_PERPS_DEX = 0;

export type RouteKind = "cctp" | "bridge" | "swap" | "hyperevm";
export type DepositRoute = {
  id: string;
  label: string;
  chain: Chain;
  kind: RouteKind;
  /** the token the user pays with */
  token: Address;
  symbol: "USDC" | "USDT";
  /** CCTP source domain for cctp / swap routes */
  domain?: number;
  min: number;
  fee: string;
  eta: string;
  explorer: string;
};

const cctp = (id: string, label: string, chain: Chain, token: Address, domain: number, eta: string): DepositRoute => ({
  id,
  label,
  chain,
  kind: "cctp",
  token,
  symbol: "USDC",
  domain,
  min: 2,
  fee: `${CCTP_FORWARD_FEE} USDC`,
  eta,
  explorer: chain.blockExplorers?.default.url ?? "",
});

/** the first four are Hyperliquid's own list, in its order; the rest are the other CCTP V2 chains Circle forwards from */
export const DEPOSIT_ROUTES: DepositRoute[] = [
  cctp("arbitrum", "Arbitrum", arbitrum, USDC_ADDRESS, 3, "seconds (fast) · ~15 min (standard)"),
  { id: "arbitrum-bridge", label: "Arbitrum (Legacy Bridge)", chain: arbitrum, kind: "bridge", token: USDC_ADDRESS, symbol: "USDC", min: MIN_DEPOSIT, fee: "none", eta: "about a minute", explorer: EXPLORER },
  { id: "arbitrum-usdt", label: "Arbitrum (Swap USDT for USDC)", chain: arbitrum, kind: "swap", token: USDT_ARBITRUM, symbol: "USDT", domain: 3, min: 2, fee: `${CCTP_FORWARD_FEE} USDC + swap (≈0.01%)`, eta: "seconds (fast) · ~15 min (standard)", explorer: EXPLORER },
  { id: "hyperevm", label: "HyperEVM", chain: hyperEvm, kind: "hyperevm", token: HYPEREVM_USDC, symbol: "USDC", min: 2, fee: "none", eta: "seconds", explorer: hyperEvm.blockExplorers?.default.url ?? "" },
  cctp("ethereum", "Ethereum", mainnet, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 0, "seconds (fast) · ~15 min (standard)"),
  cctp("base", "Base", base, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6, "seconds (fast) · ~15 min (standard)"),
  cctp("optimism", "Optimism", optimism, "0x0b2C639c533813f4Aa9D7837CAF62653d097Ff85", 2, "seconds (fast) · ~15 min (standard)"),
  cctp("polygon", "Polygon", polygon, "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 7, "seconds (fast) · ~15 min (standard)"),
  cctp("avalanche", "Avalanche", avalanche, "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 1, "seconds (fast) · ~15 min (standard)"),
];
export const DEFAULT_ROUTE = DEPOSIT_ROUTES[0];
export const routeById = (id: string) => DEPOSIT_ROUTES.find((r) => r.id === id) ?? DEFAULT_ROUTE;

export type Step = (text: string) => void;
const noop: Step = () => {};

const TOKEN_MESSENGER_ABI = parseAbi([
  "function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)",
]);
const CORE_DEPOSIT_ABI = parseAbi(["function deposit(uint256 amount,uint32 destinationDex)"]);
const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);
const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

const clients = new Map<number, ReturnType<typeof createPublicClient>>();
function publicClient(chain: Chain) {
  let c = clients.get(chain.id);
  if (!c) {
    c = createPublicClient({ chain, transport: http() });
    clients.set(chain.id, c);
  }
  return c;
}

async function ensureChain(wallet: WalletClient, chain: Chain) {
  if ((await wallet.getChainId()) !== chain.id) await wallet.switchChain({ id: chain.id });
}

function account(wallet: WalletClient) {
  if (!wallet.account) throw new Error("wallet not ready");
  return wallet.account;
}

/** approve `spender` for exactly `amount` unless the allowance already covers it; waits for the approval to confirm */
async function ensureAllowance(wallet: WalletClient, chain: Chain, token: Address, spender: Address, amount: bigint, label: string, step: Step) {
  const pub = publicClient(chain);
  const owner = account(wallet).address;
  const have = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }).catch(() => 0n);
  if (have >= amount) return null;
  step(`Approve ${label} in your wallet…`);
  const hash = await wallet.writeContract({ account: account(wallet), chain, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  step("Waiting for the approval to confirm…");
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("the approval reverted on chain");
  return hash;
}

/**
 * hook for Circle's CctpForwarder (56 bytes): "cctp-forward" right-padded to 24 bytes | version uint32 0 |
 * payload length uint32 24 | recipient on HyperCore (20 bytes) | destination dex uint32 (0 = perps)
 */
export function forwardHookData(user: Address): Hex {
  if (!/^0x[0-9a-fA-F]{40}$/.test(user)) throw new Error("bad address");
  const magic = Array.from("cctp-forward", (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("").padEnd(48, "0");
  const hook = `0x${magic}00000000${"00000018"}${user.slice(2).toLowerCase()}${CORE_PERPS_DEX.toString(16).padStart(8, "0")}` as Hex;
  if (hook.length !== 2 + 56 * 2) throw new Error("hook data is the wrong length");
  return hook;
}

/** Circle's fast-transfer fee in bps for a source domain → HyperEVM, or null if fast is unavailable / the api is unreachable */
export async function cctpFastFeeBps(sourceDomain: number): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://iris-api.circle.com/v2/burn/USDC/fees/${sourceDomain}/${HYPEREVM_DOMAIN}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const rows = (await res.json()) as { finalityThreshold: number; minimumFee: number }[];
    const fast = rows.find((r) => r.finalityThreshold === CCTP_FAST);
    return fast ? Number(fast.minimumFee) : null;
  } catch {
    return null;
  }
}

/** total deducted from a CCTP deposit of `amount` USDC: the forwarding fee plus the fast-transfer bps when fast */
export function cctpMaxFee(amountUnits: bigint, fastBps: number | null): bigint {
  const forward = parseUnits(String(CCTP_FORWARD_FEE), 6);
  if (fastBps === null) return forward;
  return forward + (amountUnits * BigInt(Math.ceil(fastBps)) + 9999n) / 10000n;
}

/**
 * burn `amountUnits` USDC on the route's chain through TokenMessengerV2; Circle attests and its forwarder on HyperEVM
 * credits the user's perps balance with the amount minus maxFee. a wrong mintRecipient / destinationCaller would strand
 * the USDC, so the call is built from constants and the hook is checked before the wallet is asked.
 */
export async function depositCctp(wallet: WalletClient, route: DepositRoute, amountUnits: bigint, fastBps: number | null, step: Step = noop): Promise<{ hash: Hex; maxFee: bigint }> {
  if (route.domain === undefined) throw new Error("not a cctp route");
  const user = account(wallet).address;
  const maxFee = cctpMaxFee(amountUnits, fastBps);
  if (amountUnits <= maxFee) throw new Error(`the amount must be above the ${CCTP_FORWARD_FEE} USDC fee`);
  const hook = forwardHookData(user);
  if (hook.slice(66, 106) !== user.slice(2).toLowerCase()) throw new Error("hook does not name your account; nothing was sent");
  const forwarder = pad(CCTP_FORWARDER, { size: 32 });
  step(`Switch to ${route.chain.name}…`);
  await ensureChain(wallet, route.chain);
  await ensureAllowance(wallet, route.chain, route.token === USDT_ARBITRUM ? USDC_ADDRESS : route.token, CCTP_TOKEN_MESSENGER, amountUnits, "USDC", step);
  step("Confirm the deposit in your wallet…");
  const hash = await wallet.writeContract({
    account: account(wallet),
    chain: route.chain,
    address: CCTP_TOKEN_MESSENGER,
    abi: TOKEN_MESSENGER_ABI,
    functionName: "depositForBurnWithHook",
    args: [amountUnits, HYPEREVM_DOMAIN, forwarder, route.token === USDT_ARBITRUM ? USDC_ADDRESS : route.token, forwarder, maxFee, fastBps === null ? CCTP_STANDARD : CCTP_FAST, hook],
  });
  return { hash, maxFee };
}

/** sends `amount` USDC to bridge2 from the connected wallet; resolves with the tx hash once the user confirms */
export async function depositWithWallet(wallet: WalletClient, amount: string, step: Step = noop): Promise<Hex> {
  step(`Switch to ${DEPOSIT_CHAIN.name}…`);
  await ensureChain(wallet, DEPOSIT_CHAIN);
  step("Confirm the deposit in your wallet…");
  return wallet.writeContract({
    account: account(wallet),
    chain: DEPOSIT_CHAIN,
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [HL_BRIDGE_ADDRESS, parseUnits(amount, 6)],
  });
}

/** quote USDT→USDC on uniswap v3 (0.01% pool first, 0.05% as fallback); returns the best output and its pool fee */
export async function quoteUsdtToUsdc(amountIn: bigint): Promise<{ out: bigint; poolFee: number }> {
  const pub = publicClient(arbitrum);
  let best: { out: bigint; poolFee: number } | null = null;
  for (const poolFee of [100, 500]) {
    try {
      const { result } = await pub.simulateContract({
        address: UNISWAP_QUOTER_ARBITRUM,
        abi: QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: USDT_ARBITRUM, tokenOut: USDC_ADDRESS, amountIn, fee: poolFee, sqrtPriceLimitX96: 0n }],
      });
      const out = result[0];
      if (!best || out > best.out) best = { out, poolFee };
    } catch {
      /* no pool at this tier */
    }
  }
  if (!best) throw new Error("could not get a USDT→USDC quote from Uniswap on Arbitrum");
  return best;
}

/** swaps USDT for USDC in the user's wallet on arbitrum; resolves with the USDC actually received */
export async function swapUsdtToUsdc(wallet: WalletClient, amountIn: bigint, step: Step = noop): Promise<{ hash: Hex; received: bigint }> {
  const user = account(wallet).address;
  const pub = publicClient(arbitrum);
  step("Switch to Arbitrum…");
  await ensureChain(wallet, arbitrum);
  step("Getting a Uniswap quote…");
  const q = await quoteUsdtToUsdc(amountIn);
  const minOut = (q.out * (10000n - SWAP_SLIPPAGE_BPS)) / 10000n;
  if (minOut * 10000n < amountIn * 9900n) throw new Error("the USDT→USDC quote is more than 1% off par; try again later");
  const before = await pub.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [user] });
  await ensureAllowance(wallet, arbitrum, USDT_ARBITRUM, UNISWAP_ROUTER_ARBITRUM, amountIn, "USDT", step);
  step("Confirm the swap in your wallet…");
  const hash = await wallet.writeContract({
    account: account(wallet),
    chain: arbitrum,
    address: UNISWAP_ROUTER_ARBITRUM,
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{ tokenIn: USDT_ARBITRUM, tokenOut: USDC_ADDRESS, fee: q.poolFee, recipient: user, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
  });
  step("Waiting for the swap to confirm…");
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("the swap reverted on chain; nothing was deposited");
  const after = await pub.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [user] });
  const received = after > before ? after - before : minOut;
  return { hash, received };
}

/** HyperEVM → HyperCore perps through Circle's CoreDepositWallet (approve, then deposit with dex 0) */
export async function depositHyperEvm(wallet: WalletClient, amountUnits: bigint, step: Step = noop): Promise<Hex> {
  step("Switch to HyperEVM…");
  await ensureChain(wallet, hyperEvm);
  await ensureAllowance(wallet, hyperEvm, HYPEREVM_USDC, CORE_DEPOSIT_WALLET, amountUnits, "USDC", step);
  step("Confirm the deposit in your wallet…");
  return wallet.writeContract({
    account: account(wallet),
    chain: hyperEvm,
    address: CORE_DEPOSIT_WALLET,
    abi: CORE_DEPOSIT_ABI,
    functionName: "deposit",
    args: [amountUnits, CORE_PERPS_DEX],
  });
}

/** Circle's message status for a burn tx: pending until attested, complete once minted and forwarded */
export async function cctpStatus(sourceDomain: number, hash: Hex): Promise<string | null> {
  try {
    const res = await fetch(`https://iris-api.circle.com/v2/messages/${sourceDomain}?transactionHash=${hash}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { messages?: { status?: string }[] };
    return j.messages?.[0]?.status ?? null;
  } catch {
    return null;
  }
}
