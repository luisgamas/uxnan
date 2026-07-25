import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/**
 * `/robots.txt`. The site is fully public and *wants* to be read — by search
 * engines and by AI crawlers alike — so everything is allowed and the sitemap is
 * advertised. AI agents that respect robots (GPTBot, ClaudeBot, PerplexityBot,
 * Google-Extended, …) fall under `*` and are welcome; there is nothing to gate.
 * A richer, human/LLM-readable summary lives at `/llms.txt`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
