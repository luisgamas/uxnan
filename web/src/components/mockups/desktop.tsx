import { HugeiconsIcon } from "@hugeicons/react";
import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
import CircleCheckIcon from "@hugeicons/core-free-icons/CircleCheckIcon";
import CirclePauseIcon from "@hugeicons/core-free-icons/PauseCircleIcon";
import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import MessageCircleQuestionMarkIcon from "@hugeicons/core-free-icons/ChatQuestionIcon";
import MinusIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
import SquareIcon from "@hugeicons/core-free-icons/SquareIcon";
import SquareTerminalIcon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
import { AGENT_ICON, CLAUDE_TERMINAL_ICON, INVERT_ON_DARK } from "@/lib/site";

/* ───────────────────────────────────────────────────────────────────────────
   A DOM recreation of Uxnan Desktop — not a screenshot.

   Chrome, panel order and wording follow the real app: one tab per running
   agent (subagents get no tab), the project rail with its live agent view
   underneath the worktree, the agent terminal in the centre, and
   Files / Changes / History / GitHub on the right.
   ─────────────────────────────────────────────────────────────────────────── */

/** The agent states the app renders, and the only ones this mockup may show. */
type Tone = "live" | "waiting" | "blocked" | "done" | "idle";

/* Between them the four agents (and OpenCode's two subagents) show every state
   the app can report — working, needs-you, blocked, done — so a visitor sees the
   whole vocabulary in one glance instead of a wall of identical green. */
const AGENTS_RUNNING = [
  {
    name: "Claude Code",
    id: "claudecode",
    icon: AGENT_ICON.claudecode,
    state: "Working",
    tone: "live" as Tone,
    time: "now",
    active: true,
    children: [
      { name: "Explore the mobile UI screens", tone: "live" as Tone },
      { name: "Document the web mockups", tone: "live" as Tone },
    ],
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
    // Blocked on the parent, not on a child: a subagent only ever reaches
    // `working` / `done` (`SubagentEntry`), and the app renders only the working
    // ones — a blocked child row is not something the software can produce.
    state: "Blocked",
    tone: "blocked" as Tone,
    time: "now",
    badge: "2/2",
    children: [
      { name: "Sweep the changelog entries", tone: "live" as Tone },
      { name: "Check the release checklist", tone: "live" as Tone },
    ],
  },
  {
    name: "Antigravity",
    id: "antigravity",
    icon: AGENT_ICON.antigravity,
    state: "Waiting for input",
    tone: "waiting" as Tone,
    time: "2m",
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
  waiting: "bg-orange",
  blocked: "bg-amber",
  done: "bg-brand-lit",
  idle: "bg-faint",
};

/** Row-major 3×3 grid: the eight perimeter cells, clockwise from top-left. */
const COMET_RING = [0, 1, 2, 5, 8, 7, 6, 3];
const COMET_LAP = 1150;

/** The app's working indicator: a bright head with a fading two-dot tail
 *  sweeping a 3×3 dot matrix, while the centre breathes. Pure CSS, same as the
 *  shipped component — one keyframe plus a negative per-dot delay. */
function Comet({ size = 9 }: { size?: number }) {
  const dot = Math.max(2, Math.round(size / 4));
  const gap = (size - dot * 3) / 2;
  const step = COMET_LAP / COMET_RING.length;
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 text-live"
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(3, ${dot}px)`,
        gridTemplateRows: `repeat(3, ${dot}px)`,
        gap,
      }}
    >
      {Array.from({ length: 9 }, (_, cell) => {
        const i = COMET_RING.indexOf(cell);
        const centre = cell === 4;
        return (
          <span
            key={cell}
            className="rounded-full bg-current opacity-[0.14]"
            style={{
              animation: `${
                centre ? "ux-comet-breathe" : "ux-comet-sweep"
              } ${centre ? COMET_LAP * 2 : COMET_LAP}ms linear infinite`,
              animationDelay: centre ? undefined : `${(i - COMET_RING.length) * step}ms`,
            }}
          />
        );
      })}
    </span>
  );
}

/** The agent-state glyph, one shape per state, exactly as the app draws them:
 *  the Comet Trail while working, a question bubble when it needs *you*, a pause
 *  circle when it's blocked on another system, a check when the turn is done.
 *  `idle` stays a plain dot — the most frequent state earns the quietest mark. */
function Dot({ tone = "live" }: { tone?: Tone }) {
  if (tone === "live") return <Comet />;
  if (tone === "waiting")
    return (
      <HugeiconsIcon icon={MessageCircleQuestionMarkIcon} className="size-[9px] shrink-0 text-orange" />
    );
  if (tone === "blocked")
    return <HugeiconsIcon icon={CirclePauseIcon} className="size-[9px] shrink-0 text-amber" />;
  if (tone === "done")
    return <HugeiconsIcon icon={CircleCheckIcon} className="size-[9px] shrink-0 text-brand-lit" />;
  return <span className={`size-[5px] shrink-0 rounded-full ${DOT[tone]}`} />;
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
              <HugeiconsIcon icon={XIcon} className="size-3 opacity-40" />
            </div>
          ))}
          <HugeiconsIcon icon={PlusIcon} className="size-3.5 shrink-0 text-faint" />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3 text-faint">
          <HugeiconsIcon icon={MinusIcon} className="size-3.5" />
          <HugeiconsIcon icon={SquareIcon} className="size-[11px]" />
          <HugeiconsIcon icon={XIcon} className="size-3.5" />
        </div>
      </div>

      <div className="flex h-[340px] text-[11px] sm:h-[440px] lg:h-[560px]">
        {/* ── Project rail with the live agent view ──────────────────── */}
        <aside className="hidden w-[212px] shrink-0 flex-col border-r border-line bg-panel/60 p-2.5 md:flex">
          <div className="flex items-center gap-2 rounded-md border border-line bg-ink px-2 py-1.5 text-[10.5px] text-faint">
            <HugeiconsIcon icon={SearchIcon} className="size-3" />
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
              <HugeiconsIcon icon={RefreshCwIcon} className="size-2.5" />
              <HugeiconsIcon icon={PlusIcon} className="size-2.5" />
            </span>
          </div>

          {/* the open project */}
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg">
            <HugeiconsIcon icon={FolderIcon} className="size-3 shrink-0 opacity-70" />
            <span className="truncate text-[10.5px]">uxnan</span>
            <span className="ml-auto flex items-center gap-1 text-[9px] text-dim">
              <HugeiconsIcon icon={SquareTerminalIcon} className="size-2.5" />4
            </span>
          </div>

          {/* the worktree + its agents */}
          <div className="mt-1 rounded-lg border border-line bg-ink/60 p-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <Dot />
              <span className="text-[10.5px] text-fg">main</span>
              <span className="ml-auto flex items-center gap-1 text-[9px] text-dim">
                <HugeiconsIcon icon={SquareTerminalIcon} className="size-2.5" />4
              </span>
            </div>
            <div className="mb-1 px-1 pl-[13px] text-[9px] text-faint">uxnan</div>

            <div className="flex items-center gap-1 px-1 py-1 text-[8.5px] tracking-[0.14em] text-faint">
              <HugeiconsIcon icon={ChevronDownIcon} className="size-2.5" />
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
                    key={child.name}
                    className="flex items-center gap-1.5 py-[3px] pl-[18px]"
                  >
                    <Dot tone={child.tone} />
                    <span className="truncate text-[9px] text-dim">
                      {child.name}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            <div className="mt-1.5 flex items-center gap-1.5 border-t border-line px-1 pt-1.5">
              <HugeiconsIcon icon={GitBranchIcon} className="size-2.5 shrink-0 text-faint" />
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
                <HugeiconsIcon icon={FolderIcon} className="size-3 shrink-0 opacity-60" />
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
              <HugeiconsIcon icon={SearchIcon} className="size-2.5" />
              <HugeiconsIcon icon={RefreshCwIcon} className="size-2.5" />
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
                    <HugeiconsIcon icon={ChevronRightIcon} className="size-2.5 text-faint" />
                    <HugeiconsIcon icon={FolderIcon} className="size-3 opacity-70" />
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
              <HugeiconsIcon icon={GitBranchIcon} className="size-2.5" />
              <span>uxnan / main</span>
              <span className="ml-auto flex items-center gap-1">
                <HugeiconsIcon icon={SquareTerminalIcon} className="size-2.5" />4
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
