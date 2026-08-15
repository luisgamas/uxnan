// "Files under this worktree changed" registry — pure TS, no Svelte imports.
//
// The signal has one publisher (the git store, after an action of ours that
// rewrites files) and one subscriber (the terminals store, which owns the open
// editor and diff tabs). They cannot import each other: `terminals` already
// reaches the file layer, and the file layer reads the git store, so a direct
// call would close a `git → terminals → files → git` cycle — the same shape the
// session registry exists to prevent. Same pattern as `flushRegistry` and
// `statusSweepRegistry`.
//
// **Why this exists at all.** Locally, nobody needs it: the backend watcher sees
// the write and emits `fs:changed`, which is also how an edit from *outside* the
// app reaches the tabs. A host has no watcher — polling one over SSH would be a
// shell start on someone else's machine every few seconds (`02g` §5.11) — so for
// the changes the app makes *itself*, it says so directly. It knows what it did;
// that needs no watcher.

import type { TargetId } from "$lib/target";

type Notify = (root: string, target: TargetId) => void;

let notify: Notify | null = null;

/** Register the implementation (the terminals store does this once). */
export function registerExternalChangeNotifier(fn: Notify): void {
  notify = fn;
}

/** Say that files under `root` on `target` changed because of something we did.
 *  A no-op before the store registers, or in a harness without one. */
export function noteExternalChange(root: string, target: TargetId): void {
  notify?.(root, target);
}
