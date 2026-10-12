"use client";
/**
 * deposits never touch socialLiquid: a deposit is a plain USDC transfer from the user's wallet to hyperliquid's
 * bridge contract on arbitrum, which credits the perps balance in about a minute. withdrawals are signed by the
 * main wallet (never the agent key) and land on arbitrum a few minutes later.
 */
import { erc20Abi, parseUnits, type WalletClient } from "viem";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";
import { IS_TESTNET_CLIENT } from "./wagmi";

export const DEPOSIT_CHAIN = IS_TESTNET_CLIENT ? arbitrumSepolia : arbitrum;
/** native USDC on arbitrum (USDC2 on arbitrum sepolia for testnet) */
export const USDC_ADDRESS = (IS_TESTNET_CLIENT ? "0x1baAbB04529D43a73232B713C0FE471f7c7334d5" : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831") as `0x${string}`;
/** hyperliquid bridge2 */
export const HL_BRIDGE_ADDRESS = (IS_TESTNET_CLIENT ? "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89" : "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7") as `0x${string}`;
export const EXPLORER = IS_TESTNET_CLIENT ? "https://sepolia.arbiscan.io" : "https://arbiscan.io";
export const MIN_DEPOSIT = 5;
export const MIN_WITHDRAW = 2;
export const WITHDRAW_FEE = 1;

/** sends `amount` USDC to the bridge from the connected wallet; resolves with the tx hash once the user confirms */
export async function depositWithWallet(wallet: WalletClient, amount: string): Promise<`0x${string}`> {
  const account = wallet.account;
  if (!account) throw new Error("wallet not ready");
  const current = await wallet.getChainId();
  if (current !== DEPOSIT_CHAIN.id) await wallet.switchChain({ id: DEPOSIT_CHAIN.id });
  return wallet.writeContract({
    account,
    chain: DEPOSIT_CHAIN,
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [HL_BRIDGE_ADDRESS, parseUnits(amount, 6)],
  });
}
