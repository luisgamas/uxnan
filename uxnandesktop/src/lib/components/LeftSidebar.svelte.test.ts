/**
 * The panel's hidden-worktrees surface: the header pill that counts what is held
 * back (and switches it on), and an empty state that tells "nothing here" from
 * "everything here is hidden". The rules themselves are `sidebar-visibility.ts`;
 * this proves they reach the screen in every view.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { projects } from "$lib/state/projects.svelte";
import type { RepoData, SidebarGroupBy, WorktreeEntry } from "$lib/types";
import LeftSidebar from "./LeftSidebar.svelte";

const REPO_A: RepoData = { id: 'a', name: 'alpha', path: '/p/a', worktrees: [], isGit: true };
const REPO_B: RepoData = { id: 'b', name: 'beta', path: '/p/b', worktrees: [], isGit: true };

const entry = (path: string, branch: string | null, isMain = false): WorktreeEntry => ({
  path,
  branch,
  head: 'abcdef0123456789',
  isMain,
});
const A_MAIN = entry('/p/a', 'main', true);
const A_OLD = entry('/p/a--old', 'old');
const B_MAIN = entry('/p/b', 'main', true);
const B_OLD = entry('/p/b--old', 'older');

function setup(groupBy: SidebarGroupBy, hidden: string[], showHidden = false) {
  app.repos = [REPO_A, REPO_B];
  projects.worktreesByRepo = { a: [A_MAIN, A_OLD], b: [B_MAIN, B_OLD] };
  projects.statusByPath = {
    [A_OLD.path]: { dirty: 0, ahead: 0, behind: 0 },
    [B_OLD.path]: { dirty: 0, ahead: 0, behind: 0 },
  };
  projects.query = '';
  projects.activeWorktreePath = null;
  app.settings.sidebarGroupBy = groupBy;
  app.settings.sidebarExpandedProjects = ['a', 'b'];
  app.settings.hiddenWorktrees = hidden;
  app.settings.sidebarShowHidden = showHidden;
  app.settings.pinnedWorktrees = [];
}

beforeEach(() => setup('none', []));

describe('LeftSidebar — hidden worktrees', () => {
  it('shows no hidden pill while nothing is hidden', () => {
    const { screen } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });

    expect(screen.queryByRole('button', { name: /hidden worktree/ })).toBeNull();
    expect(screen.getByText('old')).toBeInTheDocument();
  });

  it.each(['none', 'status', 'review'] as const)(
    'holds hidden worktrees back in the %s view and counts them in the header',
    async (view) => {
      setup(view, [A_OLD.path, B_OLD.path]);
      const { screen } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });

      expect(screen.queryByText('old')).toBeNull();
      expect(screen.queryByText('older')).toBeNull();
      const pill = await screen.findByRole('button', { name: /2 hidden worktree/ });
      expect(pill).toHaveAttribute('aria-pressed', 'false');
      // The primary worktrees are not part of it.
      expect(screen.getAllByText('main').length).toBeGreaterThan(0);
    },
  );

  it('draws them again when the pill is pressed, and says so', async () => {
    setup('status', [A_OLD.path]);
    const { screen, user } = mountWithProviders(LeftSidebar, {
      commands: { update_settings: () => ({}) },
    });

    await user.click(await screen.findByRole('button', { name: /1 hidden worktree/ }));

    expect(await screen.findByText('old')).toBeInTheDocument();
    expect(app.settings.sidebarShowHidden).toBe(true);
    expect(screen.getByRole('button', { name: /Showing 1 hidden/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('says one hidden worktree in the singular', async () => {
    setup('none', [A_OLD.path]);
    const one = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });
    expect(await one.screen.findByRole('button', { name: '1 hidden worktree — show it' })).toBeInTheDocument();
    expect(one.screen.getByRole('button', { name: /^1 hidden\s*·\s*Show/ })).toBeInTheDocument();
  });

  it('counts several hidden worktrees in the plural, in Spanish too', async () => {
    setup('none', [A_OLD.path, B_OLD.path]);
    app.settings.language = 'es';
    try {
      const { screen } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });
      expect(
        await screen.findByRole('button', { name: '2 worktrees ocultos — mostrarlos' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^1 oculto\s*·\s*Mostrar/ }).length).toBe(2);
    } finally {
      app.settings.language = 'en';
    }
  });

  it('keeps a project in the tree even when all its children are hidden, with a way back', async () => {
    setup('none', [A_OLD.path]);
    const { screen, user } = mountWithProviders(LeftSidebar, {
      commands: { update_settings: () => ({}) },
    });

    expect(await screen.findByText('alpha')).toBeInTheDocument();
    // The project's own footnote is the same switch as the header's pill.
    await user.click(await screen.findByRole('button', { name: /1 hidden\s*·\s*Show/ }));
    expect(app.settings.sidebarShowHidden).toBe(true);
  });

  it('says everything is hidden — not that there is nothing — when that is the case', async () => {
    // A project that lists nothing but a hidden worktree (no primary entry to
    // keep a row on screen): "Add a folder" would be the wrong answer.
    app.repos = [REPO_A];
    projects.worktreesByRepo = { a: [A_OLD] };
    app.settings.sidebarGroupBy = 'status';
    app.settings.hiddenWorktrees = [A_OLD.path];
    app.settings.sidebarShowHidden = false;
    const { screen, user } = mountWithProviders(LeftSidebar, {
      commands: { update_settings: () => ({}) },
    });

    expect(await screen.findByText('Every worktree here is hidden.')).toBeInTheDocument();
    expect(screen.queryByText('No projects yet.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show 1 hidden' }));
    expect(await screen.findByText('old')).toBeInTheDocument();
  });

  it('still asks for a project when there is none', async () => {
    app.repos = [];
    projects.worktreesByRepo = {};
    app.settings.hiddenWorktrees = [];
    const { screen } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
  });
});
