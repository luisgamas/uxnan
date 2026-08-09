import { describe, expect, it } from 'vitest';
import {
  classifyProjectInput,
  githubCloneDestination,
  githubWorkItemBranch,
  parseGitHubRepositoryInput,
  parseGitHubWorkItemInput,
  rankGitHubWorkItemSearch,
} from './githubInput';

describe('GitHub input', () => {
  it.each([
    ['owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo.git', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'owner/repo'],
  ])('recognizes repository input %s', (input, expected) => {
    expect(parseGitHubRepositoryInput(input)?.nameWithOwner).toBe(expected);
  });

  it.each([
    '',
    'owner',
    'https://example.com/owner/repo',
    'https://github.com/owner/repo/issues/2',
    'owner/repo/extra',
  ])('rejects unsupported repository input %s', (input) => {
    expect(parseGitHubRepositoryInput(input)).toBeNull();
  });

  it('parses scoped numbers and full work-item URLs', () => {
    expect(parseGitHubWorkItemInput('#42', 'issue')).toEqual({ kind: 'issue', number: 42 });
    expect(parseGitHubWorkItemInput('https://github.com/acme/app/pull/7', 'pr')).toMatchObject({
      owner: 'acme',
      repo: 'app',
      kind: 'pr',
      number: 7,
    });
    expect(parseGitHubWorkItemInput('PR #8')).toEqual({ kind: 'pr', number: 8 });
    expect(parseGitHubWorkItemInput('Issue 9')).toEqual({ kind: 'issue', number: 9 });
  });

  it('ranks numeric, hash, and text work-item searches predictably', () => {
    const item = {
      number: 42,
      title: 'Improve project import',
      author: 'developer',
      meta: 'feature/import → main',
      branch: 'feature/import',
    };

    expect(rankGitHubWorkItemSearch(item, '42', 'pr')).toBe(0);
    expect(rankGitHubWorkItemSearch(item, '#42', 'pr')).toBe(0);
    expect(rankGitHubWorkItemSearch(item, '#', 'pr')).toBe(1);
    expect(rankGitHubWorkItemSearch(item, 'project developer', 'pr')).toBe(1);
    expect(rankGitHubWorkItemSearch(item, 'missing', 'pr')).toBeNull();
  });

  it('rejects the wrong item kind, host, and invalid number', () => {
    expect(parseGitHubWorkItemInput('https://github.com/acme/app/issues/7', 'pr')).toBeNull();
    expect(parseGitHubWorkItemInput('https://example.com/acme/app/pull/7', 'pr')).toBeNull();
    expect(parseGitHubWorkItemInput('#0', 'issue')).toBeNull();
  });

  it('builds native-looking clone destinations', () => {
    expect(githubCloneDestination('C:\\Code', 'app')).toBe('C:\\Code\\app');
    expect(githubCloneDestination('/srv/code/', 'app')).toBe('/srv/code/app');
  });

  it('derives worktree branches from GitHub item identity', () => {
    expect(githubWorkItemBranch('pr', 42, 'Ignored title', 'feature/import')).toBe(
      'feature/import',
    );
    expect(githubWorkItemBranch('issue', 17, 'Fix the login!')).toBe('17-fix-the-login');
    expect(githubWorkItemBranch('issue', 18, '✨')).toBe('issue-18');
  });

  it.each([
    ['team/sample', 'github'],
    ['https://github.com/team/sample', 'github'],
    ['C:\\Code\\sample', 'local'],
    ['/srv/code/sample', 'local'],
    ['./sample', 'local'],
    ['', 'unknown'],
  ])('classifies project input %s as %s', (input, expected) => {
    expect(classifyProjectInput(input)).toBe(expected);
  });
});
