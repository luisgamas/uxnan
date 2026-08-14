import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend } from '../../test/tauri';
import { projects } from '$lib/state/projects.svelte';
import { app } from '$lib/state/app.svelte';
import { terminals, GLOBAL_WORKSPACE } from '$lib/state/terminals.svelte';
import { LOCAL_TARGET } from '$lib/target';
import type { WorktreeEntry } from '$lib/types';

const REPO_ID = 'repo-1';
const MAIN: WorktreeEntry = {
  path: 'C:/projects/sample',
  branch: 'main',
  head: 'abc123',
  isMain: true,
};

beforeEach(() => {
  projects.activeWorktreePath = null;
  projects.error = null;
  projects.worktreesByRepo = { [REPO_ID]: [MAIN] };
});

describe('projects.createGitHubWorktree', () => {
  it.each([
    ['pr', 'github_pr_checkout', 'review-42'],
    ['issue', 'github_issue_develop', 'issue-42'],
  ] as const)(
    'creates a %s worktree through the shared adoption path',
    async (kind, command, branch) => {
      const created: WorktreeEntry = {
        path: `C:/projects/sample-worktrees/${branch}`,
        branch,
        head: 'def456',
        isMain: false,
      };
      const backend = installFakeBackend({
        [command]: () => created,
        worktree_list: () => [MAIN, created],
        worktree_status: () => ({ dirty: 0, ahead: 0, behind: 0 }),
      });

      const path = await projects.createGitHubWorktree(REPO_ID, kind, 42, branch, null);

      expect(path).toBe(created.path);
      expect(projects.activeWorktreePath).toBe(created.path);
      expect(projects.worktreesOf(REPO_ID)).toEqual([MAIN, created]);
      expect(backend.lastCallTo(command)?.args).toEqual({
        repoId: REPO_ID,
        number: '42',
        branch,
      });
    },
  );

  it('returns a readable failure without changing the active worktree', async () => {
    installFakeBackend({
      github_pr_checkout: () => {
        throw new Error('Pull request is unavailable');
      },
    });

    const path = await projects.createGitHubWorktree(REPO_ID, 'pr', 7, 'review-7', null);

    expect(path).toBeNull();
    expect(projects.activeWorktreePath).toBeNull();
    expect(projects.error).toBe('Pull request is unavailable');
  });

  it('does not delay adoption while the status badge hydrates', async () => {
    const created: WorktreeEntry = {
      path: 'C:/projects/sample-worktrees/review-8',
      branch: 'review-8',
      head: 'def456',
      isMain: false,
    };
    let statusRequested = false;
    installFakeBackend({
      github_pr_checkout: () => created,
      worktree_list: () => [MAIN, created],
      worktree_status: () => {
        statusRequested = true;
        return new Promise(() => {});
      },
    });

    const path = await projects.createGitHubWorktree(REPO_ID, 'pr', 8, 'review-8', null);

    expect(path).toBe(created.path);
    expect(projects.activeWorktreePath).toBe(created.path);
    expect(statusRequested).toBe(true);
  });
});

describe('a project that lives on a host', () => {
  const REMOTE_ID = 'repo-remote';
  const REMOTE_PATH = 'C:/Users/gamas/code/sample';
  const REMOTE_MAIN: WorktreeEntry = {
    path: REMOTE_PATH,
    branch: null,
    head: null,
    isMain: true,
  };

  beforeEach(() => {
    app.repos = [
      { id: REPO_ID, name: 'sample', path: MAIN.path, worktrees: [], isGit: true },
      {
        id: REMOTE_ID,
        name: 'sample',
        path: REMOTE_PATH,
        target: 'ssh:h1',
        worktrees: [],
        isGit: true,
      },
    ];
    projects.worktreesByRepo = { [REPO_ID]: [MAIN], [REMOTE_ID]: [REMOTE_MAIN] };
    projects.activeWorktreePath = null;
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    // The store is a singleton: leaving one test's tabs behind would let the
    // next one inherit a machine from a terminal it never opened.
    terminals.root = null;
  });

  it('activates under a workspace key that names the machine', () => {
    // Without the target in the key, two projects at the same absolute path on
    // two machines would share one terminal workspace — and, worse, a shell
    // opened for the remote one would spawn here.
    projects.setActiveWorktree(REMOTE_PATH);

    expect(projects.activeWorktreeTarget).toBe('ssh:h1');
    expect(terminals.activeWorkspace).toBe(`ssh:h1::${REMOTE_PATH}`);
    expect(projects.activeIsRemote).toBe(true);
  });

  it('opens its terminal on the host, in the project folder', () => {
    // The bug this pins: the terminal opened on *this* PC, in this PC's home,
    // because neither the machine nor the folder reached the spawn.
    projects.openTerminalAt(REMOTE_PATH);

    const id = terminals.activePtyId();
    const tab = id ? terminals.findTab(id) : undefined;
    expect(tab?.kind === 'terminal' ? tab.target : null).toBe('ssh:h1');
    expect(tab?.kind === 'terminal' ? tab.cwd : null).toBe(REMOTE_PATH);
  });

  it('keeps a local project on this machine', () => {
    projects.openTerminalAt(MAIN.path);

    const id = terminals.activePtyId();
    const tab = id ? terminals.findTab(id) : undefined;
    expect((tab?.kind === 'terminal' ? tab.target : undefined) ?? LOCAL_TARGET).toBe(LOCAL_TARGET);
    expect(projects.activeIsRemote).toBe(false);
  });

  it('opens a new Global terminal on the machine of the one you are looking at', () => {
    // The Global space is the one place terminals from several machines share,
    // so its key names no machine. Pressing `+` beside a host's terminal used to
    // open a shell on this PC, in this PC's home.
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    terminals.create({ target: 'ssh:h1', title: 'workstation' });

    terminals.create({});

    const id = terminals.activePtyId();
    const tab = id ? terminals.findTab(id) : undefined;
    expect(tab?.kind === 'terminal' ? tab.target : null).toBe('ssh:h1');
  });

  it('keeps a Global terminal local when the one you are looking at is local', () => {
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    terminals.create({});

    terminals.create({});

    const id = terminals.activePtyId();
    const tab = id ? terminals.findTab(id) : undefined;
    expect((tab?.kind === 'terminal' ? tab.target : undefined) ?? LOCAL_TARGET).toBe(LOCAL_TARGET);
  });

  it('closing one terminal on a host leaves the other tabs alone', async () => {
    // Reported from the app: a terminal and an agent open on the same host, and
    // closing the terminal took the agent's tab with it.
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    const term = terminals.create({ target: 'ssh:h1', title: 'shell' });
    const agent = terminals.create({
      target: 'ssh:h1',
      title: 'claude',
      agentName: 'Claude Code',
      agentCommand: 'claude',
      runCommand: 'claude',
    });

    const group = terminals.workspaceRoot(GLOBAL_WORKSPACE);
    expect(group).not.toBeNull();
    await terminals.closeTab(terminals.activeGroupId, term);

    expect(terminals.findTab(term)).toBeUndefined();
    expect(terminals.findTab(agent)).toBeDefined();
  });

  it("a closed tab's exit event cannot take a sibling with it", async () => {
    // The event arrives after the tab is gone (the backend fires it as the
    // channel ends), so the handler runs against an id it can no longer find.
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    const term = terminals.create({ target: 'ssh:h1', title: 'shell' });
    const agent = terminals.create({ target: 'ssh:h1', title: 'claude', agentCommand: 'claude' });

    await terminals.closeTab(terminals.activeGroupId, term);
    terminals.handleShellExit(term);

    expect(terminals.findTab(agent)).toBeDefined();
  });

  it('accepts the workspace key the terminal area holds, not just a path', () => {
    // The tab-strip launcher passes the key of the workspace it is showing. For
    // a local project the key *is* the path, so handing over the wrong one was
    // invisible — until a remote key arrived and every option in that menu
    // opened a shell here, in this PC's home, with the key itself as the cwd.
    projects.openTerminalAt(`ssh:h1::${REMOTE_PATH}`);

    const id = terminals.activePtyId();
    const tab = id ? terminals.findTab(id) : undefined;
    expect(tab?.kind === 'terminal' ? tab.target : null).toBe('ssh:h1');
    expect(tab?.kind === 'terminal' ? tab.cwd : null).toBe(REMOTE_PATH);
    expect(projects.activeWorktreePath).toBe(REMOTE_PATH);
  });

  it('does not act on the exits a sleeping workspace causes', async () => {
    // Sleeping closes a workspace's PTYs on purpose. Those exits are that act
    // finishing; treating them as shells dying would delete every asleep tab.
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    const tab = terminals.create({ target: 'ssh:h1', title: 'shell' });
    await terminals.sleepWorkspace(GLOBAL_WORKSPACE);

    terminals.handleShellExit(tab);

    expect(terminals.findTab(tab)).toBeDefined();
  });

  it('remembers which machine a terminal was on across a restart', () => {
    // The layout is what a restart rebuilds from. Without the machine in it, a
    // remote tab came back as a local shell holding the host's path — it then
    // started here, in the home directory, looking like the tab you left.
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    terminals.create({ target: 'ssh:h1', title: 'workstation', cwd: '/home/dev/app' });

    const saved = terminals.serialize();
    const tabs = JSON.stringify(saved);
    expect(tabs).toContain('ssh:h1');

    terminals.root = null;
    terminals.restore(saved, {});
    const id = terminals.activePtyId();
    const tab = id ? terminals.findTab(id) : undefined;
    expect(tab?.kind === 'terminal' ? tab.target : null).toBe('ssh:h1');
    expect(tab?.kind === 'terminal' ? tab.cwd : null).toBe('/home/dev/app');
  });

  it('offers no local path for the file and git layers to read', () => {
    // They run here. A remote workspace must resolve to null rather than to a
    // path this machine would happily — and wrongly — answer for.
    projects.setActiveWorktree(REMOTE_PATH);
    expect(projects.activeLocalPath).toBeNull();

    projects.setActiveWorktree(MAIN.path);
    expect(projects.activeLocalPath).toBe(MAIN.path);
  });

  it('resolves the active repo through the key, not the bare path', () => {
    projects.setActiveWorktree(REMOTE_PATH);
    expect(projects.activeRepo?.id).toBe(REMOTE_ID);

    projects.setActiveWorktree(MAIN.path);
    expect(projects.activeRepo?.id).toBe(REPO_ID);
  });
});
