export interface GitHubRepositoryInput {
  owner: string;
  repo: string;
  nameWithOwner: string;
}

export type GitHubWorkItemKind = 'pr' | 'issue';
export type ProjectInputKind = 'github' | 'local' | 'unknown';

export interface GitHubWorkItemInput extends GitHubRepositoryInput {
  kind: GitHubWorkItemKind;
  number: number;
}

export interface GitHubWorkItemSearchValue {
  number: number;
  title: string;
  author?: string | null;
  meta?: string;
  branch?: string;
}

const PART = /^[A-Za-z0-9_.-]+$/;

function repository(owner: string, repo: string): GitHubRepositoryInput | null {
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim().replace(/\.git$/i, '');
  if (!cleanOwner || !cleanRepo || !PART.test(cleanOwner) || !PART.test(cleanRepo)) return null;
  return { owner: cleanOwner, repo: cleanRepo, nameWithOwner: `${cleanOwner}/${cleanRepo}` };
}

/** Parse the GitHub forms accepted by Add project: `owner/repo`, HTTPS, SSH,
 *  and `ssh://`. Other hosts are deliberately rejected. */
export function parseGitHubRepositoryInput(value: string): GitHubRepositoryInput | null {
  const input = value.trim();
  if (!input) return null;

  const short = input.match(/^([^/:\s]+)\/([^/\s]+)$/);
  if (short) return repository(short[1], short[2]);

  const scp = input.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i);
  if (scp) return repository(scp[1], scp[2]);

  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    return repository(parts[0], parts[1]);
  } catch {
    return null;
  }
}

/** Classify the single Add project field without touching the filesystem. An
 * explicit path marker wins over the compact `owner/repo` GitHub form; the
 * dialog's Local and GitHub tabs remain available for genuinely ambiguous input. */
export function classifyProjectInput(value: string): ProjectInputKind {
  const input = value.trim();
  if (!input) return 'unknown';
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])/.test(input)) return 'local';
  if (parseGitHubRepositoryInput(input)) return 'github';
  return 'local';
}

/** Parse a PR/issue reference. Neutral `123` and `#123` are scoped to the
 *  project that opened the launcher and intentionally carry no type until the
 *  backend resolves it; full URLs additionally carry repo identity so the
 *  caller can refuse cross-project launches. */
export function parseGitHubWorkItemInput(
  value: string,
  expectedKind?: GitHubWorkItemKind,
): (Partial<GitHubRepositoryInput> & { kind: GitHubWorkItemKind | null; number: number }) | null {
  const input = value.trim();
  const bare = input.match(/^#?(\d+)$/);
  if (bare) {
    const number = Number(bare[1]);
    return number > 0 ? { kind: expectedKind ?? null, number } : null;
  }

  const labeled = input.match(/^(pr|pull\s+request|issue)\s*#?\s*(\d+)$/i);
  if (labeled) {
    const kind: GitHubWorkItemKind = labeled[1].toLowerCase() === 'issue' ? 'issue' : 'pr';
    const number = Number(labeled[2]);
    if (number <= 0 || (expectedKind && kind !== expectedKind)) return null;
    return { kind, number };
  }

  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4) return null;
    const kind = parts[2] === 'pull' ? 'pr' : parts[2] === 'issues' ? 'issue' : null;
    const number = Number(parts[3]);
    if (!kind || number <= 0 || (expectedKind && kind !== expectedKind)) return null;
    const repo = repository(parts[0], parts[1]);
    return repo ? { ...repo, kind, number } : null;
  } catch {
    return null;
  }
}

/** Rank a work item against the launcher's search field. Exact numeric
 * references lead, while ordinary text may match title, author, branch, or
 * metadata. A lone `#` is treated as an unfinished number and keeps the list
 * visible instead of collapsing it to an arbitrary row. */
export function rankGitHubWorkItemSearch(
  item: GitHubWorkItemSearchValue,
  value: string,
  kind: GitHubWorkItemKind,
): number | null {
  const query = value.trim().toLowerCase();
  if (!query || query === '#') return 1;

  const reference = parseGitHubWorkItemInput(query, kind);
  if (reference) return item.number === reference.number ? 0 : null;

  const terms = query
    .replace(/^#\s*/, '')
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return 1;
  const haystack = [
    String(item.number),
    `#${item.number}`,
    item.title,
    item.author ?? '',
    item.meta ?? '',
    item.branch ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term)) ? 1 : null;
}

export function githubCloneDestination(parent: string, repo: string): string {
  const base = parent.trim().replace(/[\\/]+$/, '');
  if (!base) return '';
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return `${base}${separator}${repo}`;
}

/** Derive the worktree branch from the selected GitHub item. Pull requests keep
 * their real head branch; issues get a stable number + title slug. */
export function githubWorkItemBranch(
  kind: GitHubWorkItemKind,
  number: number,
  title: string,
  headRefName?: string | null,
): string {
  if (kind === 'pr') return headRefName?.trim() || `pr-${number}`;
  const slug = branchSlug(title);
  return slug ? `${number}-${slug}` : `issue-${number}`;
}
import { branchSlug } from './branchName';
