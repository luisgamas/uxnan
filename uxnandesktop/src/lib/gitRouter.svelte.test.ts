import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../test/tauri';
import {
  applyOn,
  commitOn,
  diffHeadOn,
  diffOn,
  discardOn,
  logOn,
  reviewOn,
  showOn,
  stageOn,
  syncOn,
  unstageAllOn,
} from './gitRouter';

const CHANGE = { path: 'src/main.rs', index: ' ', worktree: 'M' };
const NUMSTAT = { path: 'src/main.rs', added: 3, deleted: 1 };
const STATUS = { dirty: 1, ahead: 0, behind: 2 };

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend({
    git_status: () => [CHANGE],
    git_numstat: () => [NUMSTAT],
    worktree_status: () => STATUS,
    git_diff: () => 'local diff',
    git_diff_head: () => 'local gutter',
    git_log: () => [],
    git_show: () => 'local patch',
    git_stage: () => null,
    git_unstage_all: () => null,
    git_discard: () => null,
    git_apply: () => null,
    git_commit: () => null,
    git_fetch: () => STATUS,
    git_push: () => null,
    ssh_git_review: () => ({ files: [CHANGE], numstat: [NUMSTAT], ...STATUS, head: 'abc', isRepo: true }),
    ssh_git_diff: () => 'remote diff',
    ssh_git_diff_head: () => 'remote gutter',
    ssh_git_log: () => [],
    ssh_git_show: () => 'remote patch',
    ssh_git_stage: () => null,
    ssh_git_unstage_all: () => null,
    ssh_git_discard: () => null,
    ssh_git_apply: () => null,
    ssh_git_commit: () => null,
    ssh_git_sync: () => STATUS,
  });
});

describe('gitRouter — reads', () => {
  it('keeps the three calls it always made for a local worktree', async () => {
    // Batching those into one command would be a rewrite of working code to
    // solve a problem this machine does not have.
    const review = await reviewOn('local', '/home/dev/app');
    expect(backend.lastCallTo('git_status')?.args).toEqual({ path: '/home/dev/app' });
    expect(backend.lastCallTo('git_numstat')).toBeDefined();
    expect(backend.lastCallTo('worktree_status')).toBeDefined();
    expect(backend.lastCallTo('ssh_git_review')).toBeUndefined();
    expect(review.files).toEqual([CHANGE]);
    expect(review.status).toEqual(STATUS);
    // Local git answers no HEAD here: the watcher already tracks it, and a
    // fabricated one would make History reload for nothing.
    expect(review.head).toBeNull();
  });

  it('asks a host once for everything the panel draws', async () => {
    // Each remote call is a shell start on another machine, so three would be
    // three of them for one click.
    const review = await reviewOn('ssh:h1', 'C:/Users/gamas/app');
    expect(backend.lastCallTo('ssh_git_review')?.args).toEqual({
      hostId: 'h1',
      path: 'C:/Users/gamas/app',
    });
    expect(backend.lastCallTo('git_status')).toBeUndefined();
    expect(backend.lastCallTo('worktree_status')).toBeUndefined();
    expect(review.head).toBe('abc');
    expect(review.status).toEqual(STATUS);
  });

  it('routes every read by the machine, never by the path', async () => {
    await diffOn('ssh:h1', 'C:/app', 'main.rs', true);
    expect(backend.lastCallTo('ssh_git_diff')?.args).toEqual({
      hostId: 'h1',
      path: 'C:/app',
      file: 'main.rs',
      staged: true,
    });
    await diffHeadOn('ssh:h1', 'C:/app', 'main.rs');
    expect(backend.lastCallTo('ssh_git_diff_head')).toBeDefined();
    await logOn('ssh:h1', 'C:/app', 100, 0);
    expect(backend.lastCallTo('ssh_git_log')?.args).toMatchObject({ limit: 100, skip: 0 });
    await showOn('ssh:h1', 'C:/app', 'deadbeef');
    expect(backend.lastCallTo('ssh_git_show')?.args).toMatchObject({ hash: 'deadbeef' });
    expect(backend.lastCallTo('git_diff')).toBeUndefined();
    expect(backend.lastCallTo('git_show')).toBeUndefined();
  });

  it('separates the gutter from the file diff', async () => {
    // Two different questions: the gutter marks every line that differs from the
    // commit, so staging a hunk must not clear it.
    expect(await diffOn('local', '/app', 'main.rs', false)).toBe('local diff');
    expect(await diffHeadOn('local', '/app', 'main.rs')).toBe('local gutter');
  });
});

describe('gitRouter — mutations', () => {
  it('sends no expectation for local work', async () => {
    await stageOn('local', '/home/dev/app', 'src/main.rs');
    expect(backend.lastCallTo('git_stage')?.args).toEqual({
      path: '/home/dev/app',
      file: 'src/main.rs',
    });
  });

  it('fences every remote mutation with the connection it was prepared for', async () => {
    const fence = { targetId: 'ssh:h1', generation: 4 };
    await stageOn('ssh:h1', 'C:/app', 'src/main.rs', 4);
    expect(backend.lastCallTo('ssh_git_stage')?.args).toMatchObject({ expect: fence });
    await unstageAllOn('ssh:h1', 'C:/app', 4);
    expect(backend.lastCallTo('ssh_git_unstage_all')?.args).toMatchObject({ expect: fence });
    await discardOn('ssh:h1', 'C:/app', 'src/main.rs', true, 4);
    expect(backend.lastCallTo('ssh_git_discard')?.args).toMatchObject({
      untracked: true,
      expect: fence,
    });
    await applyOn('ssh:h1', 'C:/app', '@@ patch', true, false, 4);
    expect(backend.lastCallTo('ssh_git_apply')?.args).toMatchObject({
      patch: '@@ patch',
      cached: true,
      reverse: false,
      expect: fence,
    });
    await commitOn('ssh:h1', 'C:/app', 'a message', false, true, 4);
    expect(backend.lastCallTo('ssh_git_commit')?.args).toMatchObject({
      message: 'a message',
      signOff: true,
      expect: fence,
    });
  });

  it('refuses a remote mutation it cannot name a connection for', async () => {
    // A discard cannot be taken back once the host has run it, so an
    // expectation nobody issued must never be sent.
    await expect(discardOn('ssh:h1', 'C:/app', 'src/main.rs', false)).rejects.toThrow(
      /no live connection/,
    );
    expect(backend.lastCallTo('ssh_git_discard')).toBeUndefined();
    await expect(commitOn('ssh:h1', 'C:/app', 'msg', false, false)).rejects.toThrow(
      /no live connection/,
    );
    expect(backend.lastCallTo('ssh_git_commit')).toBeUndefined();
  });

  it('syncs on the machine the worktree is on', async () => {
    // On a host it runs there, with that machine's own credentials: the project
    // lives on it, so its remote is reachable from it.
    expect(await syncOn('ssh:h1', 'C:/app', 'push', 2)).toEqual(STATUS);
    expect(backend.lastCallTo('ssh_git_sync')?.args).toMatchObject({
      action: 'push',
      expect: { targetId: 'ssh:h1', generation: 2 },
    });
    expect(backend.lastCallTo('git_push')).toBeUndefined();

    // Locally, push answers nothing, so the distance is read back afterwards.
    expect(await syncOn('local', '/app', 'push')).toEqual(STATUS);
    expect(backend.lastCallTo('git_push')).toBeDefined();
    expect(backend.lastCallTo('worktree_status')).toBeDefined();

    // Fetch is the one that already answers the distance itself.
    expect(await syncOn('local', '/app', 'fetch')).toEqual(STATUS);
    expect(backend.lastCallTo('git_fetch')).toBeDefined();
  });
});
