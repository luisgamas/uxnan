import { beforeEach, describe, expect, it } from 'vitest';

import { deferred, installFakeBackend } from '../../test/tauri';
import { until } from '../../test/render';
import { projects } from '$lib/state/projects.svelte';
import { app } from '$lib/state/app.svelte';
import { hosts } from '$lib/state/hosts.svelte';
import { terminals, GLOBAL_WORKSPACE } from '$lib/state/terminals.svelte';
import { fileTree } from '$lib/state/fileTree.svelte';
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

  it('closing one tab cannot take its neighbour, however slow the backend is', async () => {
    // Reproduced from the app, three times: two terminals on a host, close one,
    // both vanish — with the survivor's PTY still alive on the far machine.
    //
    // The race: `closeTab` awaited the backend *before* taking the tab out of
    // the model, so the exit event for the tab being closed arrived while it was
    // still in the tree. `handleShellExit` then routed it to `closeTabAnywhere`,
    // which — finding what it thought was the region's last tab — removed the
    // whole region. A workspace with no regions renders nothing, so every pane
    // in it left the screen at once.
    const closing = deferred<void>();
    installFakeBackend({ pty_create: () => true, pty_close: closing.handler });

    terminals.setWorkspace(GLOBAL_WORKSPACE);
    terminals.root = null;
    const first = terminals.create({ title: 'shell', target: 'ssh:h1' });
    const second = terminals.create({ title: 'claude', target: 'ssh:h1' });
    const group = terminals.activeGroupId;

    const closed = terminals.closeTab(group, first);
    // The backend answers, and the exit for the closed tab lands in the same
    // turn — which is exactly what a real host does.
    closing.resolve();
    terminals.handleShellExit(first);
    await closed;

    expect(terminals.findTab(first)).toBeUndefined();
    expect(terminals.findTab(second)).toBeDefined();
    expect(terminals.workspaceRoot(GLOBAL_WORKSPACE)).not.toBeNull();
    expect(terminals.terminalCount(GLOBAL_WORKSPACE)).toBe(1);
  });

  it("quotes an agent's command line for the host's shell, not this machine's", () => {
    // The same class of bug as the `cd` that killed every terminal on a
    // PowerShell host: the launch used to quote for *this* machine's shell
    // (`currentOS()`), so a Windows desktop driving a POSIX host produced
    // cmd-style quoting and any argument with a space landed in a dead pane.
    hosts.shells = { h1: 'posix' };
    app.settings.agentProfiles = [
      { id: 'ag', name: 'Claude', command: 'claude', args: ['-p', 'hello world'], env: [] },
    ];

    app.launchAgent(app.launchableAgents[0], {
      cwd: REMOTE_PATH,
      workspace: `ssh:h1::${REMOTE_PATH}`,
      target: 'ssh:h1',
    });

    const id = terminals.activePtyId();
    const tab = id ? terminals.findTab(id) : undefined;
    const run = tab?.kind === 'terminal' ? (tab.runCommand ?? '') : '';
    expect(run).toContain("'hello world'");
    expect(run).not.toContain('"hello world"');
  });

  it('offers only the agents the host reported', () => {
    // A host runs its own CLIs. Offering this machine's list invites launching
    // something that is not installed there.
    app.settings.agentProfiles = [
      { id: 'a', name: 'Claude', command: 'claude', args: [], env: [] },
      { id: 'b', name: 'Codex', command: 'codex', args: [], env: [] },
    ];
    hosts.inventories = {
      h1: { os: 'linux', home: '/home/dev', git: 'git 2.44', multiplexer: '', shell: 'posix', agents: { claude: '2.1' } },
    };

    expect(app.launchableAgentsOn('ssh:h1').map((a) => a.id)).toEqual(['a']);
    // Locally, nothing is filtered.
    expect(app.launchableAgentsOn(undefined).map((a) => a.id)).toEqual(['a', 'b']);
    // A host nobody has asked yet claims nothing.
    hosts.inventories = {};
    expect(app.launchableAgentsOn('ssh:h1').map((a) => a.id)).toEqual(['a', 'b']);
  });

  it("lists a host's folder in the file tree, and does not offer a search it cannot run", async () => {
    // Phase 3's first slice: Files works on a host because it goes over SFTP —
    // a subsystem, so the same code path serves cmd, PowerShell, WSL and Git
    // Bash. Search does not, and is therefore not offered rather than offered
    // broken (it walks *this* filesystem and would answer "no matches").
    const backend = installFakeBackend({
      ssh_fs_list: () => [
        { name: 'src', path: `${REMOTE_PATH}/src`, isDir: true, ignored: false },
        { name: 'README.md', path: `${REMOTE_PATH}/README.md`, isDir: false, ignored: false },
      ],
      fs_set_watch: () => undefined,
    });

    projects.setActiveWorktree(REMOTE_PATH);
    fileTree.setRoot(REMOTE_PATH, projects.activeWorktreeTarget);
    await fileTree.loadDir(REMOTE_PATH);

    expect(backend.lastCallTo('ssh_fs_list')?.args).toEqual({
      hostId: 'h1',
      path: REMOTE_PATH,
    });
    expect(backend.lastCallTo('fs_list_dir')).toBeUndefined();
    expect(fileTree.searchable).toBe(false);

    // …and a local workspace is unchanged.
    fileTree.setRoot(MAIN.path, 'local');
    expect(fileTree.searchable).toBe(true);
  });

  it("reads a host's git on the host, and never calls this machine's", async () => {
    // Phase 3's second slice. Git has to be *run*, so it goes through the host's
    // shell — the one it reported, with arguments quoted for it.
    const backend = installFakeBackend({
      ssh_git_status: () => ({ branch: 'main', dirty: 3, ahead: 1, behind: 0, isRepo: true }),
      worktree_status: () => ({ dirty: 99, ahead: 99, behind: 99 }),
    });

    await projects.refreshStatuses([REMOTE_PATH]);

    expect(backend.lastCallTo('ssh_git_status')?.args).toEqual({ hostId: 'h1', path: REMOTE_PATH });
    expect(backend.lastCallTo('worktree_status')).toBeUndefined();
    expect(projects.status(REMOTE_PATH)).toEqual({ dirty: 3, ahead: 1, behind: 0 });
  });

  it('leaves the badges alone when a host cannot answer about git', async () => {
    // "Not a repository", "no git installed" and "the shell could not be named"
    // all arrive as isRepo:false — and none of them means "no changes". Showing
    // zeroes there would be the same lie as a made-up branch.
    installFakeBackend({
      ssh_git_status: () => ({ branch: null, dirty: 0, ahead: 0, behind: 0, isRepo: false }),
    });
    // Start from nothing known, so this asserts "never written" rather than
    // "overwritten" — a status already read stays put on a transient failure,
    // which is deliberate.
    projects.statusByPath = {};

    await projects.refreshStatuses([REMOTE_PATH]);

    expect(projects.status(REMOTE_PATH)).toBeUndefined();
  });

  it('waits for a host instead of showing an error, and fills in when it connects', async () => {
    // Reported from the app: the panel opened before the host was connected and
    // kept its red line until the user switched projects and came back. Nothing
    // retried, because the root never made it into the loaded set.
    let connected = false;
    installFakeBackend({
      ssh_fs_list: () => {
        if (!connected) throw { code: 'NOT_CONNECTED', message: 'h1 is not connected' };
        return [{ name: 'src', path: `${REMOTE_PATH}/src`, isDir: true, ignored: false }];
      },
      fs_set_watch: () => undefined,
    });

    projects.setActiveWorktree(REMOTE_PATH);
    fileTree.setRoot(REMOTE_PATH, projects.activeWorktreeTarget);
    await fileTree.loadDir(REMOTE_PATH);

    // A state, not a fault: nothing red, and the panel says what it is waiting on.
    expect(fileTree.awaitingHost).toBe(true);
    expect(fileTree.error).toBeNull();

    connected = true;
    fileTree.retryForHost('h1');
    await until(() => fileTree.awaitingHost === false, { label: 'the retry' });
    await until(() => (fileTree.childrenByDir[REMOTE_PATH] ?? []).length > 0, {
      label: 'the listing',
    });

    // A different host connecting must not disturb this tree.
    fileTree.retryForHost('h2');
    expect(fileTree.awaitingHost).toBe(false);
  });

  it('restarts a terminal that could not start until its host connected', () => {
    // Reported: the tree filled itself in when the host connected, but the
    // terminal kept its "connect first" message until the user closed it and
    // opened another. Its pane held an explanation of a condition that had
    // already passed.
    terminals.setWorkspace(GLOBAL_WORKSPACE);
    terminals.root = null;
    const failed = terminals.create({ target: 'ssh:h1', title: 'workstation' });
    const healthy = terminals.create({ target: 'ssh:h1', title: 'other' });
    const elsewhere = terminals.create({ target: 'ssh:h2', title: 'another host' });
    terminals.markSpawnFailed(failed);
    terminals.markSpawnFailed(elsewhere);

    terminals.restartFailedOnHost('h1');

    const tab = (id: string) => {
      const t = terminals.findTab(id);
      return t?.kind === 'terminal' ? t : undefined;
    };
    // The one that failed is cleared for a fresh attempt…
    expect(tab(failed)?.spawnFailed).toBe(false);
    // …a terminal that was fine is not disturbed…
    expect(tab(healthy)?.spawnFailed).toBeFalsy();
    // …and another host's failure is none of this host's business.
    expect(tab(elsewhere)?.spawnFailed).toBe(true);
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
