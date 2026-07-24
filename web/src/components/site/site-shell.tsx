"use client";

import { Footer } from "./footer";
import { Header } from "./header";
import { useRevealOnScroll } from "@/lib/hooks";

/**
 * The chrome every page shares: the header, an opaque main (which is what
 * uncovers the fixed footer on the last scroll), and the footer itself.
 */
export function SiteShell({
  children,
  minimalHeader = false,
}: {
  children: React.ReactNode;
  minimalHeader?: boolean;
}) {
  useRevealOnScroll();

  return (
    <>
      <Header minimal={minimalHeader} />
      {/* Opaque and above the fixed footer — this is what uncovers it on the
          last scroll of the page. */}
      <main id="main" className="relative z-10 bg-background">
        {children}
      </main>
      <Footer />
    </>
  );
}
