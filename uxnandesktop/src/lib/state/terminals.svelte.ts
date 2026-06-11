// Terminal tabs state (Svelte 5 runes).
//
// Tracks the open terminal tabs in the center area. Each tab maps to a backend
// PTY session (created by the Terminal component, keyed by the `id` chosen
// here). Hidden tabs stay mounted in the DOM so their PTY output keeps
// streaming in the background — switching tabs is instant and lossless.

import { invoke } from "@tauri-apps/api/core";

export interface TermTab {
  /** PTY id (also the event channel suffix: `pty:output:{id}`). */
  id: string;
  title: string;
  /** Working directory for the shell (undefined = home). */
  cwd?: string;
  /** Set once the underlying process has exited. */
  exited: boolean;
}

class TerminalStore {
  tabs = $state<TermTab[]>([]);
  activeId = $state<string | null>(null);

  /** Open a new terminal tab and make it active. The PTY itself is spawned by
   *  the Terminal component once it has measured its size. */
  create(opts?: { cwd?: string; title?: string }): string {
    const id = crypto.randomUUID();
    this.tabs.push({
      id,
      title: opts?.title ?? `Terminal ${this.tabs.length + 1}`,
      cwd: opts?.cwd,
      exited: false,
    });
    this.activeId = id;
    return id;
  }

  setActive(id: string): void {
    this.activeId = id;
  }

  /** Mark a tab's process as exited (e.g. the user typed `exit`). */
  markExited(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) tab.exited = true;
  }

  /** Close a tab: kill its PTY and remove it, picking a new active tab. */
  async close(id: string): Promise<void> {
    try {
      await invoke("pty_close", { id });
    } catch {
      // Already gone / never created — closing is idempotent.
    }
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index >= 0) this.tabs.splice(index, 1);
    if (this.activeId === id) {
      this.activeId = this.tabs.at(-1)?.id ?? null;
    }
  }
}

/** Singleton terminal store shared across the app. */
export const terminals = new TerminalStore();
