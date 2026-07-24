import { AgentMark, StatusDot, type AgentStatus } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * The left sidebar, rebuilt from the real component tree rather than invented.
 *
 * The structure that matters, and that an approximation gets wrong:
 * - A **project is a borderless group**, not a bordered card: an identity header
 *   (folder icon · name · indicators) with its worktrees indented underneath.
 * - A **worktree row is two lines** — branch name plus its git indicators on the
 *   first, the worktree folder name on the second — and the selection fill wraps
 *   the row *and* its agents, so the agents read as living inside that worktree.
 * - The **agent space** is a quiet `AGENTS · n` toggle, and each agent is a
 *   two-line row whose sub-agents hang off a left rule underneath it.
 */

export interface Subagent {
  label: string;
  status: AgentStatus;
}

export interface AgentEntry {
  name: string;
  logo: string;
  status: AgentStatus;
  title: string;
  preview: string;
  time?: string;
  subagents?: Subagent[];
}

export interface WorktreeEntry {
  branch: string;
  /** Second line — the worktree's folder name. */
  meta: string;
  status?: AgentStatus;
  dirty?: number;
  ahead?: number;
  behind?: number;
  pr?: "success" | "pending" | "failure";
  terminals?: number;
  active?: boolean;
  agents?: AgentEntry[];
}

export interface ProjectEntry {
  name: string;
  pinned?: boolean;
  unread?: boolean;
  terminals?: number;
  worktrees: WorktreeEntry[];
}

/* -------------------------------------------------------------------------- */

export function SearchField() {
  return (
    <div className="flex h-[22px] items-center gap-1.5 rounded-md bg-surface-sunken px-2 text-[9px] text-faint-foreground">
      <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      Search worktrees
    </div>
  );
}

function Indicator({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "amber" | "emerald" | "red";
}) {
  const tones = {
    muted: "text-faint-foreground",
    amber: "text-warning",
    emerald: "text-positive",
    red: "text-danger",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 text-[9px] tabular-nums",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ProjectHeader({ project }: { project: ProjectEntry }) {
  return (
    <div className="flex min-h-[26px] items-center gap-1.5 rounded-md px-1.5">
      <svg
        viewBox="0 0 24 24"
        className="size-[13px] shrink-0 text-faint-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      >
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M12 11v5M9.5 13.5h5" />
      </svg>
      <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
        {project.name}
      </span>
      {project.pinned && (
        <svg viewBox="0 0 24 24" className="size-2.5 shrink-0 text-faint-foreground" fill="currentColor">
          <path d="M14 3l7 7-3 1-4 4v5l-3-3-4 4-1-1 4-4-3-3h5l4-4 1-3z" />
        </svg>
      )}
      {project.unread && (
        <span className="size-[7px] shrink-0 rounded-full bg-danger ring-2 ring-[color-mix(in_oklab,var(--danger)_15%,transparent)]" />
      )}
      {project.terminals ? (
        <Indicator>
          <TerminalGlyph />
          {project.terminals}
        </Indicator>
      ) : null}
    </div>
  );
}

function TerminalGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m5 8 4 4-4 4M12 16h7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WorktreeRow({ worktree }: { worktree: WorktreeEntry }) {
  return (
    // Selection wraps the row *and* its agents — that is what makes the agents
    // read as living inside the worktree rather than floating under it.
    <div className={cn("flex flex-col rounded-md", worktree.active && "bg-sidebar-accent")}>
      <div className="flex items-start gap-1.5 rounded-md px-1.5 py-1">
        <span className="mt-[3px] flex size-3 shrink-0 items-center justify-center">
          {worktree.status ? (
            <StatusDot status={worktree.status} pulse={worktree.status === "working"} />
          ) : (
            <svg viewBox="0 0 24 24" className="size-2.5 text-faint-foreground" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9v6M18 9v1a4 4 0 0 1-4 4H9" />
            </svg>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span
              className={cn(
                "min-w-0 truncate text-[9.5px]",
                worktree.active ? "font-medium text-foreground" : "text-foreground/85",
              )}
            >
              {worktree.branch}
            </span>
            {worktree.dirty ? (
              <Indicator tone="amber">
                <span className="size-1.5 rounded-full bg-warning" />
                {worktree.dirty}
              </Indicator>
            ) : null}
            {worktree.ahead ? <Indicator>↑{worktree.ahead}</Indicator> : null}
            {worktree.behind ? <Indicator>↓{worktree.behind}</Indicator> : null}
            {worktree.pr && (
              <svg
                viewBox="0 0 24 24"
                className={cn(
                  "size-2.5 shrink-0",
                  worktree.pr === "success"
                    ? "text-positive"
                    : worktree.pr === "pending"
                      ? "text-warning"
                      : "text-danger",
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
                <path d="M6 9v6a3 3 0 0 0 3 3h6" />
              </svg>
            )}
            {worktree.terminals ? (
              <Indicator>
                <TerminalGlyph />
                {worktree.terminals}
              </Indicator>
            ) : null}
          </div>
          <div className="truncate text-[9px] text-faint-foreground">{worktree.meta}</div>
        </div>
      </div>

      {worktree.agents && worktree.agents.length > 0 && (
        <div className="pb-1 pl-4 pr-1">
          <AgentSpace agents={worktree.agents} />
        </div>
      )}
    </div>
  );
}

export function AgentSpace({ agents }: { agents: AgentEntry[] }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-1 py-0.5 text-faint-foreground">
        <svg viewBox="0 0 24 24" className="size-2.5 rotate-90" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[8.5px] font-medium uppercase tracking-[0.05em]">Agents</span>
        <span className="text-[8.5px] tabular-nums opacity-60">{agents.length}</span>
      </div>
      <div className="flex flex-col">
        {agents.map((agent) => (
          <AgentRow key={agent.title} agent={agent} />
        ))}
      </div>
    </div>
  );
}

export function AgentRow({
  agent,
  className,
}: {
  agent: AgentEntry;
  className?: string;
}) {
  const subs = agent.subagents ?? [];
  const active = subs.filter((s) => s.status === "working").length;

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-start gap-1.5 rounded-md px-1 py-[3px]">
        <span className="mt-[3px] flex size-3 shrink-0 items-center justify-center">
          <StatusDot status={agent.status} pulse={agent.status === "working"} />
        </span>
        <AgentMark logo={agent.logo} name={agent.name} className="mt-px size-[13px]" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex items-baseline gap-1">
            <span className="min-w-0 flex-1 truncate text-[9.5px] text-foreground/90">
              {agent.title}
            </span>
            {subs.length > 0 && (
              // Badge reads `running/total` in green while children are alive,
              // then collapses to the plain total — same as the app.
              <span
                className={cn(
                  "shrink-0 rounded-full px-1 text-[8px] leading-[13px] tabular-nums",
                  active > 0
                    ? "bg-positive/15 text-positive"
                    : "bg-foreground/10 text-foreground/55",
                )}
              >
                {active > 0 ? `${active}/${subs.length}` : subs.length}
              </span>
            )}
            {agent.time && (
              <span className="shrink-0 text-[8.5px] tabular-nums text-faint-foreground">
                {agent.time}
              </span>
            )}
          </span>
          <span className="truncate text-[9px] text-faint-foreground">{agent.preview}</span>
        </span>
      </div>

      {active > 0 && (
        <div className="ml-[22px] mt-0.5 flex flex-col gap-0.5 border-l border-border/60 pl-2">
          {subs
            .filter((s) => s.status === "working")
            .map((sub) => (
              <div key={sub.label} className="flex items-center gap-1.5">
                <span className="flex size-3 shrink-0 items-center justify-center">
                  <StatusDot status={sub.status} pulse />
                </span>
                <span className="truncate text-[9px] text-faint-foreground">
                  {sub.label}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function ProjectGroup({ project }: { project: ProjectEntry }) {
  return (
    <div className="flex flex-col">
      <ProjectHeader project={project} />
      <div className="flex flex-col pl-2">
        {project.worktrees.map((worktree) => (
          <WorktreeRow key={worktree.branch} worktree={worktree} />
        ))}
      </div>
    </div>
  );
}
