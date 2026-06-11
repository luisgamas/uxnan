// Global reactive application state (Svelte 5 runes).
//
// This is the frontend source of truth for UI/layout state and a cached mirror
// of the backend's persisted document. Backend remains authoritative for repos,
// worktrees and settings on disk; here we hold the live copy the UI binds to.

import { getAppState, ping, updateSettings } from "$lib/api";
import { DEFAULT_SETTINGS, type AppSettings, type RepoData } from "$lib/types";
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
