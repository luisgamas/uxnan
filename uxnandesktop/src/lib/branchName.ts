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
