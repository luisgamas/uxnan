import { HugeiconsIcon } from "@hugeicons/react";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
import { Reveal } from "@/components/reveal";
import { AGENT_ICON, INVERT_ON_DARK } from "@/lib/site";

const POINTS = [
  "A new worktree in seconds — new branch, existing branch, or anywhere you like.",
  "Terminals that survive sleep and restore with their scrollback intact.",
  "Commit, push and open the PR with the merge methods your repo actually allows.",
  "Subagents show up nested under the agent that spawned them.",
];

const LANES = [
  {
    branch: "feat/reconnect-backoff",
    agent: "Claude Code",
    id: "claudecode",
    icon: AGENT_ICON.claudecode,
    state: "working",
    detail: "editing zero-adapter.ts",
  },
  {
    branch: "fix/windows-flake",
    agent: "Codex",
    id: "codex",
    icon: AGENT_ICON.codex,
    state: "waiting",
    detail: "asking to run the suite",
  },
  {
    branch: "docs/agent-surfaces",
    agent: "OpenCode",
    id: "opencode",
    icon: AGENT_ICON.opencode,
    state: "done",
    detail: "+142 −38 · ready to review",
  },
];

const TONE = {
  working: { dot: "bg-live", label: "Working", text: "text-live" },
  waiting: { dot: "bg-orange", label: "Waiting on you", text: "text-orange" },
  done: { dot: "bg-brand-lit", label: "Done", text: "text-brand-lit" },
} as const;

export function Parallel() {
  return (
    <section id="desktop" className="relative py-16 sm:py-24">
      <div className="wrap grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-20">
        <Reveal>
          <p className="eyebrow">Parallel by default</p>
          <h2 className="display mt-4 text-[clamp(1.9rem,3.6vw,2.9rem)]">
            One task. One worktree. One agent.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted">
            Every task gets its own isolated git worktree, so nothing an agent
            touches collides with what you&apos;re doing — or with the other
            three. You keep one window, and each of them keeps their own copy of
            the repo.
          </p>

          <ul className="mt-8 flex flex-col gap-3.5">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3 text-[14.5px] text-muted">
                <HugeiconsIcon icon={CheckIcon} className="mt-[3px] size-4 shrink-0 text-live" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={100}>
          <div className="tile overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-[12px] text-dim">
              <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
              <span className="text-fg">uxnan</span>
              <span className="text-faint">· 3 active worktrees</span>
              <span className="ml-auto flex items-center gap-1.5 text-[11px]">
                <HugeiconsIcon icon={GitPullRequestIcon} className="size-3.5" /> 1 ready
              </span>
            </div>

            <div className="flex flex-col divide-y divide-[color:var(--color-line)]">
              {LANES.map((l) => {
                const tone = TONE[l.state as keyof typeof TONE];
                return (
                  <div key={l.branch} className="flex items-center gap-3 px-4 py-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-line bg-ink">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={l.icon}
                        alt=""
                        className={`size-4 rounded-[3px] object-contain ${INVERT_ON_DARK.has(l.id) ? "invert" : ""}`}
                      />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12px] text-fg">
                        {l.branch}
                      </div>
                      <div className="mt-1 truncate text-[11.5px] text-faint">
                        {l.agent} · {l.detail}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`size-[6px] rounded-full ${tone.dot}`}
                        style={
                          l.state === "working"
                            ? { animation: "ux-pulse 2.4s ease-out infinite" }
                            : undefined
                        }
                      />
                      <span className={`text-[11.5px] ${tone.text}`}>
                        {tone.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="relative overflow-hidden border-t border-line px-4 py-3">
              <div className="flex items-center gap-2 text-[11.5px] text-dim">
                <span className="font-mono text-faint">$</span>
                <span className="font-mono">git worktree add ../uxnan--fix</span>
                <span className="ml-auto text-live">ready in 0.9s</span>
              </div>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/[0.045] to-transparent"
                style={{ animation: "ux-sweep 4.5s ease-in-out infinite" }}
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
