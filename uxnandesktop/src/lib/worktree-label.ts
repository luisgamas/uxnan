// What a worktree is *called* in the panel — the one place that decides.
//
// A worktree's name was `branch ?? "(detached)"`, spelled out separately in the
// row, the hover card, the palette and three dialogs. That is fine while every
// worktree sits on a branch; a checkout of a tag, a commit, or a PR's merge ref
// (or any HEAD the host could not read) has no branch, and the word
// "(detached)" is a statement about git's state, not a name: three of them under
// one project were indistinguishable, and in the flat views the card had nothing
// left to tell it apart by.
//
// So a worktree with no branch is named by its **folder** — which is what
// distinguishes checkouts of the same repository by construction (git refuses
// two on the same path) — and "detached at a1b2c3d" becomes a *hint* beside it:
// the state, plus the short commit that says where it is standing.
//
// Pure and free of Svelte/i18n so the rule is unit-tested; callers translate the
// hint with `formatWorktreeHint`.

import type { MessageKey } from "$lib/i18n/locales/en";

/** Why a worktree has no branch name, when it hasn't. */
export type WorktreeHint =
  /** HEAD sits on a commit. `sha` is its short form, or null if git gave none. */
  | { kind: "detached"; sha: string | null }
  /** Git was asked on another machine and could not answer — saying "detached"
   *  would claim something about a repository nobody read. */
  | { kind: "not-read" };

export interface WorktreeIdentity {
  /** The name to show: the branch, else the folder (else the short commit). */
  title: string;
  /** Present only when there is no branch to show. */
  hint: WorktreeHint | null;
}

export interface WorktreeIdentityInput {
  branch: string | null;
  path: string;
  /** The HEAD commit as git reported it (full or abbreviated), if known. */
  head: string | null;
  /** The project lives on another machine and git could not be read there. */
  remote?: boolean;
}

/** Length of the abbreviated commit shown to the user. */
export const SHORT_SHA_LENGTH = 7;

/** The last path segment, whatever the separators and trailing slashes. */
export function folderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Abbreviate a commit id; null for a missing or empty one. */
export function shortSha(head: string | null | undefined): string | null {
  const sha = head?.trim();
  return sha ? sha.slice(0, SHORT_SHA_LENGTH) : null;
}

/** Name a worktree: its branch when it has one, else its folder, with the reason
 *  there is no branch carried as a hint. */
export function worktreeIdentity(input: WorktreeIdentityInput): WorktreeIdentity {
  const branch = input.branch?.trim();
  if (branch) return { title: branch, hint: null };

  const sha = shortSha(input.head);
  return {
    // The folder always exists; the commit is the last resort for a path that
    // somehow has no usable segment.
    title: folderName(input.path) || sha || input.path,
    hint: input.remote && !sha ? { kind: "not-read" } : { kind: "detached", sha },
  };
}

/** Turn a hint into words. `t` is the app's translator, injected so this module
 *  stays free of the i18n runtime. */
export function formatWorktreeHint(
  hint: WorktreeHint,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (hint.kind === "not-read") return t("remote.branchNotRead");
  return hint.sha ? t("worktree.detachedAt", { sha: hint.sha }) : t("worktree.detached");
}
