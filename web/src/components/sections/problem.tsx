import { EyeOff, Gauge, Layers } from "lucide-react";

import { Section, SectionHeading } from "./shared";
import { ELECTRON_RAM } from "@/lib/site";

/**
 * Problem → agitation → turn.
 *
 * Two real pains, one each for the product that solves it later on the page.
 * No feature dump, no villain brand names — only what the visitor can check
 * against their own week.
 */
export function Problem() {
  return (
    <Section id="problem" tone="sunken">
      <div className="shell">
        <SectionHeading
          eyebrow="Who gets left behind"
          title="Agents got better. The shell around them did not get fairer."
          lead={
            <>
              Every cycle ships heavier UIs and tighter vendor apps. The people on
              modest hardware — and anyone who refuses to live inside one provider&apos;s
              phone — are treated as edge cases. They are not.
            </>
          }
        />

        <div className="mt-16 grid gap-6 lg:mt-20 lg:grid-cols-2 lg:gap-8">
          <ProblemCard
            icon={<Gauge className="size-5" aria-hidden />}
            title="Heavy shells starve the work"
            delay={0}
          >
            <p>
              A typical Electron shell sits at{" "}
              <b className="font-medium text-foreground">{ELECTRON_RAM}</b> before a
              single agent starts. On a laptop that already has little spare RAM, that
              memory is not “comfort” — it is the run you are waiting on.
            </p>
            <p>
              Bare terminals are light, and chaos: which branch, which agent, who is
              blocked on you. You should not have to choose between a modern surface and
              enough machine left for the agents.
            </p>
          </ProblemCard>

          <ProblemCard
            icon={<EyeOff className="size-5" aria-hidden />}
            title="Remote control came with a leash"
            delay={90}
          >
            <p>
              The agent keeps working when you leave the desk. Most phone apps only
              reopen the loop if you adopt{" "}
              <b className="font-medium text-foreground">their</b> provider,{" "}
              <b className="font-medium text-foreground">their</b> desktop product, and{" "}
              <b className="font-medium text-foreground">their</b> account.
            </p>
            <p>
              If you already pay for Claude, Codex, OpenCode or another CLI on your PC,
              you should not need a second stack just to approve a diff from the train.
            </p>
          </ProblemCard>
        </div>

        <div
          className="mx-auto mt-16 max-w-[56rem] rounded-2xl border border-accent/20 bg-accent-tint p-8 text-center md:p-10 lg:mt-20"
          data-reveal
        >
          <span className="mx-auto mb-6 grid size-11 place-items-center rounded-xl border border-accent/25 bg-surface-raised text-accent">
            <Layers className="size-5" aria-hidden />
          </span>
          <p className="text-[clamp(1.25rem,2.1vw,1.625rem)] font-medium leading-[1.5]">
            Uxnan is not another agent. It is where the agents you already run live —
            light on the PC, free of the vendor leash on the phone.
          </p>
          <p className="mx-auto mt-5 max-w-[48ch] text-[16px] leading-[1.7] text-muted-foreground">
            Each agent starts as its own official CLI, under the account you already
            signed in with. No provider API key handed to us. No forced bundle of
            desktop + mobile.
          </p>
        </div>
      </div>
    </Section>
  );
}

function ProblemCard({
  icon,
  title,
  children,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  delay: number;
}) {
  return (
    <div
      data-reveal
      data-reveal-delay={delay}
      className="rounded-2xl border border-border/70 bg-surface-raised p-8 md:p-10"
    >
      <span className="mb-6 grid size-11 place-items-center rounded-xl border border-border bg-surface text-muted-foreground">
        {icon}
      </span>
      <h3 className="text-[1.375rem] font-semibold leading-snug">{title}</h3>
      <div className="mt-4 space-y-4 text-[16px] leading-[1.75] text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
