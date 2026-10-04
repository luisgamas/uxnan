/**
 * The History log while its host is away.
 *
 * A commit already made stays true, so a log that was read is kept on screen
 * when its host drops — marked offline, with when it was read — instead of
 * emptying into a "waiting" panel. A log that was never read has nothing to
 * keep, and waits.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend } from '../../test/tauri';
import type { CommitInfo } from '$lib/types';
import { history } from './history.svelte';

const COMMIT: CommitInfo = {
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaa',
  parents: [],
  subject: 'first',
  body: '',
  authorName: 'dev',
  authorEmail: 'dev@example.com',
  timestamp: 1_700_000_000,
  refs: [],
};

beforeEach(async () => {
  installFakeBackend({ git_log: () => [] });
  await history.load(null);
});

describe('history — a host that drops', () => {
  it('keeps a log that was read, marked offline, and reads it again on load', async () => {
    installFakeBackend({ git_log: () => [COMMIT] });
    await history.load('/srv/app', 'ssh:h1');
    expect(history.readAt).not.toBeNull();

    expect(history.keepWhileAway('/srv/app', 'ssh:h1')).toBe(true);
    expect(history.offline).toBe(true);
    expect(history.commits).toHaveLength(1);

    // The host is back: the panel reloads, and the mark goes with it.
    await history.load('/srv/app', 'ssh:h1');
    expect(history.offline).toBe(false);
  });

  it('keeps nothing for a log it never read, or for another worktree', async () => {
    installFakeBackend({
      git_log: () => {
        throw new Error('not connected to h1');
      },
    });
    await history.load('/srv/app', 'ssh:h1');
    expect(history.keepWhileAway('/srv/app', 'ssh:h1')).toBe(false);

    installFakeBackend({ git_log: () => [COMMIT] });
    await history.load('/srv/app', 'ssh:h1');
    expect(history.keepWhileAway('/srv/other', 'ssh:h1')).toBe(false);
    expect(history.offline).toBe(false);
  });
});
