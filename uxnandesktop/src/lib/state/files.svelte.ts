// File-editor state for the center panel (Svelte 5 runes).
//
// Opened from the file-tree tab (right panel). Holds the file currently open in
// the CodeMirror editor: its content baseline (for dirty tracking), the
// `git diff HEAD` text that drives the change gutter, and the load/save
// orchestration. The CodeMirror document itself lives in `FileEditor.svelte`;
// this store owns everything around it. All FS/git access goes through `$lib/api`.

import { fsReadFile, fsWriteFile, gitDiffHead } from "$lib/api";
import { git } from "$lib/state/git.svelte";

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

/** Strip a trailing slash, then return `abs` relative to `root` (forward-slash),
 *  or just the file name when it isn't under `root`. */
function relativeTo(abs: string, root: string): string {
  const base = root.replace(/\/+$/, "");
  if (abs === base) return abs.split("/").pop() ?? abs;
  if (abs.startsWith(base + "/")) return abs.slice(base.length + 1);
  return abs.split("/").pop() ?? abs;
}

class FilesStore {
  /** Worktree root (forward-slash) of the open file, for git-relative ops. */
  worktree = $state<string | null>(null);
  /** Absolute (forward-slash) path of the file open in the editor, or null. */
  path = $state<string | null>(null);
  /** Worktree-relative path (forward-slash), for git diff + status matching. */
  rel = $state("");
  loading = $state(false);
  saving = $state(false);
  error = $state<string | null>(null);
  /** The file isn't editable text (binary / invalid UTF-8). */
  binary = $state(false);
  /** The file is too large to load into the editor. */
  tooLarge = $state(false);
  /** Last loaded / saved content — the baseline the editor diffs "dirty" against. */
  baseline = $state("");
  /** `git diff HEAD` for the open file; drives the change gutter (empty = clean). */
  headDiff = $state("");
  /** Whether the editor document differs from `baseline` (the editor sets this). */
  dirty = $state(false);
  /** Bumped on each successful load so the editor re-initializes its document. */
  rev = $state(0);

  /** File name (last path segment) of the open file. */
  get name(): string {
    return this.path ? (this.path.split("/").pop() ?? this.path) : "";
  }

  /** Open `absPath` (forward-slash) in the editor, resolving its path relative to
   *  `worktree` for the git gutter. Reads the content + `git diff HEAD`. */
  async open(absPath: string, worktree: string | null): Promise<void> {
    this.path = absPath;
    this.worktree = worktree;
    this.rel = worktree ? relativeTo(absPath, worktree) : (absPath.split("/").pop() ?? absPath);
    this.loading = true;
    this.error = null;
    this.binary = false;
    this.tooLarge = false;
    this.dirty = false;
    this.headDiff = "";
    try {
      const r = await fsReadFile(absPath);
      this.binary = r.binary;
      this.tooLarge = r.tooLarge;
      this.baseline = r.content;
      if (!r.binary && !r.tooLarge && worktree) {
        this.headDiff = await gitDiffHead(worktree, this.rel).catch(() => "");
      }
      this.rev++;
    } catch (e) {
      this.error = msg(e);
      this.baseline = "";
      this.rev++;
    } finally {
      this.loading = false;
    }
  }

  /** Close the editor (returns the center panel to the terminals). */
  close(): void {
    this.path = null;
    this.dirty = false;
    this.headDiff = "";
    this.error = null;
  }

  /** Persist `content` to disk, then refresh the gutter + the right-panel status
   *  so the change indicators update immediately (not just on the 3 s watcher). */
  async save(content: string): Promise<void> {
    const path = this.path;
    const worktree = this.worktree;
    if (!path) return;
    this.saving = true;
    this.error = null;
    try {
      await fsWriteFile(path, content);
      this.baseline = content;
      this.dirty = false;
      if (worktree) {
        this.headDiff = await gitDiffHead(worktree, this.rel).catch(() => "");
        if (git.path === worktree) void git.refresh();
      }
    } catch (e) {
      this.error = msg(e);
      throw e;
    } finally {
      this.saving = false;
    }
  }
}

/** Singleton file-editor store shared by the tree + the center editor. */
export const files = new FilesStore();
