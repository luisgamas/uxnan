// Per-launch registration of uxnan's browser MCP server on the command line.
//
// The backend serves the server and owns the *registry* of how each CLI is
// pointed at it for one launch (`src-tauri/src/mcpinject.rs`); this module is
// the other half: it appends that CLI's arguments to the command uxnan is about
// to type into a terminal. Env-registered agents (OpenCode) need nothing here —
// the backend puts their variable on the terminal it spawns.
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
/** In-flight/settled load, so concurrent callers share one round-trip. */
let loading: Promise<void> | null = null;

/** True once the catalog carries real launch arguments, which only happens after
 *  the hook server is listening (its port is in every one of them). */
function warm(): boolean {
  return catalog.some((a) => a.args.length > 0);
}

/** Fetch the per-launch catalog. Safe to call repeatedly — concurrent callers
 *  share one round-trip, and a failure (web preview, backend not ready yet) just
 *  leaves the catalog empty, which means "launch the agent without the browser
 *  tools" rather than failing the launch. */
export async function loadMcpLaunch(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const info = await mcpInfo();
      catalog = info.agents ?? [];
    } catch {
      catalog = [];
    }
  })();
  try {
    await loading;
  } finally {
    // A cold result must stay retryable: the hook server may simply not have
    // been listening yet when the app started.
    if (!warm()) loading = null;
  }
}

/** Make sure the catalog is loaded before a command line is built. Returns
 *  immediately when registration is off or the catalog is already warm, so the
 *  launch path only ever pays for the round-trip once. */
export async function ensureMcpLaunch(): Promise<void> {
  if (!enabled || warm()) return;
  await loadMcpLaunch();
}

/** Mirror the browser settings that decide whether (and for whom) the server is
 *  registered. Pushed from the app store on load and on every settings write. */
export function syncMcpLaunchSettings(browser: BrowserSettings | undefined): void {
  enabled = browser?.enabled !== false && browser?.mcpEnabled !== false;
  disabled = browser?.mcpDisabledAgents ?? [];
}

/** Test seam: replace the catalog without a backend round-trip. */
export function __setMcpCatalog(agents: McpAgentInfo[]): void {
  catalog = agents;
  loading = Promise.resolve();
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

/** The launch arguments for `commandLine`, or `[]` when this command isn't an
 *  agent we register, the agent is turned off, or the server isn't up yet. */
export function mcpLaunchArgs(commandLine: string): string[] {
  if (!enabled) return [];
  const exe = launchExecutable(commandLine);
  if (!exe) return [];
  const agent = catalog.find((a) => a.commands.includes(exe));
  if (!agent || disabled.includes(agent.id)) return [];
  return agent.args;
}

/** Append this launch's MCP registration to a command line, quoted for `shell`.
 *  Returns the line untouched when there is nothing to add — the common case for
 *  every command that isn't one of the registered agents. */
export function withMcpLaunch(commandLine: string, shell?: string | null): string {
  const args = mcpLaunchArgs(commandLine);
  if (args.length === 0) return commandLine;
  const kind: ShellKind = shellKind(shell);
  return [commandLine, ...args.map((a) => quoteArg(a, kind))].join(" ");
}
