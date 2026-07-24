// A server component on purpose: it only composes client sections (each `"use
// client"` on its own), so it can export page metadata — which a client
// component cannot.
import type { Metadata } from "next";

import { Hero } from "@/components/hero/hero";
import { Agents } from "@/components/sections/agents";
import { Cta } from "@/components/sections/cta";
import { Faq } from "@/components/sections/faq";
import { Features } from "@/components/sections/features";
import { Problem } from "@/components/sections/problem";
import { TwoApps } from "@/components/sections/two-apps";
import { SiteShell } from "@/components/site/site-shell";

/**
 * Single-page marketing funnel + /download for installers.
 * No /desktop or /mobile product pages — surfaces live in the features marquee.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <SiteShell>
      <Hero />
      <Problem />
      <TwoApps />
      <Features />
      <Agents />
      <Faq />
      <Cta />
    </SiteShell>
  );
}
