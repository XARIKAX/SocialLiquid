import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "prisma"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  webpack: (config) => {
    // wagmi / walletconnect optional deps that are not needed in the browser bundle
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
