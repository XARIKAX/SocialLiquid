"use client";
/** client-side one-time approvals signed by the user's main wallet. the main key never leaves the wallet. */
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import type { WalletClient } from "viem";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { IS_TESTNET_CLIENT } from "./wagmi";

/**
 * hyperliquid actions are signed messages, never transactions: the EIP-712 domain carries whatever EVM chain the
 * wallet is on right now (Phantom sits on Ethereum, Base, Polygon or HyperEVM; MetaMask on anything). we read that
 * live from the wallet instead of trusting wagmi's fallback, so no wallet is ever asked to switch network to sign.
 */
async function exchange(wallet: WalletClient, chainId: number) {
  let id = chainId;
  try {
    id = await wallet.getChainId();
  } catch {
    /* keep the hook value */
  }
  return new ExchangeClient({
    transport: new HttpTransport({ isTestnet: IS_TESTNET_CLIENT }),
    // wagmi's wallet client satisfies the sdk's viem json-rpc account interface
    wallet: wallet as unknown as AbstractWallet,
    signatureChainId: `0x${id.toString(16)}`,
  });
}

export async function approveAgentWithWallet(wallet: WalletClient, chainId: number, agentAddress: string, agentName: string) {
  return (await exchange(wallet, chainId)).approveAgent({ agentAddress: agentAddress as `0x${string}`, agentName });
}

export async function approveBuilderFeeWithWallet(wallet: WalletClient, chainId: number, builder: string, maxFeeRate: string) {
  return (await exchange(wallet, chainId)).approveBuilderFee({ builder: builder as `0x${string}`, maxFeeRate });
}

/** withdraw USDC from hyperliquid to an arbitrum address. signed by the main wallet; the agent key cannot withdraw. $1 fee, ~5 minutes. */
export async function withdrawWithWallet(wallet: WalletClient, chainId: number, destination: string, amount: string) {
  return (await exchange(wallet, chainId)).withdraw3({ destination: destination as `0x${string}`, amount });
}

/**
 * USDC out of hyperliquid over Circle CCTP (`sendToEvmWithData`): hyperliquid burns the USDC, Circle attests, and
 * Circle's forwarding service mints it to `destination` on the chain whose CCTP domain is `domain`. this is the route
 * behind hyperliquid's own "Withdraw USDC to Arbitrum" (0.2 USDC fee). `sourceDex` "" = perps balance, "spot" = spot.
 */
export async function sendToEvmWithWallet(wallet: WalletClient, chainId: number, o: { amount: string; destination: string; domain: number; sourceDex?: "" | "spot" }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(o.destination)) throw new Error("bad destination address");
  return (await exchange(wallet, chainId)).sendToEvmWithData({
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
  return (await exchange(wallet, chainId)).usdClassTransfer({ amount, toPerp });
}

/** send USDC from the perps balance to another hyperliquid address (free, instant). the keys section pays subscriptions this way */
export async function usdSendWithWallet(wallet: WalletClient, chainId: number, destination: string, amount: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error("bad destination address");
  return (await exchange(wallet, chainId)).usdSend({ destination: destination as `0x${string}`, amount });
}

/** send a spot token to a hyperliquid address. `token` is "NAME:tokenId" as spotMeta lists it */
export async function spotSendWithWallet(wallet: WalletClient, chainId: number, destination: string, token: string, amount: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error("bad destination address");
  return (await exchange(wallet, chainId)).spotSend({ destination: destination as `0x${string}`, token, amount });
}

/** hip-3 dex abstraction: let the main perps USDC margin positions on every builder dex (one signature, main wallet) */
export async function setDexAbstractionWithWallet(wallet: WalletClient, chainId: number, user: string, enabled: boolean) {
  return (await exchange(wallet, chainId)).userDexAbstraction({ user: user as `0x${string}`, enabled });
}

/*
 * no main-wallet order signing here on purpose: orders and cancels are L1 actions, signed under the fixed
 * "Exchange" domain with chainId 1337. browser wallets refuse that (Phantom: "Unsupported network", MetaMask:
 * chain id mismatch), which is why hyperliquid itself routes every order through the approved agent key.
 * spot sells go through /api/trade/spot-sell (agent-signed) once trading is enabled.
 */
