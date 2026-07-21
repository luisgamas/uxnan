// Branch-name helpers shared by the worktree dialogs. Pure, so they're unit-tested
// and can't drift from their Rust counterparts unnoticed.

/**
 * The sibling folder a worktree for `branch` will land in — the mirror of
 * `git::worktree_path_for`: `<parent>/<repo>--<safe-branch>`, with `/` and `\` in
 * the branch flattened to `-`.
 *
 * The result is canonicalized to **forward slashes**, exactly as git reports
 * worktree paths (and as the backend returns them). That matters beyond looks:
 * a path built here is compared against listed worktree paths, and a
 * backslash form would never match its own worktree on Windows.
 */
export function worktreeFolderFor(repoPath: string, branch: string): string {
  const norm = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = norm.split("/");
  const repoName = segments.pop() ?? "";
  const parent = segments.join("/");
  const safeBranch = branch.replace(/[\\/]/g, "-");
  return `${parent}/${repoName}--${safeBranch}`;
}

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
