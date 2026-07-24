import { Section } from "./shared";
import { AgentMark } from "@/components/mockups/primitives";
import {
  TERMINAL_ONLY_AGENTS,
  WIRED_AGENTS,
  WIRED_AGENT_COUNT,
} from "@/lib/site";
import { cn } from "@/lib/utils";

/** Two drifting rows of CLI marks — the list is not a closed menu. */
const MARQUEE = [
  ...WIRED_AGENTS.map((a) => ({ ...a, wired: true })),
  ...TERMINAL_ONLY_AGENTS.map((a) => ({ ...a, wired: false })),
];

const ROW_A = MARQUEE.filter((_, i) => i % 2 === 0);
const ROW_B = MARQUEE.filter((_, i) => i % 2 === 1);

export function Agents() {
  return (
    <Section id="agents" tone="sunken" className="overflow-hidden">
      <div className="shell">
        <div className="mx-auto max-w-[42rem] text-center">
          <p className="eyebrow justify-center" data-reveal>
            Your CLIs · your accounts
          </p>
          <h2
            className="mt-5 text-[clamp(2rem,3.6vw,3rem)] font-semibold"
            data-reveal
            data-reveal-delay="60"
          >
            Bring the agent you already use.
          </h2>
          <p
            className="mt-6 text-[clamp(1.0625rem,1.35vw,1.1875rem)] leading-[1.7] text-muted-foreground"
            data-reveal
            data-reveal-delay="120"
          >
            <b className="font-medium text-foreground">{WIRED_AGENT_COUNT} CLIs</b>{" "}
            are wired for remote control from the phone. Desktop is terminal-native —
            anything you can start in a shell runs unmodified, including whatever
            ships next month.
          </p>
        </div>
      </div>

      <div className="mt-14 space-y-4 lg:mt-16" data-reveal aria-hidden>
        <MarqueeRow items={ROW_A} duration={75} />
        <MarqueeRow items={ROW_B} duration={95} reverse />
      </div>
    </Section>
  );
}

const REPEATS_PER_HALF = 3;

function MarqueeRow({
  items,
  duration,
  reverse = false,
}: {
  items: { id: string; name: string; logo: string; wired: boolean }[];
  duration: number;
  reverse?: boolean;
}) {
  const half = Array.from({ length: REPEATS_PER_HALF }, () => items).flat();
  const loop = [...half, ...half];
  return (
    <div className="mask-edges overflow-hidden">
      <div
        className="flex w-max gap-4"
        style={{
          animation: `ux-marquee ${duration}s linear infinite${reverse ? " reverse" : ""}`,
        }}
      >
        {loop.map((agent, index) => (
          <div
            key={`${agent.id}-${index}`}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-2xl border border-border/70 bg-surface-raised px-5 py-3.5",
            )}
          >
            <AgentMark logo={agent.logo} name={agent.name} className="size-9" />
            <div className="whitespace-nowrap">
              <div className="text-[15px] font-medium leading-tight">{agent.name}</div>
              <div className="text-[12.5px] text-faint-foreground">
                {agent.wired ? "wired end to end" : "runs in the terminal"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
