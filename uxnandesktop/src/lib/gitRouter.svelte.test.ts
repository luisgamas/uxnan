import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../test/tauri';
import {
  applyOn,
  commitOn,
  diffHeadOn,
  diffOn,
  discardOn,
  logOn,
  repoStatusOn,
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
    git_review: () => ({ files: [CHANGE], numstat: [NUMSTAT], ...STATUS, head: 'abc', isRepo: true }),
    git_repo_status: () => ({ branch: 'main', ...STATUS, isRepo: true }),
    git_diff: () => 'a diff',
    git_diff_head: () => 'a gutter',
    git_log: () => [],
    git_show: () => 'a patch',
    git_stage: () => null,
    git_unstage_all: () => null,
    git_discard: () => null,
    git_apply: () => null,
    git_commit: () => null,
    git_fetch: () => STATUS,
    git_push: () => null,
  });
});

describe('gitRouter — reads', () => {
  it('asks once for everything the panel draws, naming the machine', async () => {
    // One call on either machine: on a host each one is a round trip, so
    // three would be three of them for one click.
    const local = await reviewOn('local', '/home/dev/app');
    expect(backend.lastCallTo('git_review')?.args).toEqual({
      path: '/home/dev/app',
      target: 'local',
    });
    expect(local.files).toEqual([CHANGE]);
    const remote = await reviewOn('ssh:h1', 'C:/Users/gamas/app');
    expect(backend.lastCallTo('git_review')?.args).toEqual({
      path: 'C:/Users/gamas/app',
      target: 'ssh:h1',
    });
    expect(remote.head).toBe('abc');
    expect(remote.status).toEqual(STATUS);
  });

  it('routes every read by the machine, never by the path', async () => {
    await diffOn('ssh:h1', 'C:/app', 'main.rs', true);
    expect(backend.lastCallTo('git_diff')?.args).toEqual({
      path: 'C:/app',
      file: 'main.rs',
      staged: true,
      target: 'ssh:h1',
    });
    await diffHeadOn('ssh:h1', 'C:/app', 'main.rs');
    expect(backend.lastCallTo('git_diff_head')?.args).toMatchObject({ target: 'ssh:h1' });
    await logOn('ssh:h1', 'C:/app', 100, 0);
    expect(backend.lastCallTo('git_log')?.args).toMatchObject({
      limit: 100,
      skip: 0,
      target: 'ssh:h1',
    });
    await showOn('ssh:h1', 'C:/app', 'deadbeef');
    expect(backend.lastCallTo('git_show')?.args).toMatchObject({
      hash: 'deadbeef',
      target: 'ssh:h1',
    });
  });

  it('separates the gutter from the file diff', async () => {
    // Two different questions: the gutter marks every line that differs from the
    // commit, so staging a hunk must not clear it.
    expect(await diffOn('local', '/app', 'main.rs', false)).toBe('a diff');
    expect(await diffHeadOn('local', '/app', 'main.rs')).toBe('a gutter');
  });

  it('reads a row as "not read" when the folder is not a repository', async () => {
    expect(await repoStatusOn('ssh:h1', 'C:/app')).toEqual(STATUS);
    backend.setCommands({ git_repo_status: () => ({ branch: null, ...STATUS, isRepo: false }) });
    expect(await repoStatusOn('ssh:h1', 'C:/plain')).toBeNull();
  });
});

describe('gitRouter — mutations', () => {
  it('sends no expectation for local work', async () => {
    await stageOn('local', '/home/dev/app', 'src/main.rs');
    expect(backend.lastCallTo('git_stage')?.args).toEqual({
      path: '/home/dev/app',
      file: 'src/main.rs',
      target: 'local',
      expect: null,
    });
  });

  it('fences every remote mutation with the connection it was prepared for', async () => {
    const onHost = { target: 'ssh:h1', expect: { targetId: 'ssh:h1', generation: 4 } };
    await stageOn('ssh:h1', 'C:/app', 'src/main.rs', 4);
    expect(backend.lastCallTo('git_stage')?.args).toMatchObject(onHost);
    await unstageAllOn('ssh:h1', 'C:/app', 4);
    expect(backend.lastCallTo('git_unstage_all')?.args).toMatchObject(onHost);
    await discardOn('ssh:h1', 'C:/app', 'src/main.rs', true, 4);
    expect(backend.lastCallTo('git_discard')?.args).toMatchObject({ untracked: true, ...onHost });
    await applyOn('ssh:h1', 'C:/app', '@@ patch', true, false, 4);
    expect(backend.lastCallTo('git_apply')?.args).toMatchObject({
      patch: '@@ patch',
      cached: true,
      reverse: false,
      ...onHost,
    });
    await commitOn('ssh:h1', 'C:/app', 'a message', false, true, 4);
    expect(backend.lastCallTo('git_commit')?.args).toMatchObject({
      message: 'a message',
      signOff: true,
      ...onHost,
    });
  });

  it('refuses a remote mutation it cannot name a connection for', async () => {
    // A discard cannot be taken back once the host has run it, so an
    // expectation nobody issued must never be sent.
    await expect(discardOn('ssh:h1', 'C:/app', 'src/main.rs', false)).rejects.toThrow(
      /no live connection/,
    );
    await expect(commitOn('ssh:h1', 'C:/app', 'msg', false, false)).rejects.toThrow(
      /no live connection/,
    );
    expect(backend.lastCallTo('git_discard')).toBeUndefined();
    expect(backend.lastCallTo('git_commit')).toBeUndefined();
  });

  it('syncs on the machine the worktree is on, and reads the distance back', async () => {
    // On a host it runs there, with that machine's own credentials: the project
    // lives on it, so its remote is reachable from it.
    expect(await syncOn('ssh:h1', 'C:/app', 'push', 2)).toEqual(STATUS);
    expect(backend.lastCallTo('git_push')?.args).toMatchObject({
      target: 'ssh:h1',
      expect: { targetId: 'ssh:h1', generation: 2 },
    });
    // Push answers nothing, so the distance is read back afterwards.
    expect(backend.lastCallTo('git_repo_status')?.args).toMatchObject({ target: 'ssh:h1' });

    // Fetch is the one that already answers the distance itself.
    expect(await syncOn('local', '/app', 'fetch')).toEqual(STATUS);
    expect(backend.lastCallTo('git_fetch')?.args).toMatchObject({ target: 'local', expect: null });
  });
});
