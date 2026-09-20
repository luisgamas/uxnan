import type { NextConfig } from "next";

/**
 * Static export — Next writes the page shell to `out/`. The one runtime route
 * lives separately in `functions/` and is deployed as a Cloudflare Pages
 * Function by Wrangler.
 */
const nextConfig: NextConfig = {
  output: "export",
  devIndicators: false,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
