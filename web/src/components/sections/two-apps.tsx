import { ArrowRight, Check, Monitor, Smartphone } from "lucide-react";

import { Section, SectionHeading } from "./shared";
import { MemoryCard, Phone } from "@/components/mockups/satellites";
import { LinkButton } from "@/components/ui/button";
import { BRIDGE_INSTALL_COMMAND, links, PHONE_AGENT_COUNT, RAM_FOOTPRINT } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Two products, said once: problem → product → what it needs.
 * CTAs stay on this site (features marquee / downloads) — no product subpages.
 */
export function TwoApps() {
  return (
    <Section id="apps">
      <div className="shell">
        <SectionHeading
          eyebrow="Two apps · two problems"
          title="Pick the pain you have today."
          lead={
            <>
              They share an ecosystem name and nothing about install. One never
              requires the other.
            </>
          }
        />

        <div className="mt-16 grid gap-6 lg:mt-20 lg:grid-cols-2 lg:gap-8">
          <AppCard
            kind="desktop"
            name="Uxnan Desktop"
            problem="Modest PCs still deserve modern agent workflows."
            tagline="Agents on your machine — without eating it."
            href="#features"
            cta="See Desktop in motion"
            summary={`A terminal-native workspace that organises CLI agents, worktrees and review. Measured at ${RAM_FOOTPRINT} — RAM stays with the agents, not with a second browser inside the app.`}
            requires="Standalone. No phone, no bridge, no account with us."
            points={[
              "Native OS webview — not Electron’s full Chromium tax",
              "One worktree + terminal + agent per task",
              "Diffs, git and PRs without leaving the window",
            ]}
            platforms="Windows · Linux · macOS (experimental)"
            visual={<MemoryCard className="w-full" />}
            delay={0}
          />

          <AppCard
            kind="mobile"
            name="Uxnan Mobile"
            problem="Remote agents without renting a vendor’s mobile app."
            tagline="Your PC’s agents. Your phone. Your accounts."
            href={links.playStore}
            cta="Get it on Google Play"
            external
            summary={`Drive the CLIs already on your PC from anywhere — stream turns, approve tools, review diffs — over end-to-end encryption. ${PHONE_AGENT_COUNT} agents in the picker; you choose per conversation.`}
            requires={
              <>
                Only the bridge:{" "}
                <code className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[13.5px]">
                  {BRIDGE_INSTALL_COMMAND}
                </code>
              </>
            }
            highlight="Does not need Uxnan Desktop."
            points={[
              "Provider-agnostic — not locked to one company’s stack",
              "Direct to your PC when possible; optional self-hosted relay",
              "Encrypted always, git and files included",
            ]}
            platforms="Android · iOS coming soon"
            visual={<Phone variant="conversation" className="h-[236px] w-[116px]" />}
            delay={90}
          />
        </div>
      </div>
    </Section>
  );
}

function AppCard({
  kind,
  name,
  problem,
  tagline,
  href,
  cta,
  external,
  summary,
  requires,
  highlight,
  points,
  platforms,
  visual,
  delay,
}: {
  kind: "desktop" | "mobile";
  name: string;
  problem: string;
  tagline: string;
  href: string;
  cta: string;
  external?: boolean;
  summary: string;
  requires: React.ReactNode;
  highlight?: string;
  points: string[];
  platforms: string;
  visual: React.ReactNode;
  delay: number;
}) {
  const Icon = kind === "desktop" ? Monitor : Smartphone;
  return (
    <div
      data-reveal
      data-reveal-delay={delay}
      className={cn(
        "card-wash flex flex-col rounded-2xl border border-border/70 p-8 md:p-10",
      )}
    >
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 place-items-center rounded-xl border border-accent/20 bg-surface-raised text-accent">
          <Icon className="size-5" aria-hidden />
        </span>
        <div>
          <h3 className="text-[1.375rem] font-semibold leading-tight">{name}</h3>
          <p className="text-[14.5px] text-muted-foreground">{tagline}</p>
        </div>
      </div>

      <p className="mt-5 text-[14px] font-medium leading-snug text-accent">{problem}</p>

      <div
        className={cn(
          "mt-6 flex items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-surface/50 p-6",
          kind === "desktop" ? "min-h-[168px]" : "min-h-[268px]",
        )}
      >
        {visual}
      </div>

      <p className="mt-6 text-[16px] leading-[1.75] text-muted-foreground">{summary}</p>

      <div className="mt-6 rounded-xl border border-border/70 bg-surface-raised/70 p-4">
        <p className="text-[12px] font-medium uppercase tracking-[0.09em] text-faint-foreground">
          What it needs
        </p>
        <p className="mt-1.5 text-[15px] leading-[1.6]">{requires}</p>
        {highlight && (
          <p className="mt-2 text-[15px] font-medium text-accent">{highlight}</p>
        )}
      </div>

      <ul className="mt-7 space-y-3.5">
        {points.map((point) => (
          <li key={point} className="flex gap-3 text-[15.5px] leading-[1.6]">
            <Check className="mt-1 size-4 shrink-0 text-accent" aria-hidden />
            <span className="text-muted-foreground">{point}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        <LinkButton
          href={href}
          variant="outline"
          className="w-full sm:w-auto"
          {...(external
            ? { target: "_blank", rel: "noreferrer noopener" }
            : {})}
        >
          {cta}
          <ArrowRight className="size-[18px]" aria-hidden />
        </LinkButton>
        <p className="mt-4 text-[13.5px] text-faint-foreground">{platforms}</p>
      </div>
    </div>
  );
}
