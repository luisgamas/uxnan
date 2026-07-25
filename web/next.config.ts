import type { NextConfig } from "next";

/**
 * The site is a fully static export: `next build` writes `out/`, which is what
 * Cloudflare Pages serves. There is no server runtime, so every dynamic bit
 * (OS detection, GitHub release lookup, theme) happens in the browser.
 */
const nextConfig: NextConfig = {
  output: "export",
  // The monorepo root also carries a lockfile; pin tracing to this package so
  // Next.js stops guessing which one is the workspace root.
  outputFileTracingRoot: import.meta.dirname,
  // No Next.js image optimizer in a static export; assets are already SVG/inline.
  images: { unoptimized: true },
  // Emit `out/<route>/index.html` so any static host resolves clean URLs.
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
