import {
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { AGENT_ICON, CLAUDE_TERMINAL_ICON, INVERT_ON_DARK } from "@/lib/site";

/* ───────────────────────────────────────────────────────────────────────────
   A DOM recreation of Uxnan Desktop — not a screenshot.

   Chrome, panel order and wording follow the real app: one tab per running
   agent (subagents get no tab), the project rail with its live agent view
   underneath the worktree, the agent terminal in the centre, and
   Files / Changes / History / GitHub on the right.
   ─────────────────────────────────────────────────────────────────────────── */

type Tone = "live" | "done" | "idle";

const AGENTS_RUNNING = [
  {
    name: "Claude Code",
    id: "claudecode",
    icon: AGENT_ICON.claudecode,
    state: "Working",
    tone: "live" as Tone,
    time: "now",
    active: true,
    children: ["Explore the mobile UI screens", "Document the web mockups"],
  },
  {
    name: "Uxnan project session startup",
    id: "pi",
    icon: AGENT_ICON.pi,
    state: "Done",
    tone: "done" as Tone,
    time: "40m",
  },
  {
    name: "OpenCode",
    id: "opencode",
    icon: AGENT_ICON.opencode,
    state: "Working",
    tone: "live" as Tone,
    time: "now",
    badge: "2/2",
    children: ["Sweep the changelog entries", "Check the release checklist"],
  },
  {
    name: "Antigravity",
    id: "antigravity",
    icon: AGENT_ICON.antigravity,
    state: "run_command",
    tone: "live" as Tone,
    time: "now",
  },
];

const PROJECTS = ["portfolio_web_njs", "wallium", "Sink", "SimpleCalendar"];

const TREE = [
  { name: "architecture", dir: true },
  { name: "bridge", dir: true },
  { name: "relay", dir: true },
  { name: "shared", dir: true },
  { name: "uxnandesktop", dir: true },
  { name: "uxnanmobile", dir: true },
  { name: "AGENTS.md", dir: false },
  { name: "README.md", dir: false },
];

const DOT: Record<Tone, string> = {
  live: "bg-live",
  done: "bg-brand-lit",
  idle: "bg-faint",
};

function Dot({ tone = "live" }: { tone?: Tone }) {
  return (
    <span
      className={`size-[5px] shrink-0 rounded-full ${DOT[tone]}`}
      style={
        tone === "live"
          ? { animation: "ux-pulse 2.4s ease-out infinite" }
          : undefined
      }
    />
  );
}

function Mark({
  src,
  id,
  className = "",
}: {
  src: string;
  /** Agent id, when the mark needs lifting on these dark surfaces. */
  id?: string;
  className?: string;
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      className={`rounded-[3px] object-contain ${id && INVERT_ON_DARK.has(id) ? "invert" : ""} ${className}`}
    />
  );
}

export function DesktopWindow({ className = "" }: { className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-line-2 bg-ink-soft shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] ${className}`}
    >
      {/* ── Title bar — one tab per running agent ─────────────────────── */}
      <div className="flex items-center gap-3 border-b border-line bg-panel px-3 py-2">
        <div className="flex shrink-0 items-center gap-2">
          <Mark src="/logo.svg" className="size-[14px]" />
          <span className="text-[11.5px] font-medium whitespace-nowrap text-fg/90">
            Uxnan Desktop
          </span>
          <span className="rounded border border-line px-1.5 py-px text-[9px] tracking-wider text-dim">
            ALPHA
          </span>
        </div>

        <div className="ml-2 flex min-w-0 items-center gap-1 overflow-hidden">
          {AGENTS_RUNNING.map((a) => (
            <div
              key={a.name}
              className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap ${
                a.active ? "bg-raise text-fg" : "text-dim"
              }`}
            >
              <Dot tone={a.tone} />
              <span className="max-w-[110px] truncate">{a.name}</span>
              <X className="size-3 opacity-40" />
            </div>
          ))}
          <Plus className="size-3.5 shrink-0 text-faint" />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3 text-faint">
          <Minus className="size-3.5" />
          <Square className="size-[11px]" />
          <X className="size-3.5" />
        </div>
      </div>

      <div className="flex h-[340px] text-[11px] sm:h-[440px] lg:h-[560px]">
        {/* ── Project rail with the live agent view ──────────────────── */}
        <aside className="hidden w-[212px] shrink-0 flex-col border-r border-line bg-panel/60 p-2.5 md:flex">
          <div className="flex items-center gap-2 rounded-md border border-line bg-ink px-2 py-1.5 text-[10.5px] text-faint">
            <Search className="size-3" />
            <span className="truncate">Search a project…</span>
            <kbd className="ml-auto shrink-0 rounded border border-line px-1 text-[9px] whitespace-nowrap text-faint">
              Ctrl P
            </kbd>
          </div>

          <div className="mt-4 mb-1.5 flex items-center px-1">
            <span className="text-[9px] font-medium tracking-[0.14em] text-faint">
              PROJECTS (8)
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-faint">
              <RefreshCw className="size-2.5" />
              <Plus className="size-2.5" />
            </span>
          </div>

          {/* the open project */}
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg">
            <Folder className="size-3 shrink-0 opacity-70" />
            <span className="truncate text-[10.5px]">uxnan</span>
            <span className="ml-auto flex items-center gap-1 text-[9px] text-dim">
              <SquareTerminal className="size-2.5" />4
            </span>
          </div>

          {/* the worktree + its agents */}
          <div className="mt-1 rounded-lg border border-line bg-ink/60 p-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <Dot />
              <span className="text-[10.5px] text-fg">main</span>
              <span className="ml-auto flex items-center gap-1 text-[9px] text-dim">
                <SquareTerminal className="size-2.5" />4
              </span>
            </div>
            <div className="mb-1 px-1 pl-[13px] text-[9px] text-faint">uxnan</div>

            <div className="flex items-center gap-1 px-1 py-1 text-[8.5px] tracking-[0.14em] text-faint">
              <ChevronDown className="size-2.5" />
              AGENTS {AGENTS_RUNNING.length}
            </div>

            {AGENTS_RUNNING.map((a) => (
              <div key={a.name}>
                <div
                  className={`flex items-center gap-1.5 rounded-md px-1 py-1 ${
                    a.active ? "bg-raise" : ""
                  }`}
                >
                  <Dot tone={a.tone} />
                  <Mark src={a.icon} id={a.id} className="size-3 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] leading-tight text-fg">
                      {a.name}
                    </div>
                    <div className="truncate text-[9px] leading-tight text-faint">
                      {a.state}
                    </div>
                  </div>
                  {a.badge ? (
                    <span className="rounded bg-live/15 px-1 text-[8.5px] text-live">
                      {a.badge}
                    </span>
                  ) : null}
                  <span className="text-[9px] text-dim">{a.time}</span>
                </div>

                {a.children?.map((child) => (
                  <div
                    key={child}
                    className="flex items-center gap-1.5 py-[3px] pl-[18px]"
                  >
                    <Dot />
                    <span className="truncate text-[9px] text-dim">{child}</span>
                  </div>
                ))}
              </div>
            ))}

            <div className="mt-1.5 flex items-center gap-1.5 border-t border-line px-1 pt-1.5">
              <GitBranch className="size-2.5 shrink-0 text-faint" />
              <div className="min-w-0">
                <div className="truncate text-[10px] leading-tight text-dim">
                  feat/branding
                </div>
                <div className="truncate text-[9px] leading-tight text-faint">
                  branding
                </div>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-px">
            {PROJECTS.map((p) => (
              <div
                key={p}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-dim"
              >
                <Folder className="size-3 shrink-0 opacity-60" />
                <span className="truncate text-[10.5px]">{p}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* ── The agent terminal ─────────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col bg-ink">
          <div className="thin-scroll flex-1 overflow-hidden px-3.5 py-3.5 font-mono text-[10.5px] leading-[1.7] text-muted">
            {/* Claude Code's own session header */}
            <div className="mb-3 flex items-start gap-3">
              <Mark src={CLAUDE_TERMINAL_ICON} className="mt-px size-7 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-fg">
                  Claude Code <span className="text-faint">v2.1.222</span>
                </div>
                <div className="text-live/90">
                  Opus 5 (1M context) with xhigh effort{" "}
                  <span className="text-faint">· Claude Max</span>
                </div>
                <div className="truncate text-faint">
                  ~\Documents\GitHub\uxnan
                </div>
              </div>
            </div>

            <p className="text-fg/70">
              <span className="text-live">&gt;</span> add a reconnect backoff to
              the zero adapter and cover it with a test
            </p>

            <p className="mt-2.5">
              <span className="text-fg">⏺</span> Read(
              <span className="text-brand-lit">
                bridge/src/adapters/zero-adapter.ts
              </span>
              )
            </p>
            <p className="text-faint"> ⎿ 142 lines</p>

            <p>
              <span className="text-fg">⏺</span> Grep(
              <span className="text-fg/80">&quot;reconnect&quot;</span>)
            </p>
            <p className="text-faint"> ⎿ 6 matches in 3 files</p>

            <p>
              <span className="text-fg">⏺</span> Update(
              <span className="text-brand-lit">
                bridge/src/adapters/zero-adapter.ts
              </span>
              )
            </p>
            <p className="text-faint">
              {" "}
              ⎿ <span className="text-live">+18</span> −4
            </p>

            <p>
              <span className="text-fg">⏺</span> Task(
              <span className="text-brand-lit">doc-check</span>){" "}
              <span className="text-amber">running 12s</span>
            </p>

            <p>
              <span className="text-fg">⏺</span> Bash(
              <span className="text-fg/80">npm test -w uxnan-bridge</span>)
            </p>
            <p className="text-faint">
              {" "}
              ⎿ <span className="text-live">✓ 493 tests passed in 6.2s</span>
            </p>

            <p className="mt-2.5 text-fg/90">
              <span className="text-fg">⏺</span> Reconnect backoff is in, with a
              test that fakes three dropped sockets. Want me to open the PR?
            </p>
          </div>

          <div className="px-3 pb-2.5">
            <div className="rounded-md border border-line bg-panel/60 px-2.5 py-2 font-mono text-[10.5px] text-faint">
              <span className="text-live">&gt;</span> Try &quot;fix lint
              errors&quot; <span className="caret" />
            </div>
            <div className="mt-1.5 flex items-center gap-2 px-0.5 font-mono text-[9.5px] text-faint">
              <span>⏸ manual mode on</span>
              <span>· ? for shortcuts</span>
              <span className="hidden sm:inline">· ← for agents</span>
            </div>
          </div>
        </section>

        {/* ── Files / Changes / History / GitHub ─────────────────────── */}
        <aside className="hidden w-[196px] shrink-0 flex-col border-l border-line bg-panel/60 lg:flex">
          <div className="flex items-center gap-2.5 border-b border-line px-2.5 py-2 text-[9.5px]">
            <span className="border-b border-fg pb-1 text-fg">Files</span>
            <span className="text-dim">Changes</span>
            <span className="text-dim">History</span>
            <span className="text-dim">GitHub</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-2 text-[9px] tracking-[0.14em] text-faint">
            UXNAN
            <span className="ml-auto flex items-center gap-1.5">
              <Search className="size-2.5" />
              <RefreshCw className="size-2.5" />
            </span>
          </div>

          <div className="flex flex-col gap-px px-1.5">
            {TREE.map((t) => (
              <div
                key={t.name}
                className="flex items-center gap-1.5 rounded px-1.5 py-[5px] text-[10.5px] text-dim"
              >
                {t.dir ? (
                  <>
                    <ChevronRight className="size-2.5 text-faint" />
                    <Folder className="size-3 opacity-70" />
                  </>
                ) : (
                  <span className="ml-[18px]" />
                )}
                <span className="truncate">{t.name}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto border-t border-line px-2.5 py-2 text-[9.5px] text-faint">
            <div className="flex items-center gap-1.5">
              <GitBranch className="size-2.5" />
              <span>uxnan / main</span>
              <span className="ml-auto flex items-center gap-1">
                <SquareTerminal className="size-2.5" />4
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
