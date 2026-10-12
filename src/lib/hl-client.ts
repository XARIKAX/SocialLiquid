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

/**
 * USDC out of hyperliquid over Circle CCTP (`sendToEvmWithData`): hyperliquid burns the USDC, Circle attests, and
 * Circle's forwarding service mints it to `destination` on the chain whose CCTP domain is `domain`. this is the route
 * behind hyperliquid's own "Withdraw USDC to Arbitrum" (0.2 USDC fee). `sourceDex` "" = perps balance, "spot" = spot.
 */
export async function sendToEvmWithWallet(wallet: WalletClient, chainId: number, o: { amount: string; destination: string; domain: number; sourceDex?: "" | "spot" }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(o.destination)) throw new Error("bad destination address");
  return exchange(wallet, chainId).sendToEvmWithData({
    token: "USDC",
    amount: o.amount,
    sourceDex: o.sourceDex ?? "",
    destinationRecipient: o.destination.toLowerCase(),
    addressEncoding: "hex",
    destinationChainId: o.domain,
    gasLimit: 200000,
    data: "0x",
  });
}

/** move USDC between the perps and spot balances (free, instant) */
export async function usdClassTransferWithWallet(wallet: WalletClient, chainId: number, amount: string, toPerp: boolean) {
  return exchange(wallet, chainId).usdClassTransfer({ amount, toPerp });
}

/** send a spot token to a hyperliquid address. `token` is "NAME:tokenId" as spotMeta lists it */
export async function spotSendWithWallet(wallet: WalletClient, chainId: number, destination: string, token: string, amount: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error("bad destination address");
  return exchange(wallet, chainId).spotSend({ destination: destination as `0x${string}`, token, amount });
}

/** hip-3 dex abstraction: let the main perps USDC margin positions on every builder dex (one signature, main wallet) */
export async function setDexAbstractionWithWallet(wallet: WalletClient, chainId: number, user: string, enabled: boolean) {
  return exchange(wallet, chainId).userDexAbstraction({ user: user as `0x${string}`, enabled });
}
