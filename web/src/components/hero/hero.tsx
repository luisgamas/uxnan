"use client";

import { ArrowRight, Bot, FlaskConical, Gauge, Scale } from "lucide-react";

import { GlyphField } from "./glyph-field";
import { DownloadButton } from "@/components/site/download-button";
import { RepoStatsLine } from "@/components/site/repo-stats-line";
import { DesktopApp } from "@/components/mockups/desktop-app";
import {
  AgentView,
  Phone,
  ProjectCards,
  PullRequestPanel,
} from "@/components/mockups/satellites";
import { LinkButton } from "@/components/ui/button";
import { useScrollProgress } from "@/lib/hooks";
import { DESKTOP_TEST_COUNT, links, PHONE_AGENT_COUNT, RAM_FOOTPRINT } from "@/lib/site";

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

          {/*
            The one live counter on the page — the header carries no counter
            of its own any more (see `header.tsx`), so this is what every
            visitor, at every width, sees to know the repo is real.
          */}
          <RepoStatsLine className="mt-3.5" data-reveal data-reveal-delay="20" />

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
            Kept to ~2 visual lines on purpose — confident and concrete, not a
            pitch. The RAM figure lives in the proof strip below instead of
            here, where it would compete with the actual headline: any CLI
            agent, 7 of them first-class.
          */}
          <p
            className="mx-auto mt-7 max-w-[46ch] text-[clamp(1.0625rem,1.6vw,1.1875rem)] leading-[1.7] text-muted-foreground"
            data-reveal
            data-reveal-delay="140"
          >
            <b className="font-medium text-foreground">Desktop</b> runs any CLI
            agent — {PHONE_AGENT_COUNT} with first-class support.{" "}
            <b className="font-medium text-foreground">Mobile</b> reaches those{" "}
            {PHONE_AGENT_COUNT} from your phone. Independent apps. No lock-in.
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

          {/*
            Honest proof, not testimonials — there are none yet, the project is
            alpha. Four short, independently-checkable facts instead: each links
            to the exact page that backs it.
          */}
          <ul
            className="mx-auto mt-9 flex max-w-[42rem] flex-wrap items-center justify-center gap-x-6 gap-y-2.5 text-[13.5px] text-muted-foreground"
            data-reveal
            data-reveal-delay="280"
          >
            <li>
              <a
                href={links.benchmarksGuide}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <Gauge className="size-[14px] text-accent" aria-hidden />
                <b className="font-medium text-foreground">{RAM_FOOTPRINT}</b>
                measured, not promised
              </a>
            </li>
            <li>
              <a
                href={links.testingGuide}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <FlaskConical className="size-[14px] text-accent" aria-hidden />
                <b className="font-medium text-foreground">
                  {DESKTOP_TEST_COUNT.toLocaleString("en-US")}
                </b>
                automated tests
              </a>
            </li>
            <li>
              <a
                href={links.license}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <Scale className="size-[14px] text-accent" aria-hidden />
                MPL-2.0 · open source
              </a>
            </li>
            <li className="flex items-center gap-1.5">
              <Bot className="size-[14px] text-accent" aria-hidden />
              <b className="font-medium text-foreground">{PHONE_AGENT_COUNT}</b>
              first-class agent CLIs
            </li>
          </ul>
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
