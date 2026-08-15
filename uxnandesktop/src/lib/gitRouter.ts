// Which machine a git operation runs on.
//
// The sibling of `fsRouter`, and it exists for the same reason: the alternative
// is every call site asking "is this project remote?", which is the shape that
// already cost us once — the launcher, the terminal and the git panels each
// answered that question separately, and one of them answered it wrong.
//
// Two things differ from files, and both are visible in the signatures here:
//
// - **Reads are batched on a host.** Locally, `git_status`, `worktree_status`
//   and `git_numstat` are three microsecond calls. On a host each one is a shell
//   start on another machine — ~2s on a real link — so the remote side answers
//   all three in one command (`reviewOn`). The local branch keeps making the
//   three calls it always made: batching them would be a rewrite of working code
//   to solve a problem the local machine does not have.
// - **Mutations carry an expectation.** A stage, a discard or a commit names the
//   machine and the connection it was prepared for, and the backend refuses it
//   outright when that no longer holds. The same absolute path usually exists on
//   both machines, so a misrouted mutation is the one that looks like success.
//   Without a generation, a remote mutation is refused here rather than sent
//   with a zero, which the backend might satisfy by accident.

import {
  gitApply,
  gitCommit,
  gitDiff,
  gitDiffHead,
  gitDiscard,
  gitFetch,
  gitLog,
  gitNumstat,
  gitPull,
  gitPush,
  gitShow,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  sshGitApply,
  sshGitCommit,
  sshGitDiff,
  sshGitDiffHead,
  sshGitDiscard,
  sshGitLog,
  sshGitReview,
  sshGitShow,
  sshGitStage,
  sshGitStageAll,
  sshGitSync,
  sshGitUnstage,
  sshGitUnstageAll,
  worktreeStatus,
} from "$lib/api";
import { expectation, sshHostId, type TargetId } from "$lib/target";
import type { CommitInfo, FileChange, FileNumstat, WorktreeStatus } from "$lib/types";

/** Everything the Changes tab draws about a worktree, from either machine. */
export interface Review {
  files: FileChange[];
  numstat: FileNumstat[];
  status: WorktreeStatus;
  /** HEAD, when the machine reported one (History uses it to know it is stale). */
  head: string | null;
  /** False only when the folder could not be read as a repository at all. Local
   *  reads throw instead, so this is `true` there — a thrown error and a
   *  "not a repository" answer are different states and stay that way. */
  isRepo: boolean;
}

/** A mutation on a machine that is not this one needs to know which connection
 *  it was prepared against. Thrown rather than defaulted: see the note above.
 *
 *  Every caller of this is `async`, deliberately — a promise-returning function
 *  that throws *synchronously* skips the `.catch()` its callers wrote and takes
 *  down whatever called it instead. */
function fence(target: TargetId | undefined | null, host: string, generation?: number) {
  if (generation === undefined) {
    throw new Error(`no live connection to ${host} to act against`);
  }
  return expectation(target, generation);
}

/** Read a worktree's whole review state. */
export async function reviewOn(
  target: TargetId | undefined | null,
  path: string,
): Promise<Review> {
  const host = sshHostId(target);
  if (host) {
    const r = await sshGitReview(host, path);
    return {
      files: r.files,
      numstat: r.numstat,
      status: { dirty: r.dirty, ahead: r.ahead, behind: r.behind },
      head: r.head,
      isRepo: r.isRepo,
    };
  }
  const [files, numstat, status] = await Promise.all([
    gitStatus(path),
    gitNumstat(path),
    worktreeStatus(path),
  ]);
  return { files, numstat, status, head: null, isRepo: true };
}

/** A file's unified diff, staged or unstaged. */
export function diffOn(
  target: TargetId | undefined | null,
  path: string,
  file: string,
  staged: boolean,
): Promise<string> {
  const host = sshHostId(target);
  return host ? sshGitDiff(host, path, file, staged) : gitDiff(path, file, staged);
}

/** A file's diff against HEAD — what the editor's change gutter draws.
 *
 *  Distinct from `diffOn`: the gutter must keep marking a line after its hunk is
 *  staged, which `git diff` alone stops doing. */
export function diffHeadOn(
  target: TargetId | undefined | null,
  path: string,
  file: string,
): Promise<string> {
  const host = sshHostId(target);
  return host ? sshGitDiffHead(host, path, file) : gitDiffHead(path, file);
}

/** A worktree's history, newest first. */
export function logOn(
  target: TargetId | undefined | null,
  path: string,
  limit: number,
  skip: number,
): Promise<CommitInfo[]> {
  const host = sshHostId(target);
  return host ? sshGitLog(host, path, limit, skip) : gitLog(path, limit, skip);
}

/** One commit's patch. */
export function showOn(
  target: TargetId | undefined | null,
  path: string,
  hash: string,
): Promise<string> {
  const host = sshHostId(target);
  return host ? sshGitShow(host, path, hash) : gitShow(path, hash);
}

export async function stageOn(
  target: TargetId | undefined | null,
  path: string,
  file: string,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return gitStage(path, file);
  return sshGitStage(host, path, file, fence(target, host, generation));
}

export async function unstageOn(
  target: TargetId | undefined | null,
  path: string,
  file: string,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return gitUnstage(path, file);
  return sshGitUnstage(host, path, file, fence(target, host, generation));
}

export async function stageAllOn(
  target: TargetId | undefined | null,
  path: string,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return gitStageAll(path);
  return sshGitStageAll(host, path, fence(target, host, generation));
}

export async function unstageAllOn(
  target: TargetId | undefined | null,
  path: string,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return gitUnstageAll(path);
  return sshGitUnstageAll(host, path, fence(target, host, generation));
}

export async function discardOn(
  target: TargetId | undefined | null,
  path: string,
  file: string,
  untracked: boolean,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return gitDiscard(path, file, untracked);
  return sshGitDiscard(host, path, file, untracked, fence(target, host, generation));
}

/** Apply a patch — the per-hunk stage / unstage / discard. */
export async function applyOn(
  target: TargetId | undefined | null,
  path: string,
  patch: string,
  cached: boolean,
  reverse: boolean,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return gitApply(path, patch, cached, reverse);
  return sshGitApply(host, path, patch, cached, reverse, fence(target, host, generation));
}

export async function commitOn(
  target: TargetId | undefined | null,
  path: string,
  message: string,
  amend: boolean,
  signOff: boolean,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return gitCommit(path, message, amend, signOff);
  return sshGitCommit(host, path, message, amend, signOff, fence(target, host, generation));
}

/** Fetch, push or pull, answering the worktree's new distance from its upstream.
 *
 *  On a host it runs **there**, with that machine's own credentials — the
 *  project lives on it, so its remote is reachable from it and not necessarily
 *  from here. Locally, push and pull answer nothing, so the distance is read
 *  back the way the panel always read it. */
export async function syncOn(
  target: TargetId | undefined | null,
  path: string,
  action: "fetch" | "push" | "pull",
  generation?: number,
): Promise<WorktreeStatus> {
  const host = sshHostId(target);
  if (host) return sshGitSync(host, path, action, fence(target, host, generation));
  if (action === "fetch") return gitFetch(path);
  await (action === "push" ? gitPush(path) : gitPull(path));
  return worktreeStatus(path);
}
