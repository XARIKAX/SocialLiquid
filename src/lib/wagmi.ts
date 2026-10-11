"use client";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrum, arbitrumSepolia, mainnet } from "wagmi/chains";
import { http } from "wagmi";

export const IS_TESTNET_CLIENT = process.env.NEXT_PUBLIC_HL_TESTNET === "true";

export const wagmiConfig = getDefaultConfig({
  appName: "socialLiquid",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID || "00000000000000000000000000000000",
  chains: IS_TESTNET_CLIENT ? [arbitrumSepolia, arbitrum, mainnet] : [arbitrum, mainnet],
  transports: { [arbitrum.id]: http(), [arbitrumSepolia.id]: http(), [mainnet.id]: http() },
  ssr: true,
});
