import { HugeiconsIcon } from "@hugeicons/react";
import ArrowDownIcon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowRightIcon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowUpDownIcon from "@hugeicons/core-free-icons/ArrowUpDownIcon";
import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
import CircleCheckIcon from "@hugeicons/core-free-icons/CircleCheckIcon";
import CirclePauseIcon from "@hugeicons/core-free-icons/PauseCircleIcon";
import EnergyIcon from "@hugeicons/core-free-icons/EnergyIcon";
import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
import FileViewIcon from "@hugeicons/core-free-icons/FileViewIcon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import FolderGitIcon from "@hugeicons/core-free-icons/FolderGitTwoIcon";
import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderTreeIcon from "@hugeicons/core-free-icons/FolderTreeIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import LayersIcon from "@hugeicons/core-free-icons/Layers01Icon";
import MessageCircleQuestionMarkIcon from "@hugeicons/core-free-icons/ChatQuestionIcon";
import MinusIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import PanelLeftIcon from "@hugeicons/core-free-icons/PanelLeftIcon";
import PanelRightIcon from "@hugeicons/core-free-icons/PanelRightIcon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
import SmartPhoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import SquareIcon from "@hugeicons/core-free-icons/SquareIcon";
import StopIcon from "@hugeicons/core-free-icons/StopIcon";
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon";
import UnlockIcon from "@hugeicons/core-free-icons/SquareUnlock02Icon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";
import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
import { AGENT_ICON, INVERT_ON_DARK } from "@/lib/site";

/* ───────────────────────────────────────────────────────────────────────────
   A DOM recreation of Uxnan Desktop — not a screenshot.

   Chrome, panel order and wording follow the real app: one tab per open
   conversation or agent terminal, the sidebar with the paired phone above the
   projects and the open worktree's agent view (terminal agents and chats in
   one list), a chat in the centre streaming its steps as they run, and the
   right dock on its Files surface (its selector switches to Git, GitHub or
   the browser). The chat is the same conversation the phone shows in the hero.
   ─────────────────────────────────────────────────────────────────────────── */

/** The agent states the app renders, and the only ones this mockup may show. */
type Tone = "live" | "waiting" | "blocked" | "done" | "idle";

/** One tab: a chat draws the bubble when idle and the agent state otherwise;
 *  a terminal agent draws its state. */
const TABS = [
  { title: "Reconnect backoff", tone: "live" as Tone, active: true },
  { title: "Claude Code", tone: "done" as Tone },
  { title: "Windows CI flake", tone: "waiting" as Tone },
];

/** The open worktree's agent view: chats and terminal agents in one list,
 *  each with its state glyph, its mark, a title and a quiet second line
 *  (`ChatRow` / `AgentRow`). */
const AGENT_VIEW = [
  {
    title: "Reconnect backoff",
    id: "claudecode",
    icon: AGENT_ICON.claudecode,
    second: "Working",
    tone: "live" as Tone,
    time: "now",
    active: true,
  },
  {
    title: "Windows CI flake",
    id: "codex",
    icon: AGENT_ICON.codex,
    second: "Waiting for input",
    tone: "waiting" as Tone,
    time: "2m",
  },
  {
    title: "Claude Code",
    id: "claudecode",
    icon: AGENT_ICON.claudecode,
    second: "Done",
    tone: "done" as Tone,
    time: "40m",
  },
];

const WORKTREES = [
  { branch: "feat/agent-surfaces", folder: "uxnan--surfaces", dirty: 4 },
  { branch: "fix/windows-flake", folder: "uxnan--flake" },
];

const PROJECTS = [
  { name: "website", terminals: 1 },
  { name: "notes" },
  { name: "wallium" },
];

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

/** The turn's steps, in the order the agent took them. Each row reads the
 *  same for every agent — a verb, then what it acted on — and the last one is
 *  still running, so it animates until the step settles. */
const STEPS = [
  { glyph: FileViewIcon, verb: "Read", target: "zero-adapter.ts" },
  { glyph: SearchIcon, verb: "Searched", target: "reconnect", where: "bridge/src" },
  { glyph: FileEditIcon, verb: "Edited", target: "zero-adapter.ts", add: 18, del: 4 },
  { glyph: TerminalIcon, verb: "Running", target: "npm test -w uxnan-bridge", running: true },
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


/** The terminal count a project or worktree carries (`>_ 2`). */
function Terminals({ n }: { n: number }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-[9px] text-dim">
      <HugeiconsIcon icon={TerminalIcon} className="size-2.5" />
      {n}
    </span>
  );
}

export function DesktopWindow({ className = "" }: { className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-line-2 bg-ink-soft shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] ${className}`}
    >
      {/* ── Title bar — one tab per conversation or agent terminal ─────── */}
      <div className="flex h-9 items-stretch border-b border-line bg-panel">
        <div className="flex shrink-0 items-center gap-2 px-3 md:w-[212px]">
          <Mark src="/logo.svg" className="size-[14px]" />
          <span className="text-[11.5px] font-medium whitespace-nowrap text-fg/90">
            Uxnan Desktop
          </span>
          <span className="rounded border border-line px-1.5 py-px text-[9px] tracking-wider text-dim">
            ALPHA
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
          {TABS.map((t) => (
            <div
              key={t.title}
              className={`relative flex shrink-0 items-center gap-2 px-3 text-[11px] whitespace-nowrap ${
                t.active ? "text-fg" : "text-dim"
              }`}
            >
              <Dot tone={t.tone} />
              <span className="max-w-[112px] truncate">{t.title}</span>
              <HugeiconsIcon icon={XIcon} className="size-2.5 opacity-40" />
              {t.active ? (
                <span className="absolute inset-x-0 bottom-0 h-[2px] bg-fg/85" />
              ) : null}
            </div>
          ))}
          <span className="grid shrink-0 place-items-center px-2">
            <HugeiconsIcon icon={PlusIcon} className="size-3.5 text-faint" />
          </span>
        </div>

        {/* the right dock's surface selector sits over the dock */}
        <div className="hidden w-[196px] shrink-0 items-center gap-1.5 px-2.5 text-[10.5px] font-medium text-fg lg:flex">
          <HugeiconsIcon icon={FolderTreeIcon} className="size-3" />
          Files
          <HugeiconsIcon icon={UnfoldMoreIcon} className="size-2.5 text-faint" />
        </div>

        <div className="flex shrink-0 items-center gap-3 px-3 text-faint">
          <HugeiconsIcon icon={EnergyIcon} className="size-3" />
          <HugeiconsIcon icon={MinusIcon} className="size-3.5" />
          <HugeiconsIcon icon={SquareIcon} className="size-[11px]" />
          <HugeiconsIcon icon={XIcon} className="size-3.5" />
        </div>
      </div>

      <div className="flex h-[340px] text-[11px] sm:h-[440px] lg:h-[560px]">
        {/* ── Sidebar: the paired phone, then the projects ─────────────── */}
        <aside className="hidden w-[212px] shrink-0 flex-col border-r border-line bg-panel/60 md:flex">
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <div className="flex items-center gap-2 rounded-md border border-line bg-ink px-2 py-1.5 text-[10.5px] text-faint">
              <HugeiconsIcon icon={SearchIcon} className="size-3" />
              <span className="truncate">Search a project or worktree…</span>
              <kbd className="ml-auto shrink-0 rounded border border-line px-1 text-[8.5px] whitespace-nowrap text-faint">
                Ctrl P
              </kbd>
            </div>

            {/* the phone this desktop is linked with, and whether it is online */}
            <div className="mt-1.5 flex items-center gap-2 px-2 py-1 text-[10.5px] text-muted">
              <HugeiconsIcon icon={SmartPhoneIcon} className="size-3 text-dim" />
              <span className="truncate">Pixel 9</span>
              <span className="ml-auto size-[6px] rounded-full bg-live" />
            </div>

            <div className="mt-2.5 mb-1 flex items-center px-1">
              <span className="text-[9px] font-medium tracking-[0.12em] text-faint">
                PROJECTS <span className="opacity-70">(4)</span>
              </span>
              <span className="ml-auto flex items-center gap-2 text-faint">
                <HugeiconsIcon icon={FolderAddIcon} className="size-2.5" />
                <HugeiconsIcon icon={RefreshCwIcon} className="size-2.5" />
                <HugeiconsIcon icon={ArrowUpDownIcon} className="size-2.5" />
                <HugeiconsIcon icon={PlusIcon} className="size-2.5" />
              </span>
            </div>

            {/* the open project, expanded to its worktrees */}
            <div className="flex items-center gap-2 px-2 py-1.5 text-fg">
              <HugeiconsIcon icon={FolderGitIcon} className="size-3 shrink-0 opacity-70" />
              <span className="truncate text-[10.5px]">uxnan</span>
              <span className="ml-auto flex items-center gap-2 text-faint">
                <HugeiconsIcon icon={ChevronDownIcon} className="size-2.5" />
                <HugeiconsIcon icon={PlusIcon} className="size-2.5" />
                <HugeiconsIcon icon={MoreHorizontalIcon} className="size-2.5" />
              </span>
            </div>

            <div className="ml-1 rounded-md bg-raise/70 px-1.5 py-1.5">
              <div className="flex items-center gap-1.5 px-0.5">
                <Dot />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10.5px] leading-tight text-fg">main</div>
                  <div className="truncate text-[9px] leading-tight text-faint">uxnan</div>
                </div>
                <div className="flex flex-col items-end gap-px">
                  <Terminals n={1} />
                  <span className="text-[9px] text-dim">now</span>
                </div>
              </div>

              <div className="mt-1 flex items-center gap-1 px-1 py-0.5 text-[8.5px] tracking-[0.12em] text-faint">
                <HugeiconsIcon icon={ChevronDownIcon} className="size-2.5" />
                AGENTS <span className="opacity-70">{AGENT_VIEW.length}</span>
              </div>

              {AGENT_VIEW.map((a) => (
                <div
                  key={a.title}
                  className="relative flex items-center gap-1.5 rounded-md py-1 pr-0.5 pl-2"
                >
                  {a.active ? (
                    <span className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-fg/70" />
                  ) : null}
                  <Dot tone={a.tone} />
                  <Mark src={a.icon} id={a.id} className="size-3 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1">
                      <span
                        className={`min-w-0 flex-1 truncate text-[10px] leading-tight ${
                          a.active ? "font-medium text-fg" : "text-fg/90"
                        }`}
                      >
                        {a.title}
                      </span>
                      <span className="shrink-0 text-[9px] text-dim">{a.time}</span>
                    </div>
                    <div className="truncate text-[9px] leading-tight text-faint">
                      {a.second}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {WORKTREES.map((w) => (
              <div key={w.branch} className="ml-1 flex items-center gap-1.5 px-2 py-1.5">
                <HugeiconsIcon icon={GitBranchIcon} className="size-2.5 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] leading-tight text-muted">
                    {w.branch}
                  </div>
                  <div className="truncate text-[9px] leading-tight text-faint">
                    {w.folder}
                  </div>
                </div>
                {w.dirty ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-[9px] text-amber">
                    <span className="size-[4px] rounded-full bg-amber" />
                    {w.dirty}
                  </span>
                ) : null}
              </div>
            ))}

            <div className="mt-1 flex flex-col gap-px">
              {PROJECTS.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-dim"
                >
                  <HugeiconsIcon icon={FolderGitIcon} className="size-3 shrink-0 opacity-60" />
                  <span className="truncate text-[10.5px]">{p.name}</span>
                  {p.terminals ? (
                    <span className="ml-auto">
                      <Terminals n={p.terminals} />
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* the workspace profile */}
          <div className="flex items-center gap-2 border-t border-line px-2.5 py-2">
            <span className="grid size-6 place-items-center rounded-md border border-line bg-ink">
              <HugeiconsIcon icon={UserIcon} className="size-3 text-dim" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[10px] text-fg">Uxnan</div>
              <div className="text-[9px] text-faint">Local workspace</div>
            </div>
            <HugeiconsIcon icon={UnfoldMoreIcon} className="size-2.5 text-faint" />
          </div>
        </aside>

        {/* ── The chat: the same conversation the phone shows ─────────── */}
        <section className="flex min-w-0 flex-1 flex-col bg-ink">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
            <Mark src={AGENT_ICON.claudecode} className="size-3 shrink-0" />
            <span className="truncate text-[11px] font-medium text-fg">
              Reconnect backoff
            </span>
            <HugeiconsIcon icon={SmartPhoneIcon} className="size-2.5 shrink-0 text-faint" />
            <span className="ml-auto hidden text-[10px] text-dim lg:inline">Claude Code</span>
            <HugeiconsIcon icon={MoreHorizontalIcon} className="size-3 shrink-0 text-faint" />
          </div>

          <div className="flex-1 overflow-hidden px-4 py-4 sm:px-8">
            <div className="ml-auto w-fit max-w-[85%] rounded-xl bg-raise px-3 py-2 text-[11px] leading-relaxed text-fg/90">
              Add a reconnect backoff to the zero adapter and cover it with a
              test.
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-fg/85">
              I&apos;ll read the adapter first, then add the backoff where the
              socket closes.
            </p>

            {/* the turn's steps, grouped, the last one still running */}
            <div className="mt-3">
              <div className="flex items-center gap-2 text-[10.5px] text-dim">
                <HugeiconsIcon icon={LayersIcon} className="size-3 opacity-70" />
                <span>1 edit · 3 tool calls</span>
                <HugeiconsIcon icon={ArrowDownIcon} className="ml-auto size-2.5 text-faint" />
              </div>
              <div className="mt-1.5 ml-[5px] flex flex-col gap-1.5 border-l border-line pl-3">
                {STEPS.map((step) => (
                  <div key={step.verb} className="flex items-center gap-2 text-[10.5px]">
                    {step.running ? (
                      <Comet size={9} />
                    ) : (
                      <HugeiconsIcon icon={step.glyph} className="size-3 shrink-0 text-faint" />
                    )}
                    <span className="shrink-0 font-medium text-fg/90">{step.verb}</span>
                    <span className="min-w-0 truncate font-mono text-[10px] text-muted">
                      {step.target}
                      {step.where ? (
                        <span className="text-faint"> · {step.where}</span>
                      ) : null}
                    </span>
                    {step.add ? (
                      <span className="shrink-0 font-mono text-[10px]">
                        <span className="text-live">+{step.add}</span>{" "}
                        <span className="text-[#f87171]">−{step.del}</span>
                      </span>
                    ) : null}
                    <HugeiconsIcon icon={ArrowRightIcon} className="ml-auto size-2.5 shrink-0 text-faint" />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[10.5px] text-dim">
              <span className="size-[5px] rounded-full bg-brand-lit" style={{ animation: "ux-pulse 2.4s ease-out infinite" }} />
              Working for 41s
            </div>
          </div>

          {/* the composer */}
          <div className="px-4 pb-3 sm:px-8">
            <div className="rounded-xl border border-line-2 bg-panel/70 px-3 pt-2.5 pb-2">
              <div className="text-[11px] text-faint">
                Message the agent… <span className="caret" />
              </div>
              <div className="mt-2.5 flex items-center gap-3 text-[10px] text-dim">
                <HugeiconsIcon icon={PlusIcon} className="size-3" />
                <span className="flex items-center gap-1">
                  Opus 5.5
                  <HugeiconsIcon icon={ArrowDownIcon} className="size-2.5 opacity-60" />
                </span>
                <span className="flex items-center gap-1">
                  <HugeiconsIcon icon={UnlockIcon} className="size-2.5" />
                  Full access
                  <HugeiconsIcon icon={ArrowDownIcon} className="size-2.5 opacity-60" />
                </span>
                <span className="ml-auto grid size-5 place-items-center rounded-full bg-raise">
                  <HugeiconsIcon icon={StopIcon} className="size-2.5 text-fg/80" />
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── The right dock, on its Files surface ───────────────────── */}
        <aside className="hidden w-[196px] shrink-0 flex-col border-l border-line bg-panel/60 lg:flex">
          <div className="flex items-center gap-1.5 px-2.5 py-2 text-[9px] tracking-[0.12em] text-faint">
            UXNAN
            <span className="ml-auto flex items-center gap-1.5">
              <HugeiconsIcon icon={SearchIcon} className="size-2.5" />
              <HugeiconsIcon icon={RefreshCwIcon} className="size-2.5" />
              <HugeiconsIcon icon={MoreHorizontalIcon} className="size-2.5" />
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
        </aside>
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-t border-line bg-panel px-3 py-1 text-[9.5px] text-faint">
        <HugeiconsIcon icon={LayersIcon} className="size-2.5" />
        <span>uxnan</span>
        <span className="opacity-60">/</span>
        <span className="text-muted">main</span>
        <span className="ml-auto flex items-center gap-2.5">
          <HugeiconsIcon icon={PanelLeftIcon} className="size-3" />
          <HugeiconsIcon icon={PanelRightIcon} className="size-3" />
        </span>
      </div>
    </div>
  );
}
