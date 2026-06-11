// Global reactive application state (Svelte 5 runes).
//
// This is the frontend source of truth for UI/layout state and a cached mirror
// of the backend's persisted document. Backend remains authoritative for repos,
// worktrees and settings on disk; here we hold the live copy the UI binds to.

import { getAppState, ping, updateSettings } from "$lib/api";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type RepoData,
  type TerminalProfile,
} from "$lib/types";
import { terminals } from "$lib/state/terminals.svelte";

/** Connection state of the Rust backend, surfaced in the status bar. */
export type BackendStatus = "connecting" | "ready" | "error";

class AppStore {
  /** Registered repositories (and their worktrees). */
  repos = $state<RepoData[]>([]);
  /** Persisted UI/app settings. */
  settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
  /** Currently selected worktree, or null when none is active. */
  activeWorktreeId = $state<string | null>(null);
  /** Backend reachability for the status bar. */
  backend = $state<BackendStatus>("connecting");
  /** Last backend error message, if any. */
  errorMessage = $state<string | null>(null);
  /** Whether the Settings dialog is open. */
  settingsOpen = $state(false);

  /** Hydrate from the backend: confirm liveness, then load persisted state. */
  async init(): Promise<void> {
    try {
      await ping();
      const data = await getAppState();
      this.repos = data.repos;
      this.settings = data.settings;
      this.backend = "ready";
      this.errorMessage = null;
      terminals.restore(data.terminalLayout ?? null);
    } catch (err) {
      this.backend = "error";
      this.errorMessage = err instanceof Error ? err.message : String(err);
      // Still hydrate (with the default layout) so terminals render even when
      // the backend is unreachable (e.g. the web preview).
      terminals.restore(null);
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
  }): void {
    const profile = this.profile(opts?.profileId);
    const command = profile?.command?.trim();
    const name = profile?.name?.trim();
    terminals.create({
      cwd: opts?.cwd,
      title: opts?.title ?? (name || undefined),
      shell: command || undefined,
      args: command ? profile?.args : undefined,
    });
  }

  /** xterm colors for the current theme, so terminals follow light/dark. */
  terminalPalette(): { background: string; foreground: string; cursor: string } {
    return this.prefersDark()
      ? { background: "#0b0b0c", foreground: "#e6e6e6", cursor: "#e6e6e6" }
      : { background: "#ffffff", foreground: "#1f2328", cursor: "#1f2328" };
  }

  /** Whether the dark theme should be applied right now. */
  prefersDark(): boolean {
    if (this.settings.theme === "dark") return true;
    if (this.settings.theme === "light") return false;
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches
    );
  }
}

/** Singleton store shared across the app. */
export const app = new AppStore();
