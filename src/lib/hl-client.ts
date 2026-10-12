"use client";
/** client-side one-time approvals signed by the user's main wallet. the main key never leaves the wallet. */
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import type { WalletClient } from "viem";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { IS_TESTNET_CLIENT } from "./wagmi";

function exchange(wallet: WalletClient, chainId: number) {
  return new ExchangeClient({
    transport: new HttpTransport({ isTestnet: IS_TESTNET_CLIENT }),
    // wagmi's wallet client satisfies the sdk's viem json-rpc account interface
    wallet: wallet as unknown as AbstractWallet,
    signatureChainId: `0x${chainId.toString(16)}`,
  });
}

export async function approveAgentWithWallet(wallet: WalletClient, chainId: number, agentAddress: string, agentName: string) {
  return exchange(wallet, chainId).approveAgent({ agentAddress: agentAddress as `0x${string}`, agentName });
}

export async function approveBuilderFeeWithWallet(wallet: WalletClient, chainId: number, builder: string, maxFeeRate: string) {
  return exchange(wallet, chainId).approveBuilderFee({ builder: builder as `0x${string}`, maxFeeRate });
}

/** withdraw USDC from hyperliquid to an arbitrum address. signed by the main wallet; the agent key cannot withdraw. $1 fee, ~5 minutes. */
export async function withdrawWithWallet(wallet: WalletClient, chainId: number, destination: string, amount: string) {
  return exchange(wallet, chainId).withdraw3({ destination: destination as `0x${string}`, amount });
}
