import { ClaudeTerminal } from "./claude-terminal";
import { FileTree, RightPanelTabs } from "./file-tree";
import { StatusDot, TitleBar } from "./primitives";
import { ProjectGroup, SearchField, type ProjectEntry } from "./sidebar";
import { cn } from "@/lib/utils";

/**
 * The three-panel Agent Development Environment: projects and worktrees on the
 * left, terminals in the centre, and the working tree on the right.
 *
 * Rebuilt against the real component tree — borderless project groups, two-line
 * worktree rows with their git indicators, the agent space nested inside the
 * selected worktree, a **Files**-first right panel, and the agent's own CLI
 * output in the centre rather than a stylised chat.
 */

const PROJECTS: ProjectEntry[] = [
  {
    name: "storefront",
    pinned: true,
    terminals: 4,
    worktrees: [
      {
        branch: "feat/checkout-retry",
        meta: "storefront--checkout-retry",
        status: "working",
        dirty: 3,
        ahead: 1,
        pr: "success",
        terminals: 2,
        active: true,
        agents: [
          {
            name: "Claude Code",
            logo: "claudecode.svg",
            status: "working",
            title: "Harden checkout retries",
            preview: "Update(src/billing/retry.ts)",
            time: "12s",
            subagents: [
              { label: "scan retry call sites", status: "working" },
              { label: "draft dead-letter test", status: "working" },
              { label: "check docs for backoff", status: "working" },
            ],
          },
          {
            name: "Codex",
            logo: "codex.svg",
            status: "needs-you",
            title: "Rate-limit middleware",
            preview: "Waiting: delete migration?",
            time: "4m",
          },
        ],
      },
      {
        branch: "fix/session-leak",
        meta: "storefront--session-leak",
        status: "done",
        dirty: 7,
        terminals: 1,
      },
      { branch: "main", meta: "storefront" },
    ],
  },
  {
    name: "api-gateway",
    unread: true,
    terminals: 1,
    worktrees: [
      {
        branch: "feat/rate-limit",
        meta: "api-gateway--rate-limit",
        status: "idle",
        behind: 2,
        terminals: 1,
      },
      { branch: "main", meta: "api-gateway" },
    ],
  },
];

function Sidebar() {
  return (
    <aside className="hidden w-[186px] shrink-0 flex-col border-r border-border/60 bg-surface sm:flex">
      <div className="p-1.5">
        <SearchField />
      </div>
      <div className="flex flex-col gap-1 px-1.5 pb-2">
        {PROJECTS.map((project) => (
          <ProjectGroup key={project.name} project={project} />
        ))}
      </div>
    </aside>
  );
}

function TerminalTabs() {
  const tabs = [
    { label: "claude", active: true, status: "working" as const },
    { label: "codex", active: false, status: "needs-you" as const },
    { label: "dev server", active: false },
    { label: "git", active: false },
  ];
  return (
    <div className="flex h-[26px] shrink-0 items-stretch gap-px border-b border-border/60 bg-surface px-1">
      {tabs.map((tab) => (
        <span
          key={tab.label}
          className={cn(
            "flex items-center gap-1 px-2 text-[9.5px]",
            tab.active
              ? "border-b-2 border-foreground/70 bg-sidebar-accent font-medium text-foreground"
              : "border-b-2 border-transparent text-faint-foreground",
          )}
        >
          {tab.status && <StatusDot status={tab.status} pulse={tab.status === "working"} />}
          {tab.label}
        </span>
      ))}
      <span className="ml-auto flex items-center gap-1.5 pr-1 text-faint-foreground">
        <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 4v16" />
        </svg>
        <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}

function RightPanel() {
  return (
    <aside className="hidden w-[176px] shrink-0 flex-col border-l border-border/60 bg-surface lg:flex">
      <RightPanelTabs active="files" />
      <FileTree />
      <div className="mt-auto border-t border-border/60 px-2 py-1.5">
        <div className="flex items-center justify-between text-[9px] text-faint-foreground">
          <span>3 changed</span>
          <span>
            <span className="text-positive">+128</span>{" "}
            <span className="text-danger">−41</span>
          </span>
        </div>
      </div>
    </aside>
  );
}

function StatusBar() {
  return (
    <div className="flex h-[22px] shrink-0 items-center gap-3 border-t border-border/60 bg-surface px-3 text-[9px] text-faint-foreground">
      <span className="flex items-center gap-1 text-muted-foreground">
        <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9v6M18 9v1a4 4 0 0 1-4 4H9" />
        </svg>
        feat/checkout-retry
      </span>
      <span className="text-positive">+128</span>
      <span className="text-danger">−41</span>
      <span className="ml-auto flex items-center gap-1">
        <StatusDot status="working" pulse />4 agents
      </span>
      <span className="hidden sm:inline">62 MB</span>
    </div>
  );
}

export function DesktopApp({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl bg-surface-raised hairline",
        className,
      )}
    >
      <TitleBar>
        <span className="flex w-full items-center gap-2">
          <span className="text-foreground/80">Uxnan Desktop</span>
          <span className="text-faint-foreground">— storefront · feat/checkout-retry</span>
          <span className="ml-auto flex items-center gap-1 text-faint-foreground">
            <svg viewBox="0 0 24 24" className="size-3" fill="currentColor">
              <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />
            </svg>
          </span>
        </span>
      </TitleBar>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TerminalTabs />
          <ClaudeTerminal />
        </div>
        <RightPanel />
      </div>
      <StatusBar />
    </div>
  );
}
