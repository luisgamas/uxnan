import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/* Emitted as a static /sitemap.xml by `output: "export"`. */
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
