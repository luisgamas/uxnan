import type { NextConfig } from "next";

/**
 * Static export — the site has no server runtime. `next build` writes `out/`,
 * which is what gets uploaded to the host.
 */
const nextConfig: NextConfig = {
  output: "export",
  devIndicators: false,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
