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

    const name = await screen.findByText('uxnan');
    expect(name.className).toContain('flex-1');
    expect(name.className).toContain('truncate');
  });

  it('names a detached worktree by its folder, not by the word "detached"', async () => {
    // "(detached)" is git's state, not a name: three checkouts of one project
    // under it were indistinguishable. The folder is what tells them apart.
    const detached: Row = {
      ...localRow,
      isMain: false,
      path: 'C:/code/uxnan-worktrees/review-pr-42',
      head: '9fceb02d0ae598e95dc970b74767f19372d61af8',
    };
    const { screen } = mountWithProviders(WorktreeRow, { props: { row: detached } });

    expect(await screen.findByText('review-pr-42')).toBeInTheDocument();
    // The state survives as a hint, with the commit HEAD stands on.
    expect(screen.getByText('detached at 9fceb02')).toBeInTheDocument();
    expect(screen.queryByText('(detached)')).toBeNull();
  });

  it('says the branch was not read rather than claiming the repo is detached', async () => {
    // Git *is* asked on the host now, so this wording is what a host that could
    // not answer gets — no git there, not a repository, or a shell that could not
    // be named. "detached" would be a statement about a repository nobody read.
    const { screen } = mountWithProviders(WorktreeRow, { props: { row: remoteRow } });

    expect(await screen.findByText('branch not read')).toBeInTheDocument();
    expect(await screen.findByText('kreator_frame')).toBeInTheDocument();
    expect(screen.queryByText(/detached/)).toBeNull();
  });

  it("shows a host's real branch when it answered", async () => {
    const answered: Row = { ...remoteRow, branch: 'feat/login' };
    const { screen } = mountWithProviders(WorktreeRow, { props: { row: answered } });

    expect(await screen.findByText('feat/login')).toBeInTheDocument();
    expect(screen.queryByText('branch not read')).toBeNull();
  });

  describe('in a view without project grouping', () => {
    // Two projects on `main`: the flat views lift rows out of their project, and a
    // card that says only "main" cannot be told from the other one.
    const onMain = (repo: RepoData): Row => ({
      path: repo.path,
      branch: 'main',
      head: null,
      isMain: true,
      repoId: repo.id,
      repoName: repo.name,
    });

    it('leads the second line with the project, so two `main` cards differ', async () => {
      const { screen: a } = mountWithProviders(WorktreeRow, {
        props: { row: onMain(LOCAL), showRepo: true },
      });
      expect(await a.findByText('main')).toBeInTheDocument();
      expect(a.getByText('uxnan')).toBeInTheDocument();
    });

    it('names the other project on the other card', async () => {
      const { screen } = mountWithProviders(WorktreeRow, {
        props: { row: onMain(REMOTE), showRepo: true },
      });
      expect(await screen.findByText('kreator_frame')).toBeInTheDocument();
    });

    it('keeps the project beside the reason a worktree has no branch', async () => {
      const detached: Row = {
        ...onMain(LOCAL),
        isMain: false,
        branch: null,
        path: 'C:/code/uxnan-worktrees/spike',
        head: 'abcdef0123',
      };
      const { screen } = mountWithProviders(WorktreeRow, { props: { row: detached, showRepo: true } });

      expect(await screen.findByText('spike')).toBeInTheDocument();
      expect(screen.getByText('uxnan')).toBeInTheDocument();
      expect(screen.getByText(/detached at abcdef0/)).toBeInTheDocument();
    });

    // The folder and the project have different names here, so each can only
    // come from where it should.
    const renamed = () => {
      app.repos = [{ ...LOCAL, name: 'The App' }, REMOTE];
      return { ...onMain(LOCAL), repoName: 'The App' };
    };

    it('leaves the project implicit in the tree', async () => {
      const { screen } = mountWithProviders(WorktreeRow, { props: { row: renamed() } });

      expect(await screen.findByText('main')).toBeInTheDocument();
      expect(screen.queryByText('The App')).toBeNull();
      expect(screen.getByText('uxnan')).toBeInTheDocument(); // the folder
    });

    it('names the project in the flat views', async () => {
      const { screen } = mountWithProviders(WorktreeRow, {
        props: { row: renamed(), showRepo: true },
      });

      expect(await screen.findByText('The App')).toBeInTheDocument();
    });
  });
});
