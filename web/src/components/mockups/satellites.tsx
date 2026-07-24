import { AgentMark, Bar, Chip, StatusDot, type AgentStatus } from "./primitives";
import { AgentRow, ProjectGroup, type AgentEntry, type ProjectEntry } from "./sidebar";
import { RAM_TARGET, WIRED_AGENTS } from "@/lib/site";
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
export type PhoneVariant =
  | "devices"
  | "conversation"
  | "threads"
  | "picker"
  | "git"
  | "files"
  | "profile";

const PHONE_SCREENS: Record<PhoneVariant, () => React.ReactElement> = {
  devices: PhoneDevices,
  conversation: PhoneConversation,
  threads: PhoneThreads,
  picker: PhonePicker,
  git: PhoneGit,
  files: PhoneFiles,
  profile: PhoneProfile,
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

/** New conversation: compare agents first, then choose the model separately. */
function PhonePicker() {
  const agents = [
    { name: "Claude Code", logo: "claudecode.svg", selected: true },
    { name: "Codex", logo: "codex.svg" },
    { name: "OpenCode", logo: "opencode.svg" },
  ];
  return (
    <>
      <PhoneTitle title="New conversation" actions={1} />
      <div className="flex-1 space-y-2 px-2 pt-2">
        <div className="space-y-1">
        {agents.map((agent, i) => (
          <div
            key={agent.name}
            className={cn(
              "flex items-center gap-2 rounded-xl bg-surface-raised px-2 py-1.5 ring-1 ring-border/50",
              i === 0 && "bg-accent-soft",
            )}
          >
            <AgentMark logo={agent.logo} name="" className="size-[16px]" />
            <span className="min-w-0 flex-1 truncate text-[8px] font-medium">{agent.name}</span>
            {agent.selected && <span className="text-[8px] text-accent">✓</span>}
          </div>
        ))}
        </div>
        <div className="flex items-center rounded-full bg-surface-sunken px-2 py-1.5 text-[7.5px]">
          <span className="flex-1">Sonnet 5</span><span>⌄</span>
        </div>
      </div>
    </>
  );
}

/** Git at miniature scale: branch, changed files, and the floating commit pill. */
function PhoneGit() {
  return (
    <>
      <PhoneTitle title="Git" actions={1} />
      <div className="flex-1 space-y-2 px-2 pt-1 pb-8">
        <div className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-1.5">
          <span className="text-[8px] text-accent">⑂</span><Bar w="68%" />
        </div>
        {["72%", "58%", "66%"].map((width, index) => (
          <div key={width} className="flex items-center gap-2 rounded-xl bg-surface-raised px-2 py-2 ring-1 ring-border/50">
            <span className={cn("size-[5px] rounded-full", index === 1 ? "bg-positive" : "bg-warning")} />
            <Bar w={width} />
          </div>
        ))}
      </div>
      <div className="absolute inset-x-2 bottom-2 flex h-[22px] items-center gap-1 rounded-full bg-surface-sunken px-2 ring-1 ring-border/60">
        <Bar w="55%" tone="faint" className="flex-1" />
        <span className="grid size-[15px] place-items-center rounded-full bg-accent text-[8px] text-accent-foreground">✓</span>
      </div>
    </>
  );
}

/** The workspace file browser and viewer. */
function PhoneFiles() {
  const rows = [
    { name: "src", dir: true },
    { name: "billing", dir: true, indent: 1 },
    { name: "retry.ts", dir: false, indent: 2, tone: "text-warning" },
    { name: "queue.ts", dir: false, indent: 2 },
    { name: "tests", dir: true },
  ];
  return (
    <>
      <PhoneTitle title="Files" actions={1} />
      <div className="flex-1 px-2 pt-1">
        {rows.map((row) => (
          <div
            key={row.name}
            className={cn("flex min-h-[22px] items-center gap-1.5 py-[3px] text-[8px]", row.tone)}
            style={{ paddingLeft: `${6 + (row.indent ?? 0) * 9}px` }}
          >
            <svg
              viewBox="0 0 24 24"
              className={cn("size-[11px] shrink-0", !row.tone && "text-faint-foreground")}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
            >
              {row.dir ? (
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              ) : (
                <>
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                  <path d="M14 3v5h5" />
                </>
              )}
            </svg>
            <span className={cn("min-w-0 flex-1 truncate", !row.tone && "text-foreground/80")}>{row.name}</span>
            {row.dir && <span className="text-[7px] text-faint-foreground">›</span>}
          </div>
        ))}
      </div>
    </>
  );
}

/** Profile crop: identity, the first stats row, and the start of Activity. */
function PhoneProfile() {
  const cells = Array.from({ length: 70 }, (_, i) => (i * 7) % 5);
  return (
    <>
      <PhoneTitle title="Profile" actions={0} />
      <div className="flex-1 space-y-2 px-2 pt-1">
        <div className="flex items-center gap-2 rounded-xl bg-surface-raised p-2 ring-1 ring-border/50">
          <span className="grid size-[23px] place-items-center rounded-full bg-accent-soft text-[8px] font-semibold">LG</span>
          <div className="flex-1 space-y-1.5"><Bar w="70%" /><Bar w="45%" tone="faint" /></div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {["31h", "2h", "6"].map((value) => (
            <div key={value} className="rounded-lg bg-surface-raised py-2 text-center ring-1 ring-border/40">
              <div className="text-[9px] font-semibold">{value}</div>
            </div>
          ))}
        </div>
        <div className="text-[7.5px] font-medium">Activity</div>
        <div className="grid w-full grid-flow-col grid-rows-7 auto-cols-fr gap-[2px]">
          {cells.map((level, i) => (
            <span
              key={i}
              className="h-[4px] w-full rounded-[1px]"
              style={{
                backgroundColor:
                  level === 0
                    ? "var(--surface-sunken)"
                    : `color-mix(in oklab, var(--accent) ${level * 22}%, var(--surface-sunken))`,
              }}
            />
          ))}
        </div>
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

function PhoneThreads() {
  const threads = [
    { title: "Harden checkout retries", agent: "claudecode.svg", status: "needs-you" as AgentStatus, time: "now" },
    { title: "Rate-limit middleware", agent: "codex.svg", status: "working" as AgentStatus, time: "2m" },
    { title: "Dependency sweep", agent: "opencode.svg", status: "done" as AgentStatus, time: "18m" },
  ];
  return (
    <>
      <PhoneTitle title="Conversations" back={false} actions={1} />
      <div className="flex-1 space-y-1 px-2 pb-7">
        {threads.map((thread) => (
          <div
            key={thread.title}
            className="flex items-center gap-1.5 rounded-xl bg-surface-raised px-1.5 py-1.5 ring-1 ring-border/50"
          >
            <span className="relative">
              <AgentMark logo={thread.agent} name="" className="size-[16px]" />
              <StatusDot
                status={thread.status}
                className="absolute -bottom-px -right-px ring-2 ring-[var(--surface)]"
              />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar w={thread.title.length > 20 ? "82%" : "68%"} />
              <Bar w="48%" tone="faint" />
            </div>
          </div>
        ))}
      </div>
      <span className="absolute bottom-2 right-2 grid size-[23px] place-items-center rounded-full bg-accent text-[13px] text-accent-foreground">
        +
      </span>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** Settings → Providers: per-provider quota windows. */
export function UsageCard({ className }: { className?: string }) {
  const meters = [
    { name: "Claude", pct: 41, window: "Weekly" },
    { name: "Codex", pct: 68, window: "5-hour" },
    { name: "Copilot", pct: 12, window: "Monthly" },
  ];
  return (
    <Panel
      title="Providers"
      className={className}
      icon={
        <svg viewBox="0 0 24 24" className="size-3 text-faint-foreground" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 17V9M9 17V5M15 17v-6M21 17v-9" strokeLinecap="round" />
        </svg>
      }
    >
      <div className="space-y-2.5 p-2.5">
        {meters.map((meter, i) => (
          <div key={meter.name}>
            <div className="flex items-baseline justify-between pb-1">
              <span className="text-[9.5px] font-medium">{meter.name}</span>
              <span className="text-[8.5px] tabular-nums text-faint-foreground">
                {meter.window} · {meter.pct}%
              </span>
            </div>
            <div className="h-[4px] overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full origin-left rounded-full bg-accent"
                style={{
                  width: `${meter.pct}%`,
                  animation: `ux-grow-x 1.1s cubic-bezier(0.16,1,0.3,1) ${i * 140}ms both`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/** The docked developer browser: a real system webview inside the right panel. */
export function BrowserPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-surface-raised hairline",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-surface px-2 py-1.5">
        <span className="flex gap-1 text-faint-foreground">
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <svg viewBox="0 0 24 24" className="size-3 opacity-40" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m10 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="flex h-[17px] flex-1 items-center gap-1 rounded-md bg-surface-sunken px-2 text-[9px] text-muted-foreground">
          <span className="text-positive">●</span>
          localhost:5173
        </span>
        <span className="text-[9px] text-faint-foreground">DevTools</span>
      </div>
      <div className="space-y-2 p-3">
        <div className="h-[26px] rounded-md bg-accent/12" />
        <div className="grid grid-cols-3 gap-1.5">
          <div className="h-[34px] rounded-md bg-surface-sunken" />
          <div className="h-[34px] rounded-md bg-surface-sunken" />
          <div className="h-[34px] rounded-md bg-surface-sunken" />
        </div>
        <Bar w="88%" />
        <Bar w="64%" tone="faint" />
      </div>
      <div className="border-t border-border/60 bg-surface px-2.5 py-1.5">
        <span className="font-mono text-[8.5px] text-faint-foreground">
          agent → browser_navigate(&quot;localhost:5173&quot;)
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** The launcher: pick an agent, it starts in this worktree's terminal. */
export function LauncherCard({ className }: { className?: string }) {
  const items = WIRED_AGENTS.filter((a) => a.onPhone).slice(0, 5);
  return (
    <Panel title="Launch in feat/checkout-retry" className={className} icon={FolderIcon}>
      <div className="flex flex-col p-1.5">
        {items.map((agent, i) => (
          <div
            key={agent.id}
            className={cn(
              "flex items-center gap-2 rounded-md px-1.5 py-[5px]",
              i === 0 && "bg-sidebar-accent",
            )}
            style={{ animation: `ux-rise 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 70}ms both` }}
          >
            <AgentMark logo={agent.logo} name={agent.name} className="size-[15px]" />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[9.5px]",
                i === 0 ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {agent.name}
            </span>
            {i === 0 && (
              <span className="rounded bg-surface px-1 text-[8px] text-faint-foreground">
                ⏎
              </span>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/** Dragging a file-tree row onto a terminal to insert its path. */
export function DragCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-surface-raised hairline",
        className,
      )}
    >
      <div className="flex">
        <div className="w-[42%] shrink-0 border-r border-border/60 bg-surface py-1.5">
          {["src", "billing", "retry.ts", "queue.ts"].map((name, i) => (
            <div
              key={name}
              className={cn(
                "flex items-center gap-1 px-2 py-[3px] text-[9px]",
                i === 2 ? "text-warning" : "text-muted-foreground",
              )}
              style={{ paddingLeft: `${8 + (i === 0 ? 0 : i === 1 ? 8 : 16)}px` }}
            >
              <svg viewBox="0 0 24 24" className="size-[10px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9">
                {i < 2 ? (
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                ) : (
                  <>
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 3v5h5" />
                  </>
                )}
              </svg>
              {name}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 bg-surface-sunken p-2 font-mono text-[9px] leading-relaxed">
          <div className="text-faint-foreground">
            <span className="text-accent">&gt;</span> explain the backoff in
          </div>
          <div className="truncate text-foreground/70">
            src/billing/retry.ts
            <span
              className="ml-px inline-block h-[9px] w-[5px] translate-y-[1px] bg-accent"
              style={{ animation: "ux-caret 1.1s step-end infinite" }}
            />
          </div>
        </div>
      </div>

      {/* The dragged row, travelling from the tree to the terminal. */}
      <div
        className="pointer-events-none absolute left-[16%] top-[46%] flex items-center gap-1 rounded-md border border-accent/40 bg-surface-raised px-1.5 py-[3px] text-[9px] text-warning"
        style={{ animation: "ux-drag 3.4s cubic-bezier(0.5,0,0.2,1) infinite" }}
      >
        <svg viewBox="0 0 24 24" className="size-[10px]" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
          <path d="M14 3v5h5" />
        </svg>
        retry.ts
      </div>
    </div>
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
        <span className="font-mono text-[12px] text-accent">{RAM_TARGET}</span>
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
