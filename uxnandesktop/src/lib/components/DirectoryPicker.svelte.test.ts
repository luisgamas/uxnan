import { beforeEach, describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../test/render';
import { app } from '$lib/state/app.svelte';
import type { RepoData, WorktreeEntry } from '$lib/types';
import DirectoryPicker from './DirectoryPicker.svelte';

const ROOT = 'C:/projects';
// Clones are suggested under `<home>/uxnan/repos`, beside the worktree root,
// so a repository named `worktrees` cannot collide with it.
const CLONED = `${ROOT}/uxnan/repos/sample`;

beforeEach(() => {
  app.repos = [];
});

describe('DirectoryPicker GitHub import', () => {
  it('clones a pasted repository and registers the result as the active project', async () => {
    const repo: RepoData = {
      id: 'repo-1',
      name: 'sample',
      path: CLONED,
      worktrees: [],
      isGit: true,
    };
    const main: WorktreeEntry = {
      path: CLONED,
      branch: 'main',
      head: 'abc123',
      isMain: true,
    };
    const { screen, user, backend } = mountWithProviders(DirectoryPicker, {
      props: { open: true },
      commands: {
        browse_dirs: () => ({ path: ROOT, parent: 'C:/', isRepo: false, entries: [] }),
        browse_set_watch: () => undefined,
        github_clone: ({ dest }) => dest,
        repo_add: () => repo,
        worktree_list: () => [main],
        worktree_status: () => ({ dirty: 0, ahead: 0, behind: 0 }),
      },
    });

    const source = await screen.findByPlaceholderText(
      'Enter a local path, repository, or GitHub URL…',
    );
    await screen.findByDisplayValue(ROOT);
    await user.clear(source);
    await user.type(source, 'team/sample');
    expect(await screen.findByDisplayValue(CLONED)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clone and add' }));
    await until(() => app.repos.length === 1, { label: 'cloned project registration' });

    expect(backend.lastCallTo('github_clone')?.args).toEqual({
      repo: 'team/sample',
      dest: CLONED,
    });
    expect(app.repos).toEqual([repo]);
  });
});
