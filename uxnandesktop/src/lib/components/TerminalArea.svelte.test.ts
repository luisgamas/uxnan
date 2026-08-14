import { beforeEach, describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../test/render';
import { app } from '$lib/state/app.svelte';
import { projects } from '$lib/state/projects.svelte';
import { terminals, GLOBAL_WORKSPACE } from '$lib/state/terminals.svelte';
import type { RepoData } from '$lib/types';
import TerminalArea from './TerminalArea.svelte';

const REMOTE: RepoData = {
  id: 'repo-remote',
  name: 'CosmoCalendar',
  path: 'C:\\Users\\Agent\\Documents\\GitHub\\CosmoCalendar',
  target: 'ssh:h1',
  worktrees: [],
  isGit: true,
};

beforeEach(() => {
  app.repos = [REMOTE];
  projects.worktreesByRepo = {
    [REMOTE.id]: [{ path: REMOTE.path, branch: null, head: null, isMain: true }],
  };
  terminals.setWorkspace(GLOBAL_WORKSPACE);
  terminals.root = null;
  // The area renders nothing until the saved layout has been restored.
  terminals.hydrated = true;
  projects.activeWorktreePath = null;
});

describe('TerminalArea — two terminals on a host', () => {
  it('closing one tab leaves the other one on screen', async () => {
    // Reported from the app, twice: two terminals on a host, close one and both
    // disappear — while the log showed the survivor's PTY was never touched. So
    // the tab is lost between the model and the screen, which is the one layer
    // a store test cannot see.
    projects.setActiveWorktree(REMOTE.path);
    const first = terminals.create({ title: 'shell', target: 'ssh:h1' });
    const second = terminals.create({ title: 'claude', target: 'ssh:h1' });

    const { screen, user } = mountWithProviders(TerminalArea, {
      commands: { pty_create: () => true, pty_close: () => undefined },
    });

    expect(await screen.findByText('shell')).toBeInTheDocument();
    expect(await screen.findByText('claude')).toBeInTheDocument();

    const closers = screen.getAllByLabelText('Close tab');
    await user.click(closers[0]);
    await until(() => terminals.findTab(first) === undefined, { label: 'the first tab closing' });

    // The survivor must still be in the model *and* rendered.
    expect(terminals.findTab(second)).toBeDefined();
    expect(screen.queryByText('shell')).toBeNull();
    expect(screen.getByText('claude')).toBeInTheDocument();
  });
});
