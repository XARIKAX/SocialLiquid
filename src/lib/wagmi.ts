"use client";
import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { arbitrum, arbitrumSepolia, mainnet } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

export const IS_TESTNET_CLIENT = process.env.NEXT_PUBLIC_HL_NETWORK === "testnet";
const WC_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;

/**
 * wagmi's reconnect-on-mount calls `getProvider()` and `isAuthorized()` on every connector, which makes
 * the walletconnect and coinbase connectors import their (very large) sdks on every page load.
 * this wrapper stays inert until the user picks the connector or it was the one last connected,
 * so the sdk only loads when it is actually needed. reconnect skips a connector with no provider.
 */
function lazy(create: CreateConnectorFn): CreateConnectorFn {
  return (config) => {
    const connector = create(config);
    let armed = false;
    const arm = async () => {
      if (armed) return true;
      const recent = await config.storage?.getItem("recentConnectorId");
      if (recent !== connector.id) return false;
      armed = true;
      return true;
    };
    const wrapped: ReturnType<CreateConnectorFn> = {
      ...connector,
      async getProvider(params) {
        if (!(await arm())) return undefined;
        return connector.getProvider.call(wrapped, params);
      },
      async isAuthorized() {
        if (!(await arm())) return false;
        return connector.isAuthorized.call(wrapped);
      },
      connect: (async (params?: Parameters<typeof connector.connect>[0]) => {
        armed = true;
        return connector.connect.call(wrapped, params);
      }) as typeof connector.connect,
    };
    return wrapped;
  };
}

export const wagmiConfig = createConfig({
  chains: IS_TESTNET_CLIENT ? [arbitrumSepolia, arbitrum, mainnet] : [arbitrum, mainnet],
  connectors: [
    injected({ shimDisconnect: true }),
    ...(WC_ID
      ? [
          lazy(
            walletConnect({
              projectId: WC_ID,
              showQrModal: true,
              metadata: { name: "socialLiquid", description: "social trading for perps", url: typeof window !== "undefined" ? window.location.origin : "https://socialliquid.xyz", icons: [] },
            }),
          ),
        ]
      : []),
    lazy(coinbaseWallet({ appName: "socialLiquid", preference: "all" })),
  ],
  transports: { [arbitrum.id]: http(), [arbitrumSepolia.id]: http(), [mainnet.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
