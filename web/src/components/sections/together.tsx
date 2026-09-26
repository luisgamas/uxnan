import { HugeiconsIcon } from "@hugeicons/react";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import { Reveal } from "@/components/reveal";
import { CHAT_AGENTS, CONTROL_CLI } from "@/lib/site";

const POINTS = [
  "Every read, search, edit and command shows up as the agent takes it — the same way for every agent, on both screens.",
  "Send, stop, answer an approval or switch the model from either one; the other shows it as it happens.",
  "A chat you start from the phone gets Uxnan's tools too, while the desktop is running.",
];

const LINES: { cmd?: string; note?: string }[] = [
  { note: "# Claude Code, working on main, hands a review to Codex" },
  { cmd: CONTROL_CLI.worktree },
  { cmd: CONTROL_CLI.chatStart },
  { cmd: CONTROL_CLI.chatWait },
  { cmd: CONTROL_CLI.chatRead },
  { note: "# …and checks the result in the workspace's own browser" },
  { cmd: CONTROL_CLI.browser },
];

export function Together() {
  return (
    <section id="together" className="relative py-16 sm:py-24">
      <div className="wrap">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="eyebrow">Desktop and phone, one workspace</p>
          <h2 className="display mt-4 text-[clamp(1.9rem,3.6vw,2.9rem)]">
            Start it at your desk. Finish it from the sofa.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted">
            Open a chat in Uxnan Desktop and it is already on your phone — the
            same conversation, live, in both places. It works with{" "}
            {CHAT_AGENTS.map((a) => a.name).join(", ").replace(/, ([^,]*)$/, " and $1")}.
          </p>
        </Reveal>

        <Reveal delay={60}>
          <div className="mx-auto mt-8 flex max-w-[34rem] flex-wrap items-center justify-center gap-2">
            {CHAT_AGENTS.map((a) => (
              <span
                key={a.id}
                title={a.name}
                className="grid size-9 place-items-center rounded-[11px] border border-line bg-white/92"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.icon} alt={a.name} className="size-[18px] object-contain" />
              </span>
            ))}
          </div>
        </Reveal>

        <div className="mt-14 grid grid-cols-[minmax(0,1fr)] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          <Reveal>
            <ul className="flex flex-col gap-3.5">
              {POINTS.map((p) => (
                <li key={p} className="flex gap-3 text-[14.5px] text-muted">
                  <HugeiconsIcon icon={CheckIcon} className="mt-[3px] size-4 shrink-0 text-live" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>

            <h3 className="mt-10 text-[16px] font-semibold">
              Agents that work together.
            </h3>
            <p className="mt-2.5 max-w-[52ch] text-[14.5px] leading-relaxed text-muted">
              Inside Uxnan every agent already has{" "}
              <code className="font-mono text-[13px] text-fg/85">{CONTROL_CLI.name}</code>{" "}
              and Uxnan&apos;s MCP tools — nothing to install. It can open a
              worktree, start a chat with another agent, wait for it and read
              what it answered, then test the app in a real browser. You see
              every step, and nothing it does is destructive.
            </p>
          </Reveal>

          <Reveal delay={100}>
            <div className="tile overflow-hidden">
              <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="ml-2 font-mono text-[11px] text-faint">
                  an agent&apos;s terminal inside Uxnan
                </span>
              </div>
              <div className="overflow-x-auto p-4 font-mono text-[12px] leading-[2] sm:p-5">
                {LINES.map((l, i) =>
                  l.cmd ? (
                    <div key={i} className="whitespace-nowrap">
                      <span className="text-live">$</span>{" "}
                      <span className="text-muted">{l.cmd}</span>
                    </div>
                  ) : (
                    <div key={i} className={`whitespace-nowrap text-faint ${i ? "mt-2" : ""}`}>
                      {l.note}
                    </div>
                  ),
                )}
                <div className="text-dim">
                  <span className="text-live">$</span> <span className="caret" />
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
