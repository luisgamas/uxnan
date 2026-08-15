import { beforeEach, describe, expect, it } from 'vitest';

import { mountWithProviders } from '../../test/render';
import { app } from '$lib/state/app.svelte';
import { projects, type WorktreeRow as Row } from '$lib/state/projects.svelte';
import type { RepoData } from '$lib/types';
import WorktreeRow from './WorktreeRow.svelte';

const REMOTE: RepoData = {
  id: 'repo-remote',
  name: 'kreator_frame',
  path: 'C:/Users/gamas/code/kreator_frame',
  target: 'ssh:h1',
  worktrees: [],
  isGit: true,
};

const LOCAL: RepoData = {
  id: 'repo-local',
  name: 'uxnan',
  path: 'C:/code/uxnan',
  worktrees: [],
  isGit: true,
};

const remoteRow: Row = {
  path: REMOTE.path,
  branch: null,
  head: null,
  isMain: true,
  repoId: REMOTE.id,
  repoName: REMOTE.name,
};

const localRow: Row = {
  path: LOCAL.path,
  branch: null,
  head: null,
  isMain: true,
  repoId: LOCAL.id,
  repoName: LOCAL.name,
};

beforeEach(() => {
  app.repos = [REMOTE, LOCAL];
  projects.worktreesByRepo = {
    [REMOTE.id]: [remoteRow],
    [LOCAL.id]: [localRow],
  };
});

describe('WorktreeRow', () => {
  it('lets the name take the width, so the indicators end at the right edge', async () => {
    // A worktree row has no hover actions competing for that edge (unlike the
    // project header), so the indicators after the name belong at it. Without
    // the name growing, they trailed the text into the middle of the panel.
    const { screen } = mountWithProviders(WorktreeRow, { props: { row: localRow } });

    const name = await screen.findByText('(detached)');
    expect(name.className).toContain('flex-1');
    expect(name.className).toContain('truncate');
  });

  it('says the branch was not read rather than claiming the repo is detached', async () => {
    // Git *is* asked on the host now, so this wording is what a host that could
    // not answer gets — no git there, not a repository, or a shell that could not
    // be named. "(detached)" would be a statement about a repository nobody read.
    const { screen } = mountWithProviders(WorktreeRow, { props: { row: remoteRow } });

    expect(await screen.findByText('branch not read')).toBeInTheDocument();
    expect(screen.queryByText('(detached)')).toBeNull();
  });

  it("shows a host's real branch when it answered", async () => {
    const answered: Row = { ...remoteRow, branch: 'feat/login' };
    const { screen } = mountWithProviders(WorktreeRow, { props: { row: answered } });

    expect(await screen.findByText('feat/login')).toBeInTheDocument();
    expect(screen.queryByText('branch not read')).toBeNull();
  });
});
