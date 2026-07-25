"use client";

import { ArrowRight } from "lucide-react";

import { GlyphField } from "./glyph-field";
import { DownloadButton } from "@/components/site/download-button";
import { DesktopApp } from "@/components/mockups/desktop-app";
import {
  AgentView,
  Phone,
  ProjectCards,
  PullRequestPanel,
} from "@/components/mockups/satellites";
import { LinkButton } from "@/components/ui/button";
import { useScrollProgress } from "@/lib/hooks";
import { RAM_TARGET } from "@/lib/site";

/**
 * The satellites that surround the main window once it has settled.
 *
 * Their offsets are relative to the rail below, which is sized and placed to
 * match the settled window — so each panel overlaps the same corner by the same
 * amount whether the display is 1280px or 4K, tall or short. `--d` is the
 * arrival delay (0 = first), `--fx`/`--fy` the direction each one travels from.
 */
const SATELLITES = [
  {
    key: "projects",
    node: <ProjectCards className="w-[210px]" />,
    className: "-top-[6%] left-0",
    style: { "--d": 0, "--fx": "-72px", "--fy": "18px" },
  },
  {
    key: "agents",
    node: <AgentView className="w-[232px]" />,
    className: "bottom-[6%] left-0",
    style: { "--d": 0.34, "--fx": "-84px", "--fy": "-10px" },
  },
  {
    key: "pr",
    node: <PullRequestPanel className="w-[224px]" />,
    className: "-top-[2%] right-0",
    style: { "--d": 0.17, "--fx": "78px", "--fy": "20px" },
  },
  {
    key: "phone",
    node: <Phone className="h-[258px] w-[126px]" />,
    className: "-bottom-[8%] right-[6%]",
    style: { "--d": 0.5, "--fx": "70px", "--fy": "34px" },
  },
] as const;

export function Hero() {
  const stageRef = useScrollProgress<HTMLElement>();

  return (
    <section
      id="top"
      ref={stageRef}
      className="stage relative lg:h-[300vh]"
      aria-label="Uxnan"
    >
      <div className="stage-pin relative flex min-h-[100svh] flex-col overflow-hidden pb-16 lg:sticky lg:top-0 lg:h-[100svh] lg:pb-0">
        {/* Living glyph field — shallow across the middle, deeper at the edges. */}
        <div className="stage-glyphs pointer-events-none absolute inset-0" aria-hidden>
          <GlyphField />
          <div className="absolute inset-0 bg-[radial-gradient(54%_40%_at_50%_33%,var(--background)_26%,transparent_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-background via-background/85 to-transparent" />
        </div>

        <div className="stage-copy shell relative z-20 pt-[112px] text-center lg:pt-[140px]">
          <p className="eyebrow justify-center" data-reveal>
            <span className="size-1.5 rounded-full bg-positive" />
            Free · Open source · MPL-2.0
          </p>

          <h1
            className="mx-auto mt-6 max-w-[18ch] text-[clamp(2.35rem,5.4vw,4.125rem)] font-semibold"
            data-reveal
            data-reveal-delay="60"
          >
            Power for agents.
            <span className="mt-1 block text-gradient">Not wasted on chrome.</span>
          </h1>

          {/*
            Two products, named separately and given separate promises. They are
            not two halves of one thing, and the copy must never imply they are.
          */}
          <p
            className="mx-auto mt-7 max-w-[52ch] text-[clamp(1.0625rem,1.6vw,1.1875rem)] leading-[1.7] text-muted-foreground"
            data-reveal
            data-reveal-delay="140"
          >
            Two independent apps for the CLI coding agents you already use — not
            another agent, not another vendor lock-in.{" "}
            <b className="font-medium text-foreground">Desktop</b> runs several on{" "}
            {RAM_TARGET} so modest PCs stay in the game.{" "}
            <b className="font-medium text-foreground">Mobile</b> steers those agents
            from your phone without their app, their stack, or their wall. Use one or
            both. Neither needs the other.
          </p>

          <div
            className="mt-10 flex justify-center"
            data-reveal
            data-reveal-delay="220"
          >
            <DownloadButton
              secondary="link"
              showMacAuthCard
              extra={
                <LinkButton
                  href="/download/#mobile"
                  variant="secondary"
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  Uxnan Mobile
                  <ArrowRight className="size-[18px]" aria-hidden />
                </LinkButton>
              }
            />
          </div>
        </div>

        {/*
          The window rises out of the fold and widens as the section scrolls.

          This wrapper only exists to place the window in normal flow on small
          screens. From `lg` up it goes `static` on purpose, so the absolutely
          positioned window resolves against the pinned viewport instead of
          against whatever height happens to be left under the headline.
        */}
        <div className="relative z-10 mt-12 flex-1 lg:static lg:mt-0">
          <div className="stage-window mx-auto w-[94%] max-w-[46rem] lg:w-auto lg:max-w-none">
            <DesktopApp className="h-full" />
          </div>
        </div>

        {/*
          Small screens get the same panels, as a swipeable strip instead of a
          pinned collage — the choreography does not survive a phone, but the
          content it reveals is worth keeping.
        */}
        <div className="relative z-10 mt-8 lg:hidden" aria-hidden>
          <div className="mask-edges flex snap-x snap-mandatory gap-4 overflow-x-auto px-[6%] pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SATELLITES.map((satellite, i) => (
              <div
                key={satellite.key}
                className="shrink-0 snap-center"
                data-reveal
                data-reveal-delay={i * 90}
              >
                {satellite.node}
              </div>
            ))}
          </div>
          <p className="shell text-center text-[13px] text-faint-foreground">
            Projects · agents and their sub-agents · pull requests · the phone
          </p>
        </div>

        <div className="stage-rail pointer-events-none z-30 hidden xl:block">
          {SATELLITES.map((satellite) => (
            <div
              key={satellite.key}
              aria-hidden
              className={`stage-sat z-30 ${satellite.className}`}
              style={satellite.style as React.CSSProperties}
            >
              {satellite.node}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
