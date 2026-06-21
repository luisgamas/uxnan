// Per-tab file-editor state (Svelte 5 runes).
//
// One instance per **file tab** in the center area (registered in the terminals
// store, rendered by `FileEditor.svelte`). Holds the open file's content
// baseline (for dirty tracking), the live editor `content` (so the document can
// be saved headlessly — e.g. from the dirty-close guard), the `git diff HEAD`
// text that drives the change gutter, and the load/save orchestration. The
// CodeMirror document itself lives in `FileEditor.svelte`. All FS/git access
// goes through `$lib/api`.

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

export class FileEditorState {
  /** Absolute (forward-slash) path of the file open in the editor. */
  readonly path: string;
  /** Worktree root (forward-slash) of the open file, for git-relative ops. */
  readonly worktree: string | null;
  /** Worktree-relative path (forward-slash), for git diff + status matching. */
  readonly rel: string;
  loading = $state(true);
  saving = $state(false);
  error = $state<string | null>(null);
  /** The file isn't editable text (binary / invalid UTF-8). */
  binary = $state(false);
  /** The file is too large to load into the editor. */
  tooLarge = $state(false);
  /** Last loaded / saved content — the baseline the editor diffs "dirty" against. */
  baseline = $state("");
  /** Live editor document text (kept in sync by the editor's update listener) so
   *  the file can be saved without reaching into CodeMirror. */
  content = $state("");
  /** `git diff HEAD` for the open file; drives the change gutter (empty = clean). */
  headDiff = $state("");
  /** Whether the editor document differs from `baseline` (the editor sets this). */
  dirty = $state(false);
  /** The file changed on disk while we hold unsaved edits — surfaced as a banner
   *  offering reload-vs-keep (a clean file is reloaded silently instead). */
  externallyChanged = $state(false);
  /** Bumped on each successful load so the editor re-initializes its document. */
  rev = $state(0);

  constructor(absPath: string, worktree: string | null) {
    this.path = absPath;
    this.worktree = worktree;
    this.rel = worktree ? relativeTo(absPath, worktree) : (absPath.split("/").pop() ?? absPath);
    void this.load();
  }

  /** File name (last path segment) of the open file. */
  get name(): string {
    return this.path.split("/").pop() ?? this.path;
  }

  /** Read the file content + its `git diff HEAD` from disk, resetting dirty /
   *  external-change state. Used on open and to reload after an external edit. */
  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.binary = false;
    this.tooLarge = false;
    this.dirty = false;
    this.externallyChanged = false;
    this.headDiff = "";
    try {
      const r = await fsReadFile(this.path);
      this.binary = r.binary;
      this.tooLarge = r.tooLarge;
      this.baseline = r.content;
      this.content = r.content;
      if (!r.binary && !r.tooLarge && this.worktree) {
        this.headDiff = await gitDiffHead(this.worktree, this.rel).catch(() => "");
      }
      this.rev++;
    } catch (e) {
      this.error = msg(e);
      this.baseline = "";
      this.content = "";
      this.rev++;
    } finally {
      this.loading = false;
    }
  }

  /** The file changed on disk: reload silently when clean, else flag the banner
   *  so the user chooses reload-vs-keep (never clobber unsaved edits). */
  noteExternalChange(): void {
    if (this.dirty) this.externallyChanged = true;
    else void this.load();
  }

  /** Persist `content` to disk, then refresh the gutter + the right-panel status
   *  so the change indicators update immediately (not just on the watcher). */
  async save(content: string): Promise<void> {
    this.saving = true;
    this.error = null;
    try {
      await fsWriteFile(this.path, content);
      this.baseline = content;
      this.content = content;
      this.dirty = false;
      this.externallyChanged = false;
      if (this.worktree) {
        this.headDiff = await gitDiffHead(this.worktree, this.rel).catch(() => "");
        if (git.path === this.worktree) void git.refresh();
      }
    } catch (e) {
      this.error = msg(e);
      throw e;
    } finally {
      this.saving = false;
    }
  }
}
