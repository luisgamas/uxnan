// Path-identity helpers for terminal workspace keys.
//
// Workspace keys are worktree paths, but the same folder reaches the app under
// different spellings depending on the source: git plumbing emits forward
// slashes on Windows while the directory picker and persisted repo entries
// carry backslashes. Comparing spellings with `===` silently splits one folder
// into two workspaces (or matches nothing), so identity checks go through
// `samePath`, and the boot reconciler re-keys stored spellings to the
// canonical (git-emitted) one via `canonicalFor` + `reconcilePlan`.
//
// A path alone stopped being an identity the moment a second execution target
// became possible: `/home/u/repo` names a different folder on each machine, and
// two of them can be registered at once. The identity is therefore the *pair*
// `(target, path)` — see `workspaceKey`. Local keys deliberately keep their
// historical spelling (the bare path), so nothing persisted needs rewriting and
// the Global workspace stays the empty string.

import { isLocalTarget, LOCAL_TARGET, type TargetId } from "$lib/target";

/** Separates the target prefix from the path in a non-local workspace key.
 *  Target ids never contain it, and the key is parsed by splitting at its
 *  *first* occurrence, so a path that happens to contain `::` is still safe. */
const TARGET_SEP = "::";

/** Case-folded, separator-normalized identity for a filesystem path. Windows
 *  paths are case-insensitive, and the app never hosts two workspaces whose
 *  keys differ only by case, so folding is safe on every shipped platform. */
export function pathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Whether two spellings name the same folder. Says nothing about *which
 *  machine* — use `sameWorkspace` for identity. */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** The workspace key for a folder on a machine.
 *
 *  Local folders key on the bare path exactly as they always have; a remote one
 *  is prefixed with its target. Two hosts with the same absolute path therefore
 *  produce two different keys — which is the whole point. */
export function workspaceKey(target: TargetId | null | undefined, path: string): string {
  return isLocalTarget(target) ? path : `${target}${TARGET_SEP}${path}`;
}

/** Split a workspace key back into its machine and its path. A key with no
 *  target prefix is local, which is what every key written before targets
 *  existed is. */
export function parseWorkspaceKey(key: string): { target: TargetId; path: string } {
  const sep = key.indexOf(TARGET_SEP);
  if (sep <= 0 || !key.startsWith("ssh:")) return { target: LOCAL_TARGET, path: key };
  return {
    target: key.slice(0, sep) as TargetId,
    path: key.slice(sep + TARGET_SEP.length),
  };
}

/** The target a workspace key belongs to. */
export function keyTarget(key: string): TargetId {
  return parseWorkspaceKey(key).target;
}

/** Whether two workspace keys name the same folder **on the same machine**.
 *  The target must match exactly (no folding: host ids are ours, not user
 *  text); only the path half tolerates spelling differences. */
export function sameWorkspace(a: string, b: string): boolean {
  const left = parseWorkspaceKey(a);
  const right = parseWorkspaceKey(b);
  return left.target === right.target && samePath(left.path, right.path);
}

/** The first entry of `known` naming the same workspace as `k`, if any. */
export function canonicalFor(k: string, known: Iterable<string>): string | undefined {
  for (const candidate of known) if (sameWorkspace(k, candidate)) return candidate;
  return undefined;
}

/** The boot reconciler's classification of restored workspace keys. */
export interface ReconcilePlan {
  /** `[storedKey, canonicalKey]` pairs whose spelling must be re-keyed. */
  rekeys: [string, string][];
  /** Keys naming no known repo/worktree — candidates for the on-disk
   *  existence check (gone → drop; still present → keep, unregistered). */
  unknown: string[];
}

/** Classify restored workspace keys against the known repo/worktree keys.
 *  The empty key is the Global workspace and is never touched. Keys already
 *  spelled canonically need no entry in either list. A key can only ever be
 *  re-keyed onto a key of the same target: re-pointing a workspace at another
 *  machine because the paths happen to match would be data loss, not healing. */
export function reconcilePlan(keys: string[], known: string[]): ReconcilePlan {
  const plan: ReconcilePlan = { rekeys: [], unknown: [] };
  for (const key of keys) {
    if (key === "") continue; // the Global workspace (GLOBAL_WORKSPACE)
    const canon = canonicalFor(key, known);
    if (canon === undefined) plan.unknown.push(key);
    else if (canon !== key) plan.rekeys.push([key, canon]);
  }
  return plan;
}
