import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next 16.3+ blocks dev resources (incl. the HMR endpoint) from origins that
  // are not whitelisted — the browser then never hydrates (silent stall).
  // "127.0.0.1" started being blocked after the 16.1 -> 16.3 upgrade.
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.z.ai", "*.zai"],
  devIndicators: false,
};

export default nextConfig;
