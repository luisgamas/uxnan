// Path-identity helpers for terminal workspace keys.
//
// Workspace keys are worktree paths, but the same folder reaches the app under
// different spellings depending on the source: git plumbing emits forward
// slashes on Windows while the directory picker and persisted repo entries
// carry backslashes. Comparing spellings with `===` silently splits one folder
// into two workspaces (or matches nothing), so identity checks go through
// `samePath`, and the boot reconciler re-keys stored spellings to the
// canonical (git-emitted) one via `canonicalFor` + `reconcilePlan`.

/** Case-folded, separator-normalized identity for a filesystem path. Windows
 *  paths are case-insensitive, and the app never hosts two workspaces whose
 *  keys differ only by case, so folding is safe on every shipped platform. */
export function pathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Whether two spellings name the same folder. */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** The first entry of `known` naming the same folder as `p`, if any. */
export function canonicalFor(p: string, known: Iterable<string>): string | undefined {
  for (const k of known) if (samePath(p, k)) return k;
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

/** Classify restored workspace keys against the known repo/worktree paths.
 *  The empty key is the Global workspace and is never touched. Keys already
 *  spelled canonically need no entry in either list. */
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
