// Per-tab file-editor state (Svelte 5 runes).
//
// One instance per **file tab** in the center area (registered in the terminals
// store, rendered by `FileEditor.svelte`). Holds the open file's content
// baseline (for dirty tracking), the live editor `content` (so the document can
// be saved headlessly — e.g. from the dirty-close guard), the `git diff HEAD`
// text that drives the change gutter, and the load/save orchestration. The
// CodeMirror document itself lives in `FileEditor.svelte`. All FS/git access
// goes through `$lib/api`.

import { readFileOn, writeFileOn } from "$lib/fsRouter";
import { diffHeadOn } from "$lib/gitRouter";
import { isLocalTarget, LOCAL_TARGET, sshHostId, type TargetId } from "$lib/target";
import { git } from "$lib/state/git.svelte";
import { sessions } from "$lib/state/sessions.svelte";
import { i18n } from "$lib/i18n";

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
  /** Absolute (forward-slash) path of the file open in the editor. Mutable so a
   *  tab rename can re-point the same editor at the moved file (see `repoint`). */
  path = $state("");
  /** Worktree root (forward-slash) of the open file, for git-relative ops. */
  readonly worktree: string | null;
  /** Worktree-relative path (forward-slash), for git diff + status matching. */
  rel = $state("");
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
  /** A pending "scroll to this line" request (1-based), or null. Set when a file
   *  is opened from a content-search hit; the editor applies it once the document
   *  has loaded and then leaves it alone. `seq` makes a repeat of the *same* line
   *  a new request, so clicking the same hit twice scrolls back to it. */
  reveal = $state<{ line: number; seq: number } | null>(null);
  private revealSeq = 0;

  /** The machine this file lives on. A file tab is opened from a tree that
   *  already knows it, and a read has to go where the path came from. */
  readonly target: TargetId;

  constructor(absPath: string, worktree: string | null, target: TargetId = LOCAL_TARGET) {
    this.path = absPath;
    this.worktree = worktree;
    this.target = target;
    this.rel = worktree ? relativeTo(absPath, worktree) : (absPath.split("/").pop() ?? absPath);
    void this.load();
  }

  /** File name (last path segment) of the open file. */
  get name(): string {
    return this.path.split("/").pop() ?? this.path;
  }

  /** Ask the editor to scroll to (and briefly mark) a 1-based line — how a
   *  content-search hit lands on the line it matched. Safe before the file has
   *  loaded: the editor holds the request until the document exists. */
  requestReveal(line: number): void {
    this.reveal = { line, seq: ++this.revealSeq };
  }

  /** Re-point the editor at a moved file (a rename in the same folder). The bytes
   *  are unchanged, so content/dirty state are preserved — only the path, the
   *  git-relative path and the HEAD diff are refreshed (git sees a rename). */
  async repoint(newPath: string): Promise<void> {
    this.path = newPath;
    this.rel = this.worktree
      ? relativeTo(newPath, this.worktree)
      : (newPath.split("/").pop() ?? newPath);
    if (!this.binary && !this.tooLarge) {
      this.headDiff = await this.diffAgainstHead();
    }
  }

  /** The file's diff against HEAD, or empty when there is nothing to ask.
   *
   *  Asked on whichever machine the file is on. A failure is swallowed on
   *  purpose and always was: the gutter is a decoration over a file that opened
   *  perfectly well, and a folder that is not a repository (or a host that
   *  dropped) must not put an error toast over it. */
  private async diffAgainstHead(): Promise<string> {
    if (!this.worktree) return "";
    return diffHeadOn(this.target, this.worktree, this.rel).catch(() => "");
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
      const r = await readFileOn(this.target, this.path);
      this.binary = r.binary;
      this.tooLarge = r.tooLarge;
      this.baseline = r.content;
      this.content = r.content;
      if (!r.binary && !r.tooLarge && this.worktree) {
        this.headDiff = await this.diffAgainstHead();
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

  /** Whether this file cannot be written from here.
   *
   *  A file on a host is writable (over SFTP) **while that host is connected**.
   *  Without a live session there is nothing to write through, and the
   *  connection generation a save has to carry does not exist — so the editor
   *  says so up front instead of failing at the end of a round trip. */
  get readOnly(): boolean {
    const host = sshHostId(this.target);
    return host !== null && sessions.generationOf(host) === undefined;
  }

  /** Persist `content` to disk, then refresh the gutter + the right-panel status
   *  so the change indicators update immediately (not just on the watcher). */
  async save(content: string): Promise<void> {
    const host = sshHostId(this.target);
    if (host !== null && sessions.generationOf(host) === undefined) {
      // Refused before anything is written, and said in the pane rather than
      // swallowed: an editor that silently does not save is worse than one that
      // will not.
      this.error = i18n.t("files.hostDisconnected", { host: sessions.labelOf(host) });
      return;
    }
    this.saving = true;
    this.error = null;
    try {
      await writeFileOn(
        this.target,
        this.path,
        content,
        host ? sessions.generationOf(host) : undefined,
      );
      this.baseline = content;
      this.content = content;
      this.dirty = false;
      this.externallyChanged = false;
      if (this.worktree) {
        this.headDiff = await this.diffAgainstHead();
        // The panel is showing this worktree only if both halves match — the
        // same absolute path on two machines is two different worktrees.
        if (git.path === this.worktree && git.target === this.target) void git.refresh();
      }
    } catch (e) {
      this.error = msg(e);
      throw e;
    } finally {
      this.saving = false;
    }
  }
}
