// Branch-NAME helpers shared by the worktree dialogs. Pure, so they're unit-tested.
//
// Where a worktree lands is deliberately NOT here. That path used to be computed
// in this file as a mirror of the Rust one, and mirrors drift: this copy and the
// phone's ended up producing different folder names for the same repository and
// branch. The layout now lives once in `src-tauri/src/worktreeloc.rs`, and the
// dialogs ask it for a preview (`worktreePreviewPath` in `$lib/api`).

/**
 * Slugify a PR/issue title into the branch-name form GitHub itself uses
 * (`Fix the login!` → `fix-the-login`): lowercase, accents folded, every run of
 * non-alphanumerics collapsed to a single `-`, trimmed, and capped so a long
 * title can't produce an unwieldy folder name.
 */
export function branchSlug(title: string, maxLength = 50): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip the combining marks NFD split out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

/**
 * Name a branch after a task the user typed.
 *
 * [`branchSlug`] alone is not enough here. It caps at a hard character count,
 * which is fine for an issue title but ugly for a sentence: "Agregar un backoff
 * de reconexión al adaptador de Zero" lands on `…-al-adaptador-de-z`, cut
 * mid-word, and the worktree folder inherits that. So this trims back to the
 * last whole word before uniquifying.
 *
 * `branchSlug` itself is deliberately left alone — the GitHub issue flow's names
 * are already in use, and changing their shape would move where existing
 * worktrees land.
 *
 * Returns `""` when the task has nothing sluggable, so the caller clears the
 * field rather than showing a stale name.
 */
export function taskBranchName(task: string, taken: Iterable<string> = []): string {
  const slug = branchSlug(task);
  if (!slug) return "";
  // Only trim when the cap actually bit: a slug that ended naturally keeps its
  // last word even if that word is short.
  const trimmed =
    slug.length === 50 && slug.includes("-") ? slug.slice(0, slug.lastIndexOf("-")) : slug;
  return uniqueBranchName(trimmed, taken);
}

/** Word lists for a friendly auto-generated branch name (Docker-style
 *  adjective-noun). Small and neutral; all valid branch-name characters. */
const BRANCH_ADJECTIVES = [
  "brave", "calm", "clever", "eager", "gentle", "keen",
  "lively", "mellow", "nimble", "quiet", "swift", "witty",
];
const BRANCH_NOUNS = [
  "otter", "falcon", "maple", "harbor", "cedar", "meadow",
  "comet", "willow", "pebble", "lantern", "river", "summit",
];

/**
 * Make `base` unique against `taken` by appending `-2`, `-3`, … until it's free.
 * Pure, so it's unit-tested and drives the auto-generated-name uniqueness.
 */
export function uniqueBranchName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * A friendly, unique auto-generated branch name (`wt/<adjective>-<noun>`, e.g.
 * `wt/brave-otter`), avoiding any name already in `taken`. The random pair is
 * made collision-proof by [`uniqueBranchName`].
 */
export function randomBranchName(taken: Iterable<string> = []): string {
  const pick = (a: readonly string[]) => a[Math.floor(Math.random() * a.length)];
  const base = `wt/${pick(BRANCH_ADJECTIVES)}-${pick(BRANCH_NOUNS)}`;
  return uniqueBranchName(base, taken);
}
