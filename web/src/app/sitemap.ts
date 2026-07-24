import type { MetadataRoute } from "next";

import { ROUTES, SITE_URL } from "@/lib/site";

// A static export has no request time, so the whole route must be static.
export const dynamic = "force-static";

/**
 * `/sitemap.xml`, generated at build time from the single route list in
 * `site.ts`. This is what you submit in Google Search Console; `robots.txt`
 * points at it too.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
