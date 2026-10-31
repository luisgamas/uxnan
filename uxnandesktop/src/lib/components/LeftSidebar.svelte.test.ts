/**
 * The panel's hidden-worktrees surface: the count on the header's options button
 * (the switch lives in its menu), the per-project line, and an empty state that tells "nothing here" from
 * "everything here is hidden". The rules themselves are `sidebar-visibility.ts`;
 * this proves they reach the screen in every view.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  projects.pickerOpen = false;
  projects.activeWorktreePath = null;
  app.settings.sidebarGroupBy = groupBy;
  app.settings.sidebarExpandedProjects = ['a', 'b'];
  app.settings.hiddenWorktrees = hidden;
  // Already there when the panel first listed them: taken in, not "created outside".
  app.settings.knownWorktrees = [A_OLD.path, B_OLD.path];
  app.settings.worktreeBaselineProjects = ['a', 'b'];
  app.settings.sidebarShowHidden = showHidden;
  app.settings.pinnedWorktrees = [];
}

beforeEach(() => setup('none', []));

describe('LeftSidebar — hidden worktrees', () => {
  it('shows no hidden badge on the options button while nothing is hidden', () => {
    const { screen } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });

    expect(screen.getByRole('button', { name: 'Panel options' })).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-options-badge')).toBeNull();
    expect(screen.getByText('old')).toBeInTheDocument();
  });

  it('keeps the header to the title, the attention signal, Add project and the options menu', async () => {
    const { screen, user } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });

    // What used to be a pill and four more buttons now lives in the options menu.
    expect(screen.getByRole('button', { name: 'Panel options' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add project…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh worktrees' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sort' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add project…' }));
    expect(projects.pickerOpen).toBe(true);
  });

  it.each(['none', 'status', 'review'] as const)(
    'holds hidden worktrees back in the %s view and counts them on the options button',
    async (view) => {
      setup(view, [A_OLD.path, B_OLD.path]);
      const { screen } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });

      expect(screen.queryByText('old')).toBeNull();
      expect(screen.queryByText('older')).toBeNull();
      expect(
        await screen.findByRole('button', { name: 'Panel options — 2 hidden worktrees' }),
      ).toBeInTheDocument();
      // The primary worktrees are not part of it.
      expect(screen.getAllByText('main').length).toBeGreaterThan(0);
    },
  );

  it('draws them again from the options menu, and says so', async () => {
    setup('status', [A_OLD.path]);
    const { screen, user } = mountWithProviders(LeftSidebar, {
      commands: { update_settings: () => ({}) },
    });

    const trigger = await screen.findByRole('button', { name: /1 hidden worktree/ });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const toggle = await vi.waitFor(() => {
      const hit = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((e) =>
        /View hidden worktrees/.test(e.textContent ?? ''),
      );
      if (!hit) throw new Error('no toggle');
      return hit;
    });
    await vi.waitFor(async () => {
      toggle.focus();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.activeElement).toBe(toggle);
    });
    await user.keyboard('{Enter}');

    expect(await screen.findByText('old')).toBeInTheDocument();
    expect(app.settings.sidebarShowHidden).toBe(true);
  });

  it('counts several hidden worktrees on the options button in Spanish too', async () => {
    setup('none', [A_OLD.path, B_OLD.path]);
    app.settings.language = 'es';
    try {
      const { screen } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });
      expect(
        await screen.findByRole('button', { name: 'Opciones del panel — 2 worktrees ocultos' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^1 oculto\s*·\s*Mostrar/ }).length).toBe(2);
    } finally {
      app.settings.language = 'en';
    }
  });

  it('sets aside a worktree created outside Uxnan the same way, and shows it on request', async () => {
    // Nobody hid anything: these two simply appeared (plain `git worktree add`)
    // after the panel had taken the project in, and nothing is happening in them.
    setup('none', []);
    app.settings.knownWorktrees = [];
    const { screen, user } = mountWithProviders(LeftSidebar, { commands: { update_settings: () => ({}) } });

    expect(screen.queryByText('old')).toBeNull();
    expect(screen.queryByText('older')).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Panel options — 2 hidden worktrees' }),
    ).toBeInTheDocument();
    // The per-project line is the same switch, with the same words.
    await user.click(await screen.findAllByRole('button', { name: /^1 hidden\s*·\s*Show/ }).then((b) => b[0]));
    expect(await screen.findByText('old')).toBeInTheDocument();
    expect(app.settings.sidebarShowHidden).toBe(true);
  });

  it('keeps a project in the tree even when all its children are hidden, with a way back', async () => {
    setup('none', [A_OLD.path]);
    const { screen, user } = mountWithProviders(LeftSidebar, {
      commands: { update_settings: () => ({}) },
    });

    expect(await screen.findByText('alpha')).toBeInTheDocument();
    // The project's own footnote is the same switch as the options menu's.
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
