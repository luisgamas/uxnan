"use client";

import { useEffect, useRef } from "react";
import { Coffee, Heart } from "lucide-react";

import { links } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * The support actions under the wordmark. The repository already has a button in
 * the header, so the footer's identity block is where the "help it keep moving"
 * links belong instead — a GitHub sponsor heart and a Buy Me a Coffee cup.
 */
const SUPPORT = [
  {
    href: links.sponsor,
    label: "Sponsor Uxnan on GitHub",
    icon: Heart,
    // Sponsor pink on hover, matching GitHub's own sponsor affordance.
    hover: "hover:border-[#db61a2]/50 hover:text-[#db61a2]",
  },
  {
    href: links.coffee,
    label: "Buy the maintainer a coffee",
    icon: Coffee,
    hover: "hover:border-warning/50 hover:text-warning",
  },
] as const;

const COLUMNS = [
  {
    title: "Products",
    items: [
      { label: "Uxnan Desktop", href: links.desktopReadme },
      { label: "Uxnan Mobile", href: links.mobileReadme },
      { label: "The bridge", href: links.bridgeReadme },
      { label: "The relay", href: links.relayReadme },
    ],
  },
  {
    title: "Get it",
    items: [
      { label: "Desktop releases", href: links.releases },
      { label: "Android — Google Play", href: links.playStore },
      { label: "Bridge on npm", href: links.npmBridge },
      { label: "Installing on macOS", href: links.macosGuide },
    ],
  },
  {
    title: "Learn",
    items: [
      { label: "Updates & channels", href: links.updatesGuide },
      { label: "Orchestration", href: links.orchestrationGuide },
      { label: "Integrated browser", href: links.browserGuide },
      { label: "Provider usage", href: links.providersGuide },
    ],
  },
  {
    title: "Take part",
    items: [
      { label: "Issues", href: links.issues },
      { label: "Discussions", href: links.discussions },
      { label: "Contributing", href: links.contributing },
      { label: "Security policy", href: links.security },
    ],
  },
] as const;

/**
 * The footer sits behind the page and is uncovered as the last section scrolls
 * off, growing very slightly as it arrives. `--fp` (0 → 1) is how much of it is
 * showing, written by the scroll handler below.
 *
 * The reveal is desktop-only: the runway stays at zero height below 1024px and
 * the CSS drops back to a normal, in-flow footer, because a viewport-tall fixed
 * panel behind the page is a bad trade on a phone.
 */
export function Footer() {
  const runwayRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const runway = runwayRef.current;
    const footer = footerRef.current;
    if (!runway || !footer) return;

    const desktop = window.matchMedia("(min-width: 1024px)");
    let height = 0;
    let frame = 0;

    const sync = () => {
      if (!desktop.matches) {
        runway.style.height = "0px";
        footer.style.removeProperty("--fp");
        return;
      }
      height = footer.offsetHeight;
      runway.style.height = `${height}px`;
      update();
    };

    const update = () => {
      frame = 0;
      if (!desktop.matches || height === 0) return;
      const seen = window.scrollY + window.innerHeight;
      const start = document.documentElement.scrollHeight - height;
      const p = Math.min(1, Math.max(0, (seen - start) / height));
      footer.style.setProperty("--fp", p.toFixed(4));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(footer);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", sync, { passive: true });
    desktop.addEventListener("change", sync);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", sync);
      desktop.removeEventListener("change", sync);
    };
  }, []);

  return (
    <>
      {/* Scroll runway: exactly as tall as the footer it uncovers. */}
      <div ref={runwayRef} aria-hidden className="footer-runway" />

      <footer ref={footerRef} className="footer-panel bg-surface">
        <div className="shell py-16 lg:py-20">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,3fr)]">
            <div>
              <a href="#top" className="flex items-center gap-2.5 font-semibold">
                <img src="/logo.svg" alt="" aria-hidden className="size-9 rounded-lg" />
                <span className="text-[18px]">Uxnan</span>
              </a>
              <p className="mt-5 max-w-[34ch] text-[15px] leading-[1.7] text-muted-foreground">
                The control plane for the CLI coding agents you already use. Light on
                the machine, encrypted end to end, and open from top to bottom.
              </p>
              <p className="mt-4 text-[13.5px] text-faint-foreground">
                Pronounced <span className="font-mono">/uʃ.nan/</span>
              </p>

              <div className="mt-6">
                <p className="text-[12px] font-medium uppercase tracking-[0.09em] text-faint-foreground">
                  Support the project
                </p>
                <div className="mt-3 flex items-center gap-2.5">
                  {SUPPORT.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={item.label}
                      title={item.label}
                      className={cn(
                        "grid size-11 place-items-center rounded-full border border-border bg-surface-raised text-muted-foreground transition-colors",
                        item.hover,
                      )}
                    >
                      <item.icon className="size-[18px]" aria-hidden />
                    </a>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
              {COLUMNS.map((column) => (
                <div key={column.title}>
                  <h3 className="text-[12px] font-medium uppercase tracking-[0.09em] text-faint-foreground">
                    {column.title}
                  </h3>
                  <ul className="mt-4 space-y-3">
                    {column.items.map((item) => (
                      <li key={item.label}>
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[15px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-14 flex flex-col gap-3 border-t border-border/70 pt-8 text-[13.5px] text-faint-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              Released under the{" "}
              <a
                href={links.license}
                target="_blank"
                rel="noreferrer noopener"
                className="text-muted-foreground hover:text-foreground"
              >
                Mozilla Public License 2.0
              </a>
              .
            </p>
            <p>A name with no relation to any existing product.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
