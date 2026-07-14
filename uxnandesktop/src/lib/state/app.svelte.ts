// Global reactive application state (Svelte 5 runes).
//
// This is the frontend source of truth for UI/layout state and a cached mirror
// of the backend's persisted document. Backend remains authoritative for repos,
// worktrees and settings on disk; here we hold the live copy the UI binds to.

import { listen } from "@tauri-apps/api/event";
import {
  getAppState,
  getClaudeHooksStatus,
  getHookInstall,
  openExternal,
  ping,
  quickCommandsSet,
  setAgentCommands,
  updateSettings,
} from "$lib/api";
import { i18n } from "$lib/i18n";
import { AGENT_CATALOG, agentLogoKey } from "$lib/agentCatalog";
import {
  DEFAULT_SETTINGS,
  type AgentProfile,
  type AppSettings,
  type AgentHooksStatus,
  type HookInstall,
  type QuickCommand,
  type RepoData,
  type TerminalProfile,
} from "$lib/types";
import { terminals, GLOBAL_WORKSPACE, type SplitDir } from "$lib/state/terminals.svelte";
import { primeNotifications } from "$lib/notify";
import { buildRunCommand, shellKind } from "$lib/shell";
import { currentOS } from "$lib/platform";
import {
  BUILTIN_DARK,
  BUILTIN_LIGHT,
  BUILTIN_THEMES,
  TERMINAL_INHERIT_ID,
  mergeTerminalTypography,
  resolveTerminal,
  type ResolvedTerminal,
  type TerminalThemePreset,
  type Theme as CustomTheme,
} from "$lib/theme";

/** Whether the OS currently prefers a dark color scheme. */
function detectSystemDark(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

/** Connection state of the Rust backend, surfaced in the status bar. */
export type BackendStatus = "connecting" | "ready" | "error";

/** A pane in the Settings dialog (also the deep-link target of `openSettings`). */
export type SettingsSection =
  | "appearance"
  | "language"
  | "shortcuts"
  | "commands"
  | "agents"
  | "providers"
  | "aicommit"
  | "hooks"
  | "terminal"
  | "updates"
  | "browser";

class AppStore {
  /** Registered repositories (and their worktrees). */
  repos = $state<RepoData[]>([]);
  /** Persisted UI/app settings. */
  settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
  /** User-programmed quick commands (top-bar launcher). A flat list; each item
   *  carries its own scope + binding. Persisted separately from settings. */
  quickCommands = $state<QuickCommand[]>([]);
  /** Bindable open state for the top-bar quick-commands menu, so a keyboard
   *  shortcut can open it without the trigger being focused. */
  quickCommandsMenuOpen = $state(false);
  /** Currently selected worktree, or null when none is active. */
  activeWorktreeId = $state<string | null>(null);
  /** Backend reachability for the status bar. */
  backend = $state<BackendStatus>("connecting");
  /** Last backend error message, if any. */
  errorMessage = $state<string | null>(null);
  /** Whether the Settings dialog is open. */
  settingsOpen = $state(false);
  /** Whether the multi-agent orchestration console is open. */
  orchestrationOpen = $state(false);
  /** Whether the integrated browser panel (the right-side "4th panel") is open. */
  browserOpen = $state(false);
  /** Target URL shown in the integrated browser panel. */
  browserUrl = $state("");
  /** Which Settings pane is shown (deep-linked via `openSettings`). */
  settingsSection = $state<SettingsSection>("appearance");
  /** Live OS dark-mode preference (kept in sync via a matchMedia listener), so
   *  the "System" theme reacts to the OS switching light/dark at runtime. */
  systemDark = $state(detectSystemDark());
  /** A theme being previewed in the editor (un-saved). When set it overrides the
   *  active theme so edits show live without persisting until the user saves. */
  previewTheme = $state<CustomTheme | null>(null);
  /** A terminal theme being previewed in the editor (un-saved). */
  previewTerminalTheme = $state<TerminalThemePreset | null>(null);

  // --- Agent hooks health (drives the status-bar indicator) ----------------
  /** On-disk hook scripts layout, or `null` if the startup install step failed. */
  hookInstall = $state<HookInstall | null>(null);
  /** Latest Claude hooks install status (read on startup + after a toggle). */
  claudeHooks = $state<AgentHooksStatus | null>(null);
  /** Whether we've performed at least one hook-status check (so the indicator
   *  stays hidden until we actually know, instead of flashing on launch). */
  hooksChecked = $state(false);

  /** Whether the agent hooks need the user's attention — the only condition
   *  under which the status-bar indicator shows. The hooks auto-install on
   *  startup, so this is true only when something actually went wrong: the
   *  script/install step degraded, the status couldn't be read, the OS refused
   *  it, or Claude's block isn't installed while auto-install is on. */
  get hooksNeedAttention(): boolean {
    if (!this.hooksChecked) return false;
    if (this.hookInstall === null) return true;
    const c = this.claudeHooks;
    if (!c) return true;
    if (c.unavailable && !c.installed) return true;
    if (!c.installed && this.settings.autoInstallHooks !== false) return true;
    return false;
  }

  /** Refresh the cached hook status (install layout + Claude block). Best-effort:
   *  a failed read leaves the indicator showing "needs attention". Called once
   *  after hydrate and again whenever the Hooks settings pane changes it. */
  async refreshHooksStatus(): Promise<void> {
    try {
      this.hookInstall = await getHookInstall();
    } catch {
      this.hookInstall = null;
    }
    try {
      this.claudeHooks = await getClaudeHooksStatus();
    } catch {
      this.claudeHooks = null;
    }
    this.hooksChecked = true;
  }

  /** Open the Settings dialog, optionally jumping straight to a pane. */
  openSettings(section: SettingsSection = "appearance"): void {
    this.settingsSection = section;
    this.settingsOpen = true;
  }

  /** Open the integrated browser panel at `url` (or the configured homepage, or a
   *  blank page). If the panel is already open, this just navigates it. */
  openBrowser(url?: string): void {
    const home = this.settings.browser?.homepage?.trim();
    const target = (url && url.trim()) || (home && home.length > 0 ? home : "about:blank");
    this.browserUrl = target;
    this.browserOpen = true;
  }

  /** Close the integrated browser panel (its `WebviewWindow` is destroyed). */
  closeBrowser(): void {
    this.browserOpen = false;
  }

  /** Toggle the integrated browser panel (opens at the homepage/blank). */
  toggleBrowser(): void {
    if (this.browserOpen) this.closeBrowser();
    else this.openBrowser();
  }

  /** Subscribe to OS dark-mode changes so the "System" theme tracks them live. */
  watchSystemTheme(): void {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", (e) => (this.systemDark = e.matches));
  }

  /** Every selectable theme (built-ins + the user's custom themes). */
  allThemes(): CustomTheme[] {
    return [...BUILTIN_THEMES, ...(this.settings.customThemes ?? [])];
  }

  /** The resolved active theme — a live preview if one is open; else "system"
   *  maps to the built-in light/dark by the OS preference; else the matching
   *  built-in or custom theme. */
  resolveActiveTheme(): CustomTheme {
    if (this.previewTheme) return this.previewTheme;
    const id = this.settings.activeThemeId ?? "system";
    if (id === "system") return this.systemDark ? BUILTIN_DARK : BUILTIN_LIGHT;
    return this.allThemes().find((t) => t.id === id) ?? BUILTIN_LIGHT;
  }

  /** The active theme with the global font override applied on top of its own
   *  fonts (what actually gets rendered). */
  effectiveTheme(): CustomTheme {
    const theme = this.resolveActiveTheme();
    const g = this.settings.fonts;
    if (!g) return theme;
    const fonts = {
      title: g.title?.trim() || theme.fonts?.title,
      body: g.body?.trim() || theme.fonts?.body,
      mono: g.mono?.trim() || theme.fonts?.mono,
    };
    return { ...theme, fonts };
  }

  /** Every saved terminal theme. */
  allTerminalThemes(): TerminalThemePreset[] {
    return this.settings.terminalThemes ?? [];
  }

  /** The active terminal theme preset (a live preview if open; else by the
   *  selection mode: a single theme, or a per-light/dark choice; "inherit" →
   *  null = follow the app theme with no terminal override). */
  resolveActiveTerminalTheme(): TerminalThemePreset | null {
    if (this.previewTerminalTheme) return this.previewTerminalTheme;
    let id: string;
    if ((this.settings.terminalThemeMode ?? "single") === "scheme") {
      const dark = this.resolveActiveTheme().base === "dark";
      id =
        (dark ? this.settings.terminalThemeDarkId : this.settings.terminalThemeLightId) ??
        TERMINAL_INHERIT_ID;
    } else {
      id = this.settings.activeTerminalThemeId ?? TERMINAL_INHERIT_ID;
    }
    if (id === TERMINAL_INHERIT_ID) return null;
    return this.allTerminalThemes().find((t) => t.id === id) ?? null;
  }

  /** Effective terminal options (font + xterm theme): the active theme's base
   *  defaults, overlaid with the active terminal preset, overlaid with the global
   *  terminal-typography override (which wins over each preset's fonts). */
  resolveTerminal(): ResolvedTerminal {
    const merged = mergeTerminalTypography(
      this.resolveActiveTerminalTheme(),
      this.settings.terminalFonts,
    );
    return resolveTerminal(this.resolveActiveTheme().base, merged);
  }

  /** Hydrate from the backend: confirm liveness, then load persisted state. */
  async init(): Promise<void> {
    this.watchSystemTheme();
    try {
      await ping();
      const data = await getAppState();
      this.repos = data.repos;
      this.settings = data.settings;
      this.quickCommands = data.quickCommands ?? [];
      this.backend = "ready";
      this.errorMessage = null;
      terminals.restore(data.terminalLayout ?? null);
      this.syncAgentCommands();
      // Check hook health in the background (drives the status-bar indicator).
      void this.refreshHooksStatus();
    } catch (err) {
      this.backend = "error";
      this.errorMessage = err instanceof Error ? err.message : String(err);
      // Still hydrate (with the default layout) so terminals render even when
      // the backend is unreachable (e.g. the web preview).
      terminals.restore(null);
    }
    // Route URLs the backend decides to open internally to the browser tab
    // (independent of backend health above; a no-op without the Tauri event bus).
    void this.listenOpenUrl();
  }

  /** Route backend `browser:open-url` events to the integrated browser tab. Fired
   *  by `open_url` (terminal link clicks, the agent `BROWSER` shim). For the `ask`
   *  policy the user picks in-app vs the OS browser. */
  private async listenOpenUrl(): Promise<void> {
    try {
      await listen<{ url: string; ask: boolean }>("browser:open-url", (e) => {
        const { url, ask } = e.payload;
        if (ask && !confirm(i18n.t("browser.askPrompt", { url }))) {
          void openExternal(url).catch(() => {});
          return;
        }
        this.openBrowser(url);
      });
    } catch {
      // No Tauri event bus (web preview) — nothing to route.
    }
  }

  /** Persist the current settings snapshot to disk. */
  async persistSettings(): Promise<void> {
    try {
      await updateSettings($state.snapshot(this.settings));
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  // --- Quick commands ------------------------------------------------------

  /** Persist the current quick-commands snapshot to disk. */
  async persistQuickCommands(): Promise<void> {
    try {
      await quickCommandsSet($state.snapshot(this.quickCommands));
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  /** Replace the whole quick-commands list and persist. */
  setQuickCommands(list: QuickCommand[]): void {
    this.quickCommands = list;
    void this.persistQuickCommands();
  }

  /** Append a quick command and persist. */
  addQuickCommand(cmd: QuickCommand): void {
    this.quickCommands.push(cmd);
    void this.persistQuickCommands();
  }

  /** Replace a quick command (matched by id) and persist. */
  updateQuickCommand(cmd: QuickCommand): void {
    const i = this.quickCommands.findIndex((c) => c.id === cmd.id);
    if (i >= 0) this.quickCommands[i] = cmd;
    void this.persistQuickCommands();
  }

  /** Remove a quick command by id and persist. */
  removeQuickCommand(id: string): void {
    this.quickCommands = this.quickCommands.filter((c) => c.id !== id);
    void this.persistQuickCommands();
  }

  /** Duplicate a quick command (a fresh id, a "copy" suffix) and persist. */
  duplicateQuickCommand(id: string): void {
    const src = this.quickCommands.find((c) => c.id === id);
    if (!src) return;
    const copy: QuickCommand = {
      ...$state.snapshot(src),
      id: crypto.randomUUID(),
      name: i18n.t("commands.copyName", { name: src.name }),
    };
    const i = this.quickCommands.findIndex((c) => c.id === id);
    this.quickCommands.splice(i + 1, 0, copy);
    void this.persistQuickCommands();
  }

  /** Drop worktree-scoped commands bound to `path` (called when the worktree is
   *  removed). No-op + no write when nothing matches. */
  pruneWorktreeCommands(path: string): void {
    const before = this.quickCommands.length;
    this.quickCommands = this.quickCommands.filter(
      (c) => !(c.scope === "worktree" && c.worktreePath === path),
    );
    if (this.quickCommands.length !== before) void this.persistQuickCommands();
  }

  /** Drop project-scoped commands bound to `repoId` and any worktree-scoped ones
   *  under `worktreePaths` (called when the whole project is removed). */
  pruneProjectCommands(repoId: string, worktreePaths: string[]): void {
    const paths = new Set(worktreePaths);
    const before = this.quickCommands.length;
    this.quickCommands = this.quickCommands.filter(
      (c) =>
        !(c.scope === "project" && c.projectId === repoId) &&
        !(c.scope === "worktree" && c.worktreePath != null && paths.has(c.worktreePath)),
    );
    if (this.quickCommands.length !== before) void this.persistQuickCommands();
  }

  // --- Terminal profiles ---------------------------------------------------

  /** The configured terminal profiles. */
  get terminalProfiles(): TerminalProfile[] {
    return this.settings.terminalProfiles;
  }

  /** The default profile (or the first one) for new terminals. */
  defaultProfile(): TerminalProfile | undefined {
    const id = this.settings.defaultProfileId;
    return (
      this.terminalProfiles.find((p) => p.id === id) ?? this.terminalProfiles[0]
    );
  }

  /** A profile by id (falls back to the default when unknown/unset). */
  profile(id?: string): TerminalProfile | undefined {
    if (!id) return this.defaultProfile();
    return this.terminalProfiles.find((p) => p.id === id) ?? this.defaultProfile();
  }

  /** Open a terminal from a profile (default unless `profileId` is given),
   *  resolving the profile's shell/args. A blank `command` falls back to the
   *  backend's platform default shell. `title` defaults to the profile name. */
  openTerminal(opts?: {
    cwd?: string;
    title?: string;
    profileId?: string;
    /** Workspace to open in (worktree path, or "" for Global). */
    workspace?: string;
  }): void {
    const profile = this.profile(opts?.profileId);
    const command = profile?.command?.trim();
    const name = profile?.name?.trim();
    terminals.create({
      cwd: opts?.cwd,
      title: opts?.title ?? (name || undefined),
      shell: command || undefined,
      args: command ? profile?.args : undefined,
      workspace: opts?.workspace,
    });
  }

  /** Open a terminal in the Global scratch space (not tied to any project),
   *  switching to it. The counterpart to `openTerminal`, which targets the
   *  active workspace. */
  openGlobalTerminal(): void {
    this.openTerminal({ workspace: GLOBAL_WORKSPACE });
  }

  /** Split the active workspace's focused terminal region in `dir`, opening a
   *  new terminal from the default profile in the fresh pane. Stays bound to the
   *  active workspace; a no-op when there's no region to split (nothing selected
   *  / an empty workspace), so a keyboard shortcut does nothing rather than
   *  surprising the user with an out-of-context split. */
  splitActiveTerminal(dir: SplitDir): void {
    const profile = this.defaultProfile();
    const command = profile?.command?.trim();
    terminals.split(terminals.activeGroupId, dir, {
      shell: command || undefined,
      args: command ? profile?.args : undefined,
    });
  }

  // --- Agents --------------------------------------------------------------

  /** The registered CLI coding agents. */
  get agentProfiles(): AgentProfile[] {
    return this.settings.agentProfiles;
  }

  /** The agents that can actually be launched (a non-blank command). */
  get launchableAgents(): AgentProfile[] {
    return this.agentProfiles.filter((a) => a.command.trim().length > 0);
  }

  /** The agent auto-launched on worktree create, if one is set and launchable. */
  defaultAgent(): AgentProfile | undefined {
    const id = this.settings.defaultAgentId;
    if (!id) return undefined;
    return this.launchableAgents.find((a) => a.id === id);
  }

  /** The terminal profile agents launch in when they don't pin their own.
   *  An explicit `agentShellProfileId` wins; otherwise it resolves to a smart
   *  default — Command Prompt (`cmd.exe`) on Windows, where agent CLIs start
   *  faster and quote more predictably than under PowerShell — else the default
   *  terminal profile. */
  agentShellProfile(): TerminalProfile | undefined {
    const id = this.settings.agentShellProfileId;
    if (id) {
      return this.terminalProfiles.find((p) => p.id === id) ?? this.defaultProfile();
    }
    if (currentOS() === "windows") {
      const cmd = this.terminalProfiles.find((p) =>
        /(^|[\\/])cmd(\.exe)?$/i.test(p.command.trim()),
      );
      if (cmd) return cmd;
    }
    return this.defaultProfile();
  }

  /** Resolve a detected agent command to a display name + logo (a configured
   *  agent wins over the catalog; an unknown command shows the command itself). */
  resolveAgent(command: string): { name: string; icon: string | null } {
    const c = command.trim().toLowerCase();
    const prof = this.agentProfiles.find((a) => a.command.trim().toLowerCase() === c);
    if (prof)
      return {
        name: prof.name.trim() || prof.command,
        icon: agentLogoKey(prof.icon, prof.command),
      };
    const cat = AGENT_CATALOG.find((a) => a.command.toLowerCase() === c);
    if (cat) return { name: cat.name, icon: cat.logo };
    return { name: command, icon: agentLogoKey(null, command) };
  }

  /** Tell the backend which commands count as agents for process detection
   *  (the catalog + the user's configured agents). */
  syncAgentCommands(): void {
    const commands = new Set<string>();
    for (const c of AGENT_CATALOG) commands.add(c.command);
    for (const a of this.agentProfiles) {
      const cmd = a.command.trim();
      if (cmd) commands.add(cmd);
    }
    void setAgentCommands([...commands]).catch(() => {});
  }

  /** Launch an agent: open a terminal on its chosen shell (its terminal profile,
   *  or the default one) in `workspace` (a worktree path, or "" for Global) and
   *  type the agent command into it. Running inside an interactive shell — rather
   *  than spawning the bare command — lets PATH/PATHEXT shims (`.cmd`/`.ps1`)
   *  resolve. No-op for an agent with a blank command. */
  launchAgent(
    agent: AgentProfile,
    opts: { cwd?: string; workspace?: string; title?: string },
  ): void {
    const command = agent.command.trim();
    if (!command) return;
    // Ask for notification permission now (focused, user-initiated) so an
    // agent-idle alert later isn't lost waiting on the OS prompt.
    primeNotifications();
    // Resolve the shell: the agent's pinned profile, else the configured default
    // agent shell (cmd.exe on Windows by default). The command line is quoted for
    // *that* shell's syntax so args with spaces/special chars survive.
    const shellProfile = agent.terminalProfileId
      ? this.profile(agent.terminalProfileId)
      : this.agentShellProfile();
    // With no profile configured on Windows, spawn cmd.exe explicitly — the backend
    // default is PowerShell, which mismatches the cmd-style quoting below and trips
    // npm `.ps1` shims on the default execution policy (agents land in a dead pane).
    const shell =
      shellProfile?.command?.trim() ||
      (currentOS() === "windows" ? "cmd.exe" : undefined);
    const kind = shellKind(shell);
    const runCommand = buildRunCommand(command, agent.args, kind);
    // Per-agent env vars → real environment on the spawned shell (inherited by
    // the agent). Blank keys are dropped; the backend prepends them before its
    // own `UXNAN_*` so those always win.
    const env = (agent.env ?? [])
      .map((e) => [e.key.trim(), e.value] as [string, string])
      .filter(([k]) => k.length > 0);
    const name = agent.name.trim() || command;
    // Base tab title = the worktree folder, so the name reverts from the agent
    // back to the shell once the agent exits (the display is agentName ?? title).
    const baseTitle = opts.cwd
      ? (opts.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? undefined)
      : undefined;
    terminals.create({
      cwd: opts.cwd,
      title: opts.title ?? baseTitle,
      shell,
      args: shell ? shellProfile?.args : undefined,
      runCommand,
      env: env.length ? env : undefined,
      agentName: name,
      agentIcon: agentLogoKey(agent.icon, agent.command),
      agentCommand: agent.command.trim(),
      workspace: opts.workspace,
    });
  }

  /** Whether the dark base applies right now (drives the `.dark` class). */
  prefersDark(): boolean {
    return this.resolveActiveTheme().base === "dark";
  }
}

/** Singleton store shared across the app. */
export const app = new AppStore();
