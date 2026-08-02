import { AgentMark, Bar, Chip } from "./primitives";
import { AgentRow, ProjectGroup, type AgentEntry, type ProjectEntry } from "./sidebar";
import { RAM_FOOTPRINT, WIRED_AGENTS } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * The panels that fly in around the main window, and the small scenes each
 * feature card carries. Every one is a slice of a real surface, rebuilt from the
 * app's own components rather than approximated.
 */

function Panel({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-surface-raised hairline",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-surface px-2.5 py-1.5">
        {icon}
        <span className="text-[9.5px] font-medium text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

const FolderIcon = (
  <svg viewBox="0 0 24 24" className="size-3 text-faint-foreground" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

/* -------------------------------------------------------------------------- */

const SIDEBAR_PROJECTS: ProjectEntry[] = [
  {
    name: "storefront",
    pinned: true,
    terminals: 3,
    worktrees: [
      {
        branch: "feat/checkout-retry",
        meta: "storefront--checkout-retry",
        status: "needs-you",
        dirty: 3,
        ahead: 1,
        pr: "success",
        active: true,
      },
      {
        branch: "fix/session-leak",
        meta: "storefront--session-leak",
        status: "working",
        dirty: 7,
        terminals: 1,
      },
      { branch: "main", meta: "storefront" },
    ],
  },
  {
    name: "api-gateway",
    unread: true,
    worktrees: [
      { branch: "feat/rate-limit", meta: "api-gateway--rate-limit", status: "done", behind: 2 },
      { branch: "main", meta: "api-gateway" },
    ],
  },
];

/** The sidebar: pinned projects first, worktrees sorted by who needs you. */
export function ProjectCards({ className }: { className?: string }) {
  return (
    <Panel title="Projects" className={className} icon={FolderIcon}>
      <div className="flex flex-col gap-1 p-1.5">
        {SIDEBAR_PROJECTS.map((project) => (
          <ProjectGroup key={project.name} project={project} />
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

const AGENT_ROWS: AgentEntry[] = [
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
  {
    name: "OpenCode",
    logo: "opencode.svg",
    status: "done",
    title: "Dependency sweep",
    preview: "12 packages upgraded · tests green",
    time: "18m",
  },
];

/** The agent view, including a parent agent with its live sub-agents. */
export function AgentView({ className }: { className?: string }) {
  return (
    <Panel
      title="Agents"
      className={className}
      icon={
        <svg viewBox="0 0 24 24" className="size-3 text-faint-foreground" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M12 7V4M9 13h.01M15 13h.01" strokeLinecap="round" />
        </svg>
      }
    >
      <div className="flex flex-col gap-0.5 p-1.5">
        {AGENT_ROWS.map((agent) => (
          <AgentRow key={agent.title} agent={agent} />
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/** The GitHub tab: the worktree's PR, its checks, and the merge control. */
export function PullRequestPanel({ className }: { className?: string }) {
  return (
    <Panel
      title="GitHub"
      className={className}
      icon={
        <svg viewBox="0 0 24 24" className="size-3 text-faint-foreground" fill="currentColor">
          <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
        </svg>
      }
    >
      <div className="space-y-2 p-2.5">
        <div className="flex items-start gap-1.5">
          <svg viewBox="0 0 24 24" className="mt-px size-3 shrink-0 text-positive" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="18" r="3" />
            <path d="M6 9v6a3 3 0 0 0 3 3h6" />
          </svg>
          <div className="min-w-0">
            <div className="text-[10px] font-medium leading-snug">
              Harden checkout retries
            </div>
            <div className="text-[9px] text-faint-foreground">
              #482 · feat/checkout-retry → main
            </div>
          </div>
        </div>

        <div className="space-y-1 rounded-lg border border-border/60 bg-surface p-1.5">
          {[
            { name: "build", ok: true },
            { name: "test (node 20)", ok: true },
            { name: "lint", ok: true },
          ].map((check) => (
            <div key={check.name} className="flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="size-2.5 text-positive" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="m5 13 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="flex-1 truncate text-[9px] text-muted-foreground">
                {check.name}
              </span>
              <span className="text-[8.5px] text-faint-foreground">passed</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Chip tone="positive">All checks passed</Chip>
          <Chip>Squash</Chip>
        </div>

        <div className="flex h-[22px] items-center justify-center rounded-md bg-positive/90 text-[9.5px] font-medium text-white">
          Merge pull request
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A phone running the mobile app.
 *
 * The bubble treatment follows the app: a **soft tinted container** with dark
 * text for your own message, not a saturated fill — that is what Material 3's
 * `primaryContainer` gives, and it is what the screen actually looks like.
 */
export type PhoneVariant = "devices" | "conversation";

const PHONE_SCREENS: Record<PhoneVariant, () => React.ReactElement> = {
  devices: PhoneDevices,
  conversation: PhoneConversation,
};

export function Phone({
  className,
  variant = "devices",
}: {
  className?: string;
  variant?: PhoneVariant;
}) {
  const Screen = PHONE_SCREENS[variant];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[22px] bg-surface-raised p-[3px] ring-1 ring-border",
        className,
      )}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-[19px] bg-surface">
        <div className="absolute left-1/2 top-1 z-10 h-[7px] w-[38px] -translate-x-1/2 rounded-full bg-foreground/12" />
        <Screen />
      </div>
    </div>
  );
}

function MiniIconSurface({ label }: { label: string }) {
  return (
    <span className="grid size-[15px] shrink-0 place-items-center rounded-full bg-surface-raised text-[8px] text-muted-foreground ring-1 ring-border/60">
      {label}
    </span>
  );
}

/** Compact silhouette of the app's veiled top bar. */
function PhoneTitle({
  title,
  sub,
  back = true,
  actions = 2,
}: {
  title: string;
  sub?: string;
  back?: boolean;
  actions?: number;
}) {
  return (
    <div className="flex items-center gap-1 px-2 pb-1.5 pt-3.5">
      {back && <MiniIconSurface label="‹" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[9px] font-semibold leading-tight">{title}</div>
        {sub && <div className="truncate text-[7px] text-faint-foreground">{sub}</div>}
      </div>
      {Array.from({ length: actions }, (_, index) => (
        <MiniIconSurface key={index} label={index === actions - 1 ? "⋯" : "·"} />
      ))}
    </div>
  );
}

/** The real mobile entry surface: paired PCs and truthful transport state. */
function PhoneDevices() {
  return (
    <>
      <PhoneTitle title="Devices" back={false} actions={1} />
      <div className="flex-1 space-y-2 px-2 pt-2">
        {[true, false].map((connected) => (
          <div key={String(connected)} className="flex items-center gap-2 rounded-xl bg-surface-raised p-2 ring-1 ring-border/50">
            <span className={cn("grid size-[22px] place-items-center rounded-full", connected ? "bg-accent-soft" : "bg-surface-sunken")}>
              <span className={cn("size-[5px] rounded-full", connected ? "bg-positive" : "bg-faint-foreground")} />
            </span>
            <div className="flex-1 space-y-1.5">
              <Bar w={connected ? "70%" : "55%"} />
              <Bar w="42%" tone="faint" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PhoneConversation() {
  return (
    <>
      <div className="flex items-center gap-1 px-2 pb-1.5 pt-3.5">
        <MiniIconSurface label="‹" />
        <span className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-surface-sunken px-1.5 py-1 text-[7px] font-medium">
          <span className="text-accent">✦</span><span className="truncate">Sonnet 5</span><span>⌄</span>
        </span>
        <MiniIconSurface label="⋯" />
      </div>

      <div className="flex-1 space-y-2 overflow-hidden px-2.5 pt-1">
        <div className="ml-auto w-[74%] rounded-xl rounded-br-sm bg-accent-soft p-2">
          <Bar w="88%" /><Bar w="62%" className="mt-1.5" />
        </div>
        <div className="w-[82%] space-y-1.5 py-1">
          <Bar w="90%" /><Bar w="78%" /><Bar w="55%" />
        </div>
        <div className="rounded-xl border border-warning/35 bg-warning/[0.08] p-2">
          <div className="flex items-center gap-1.5"><span className="size-[6px] rounded-full bg-warning" /><Bar w="48%" /></div>
          <div className="mt-2 flex gap-1.5">
            <span className="h-[15px] flex-1 rounded-full bg-accent" />
            <span className="h-[15px] flex-1 rounded-full ring-1 ring-border" />
          </div>
        </div>
      </div>

      <div className="p-2">
        <div className="flex h-[24px] items-center gap-1.5 rounded-full bg-surface-sunken px-2">
          <span className="text-[11px] leading-none text-faint-foreground">+</span>
          <Bar w="55%" tone="faint" className="flex-1" />
          <span className="grid size-[16px] place-items-center rounded-full bg-accent text-[8px] text-accent-foreground">
            ↑
          </span>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** The memory argument, as a gauge rather than a sentence. */
export function MemoryCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-surface-raised p-5 hairline",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium">App shell</span>
        <span className="font-mono text-[12px] text-accent">{RAM_FOOTPRINT}</span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full origin-left rounded-full bg-accent"
          style={{ width: "21%", animation: "ux-grow-x 1.2s cubic-bezier(0.16,1,0.3,1) both" }}
        />
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium text-positive">Free for agents</span>
        <span className="font-mono text-[12px] text-positive">the rest</span>
      </div>
      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full origin-left rounded-full bg-positive"
          style={{ width: "79%", animation: "ux-grow-x 1.2s cubic-bezier(0.16,1,0.3,1) 160ms both" }}
        />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {WIRED_AGENTS.slice(0, 6).map((agent) => (
          <AgentMark key={agent.id} logo={agent.logo} name={agent.name} className="size-8" />
        ))}
      </div>
    </div>
  );
}
