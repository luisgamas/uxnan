// "Unread / done" badges (spec 02d §2). When an agent finishes (reaches `done`,
// or settles idle while you're looking elsewhere) we mark its workspace
// "unread" so the sidebar shows a red badge and the dock/taskbar shows a count.
// Badges clear when you open that worktree, or all at once when you focus the
// window (you're back — you'll see what changed).

class UnreadStore {
  /** Workspaces (worktree path, or "" for Global) with an unreviewed result. */
  byWorkspace = $state<Record<string, boolean>>({});

  /** Mark a workspace as having an unreviewed agent result. */
  mark(workspace: string): void {
    if (this.byWorkspace[workspace]) return;
    this.byWorkspace = { ...this.byWorkspace, [workspace]: true };
    void this.syncBadge();
  }

  /** Clear one workspace's badge (e.g. when the user opens it). */
  clear(workspace: string): void {
    if (!this.byWorkspace[workspace]) return;
    const { [workspace]: _drop, ...rest } = this.byWorkspace;
    this.byWorkspace = rest;
    void this.syncBadge();
  }

  /** Clear every badge (e.g. on window focus). */
  clearAll(): void {
    if (Object.keys(this.byWorkspace).length === 0) return;
    this.byWorkspace = {};
    void this.syncBadge();
  }

  /** Whether a workspace has an unreviewed result. */
  has(workspace: string): boolean {
    return !!this.byWorkspace[workspace];
  }

  /** Number of workspaces with unreviewed results (the dock/taskbar count). */
  get count(): number {
    return Object.keys(this.byWorkspace).length;
  }

  /** Reflect the count on the OS dock/taskbar badge (best-effort; no-op without
   *  a Tauri window, e.g. the web preview). */
  private async syncBadge(): Promise<void> {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setBadgeCount(this.count || undefined);
    } catch {
      // Not running under Tauri, or the platform has no badge — ignore.
    }
  }
}

/** Singleton unread-badge store shared across the sidebar. */
export const unread = new UnreadStore();
