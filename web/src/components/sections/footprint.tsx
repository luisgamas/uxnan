import { CountDown } from "@/components/count-down";
import { Reveal } from "@/components/reveal";
import { BENCH, LINKS } from "@/lib/site";

const NUMBERS = [
  { value: BENCH.idleMb, label: "workspace asleep" },
  { value: BENCH.oneTerminalMb, label: "one agent, one terminal" },
  { value: BENCH.fourTerminalsMb, label: "four agents, four terminals" },
];

export function Footprint() {
  return (
    <section id="footprint" className="relative py-16 sm:py-24">
      <div className="wrap">
        <div className="rule mb-16" />

        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
          <Reveal>
            <p className="eyebrow">Measured, not guessed</p>
            <h2 className="display mt-4 text-[clamp(1.9rem,3.6vw,2.7rem)]">
              Small enough to leave the machine to the agents.
            </h2>
          </Reveal>

          <Reveal delay={80}>
            <p className="text-[1.0625rem] leading-relaxed text-muted">
              An agent needs the CPU more than your editor does. So the number
              that matters is what the app costs while they work — and it is a
              measurement, not a marketing figure: every run records the OS,
              webview version, CPU, build profile and commit before it records a
              megabyte.
            </p>

            <div className="mt-9 grid gap-3 sm:grid-cols-3">
              {NUMBERS.map((n) => (
                <div key={n.label} className="tile px-4 py-5">
                  <div className="display text-[clamp(1.5rem,2.6vw,1.9rem)]">
                    <CountDown to={n.value} />
                  </div>
                  <div className="mt-2 text-[12.5px] leading-snug text-dim">
                    {n.label}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-5 text-[12.5px] text-faint">
              {BENCH.platform}. Agent CLIs run in their own processes and are
              never counted as ours.{" "}
              <a
                href={LINKS.benchmarks}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted underline decoration-line-2 underline-offset-4 transition-colors hover:text-fg"
              >
                Read how it is measured
              </a>
              .
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
