// A worktree's git, on the machine it is on.
//
// The sibling of `fsRouter`, and it exists for the same reason: the alternative
// is every call site asking "is this project remote?", which is the shape that
// already cost us once — the launcher, the terminal and the git panels each
// answered that question separately, and one of them answered it wrong.
//
// There is one set of git commands, and each takes the machine it is for: this
// one, or a host, whose engine runs the same git there. What is left here is
// the one thing a caller must not have to remember: **a mutation on a host
// carries an expectation**. A stage, a discard or a commit names the machine
// and the connection it was prepared for, and the backend refuses it outright
// when that no longer holds — the same absolute path usually exists on both
// machines, so a misrouted mutation is the one that looks like success.
// Without a generation, a remote mutation is refused here rather than sent with
// a zero, which the backend might satisfy by accident.

import {
  gitApply,
  gitCommit,
  gitDiff,
  gitDiffHead,
  gitDiscard,
  generateCommitMessage,
  gitImageDiff,
  gitFetch,
  gitLog,
  gitPull,
  gitPush,
  gitRepoStatus,
  gitReview,
  gitShow,
  gitStage,
  gitStageAll,
  gitUnstage,
  gitUnstageAll,
} from "$lib/api";
import { expectation, sshHostId, type TargetExpectation, type TargetId } from "$lib/target";
import type {
  CommitInfo,
  FileChange,
  FileNumstat,
  ImageDiff,
  WorktreeStatus,
} from "$lib/types";

type Target = TargetId | undefined | null;

/** Everything the Changes tab draws about a worktree, from either machine. */
export interface Review {
  files: FileChange[];
  numstat: FileNumstat[];
  status: WorktreeStatus;
  /** HEAD, when the machine reported one (History uses it to know it is stale). */
  head: string | null;
  /** False only when the folder is not a repository at all — a different
   *  state from a thrown error, and from "clean". */
  isRepo: boolean;
}

/** The expectation a mutation on `target` is sent with: none for this machine;
 *  for a host, the connection the caller last saw. Thrown rather than
 *  defaulted: see the note above.
 *
 *  Every caller of this is `async`, deliberately — a promise-returning function
 *  that throws *synchronously* skips the `.catch()` its callers wrote and takes
 *  down whatever called it instead. */
function fence(target: Target, generation?: number): TargetExpectation | undefined {
  const host = sshHostId(target);
  if (!host) return undefined;
  if (generation === undefined) {
    throw new Error(`no live connection to ${host} to act against`);
  }
  return expectation(target, generation);
}

/** Read a worktree's whole review state, in one call on either machine. */
export async function reviewOn(target: Target, path: string): Promise<Review> {
  const r = await gitReview(path, target);
  return {
    files: r.files,
    numstat: r.numstat,
    status: { dirty: r.dirty, ahead: r.ahead, behind: r.behind },
    head: r.head,
    isRepo: r.isRepo,
  };
}

/** A file's unified diff, staged or unstaged. */
export function diffOn(target: Target, path: string, file: string, staged: boolean): Promise<string> {
  return gitDiff(path, file, staged, target);
}

/** A file's diff against HEAD — what the editor's change gutter draws.
 *
 *  Distinct from `diffOn`: the gutter must keep marking a line after its hunk is
 *  staged, which `git diff` alone stops doing. */
export function diffHeadOn(target: Target, path: string, file: string): Promise<string> {
  return gitDiffHead(path, file, target);
}

/** Before/after versions of an image, from whichever machine it is on. */
export function imageDiffOn(
  target: Target,
  path: string,
  file: string,
  staged: boolean,
): Promise<ImageDiff> {
  return gitImageDiff(path, file, staged, target);
}

/** Draft a commit message with the configured agent.
 *
 *  The agent always runs on **this** machine — it is this machine's CLI and
 *  sign-in — and only the diff comes from wherever the project is. */
export function generateCommitMessageOn(target: Target, path: string): Promise<string> {
  return generateCommitMessage(path, target);
}

/** A worktree's history, newest first. */
export function logOn(target: Target, path: string, limit: number, skip: number): Promise<CommitInfo[]> {
  return gitLog(path, limit, skip, target);
}

/** One commit's patch. */
export function showOn(target: Target, path: string, hash: string): Promise<string> {
  return gitShow(path, hash, target);
}

export async function stageOn(
  target: Target,
  path: string,
  file: string,
  generation?: number,
): Promise<void> {
  return gitStage(path, file, target, fence(target, generation));
}

export async function unstageOn(
  target: Target,
  path: string,
  file: string,
  generation?: number,
): Promise<void> {
  return gitUnstage(path, file, target, fence(target, generation));
}

export async function stageAllOn(target: Target, path: string, generation?: number): Promise<void> {
  return gitStageAll(path, target, fence(target, generation));
}

export async function unstageAllOn(target: Target, path: string, generation?: number): Promise<void> {
  return gitUnstageAll(path, target, fence(target, generation));
}

export async function discardOn(
  target: Target,
  path: string,
  file: string,
  untracked: boolean,
  generation?: number,
): Promise<void> {
  return gitDiscard(path, file, untracked, target, fence(target, generation));
}

/** Apply a patch — the per-hunk stage / unstage / discard. */
export async function applyOn(
  target: Target,
  path: string,
  patch: string,
  cached: boolean,
  reverse: boolean,
  generation?: number,
): Promise<void> {
  return gitApply(path, patch, cached, reverse, target, fence(target, generation));
}

export async function commitOn(
  target: Target,
  path: string,
  message: string,
  amend: boolean,
  signOff: boolean,
  generation?: number,
): Promise<void> {
  return gitCommit(path, message, amend, signOff, target, fence(target, generation));
}

/** Fetch, push or pull, answering the worktree's new distance from its upstream.
 *
 *  On a host it runs **there**, with that machine's own credentials and the
 *  agent this connection forwards — the project lives on it, so its remote is
 *  reachable from it and not necessarily from here. */
export async function syncOn(
  target: Target,
  path: string,
  action: "fetch" | "push" | "pull",
  generation?: number,
): Promise<WorktreeStatus> {
  const expect = fence(target, generation);
  if (action === "fetch") return gitFetch(path, target, expect);
  await (action === "push" ? gitPush(path, target, expect) : gitPull(path, target, expect));
  const after = await gitRepoStatus(path, target);
  return { dirty: after.dirty, ahead: after.ahead, behind: after.behind };
}

/** A worktree's branch and row counts, from whichever machine it is on —
 *  `null` when the folder is not a repository there, which a row must show as
 *  "not read", never as zeroes that read as "clean". */
export async function repoStatusOn(target: Target, path: string): Promise<WorktreeStatus | null> {
  const s = await gitRepoStatus(path, target);
  if (!s.isRepo) return null;
  return { dirty: s.dirty, ahead: s.ahead, behind: s.behind };
}
