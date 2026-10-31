import { beforeEach, describe, expect, it } from 'vitest';

import { deferred, installFakeBackend } from '../../test/tauri';
import { until } from '../../test/render';
import { projects } from '$lib/state/projects.svelte';
import { app } from '$lib/state/app.svelte';
import { hosts } from '$lib/state/hosts.svelte';
import { terminals, GLOBAL_WORKSPACE } from '$lib/state/terminals.svelte';
import { fileTree } from '$lib/state/fileTree.svelte';
import { unread } from '$lib/state/unread.svelte';
import { sessions } from '$lib/state/sessions.svelte';
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
        git_repo_status: () => ({ branch: 'main', dirty: 0, ahead: 0, behind: 0, isRepo: true }),
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
      git_repo_status: () => {
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

describe('a plain folder that became a repository', () => {
  const PLAIN_ID = 'repo-plain';
  const PLAIN_PATH = 'C:/projects/plain';
  const PLAIN_ENTRY: WorktreeEntry = { path: PLAIN_PATH, branch: null, head: null, isMain: true };
  const NOW_GIT = {
    id: PLAIN_ID,
    name: 'plain',
    path: PLAIN_PATH,
    worktrees: [],
    isGit: true,
  };

  beforeEach(() => {
    app.repos = [{ id: PLAIN_ID, name: 'plain', path: PLAIN_PATH, worktrees: [], isGit: false }];
    projects.worktreesByRepo = { [PLAIN_ID]: [PLAIN_ENTRY] };
  });

  it('is asked again on the reconcile pass, and its record follows the answer', async () => {
    // `git init` ran in a terminal since the folder was added. The record said
    // "plain folder" and everything that trusts it (the card, the Changes panel,
    // the worktree affordances) kept treating it as one.
    const backend = installFakeBackend({
      repos_missing: () => [],
      repo_probe_git: () => NOW_GIT,
      worktree_list: () => [{ ...PLAIN_ENTRY, branch: 'main', head: 'abc123' }],
      git_repo_status: () => ({ branch: 'main', dirty: 0, ahead: 0, behind: 0, isRepo: true }),
    });

    await projects.refreshWorktrees(true);

    expect(backend.lastCallTo('repo_probe_git')?.args).toEqual({ id: PLAIN_ID });
    expect(app.repos[0].isGit).toBe(true);
    expect(projects.activeGitRepo).toBeNull(); // nothing selected — unchanged
    expect(projects.worktreesOf(PLAIN_ID)[0]?.branch).toBe('main');
  });

  it('is not asked once it is a repository, nor when it lives on a host', async () => {
    app.repos = [
      { ...NOW_GIT },
      { id: 'repo-host', name: 'h', path: PLAIN_PATH, target: 'ssh:h1', worktrees: [], isGit: false },
    ];
    const backend = installFakeBackend({
      repos_missing: () => [],
      repo_probe_git: () => null,
      worktree_list: () => [PLAIN_ENTRY],
      git_repo_status: () => ({ branch: 'main', dirty: 0, ahead: 0, behind: 0, isRepo: true }),
    });

    await projects.refreshWorktrees(true);

    expect(backend.lastCallTo('repo_probe_git')).toBeUndefined();
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

  it("creates a worktree on the host, fenced to the connection the user sees", async () => {
    sessions.replace([{ hostId: 'h1', generation: 6, label: 'gamas' }]);
    const created: WorktreeEntry = {
      path: 'C:/Users/gamas/uxnan/worktrees/sample/feature',
      branch: 'feature',
      head: 'abc',
      isMain: false,
    };
    const backend = installFakeBackend({
      worktree_create: () => created,
      worktree_list: () => [REMOTE_MAIN, created],
      git_repo_status: () => ({ branch: 'feature', dirty: 0, ahead: 0, behind: 0, isRepo: true }),
    });

    expect(await projects.createWorktree(REMOTE_ID, 'feature', { agentId: null })).toBe(true);
    expect(backend.lastCallTo('worktree_create')?.args).toMatchObject({
      repoId: REMOTE_ID,
      branch: 'feature',
      expect: { targetId: 'ssh:h1', generation: 6 },
    });
    // The new worktree is the host's, not this machine's.
    expect(projects.targetForPath(created.path)).toBe('ssh:h1');

    // With the host gone, nothing is sent: a zero would be an expectation
    // nobody issued.
    sessions.replace([]);
    backend.clearCalls();
    expect(await projects.createWorktree(REMOTE_ID, 'other', { agentId: null })).toBe(false);
    expect(backend.lastCallTo('worktree_create')).toBeUndefined();
    expect(projects.error).toMatch(/no live connection/);
  });

  it('keeps the file tree on the machine its root is on', () => {
    // The same pairing, on the panel where it actually bit: Files is the tab
    // that opens by default, so a tree asking a host about a local path is what
    // showed "waiting for this host to connect" over a local project.
    projects.setActiveWorktree(MAIN.path);
    terminals.setWorkspace(projects.workspaceFor(REMOTE_PATH, 'ssh:h1'));

    fileTree.setRoot(projects.activeWorktreePath, projects.activeReviewTarget);
    expect(fileTree.target).toBe(LOCAL_TARGET);
  });

  it('pairs the review with the machine its own path is on', () => {
    // Reproduction of a real report: the Changes panel said "waiting for this
    // host to connect" over a **local** project. The panels were taking the
    // machine from the focused terminal workspace and the path from the
    // selected project — two independent facts. Focus a terminal that lives on
    // a host while a local project is selected and they disagree, so the panel
    // asked a host about a path on this machine. With the host down that is a
    // misleading message; with it up it is a review of the wrong machine.
    projects.setActiveWorktree(MAIN.path);
    expect(projects.activeReviewTarget).toBe(LOCAL_TARGET);

    terminals.setWorkspace(projects.workspaceFor(REMOTE_PATH, 'ssh:h1'));

    // The terminal side still follows the focused workspace — that is what it
    // is for — but the review follows the path it is about.
    expect(projects.activeWorktreeTarget).toBe('ssh:h1');
    expect(projects.activeReviewTarget).toBe(LOCAL_TARGET);
  });

  it('still names the exact machine when both are the same path', () => {
    // The one case the path alone cannot answer: the same absolute path
    // registered on two machines. The workspace key knows, so it wins when it
    // is about that path.
    projects.setActiveWorktree(REMOTE_PATH, 'ssh:h1');
    expect(projects.activeReviewTarget).toBe('ssh:h1');
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
    // The tree names the host, and the backend serves it from that machine's
    // engine. Search needs the host to be reachable, so while it is not
    // connected it is not offered rather than offered broken.
    const backend = installFakeBackend({
      fs_list_dir: () => [
        { name: 'src', path: `${REMOTE_PATH}/src`, isDir: true, ignored: false },
        { name: 'README.md', path: `${REMOTE_PATH}/README.md`, isDir: false, ignored: false },
      ],
      fs_set_watch: () => undefined,
    });

    projects.setActiveWorktree(REMOTE_PATH);
    fileTree.setRoot(REMOTE_PATH, projects.activeWorktreeTarget);
    await fileTree.loadDir(REMOTE_PATH);

    expect(backend.lastCallTo('fs_list_dir')?.args).toEqual({
      path: REMOTE_PATH,
      target: 'ssh:h1',
    });
    expect(fileTree.searchable).toBe(false);

    // …and a local workspace is unchanged.
    fileTree.setRoot(MAIN.path, 'local');
    expect(fileTree.searchable).toBe(true);
  });

  it("reads a host's git on the host, and never this machine's", async () => {
    // The row names the machine; the host's engine runs git there. An answer
    // for this machine's folder at the same path would be the wrong repository.
    const backend = installFakeBackend({
      git_repo_status: (args) =>
        args.target === 'ssh:h1'
          ? { branch: 'main', dirty: 3, ahead: 1, behind: 0, isRepo: true }
          : { branch: 'main', dirty: 99, ahead: 99, behind: 99, isRepo: true },
    });

    await projects.refreshStatuses([REMOTE_PATH]);

    expect(backend.lastCallTo('git_repo_status')?.args).toEqual({ path: REMOTE_PATH, target: 'ssh:h1' });
    expect(projects.status(REMOTE_PATH)).toEqual({ dirty: 3, ahead: 1, behind: 0 });
  });

  it('leaves the badges alone when a host cannot answer about git', async () => {
    // "Not a repository", "no git installed" and "the shell could not be named"
    // all arrive as isRepo:false — and none of them means "no changes". Showing
    // zeroes there would be the same lie as a made-up branch.
    installFakeBackend({
      git_repo_status: () => ({ branch: null, dirty: 0, ahead: 0, behind: 0, isRepo: false }),
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
      fs_list_dir: () => {
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

describe('hidden worktrees', () => {
  const A = 'repo-a';
  const B = 'repo-b';
  const wt = (path: string, branch: string | null, isMain = false): WorktreeEntry => ({
    path,
    branch,
    head: 'abcdef0123456789',
    isMain,
  });
  const A_MAIN = wt('/p/a', 'main', true);
  const A_QUIET = wt('/p/a--quiet', 'quiet');
  const A_BUSY = wt('/p/a--busy', 'busy');
  const B_MAIN = wt('/p/b', 'main', true);
  const B_OLD = wt('/p/b--old', null); // a detached checkout

  const names = (list: { path: string }[]) => list.map((w) => w.path);

  beforeEach(() => {
    installFakeBackend({ update_settings: () => ({}) });
    app.repos = [
      { id: A, name: 'alpha', path: A_MAIN.path, worktrees: [], isGit: true },
      { id: B, name: 'beta', path: B_MAIN.path, worktrees: [], isGit: true },
    ];
    projects.worktreesByRepo = { [A]: [A_MAIN, A_QUIET, A_BUSY], [B]: [B_MAIN, B_OLD] };
    // A quiet, clean tree: nothing in the store says anything is happening.
    projects.statusByPath = {};
    projects.query = '';
    projects.activeWorktreePath = null;
    app.settings.hiddenWorktrees = [];
    // These are worktrees the panel already took in: this describe is about what
    // the user hides, not about what appeared outside Uxnan (the one below).
    app.settings.knownWorktrees = [A_QUIET.path, A_BUSY.path, B_OLD.path];
    app.settings.worktreeBaselineProjects = [A, B];
    app.settings.sidebarShowHidden = false;
    app.settings.pinnedWorktrees = [];
    // The PR cache outlives a test; a MERGED one would make the worktree closable.
    for (const w of [A_MAIN, A_QUIET, A_BUSY, B_MAIN, B_OLD]) projects.notePr(w.path, null);
    projects.syncLingering(); // nothing hidden: forgets any linger a test left
  });

  it('hides a worktree from its project, from both flat views, and counts it', () => {
    projects.hideWorktree({ ...A_QUIET });

    expect(projects.isHidden(A_QUIET.path)).toBe(true);
    expect(names(projects.visibleChildWorktrees(A))).toEqual([A_BUSY.path]);
    expect(names(projects.orderedChildWorktrees(A))).toEqual([A_BUSY.path]);
    const inStatus = projects.statusGroups().flatMap((lane) => names(lane.items));
    const inReview = projects.reviewGroups().flatMap((lane) => names(lane.items));
    expect(inStatus).not.toContain(A_QUIET.path);
    expect(inReview).not.toContain(A_QUIET.path);
    expect(inStatus).toContain(A_BUSY.path);
    expect(projects.hiddenCountOf(A)).toBe(1);
    expect(projects.hiddenCount).toBe(1);
    // The worktree itself is untouched: still known, still in the palette.
    expect(projects.worktreesOf(A)).toContainEqual(A_QUIET);
    expect(projects.allWorktrees().map((w) => w.path)).toContain(A_QUIET.path);
  });

  it('persists the list through the settings, and nowhere else', () => {
    const backend = installFakeBackend({ update_settings: () => ({}) });
    projects.hideWorktree({ ...A_QUIET });

    expect(app.settings.hiddenWorktrees).toEqual([A_QUIET.path]);
    const saved = backend.lastCallTo('update_settings')?.args.settings as { hiddenWorktrees: string[] };
    expect(saved.hiddenWorktrees).toEqual([A_QUIET.path]);
  });

  it('never hides the primary worktree', () => {
    expect(projects.hideWorktree({ ...A_MAIN })).toBeNull();
    expect(projects.isHidden(A_MAIN.path)).toBe(false);
    expect(projects.canHideWorktree({ ...A_MAIN })).toBe(false);
  });

  it('shows it again, and a second hide is not stacked', () => {
    projects.hideWorktree({ ...A_QUIET });
    expect(projects.hideWorktree({ ...A_QUIET })).toBeNull(); // already hidden
    expect(app.settings.hiddenWorktrees).toEqual([A_QUIET.path]);

    projects.showWorktree(A_QUIET.path);
    expect(projects.isHidden(A_QUIET.path)).toBe(false);
    expect(names(projects.visibleChildWorktrees(A))).toEqual([A_QUIET.path, A_BUSY.path]);
    expect(projects.hiddenCount).toBe(0);
  });

  it("'show hidden' draws them without forgetting they are hidden", () => {
    projects.hideWorktree({ ...A_QUIET });
    projects.setShowHidden(true);

    expect(projects.showHidden).toBe(true);
    expect(names(projects.visibleChildWorktrees(A))).toEqual([A_QUIET.path, A_BUSY.path]);
    expect(projects.isHidden(A_QUIET.path)).toBe(true);
    expect(projects.hiddenCount).toBe(1); // still the number held aside
    expect(app.settings.sidebarShowHidden).toBe(true);
  });

  it('looks through hidden worktrees when searching', () => {
    projects.hideWorktree({ ...A_QUIET });
    projects.query = 'quiet';

    expect(names(projects.visibleChildWorktrees(A))).toEqual([A_QUIET.path]);
  });

  it('brings a hidden worktree back while it is selected, and lets it go after', () => {
    projects.hideWorktree({ ...A_QUIET });
    projects.activeWorktreePath = A_QUIET.path;

    expect(names(projects.visibleChildWorktrees(A))).toContain(A_QUIET.path);
    expect(projects.hiddenCount).toBe(0); // shown, so not "held back"
    expect(projects.isHeldBack(A_QUIET)).toBe(false);

    projects.activeWorktreePath = A_MAIN.path;
    expect(names(projects.visibleChildWorktrees(A))).not.toContain(A_QUIET.path);
    expect(projects.hiddenCount).toBe(1);
  });

  it('says whether a hide takes effect now or once the worktree goes quiet', () => {
    projects.activeWorktreePath = A_QUIET.path;
    expect(projects.hideWorktree({ ...A_QUIET })).toBe(false);
    expect(projects.hideWorktree({ ...A_BUSY })).toBe(true);
  });

  it('brings a hidden worktree back when it holds an unread result', () => {
    projects.hideWorktree({ ...A_QUIET });
    unread.mark(A_QUIET.path);
    try {
      expect(names(projects.visibleChildWorktrees(A))).toContain(A_QUIET.path);
    } finally {
      unread.clear(A_QUIET.path);
    }
    expect(names(projects.visibleChildWorktrees(A))).not.toContain(A_QUIET.path);
  });

  it('does not let a worktree vanish when its result is read — it lingers until another is selected', () => {
    projects.activeWorktreePath = A_MAIN.path;
    projects.hideWorktree({ ...A_QUIET });
    projects.syncLingering();

    // An agent finishes there: the row comes back.
    unread.mark(A_QUIET.path);
    projects.syncLingering();
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_QUIET.path);

    // The result is read (window focus clears every unread dot) without the user
    // selecting it: the row stays put rather than leaving under the pointer.
    unread.clear(A_QUIET.path);
    projects.syncLingering();
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_QUIET.path);
    expect(projects.isHeldBack(A_QUIET)).toBe(false);
    expect(projects.hiddenCount).toBe(0);

    // Selecting another worktree is the user moving on.
    projects.activeWorktreePath = B_MAIN.path;
    projects.syncLingering();
    expect(names(projects.visibleChildWorktrees(A))).not.toContain(A_QUIET.path);
    expect(projects.hiddenCount).toBe(1);
  });

  it('lingers through selecting the worktree itself, and ends when the next one is selected', () => {
    projects.activeWorktreePath = A_MAIN.path;
    projects.hideWorktree({ ...A_QUIET });
    unread.mark(A_QUIET.path);
    projects.syncLingering();
    unread.clear(A_QUIET.path);

    projects.activeWorktreePath = A_QUIET.path; // clicked it to read
    projects.syncLingering();
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_QUIET.path);

    projects.activeWorktreePath = A_MAIN.path;
    projects.syncLingering();
    expect(names(projects.visibleChildWorktrees(A))).not.toContain(A_QUIET.path);
  });

  it('never lingers a worktree that was not surfaced by an agent', () => {
    projects.activeWorktreePath = A_MAIN.path;
    projects.hideWorktree({ ...A_QUIET });
    projects.syncLingering();

    expect(names(projects.visibleChildWorktrees(A))).not.toContain(A_QUIET.path);
  });

  it('never hides what is ready to close — the lane keeps its count', () => {
    projects.hideWorktree({ ...A_QUIET });
    projects.notePr(A_QUIET.path, { state: 'MERGED', isDraft: false, checks: null });

    expect(projects.completion(A_QUIET)).toBe('done');
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_QUIET.path);
    const closable = projects.statusGroups().find((lane) => lane.attention === 5);
    expect(names(closable?.items ?? [])).toContain(A_QUIET.path);
    // …and a closable worktree is not offered "Hide" in the first place.
    expect(projects.canHideWorktree(A_BUSY)).toBe(true);
    projects.notePr(A_BUSY.path, { state: 'CLOSED', isDraft: false, checks: null });
    expect(projects.canHideWorktree(A_BUSY)).toBe(false);
    expect(projects.hideWorktree({ ...A_BUSY })).toBeNull();
  });

  it('keeps the attention pill counting, hidden or not', () => {
    projects.hideWorktree({ ...A_QUIET });
    // Nothing waits on the user here, hidden or not — and the count must not read
    // the hidden list at all.
    expect(projects.needsYouCount).toBe(0);
  });

  it('pinning a hidden worktree shows it again', () => {
    projects.hideWorktree({ ...A_QUIET });
    projects.toggleWorktreePin(A_QUIET.path);

    expect(projects.isWorktreePinned(A_QUIET.path)).toBe(true);
    expect(projects.isHidden(A_QUIET.path)).toBe(false);
    expect(projects.canHideWorktree(A_QUIET)).toBe(false); // pinned: not offered
  });

  describe('hide idle', () => {
    it('hides the worktrees the panel already calls inert, and only those', () => {
      // alpha--quiet: clean and nothing unpushed (inert). alpha--busy: dirty.
      projects.statusByPath = {
        [A_QUIET.path]: { dirty: 0, ahead: 0, behind: 0 },
        [A_BUSY.path]: { dirty: 3, ahead: 0, behind: 0 },
      };

      expect(projects.idleHideable(A).map((w) => w.path)).toEqual([A_QUIET.path]);
      expect(projects.hideIdle(A)).toBe(1);
      expect(projects.isHidden(A_QUIET.path)).toBe(true);
      expect(projects.isHidden(A_BUSY.path)).toBe(false);
    });

    it('takes nothing when nothing is idle, or when the status is not known yet', () => {
      expect(projects.idleHideable(A)).toEqual([]); // status unknown ≠ clean
      expect(projects.hideIdle(A)).toBe(0);
      expect(app.settings.hiddenWorktrees).toEqual([]);
    });

    it('leaves pinned, selected and already-hidden worktrees alone', () => {
      projects.statusByPath = {
        [A_QUIET.path]: { dirty: 0, ahead: 0, behind: 0 },
        [A_BUSY.path]: { dirty: 0, ahead: 0, behind: 0 },
      };
      projects.toggleWorktreePin(A_QUIET.path);
      projects.activeWorktreePath = A_BUSY.path;

      expect(projects.idleHideable(A)).toEqual([]);
    });

    it('is scoped to its project', () => {
      projects.statusByPath = {
        [A_QUIET.path]: { dirty: 0, ahead: 0, behind: 0 },
        [B_OLD.path]: { dirty: 0, ahead: 0, behind: 0 },
      };
      projects.hideIdle(A);

      expect(projects.isHidden(A_QUIET.path)).toBe(true);
      expect(projects.isHidden(B_OLD.path)).toBe(false);
    });
  });

  describe('showing them all again', () => {
    beforeEach(() => {
      projects.hideWorktree({ ...A_QUIET });
      projects.hideWorktree({ ...B_OLD });
      projects.setShowHidden(true);
    });

    it("clears one project's and keeps the other's", () => {
      projects.showAllHidden(A);

      expect(app.settings.hiddenWorktrees).toEqual([B_OLD.path]);
      expect(projects.showHidden).toBe(true); // something is still hidden
    });

    it('clears everything and stops showing hidden when there is nothing left to show', () => {
      projects.showAllHidden();

      expect(app.settings.hiddenWorktrees).toEqual([]);
      expect(projects.showHidden).toBe(false);
    });
  });

  describe('self-healing', () => {
    it('forgets a removed worktree', () => {
      projects.hideWorktree({ ...A_QUIET });
      projects.dropHidden(A_QUIET.path);

      expect(app.settings.hiddenWorktrees).toEqual([]);
    });

    it('prunes marks whose worktree is gone once every project is loaded', () => {
      app.settings.hiddenWorktrees = [A_QUIET.path, '/gone/forever'];
      projects.pruneHiddenWorktrees();

      expect(app.settings.hiddenWorktrees).toEqual([A_QUIET.path]);
    });

    it('prunes nothing while a project has not loaded — an empty read is not "gone"', () => {
      app.settings.hiddenWorktrees = [A_QUIET.path, B_OLD.path];
      projects.worktreesByRepo = { [A]: [A_MAIN, A_QUIET, A_BUSY] }; // B not loaded

      projects.pruneHiddenWorktrees();

      expect(app.settings.hiddenWorktrees).toEqual([A_QUIET.path, B_OLD.path]);
    });
  });
});

describe('worktrees created outside Uxnan', () => {
  const A = 'repo-a';
  const B = 'repo-b';
  const clean = { dirty: 0, ahead: 0, behind: 0 };
  const wt = (path: string, branch: string | null, extra: Partial<WorktreeEntry> = {}): WorktreeEntry => ({
    path,
    branch,
    head: 'abcdef0123456789',
    isMain: false,
    ...extra,
  });
  const A_MAIN = wt('/p/a', 'main', { isMain: true });
  const A_SCRATCH = wt('/p/a/.claude/worktrees/scratch', 'scratch'); // made by plain git
  const A_OURS = wt('/p/a--ours', 'ours', { createdByUxnan: true });
  const B_MAIN = wt('/p/b', 'main', { isMain: true });
  const B_SCRATCH = wt('/p/b/.claude/worktrees/other', 'other');
  const names = (list: { path: string }[]) => list.map((w) => w.path);

  beforeEach(() => {
    installFakeBackend({ update_settings: () => ({}) });
    app.repos = [
      { id: A, name: 'alpha', path: A_MAIN.path, worktrees: [], isGit: true },
      { id: B, name: 'beta', path: B_MAIN.path, worktrees: [], isGit: true },
    ];
    projects.worktreesByRepo = { [A]: [A_MAIN, A_SCRATCH, A_OURS], [B]: [B_MAIN, B_SCRATCH] };
    projects.statusByPath = {
      [A_SCRATCH.path]: clean,
      [A_OURS.path]: clean,
      [B_SCRATCH.path]: clean,
    };
    projects.query = '';
    projects.activeWorktreePath = null;
    app.settings.hiddenWorktrees = [];
    app.settings.knownWorktrees = [];
    app.settings.worktreeBaselineProjects = [A, B];
    app.settings.sidebarShowHidden = false;
    app.settings.pinnedWorktrees = [];
    for (const w of [A_MAIN, A_SCRATCH, A_OURS, B_MAIN, B_SCRATCH]) projects.notePr(w.path, null);
    projects.syncLingering();
  });

  it('holds back an untouched one, and counts it with the hidden ones', () => {
    expect(projects.isExternal(A_SCRATCH.path)).toBe(true);
    expect(names(projects.visibleChildWorktrees(A))).toEqual([A_OURS.path]);
    expect(projects.hiddenCountOf(A)).toBe(1);
    expect(projects.hiddenCountOf(B)).toBe(1);
    expect(projects.hiddenCount).toBe(2);
    expect(projects.isHeldBack(A_SCRATCH)).toBe(true);
    expect(projects.isSetAside(A_SCRATCH)).toBe(true);
  });

  it('adds up with what the user hid, once each', () => {
    app.settings.hiddenWorktrees = [A_OURS.path];
    expect(projects.hiddenCountOf(A)).toBe(2);
    expect(projects.hiddenCount).toBe(3);
  });

  it('never sets aside the primary worktree or one Uxnan made', () => {
    expect(projects.isExternal(A_MAIN.path)).toBe(false);
    expect(projects.isExternal(A_OURS.path)).toBe(false);
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_OURS.path);
  });

  it('shows one that has work in it — dirty, unpushed — and one whose state is not known yet', () => {
    projects.statusByPath = { ...projects.statusByPath, [A_SCRATCH.path]: { dirty: 2, ahead: 0, behind: 0 } };
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);
    expect(projects.hiddenCountOf(A)).toBe(0);

    projects.statusByPath = { ...projects.statusByPath, [A_SCRATCH.path]: { dirty: 0, ahead: 1, behind: 0 } };
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);

    // Unknown is not "untouched": it is drawn until git has said.
    const { [A_SCRATCH.path]: _gone, ...rest } = projects.statusByPath;
    projects.statusByPath = rest;
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);
  });

  it('shows one with an open pull request', () => {
    projects.notePr(A_SCRATCH.path, { state: 'OPEN', isDraft: false, checks: null });
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);
  });

  it('keeps a finished one in "Ready to close" — a decision is never hidden', () => {
    projects.notePr(A_SCRATCH.path, { state: 'MERGED', isDraft: false, checks: null });
    expect(projects.completion(A_SCRATCH)).toBe('done');
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);
  });

  it('brings it back while it is selected, and lets it go after', () => {
    projects.activeWorktreePath = A_SCRATCH.path;
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);
    expect(projects.hiddenCountOf(A)).toBe(0);

    projects.activeWorktreePath = A_MAIN.path;
    expect(names(projects.visibleChildWorktrees(A))).not.toContain(A_SCRATCH.path);
  });

  it('does not let it vanish when an agent in it is read — it lingers like a hidden one', () => {
    projects.activeWorktreePath = A_MAIN.path;
    projects.syncLingering();
    unread.mark(A_SCRATCH.path);
    projects.syncLingering();
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);

    unread.clear(A_SCRATCH.path);
    projects.syncLingering();
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);

    projects.activeWorktreePath = B_MAIN.path;
    projects.syncLingering();
    expect(names(projects.visibleChildWorktrees(A))).not.toContain(A_SCRATCH.path);
  });

  it('is drawn when hidden worktrees are shown, and found by a search', () => {
    projects.setShowHidden(true);
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);
    expect(projects.hiddenCountOf(A)).toBe(1); // still the number held aside

    projects.setShowHidden(false);
    projects.query = 'scratch';
    expect(names(projects.visibleChildWorktrees(A))).toEqual([A_SCRATCH.path]);
  });

  it('is not offered Hide — it is already out of the list — and not taken by hide-idle', () => {
    expect(projects.canHideWorktree(A_SCRATCH)).toBe(false);
    expect(projects.idleHideable(A).map((w) => w.path)).not.toContain(A_SCRATCH.path);
  });

  it('is known once it is shown: it stays in the list, and the choice is saved', () => {
    const backend = installFakeBackend({ update_settings: () => ({}) });
    projects.showWorktree(A_SCRATCH.path);

    expect(projects.isExternal(A_SCRATCH.path)).toBe(false);
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);
    expect(app.settings.knownWorktrees).toEqual([A_SCRATCH.path]);
    const saved = backend.lastCallTo('update_settings')?.args.settings as { knownWorktrees: string[] };
    expect(saved.knownWorktrees).toEqual([A_SCRATCH.path]);
    // …even once it goes quiet again and nothing else surfaces it.
    expect(projects.hiddenCountOf(A)).toBe(0);
  });

  it('is known once it is pinned, so unpinning does not set it aside again', () => {
    projects.toggleWorktreePin(A_SCRATCH.path);
    expect(projects.isExternal(A_SCRATCH.path)).toBe(false);

    projects.toggleWorktreePin(A_SCRATCH.path); // unpin
    expect(names(projects.visibleChildWorktrees(A))).toContain(A_SCRATCH.path);
  });

  it('is known when "stop hiding" ends the hiding, for one project or for all', () => {
    projects.showAllHidden(A);
    expect(projects.isExternal(A_SCRATCH.path)).toBe(false);
    expect(projects.isExternal(B_SCRATCH.path)).toBe(true); // the other project is untouched
    expect(projects.hiddenCount).toBe(1);

    projects.showAllHidden();
    expect(projects.isExternal(B_SCRATCH.path)).toBe(false);
    expect(projects.hiddenCount).toBe(0);
    expect(app.settings.knownWorktrees).toEqual([A_SCRATCH.path, B_SCRATCH.path]);
  });

  it('stops showing hidden worktrees once nothing is left to show', () => {
    projects.setShowHidden(true);
    projects.showAllHidden();
    expect(projects.showHidden).toBe(false);
  });

  it('does nothing when there is nothing set aside', () => {
    projects.showAllHidden();
    const backend = installFakeBackend({ update_settings: () => ({}) });
    projects.showAllHidden();
    expect(backend.lastCallTo('update_settings')).toBeUndefined();
  });

  describe('what was already there when this arrived', () => {
    const NEW = 'repo-new';
    const OLD = wt('/p/n--old', 'old');
    const NEW_MAIN = wt('/p/n', 'main', { isMain: true });

    beforeEach(() => {
      app.repos = [...app.repos, { id: NEW, name: 'novel', path: NEW_MAIN.path, worktrees: [], isGit: true }];
      app.settings.worktreeBaselineProjects = [A, B]; // NEW has never been listed
    });

    it('takes every existing worktree in the first time a project is listed — none vanishes', async () => {
      installFakeBackend({
        update_settings: () => ({}),
        worktree_list: () => [NEW_MAIN, OLD, wt('/p/n--ours', 'ours', { createdByUxnan: true })],
      });
      projects.statusByPath = { [OLD.path]: clean };

      await projects.loadWorktrees(NEW, false);

      expect(names(projects.visibleChildWorktrees(NEW))).toEqual([OLD.path, '/p/n--ours']);
      expect(projects.hiddenCountOf(NEW)).toBe(0);
      expect(app.settings.knownWorktrees).toEqual([OLD.path]); // Uxnan's own need no entry
      expect(app.settings.worktreeBaselineProjects).toContain(NEW);
    });

    it('sets aside only what appears after that', async () => {
      const fresh = wt('/p/n--fresh', 'fresh');
      let list: WorktreeEntry[] = [NEW_MAIN, OLD];
      installFakeBackend({ update_settings: () => ({}), worktree_list: () => list });
      await projects.loadWorktrees(NEW, false);

      list = [NEW_MAIN, OLD, fresh];
      await projects.loadWorktrees(NEW, false);
      projects.statusByPath = { ...projects.statusByPath, [OLD.path]: clean, [fresh.path]: clean };

      expect(projects.isExternal(fresh.path)).toBe(true);
      expect(projects.isExternal(OLD.path)).toBe(false);
      expect(names(projects.visibleChildWorktrees(NEW))).toEqual([OLD.path]);
      expect(projects.hiddenCountOf(NEW)).toBe(1);
    });

    it('does not count the stand-in list of a host it cannot ask as the first listing', async () => {
      installFakeBackend({
        update_settings: () => ({}),
        worktree_list: () => [wt('/p/n', null, { isMain: true })],
      });
      await projects.loadWorktrees(NEW, false);
      expect(app.settings.worktreeBaselineProjects).not.toContain(NEW);

      // The host answers at last: everything that was there is taken in.
      installFakeBackend({ update_settings: () => ({}), worktree_list: () => [NEW_MAIN, OLD] });
      await projects.loadWorktrees(NEW, false);
      expect(app.settings.knownWorktrees).toEqual([OLD.path]);
      expect(app.settings.worktreeBaselineProjects).toContain(NEW);
    });

    it('does not take a worktree in again once the project was', async () => {
      installFakeBackend({ update_settings: () => ({}), worktree_list: () => [NEW_MAIN, OLD] });
      app.settings.worktreeBaselineProjects = [A, B, NEW];
      await projects.loadWorktrees(NEW, false);

      expect(app.settings.knownWorktrees).toEqual([]);
      expect(projects.isExternal(OLD.path)).toBe(true);
    });
  });

  describe('the creation record landing a moment late', () => {
    it('replaces a list that only differs by it, so a worktree Uxnan made is not stuck "external"', async () => {
      const unmarked = wt('/p/a--late', 'late');
      const marked = { ...unmarked, createdByUxnan: true };
      projects.worktreesByRepo = { [A]: [A_MAIN, unmarked] };
      installFakeBackend({
        update_settings: () => ({}),
        worktree_list: () => [A_MAIN, marked],
      });

      await projects.refreshWorktrees(true);

      expect(projects.worktreesOf(A).find((w) => w.path === unmarked.path)?.createdByUxnan).toBe(true);
      expect(projects.isExternal(unmarked.path)).toBe(false);
    });
  });

  describe('self-healing', () => {
    it('forgets a removed worktree, known or hidden', () => {
      app.settings.knownWorktrees = [A_SCRATCH.path];
      app.settings.hiddenWorktrees = [A_SCRATCH.path];
      projects.dropHidden(A_SCRATCH.path);

      expect(app.settings.knownWorktrees).toEqual([]);
      expect(app.settings.hiddenWorktrees).toEqual([]);
    });

    it('prunes known marks and projects that are gone once every project is loaded', () => {
      app.settings.knownWorktrees = [A_SCRATCH.path, '/gone/forever'];
      app.settings.worktreeBaselineProjects = [A, B, 'removed-project'];
      projects.pruneHiddenWorktrees();

      expect(app.settings.knownWorktrees).toEqual([A_SCRATCH.path]);
      expect(app.settings.worktreeBaselineProjects).toEqual([A, B]);
    });

    it('prunes nothing while a host could only give its stand-in list', () => {
      app.settings.knownWorktrees = [A_SCRATCH.path, '/host/only/known'];
      app.repos = [
        ...app.repos.slice(0, 1),
        {
          id: B,
          name: 'beta',
          path: '/host/b',
          worktrees: [],
          isGit: true,
          target: { kind: 'ssh', hostId: 'h1' },
        } as unknown as (typeof app.repos)[number],
      ];
      projects.worktreesByRepo = { [A]: [A_MAIN, A_SCRATCH], [B]: [wt('/host/b', null, { isMain: true })] };

      projects.pruneHiddenWorktrees();

      expect(app.settings.knownWorktrees).toEqual([A_SCRATCH.path, '/host/only/known']);
    });
  });
});
