// File-tree state for the right-panel "Files" tab (Svelte 5 runes).
//
// Kept in a singleton store (not in the component) so the lazy-loaded tree and
// its expanded folders survive the tab being unmounted when the user flips to
// the "Changes" tab and back. Reset whenever the active worktree changes. All FS
// access goes through `$lib/api`.

import { listen } from "@tauri-apps/api/event";
import { fsListDir, fsSetWatch } from "$lib/api";
import type { FsChangedEvent, FsEntry } from "$lib/types";

/** Safety cap for "expand all" so it never tries to load an unbounded tree. */
const EXPAND_ALL_CAP = 1500;

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

class FileTreeStore {
  /** Active worktree root (forward-slash, no trailing slash), or null. */
  root = $state<string | null>(null);
  /** Lazily-loaded children keyed by directory path. */
  childrenByDir = $state<Record<string, FsEntry[]>>({});
  /** Set of expanded directory paths. */
  expanded = $state<Set<string>>(new Set());
  /** Directories with an in-flight listing (drives the spinner). */
  loadingDir = $state<Set<string>>(new Set());
  error = $state<string | null>(null);
  /** Live filter query for the tree (matches entry names; empty = no filter). */
  query = $state("");
  private listening = false;

  /** Subscribe to the backend's `fs:changed` events (once) so files created,
   *  deleted or edited on disk reload the affected directories automatically.
   *  Events for a root other than the one we're showing are ignored. */
  async startListening(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    try {
      await listen<FsChangedEvent>("fs:changed", (e) => {
        if (e.payload.root === this.root) this.applyFsChange(e.payload.paths);
      });
    } catch {
      // No Tauri event bus (e.g. the plain web preview) — manual refresh only.
      this.listening = false;
    }
  }

  /** Reload every already-loaded directory whose contents may have changed. The
   *  backend reports each changed path together with its parent dir, so a new or
   *  deleted entry surfaces by reloading the parent (which we have loaded iff
   *  it's expanded/visible). Collapsed/unloaded dirs are skipped — they reload
   *  lazily on next expand. */
  private applyFsChange(paths: string[]): void {
    const affected = new Set(paths);
    for (const dir of Object.keys(this.childrenByDir)) {
      if (affected.has(dir)) void this.loadDir(dir, true);
    }
  }

  /** Point the tree at a worktree root, resetting + loading it, and aim the
   *  backend filesystem watcher at it. No-op when the root is unchanged, so
   *  remounting the tab keeps the expanded state. */
  setRoot(root: string | null): void {
    void this.startListening();
    if (root === this.root) return;
    this.root = root;
    this.childrenByDir = {};
    this.expanded = new Set();
    this.error = null;
    this.query = "";
    void fsSetWatch(root).catch(() => {});
    if (root) void this.loadDir(root);
  }

  /** Collapse every folder. */
  collapseAll(): void {
    this.expanded = new Set();
  }

  /** Expand the whole tree, loading folders level by level as needed. Capped at
   *  [`EXPAND_ALL_CAP`] directories so it can't freeze on a giant tree
   *  (`node_modules`, …); past the cap it stops, leaving the rest collapsed. */
  async expandAll(): Promise<void> {
    if (!this.root) return;
    const next = new Set(this.expanded);
    const queue: string[] = [this.root];
    let visited = 0;
    while (queue.length > 0 && visited < EXPAND_ALL_CAP) {
      const dir = queue.shift()!;
      visited++;
      await this.loadDir(dir);
      for (const e of this.childrenByDir[dir] ?? []) {
        if (e.isDir) {
          next.add(e.path);
          queue.push(e.path);
        }
      }
    }
    this.expanded = next;
  }

  async loadDir(dir: string, force = false): Promise<void> {
    if (this.childrenByDir[dir] && !force) return;
    this.loadingDir = new Set(this.loadingDir).add(dir);
    try {
      const entries = await fsListDir(dir);
      this.childrenByDir = { ...this.childrenByDir, [dir]: entries };
      this.error = null;
    } catch (e) {
      this.error = msg(e);
    } finally {
      const s = new Set(this.loadingDir);
      s.delete(dir);
      this.loadingDir = s;
    }
  }

  /** Expand/collapse a directory (loading its children on first expand). */
  toggle(entry: FsEntry): void {
    const next = new Set(this.expanded);
    if (next.has(entry.path)) {
      next.delete(entry.path);
    } else {
      next.add(entry.path);
      void this.loadDir(entry.path);
    }
    this.expanded = next;
  }

  /** Reload every already-loaded directory (keeps the expansion state). */
  refresh(): void {
    for (const dir of Object.keys(this.childrenByDir)) void this.loadDir(dir, true);
  }
}

/** Singleton file-tree store shared by the Files tab. */
export const fileTree = new FileTreeStore();
