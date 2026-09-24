// What uxnan adds to an agent's command line for one launch: the per-launch
// registration of its MCP server (the control surface), and whatever a CLI needs
// for any of that per-launch wiring to reach the process at all.
//
// The backend serves the server and owns the *registry* of how each CLI is
// pointed at it for one launch (`src-tauri/src/mcpinject.rs`); this module is
// the other half: it appends that CLI's arguments to the command uxnan is about
// to type into a terminal. Env-registered agents (OpenCode) need no registration
// argument — the backend puts their variable on the terminal it spawns — but
// OpenCode 2 needs `--standalone` (`requiredArgs`), or its agent would run in a
// shared background service that never sees this tab's environment. That one is
// added whatever the agent-tools switch says: it is about the launch working as
// a uxnan launch (hooks included), not about the tools.
//
// Why this exists at all: nothing is written to `~/.claude.json`,
// `~/.codex/config.toml` or any other config the user keeps, so an agent
// started outside uxnan never discovers the server — and never reports it as
// broken, which is exactly what used to happen.
//
// The transform is applied at the single point where a launch command is typed
// (`terminal/instances.ts`), so it covers a fresh agent launch, a resumed
// session and a woken tab alike. It is pure and shell-aware; the catalog and
// settings snapshot are pushed in from the app store rather than imported, so
// this module stays free of state-module cycles.

import { mcpInfo } from "$lib/api";
import { quoteArg, shellKind, type ShellKind } from "$lib/shell";
import type { BrowserSettings, McpAgentInfo } from "$lib/types";

/** Per-launch catalog from the backend (empty until `loadMcpLaunch` resolves). */
let catalog: McpAgentInfo[] = [];
/** Live snapshot of the settings that gate registration. */
let enabled = true;
let disabled: string[] = [];
/** The fetch in flight, so concurrent callers share one round-trip. */
let loading: Promise<void> | null = null;
/** Test seam: a catalog set by hand is not replaced by a fetch. */
let pinned = false;

/** Fetch the per-launch catalog. Safe to call repeatedly — concurrent callers
 *  share one round-trip, and a failure (web preview, backend not ready yet)
 *  keeps the catalog it had: empty at first, which means "launch the agent
 *  without the browser tools" rather than failing the launch. */
export async function loadMcpLaunch(): Promise<void> {
  if (pinned) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const info = await mcpInfo();
      catalog = info.agents ?? [];
    } catch {
      // Keep what we had.
    }
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

/** Refresh the catalog before a command line is built. Asked on every launch,
 *  not once: what a launch needs can change under a running app — the hook
 *  server comes up after the first terminals, and an OpenCode upgraded from 1
 *  to 2 needs `--standalone` that 1 would reject. The backend answers from a
 *  cache keyed on the CLI's binary, so an unchanged install costs a local
 *  round-trip and a `stat`. */
export async function ensureMcpLaunch(): Promise<void> {
  await loadMcpLaunch();
}

/** Mirror the settings that decide whether (and for whom) the server is
 *  registered — the agent-tools switch and the per-agent toggles, which live on
 *  the browser settings object they grew from. The browser's own master switch
 *  is not a gate: the catalog is far more than the browser tools. Pushed from
 *  the app store on load and on every settings write. */
export function syncMcpLaunchSettings(browser: BrowserSettings | undefined): void {
  enabled = browser?.mcpEnabled !== false;
  disabled = browser?.mcpDisabledAgents ?? [];
}

/** Test seam: replace the catalog without a backend round-trip. */
export function __setMcpCatalog(agents: McpAgentInfo[]): void {
  catalog = agents;
  pinned = true;
}

/** Test seam: forget the catalog, so the next load asks the backend again. */
export function __resetMcpLaunch(): void {
  catalog = [];
  pinned = false;
  loading = null;
}

/** The executable name a command line starts with, lowercased, without its
 *  directory, extension or quotes (`"C:\bin\claude.exe" --resume x` → `claude`).
 *  Returns "" when the line is blank. */
export function launchExecutable(commandLine: string): string {
  const line = commandLine.trim();
  if (!line) return "";
  // First token, honoring a quoted path with spaces.
  let token: string;
  if (line[0] === '"' || line[0] === "'") {
    const end = line.indexOf(line[0], 1);
    token = end === -1 ? line.slice(1) : line.slice(1, end);
  } else {
    token = line.split(/\s+/)[0] ?? "";
  }
  const base = token.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.(exe|cmd|bat|ps1|sh)$/i, "").toLowerCase();
}

/** The catalog entry for the agent `commandLine` launches, if it is one. */
function agentOf(commandLine: string): McpAgentInfo | undefined {
  const exe = launchExecutable(commandLine);
  return exe ? catalog.find((a) => a.commands.includes(exe)) : undefined;
}

/** The launch arguments for `commandLine`, or `[]` when this command isn't an
 *  agent we register, the agent is turned off, or the server isn't up yet. */
export function mcpLaunchArgs(commandLine: string): string[] {
  if (!enabled) return [];
  const agent = agentOf(commandLine);
  if (!agent || disabled.includes(agent.id)) return [];
  return agent.args;
}

/** The arguments `commandLine`'s CLI needs for uxnan's per-launch wiring to
 *  reach it (OpenCode 2's `--standalone`), whatever the agent-tools switch says —
 *  or `[]` when it needs none or the line already made that choice itself (a
 *  profile launching `--standalone` or `--server <url>` on purpose). */
export function requiredLaunchArgs(commandLine: string): string[] {
  const agent = agentOf(commandLine);
  const required = agent?.requiredArgs ?? [];
  if (required.length === 0) return [];
  const chosenBy = new Set(agent?.requiredArgsChosenBy ?? []);
  const chosen = commandLine
    .trim()
    .split(/\s+/)
    .slice(1)
    .some((token) => chosenBy.has(token.split("=")[0]));
  return chosen ? [] : required;
}

/** Append what this launch needs to a command line — the CLI's required
 *  arguments, then its MCP registration — quoted for `shell`. Returns the line
 *  untouched when there is nothing to add — the common case for every command
 *  that isn't one of the registered agents. */
export function withMcpLaunch(commandLine: string, shell?: string | null): string {
  const args = [...requiredLaunchArgs(commandLine), ...mcpLaunchArgs(commandLine)];
  if (args.length === 0) return commandLine;
  const kind: ShellKind = shellKind(shell);
  return [commandLine, ...args.map((a) => quoteArg(a, kind))].join(" ");
}
