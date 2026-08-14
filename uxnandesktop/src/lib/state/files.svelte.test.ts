/**
 * Saving a file the editor has open — specifically, saving one that lives on
 * another machine.
 *
 * The failure being ruled out here is not an error message: it is a save that
 * *looks* like it worked. Before remote writes existed, the same call would have
 * handed a host's absolute path to this machine's filesystem, where a folder of
 * the same name very often exists.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../../test/tauri';
import { FileEditorState } from './files.svelte';
import { hosts } from './hosts.svelte';

const REMOTE = 'C:/Users/gamas/app/main.rs';
let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend({
    fs_read_file: () => ({ content: 'fn main() {}', binary: false, tooLarge: false }),
    ssh_fs_read: () => ({ content: 'fn main() {}', binary: false, tooLarge: false }),
    fs_write_file: () => null,
    ssh_fs_write: () => null,
    git_diff_head: () => '',
  });
  hosts.connected = [];
  hosts.generations = {};
});

describe('FileEditorState — saving on a host', () => {
  it('writes through the host, carrying the connection it was prepared for', async () => {
    hosts.connected = ['h1'];
    hosts.generations = { h1: 4 };
    const state = new FileEditorState(REMOTE, null, 'ssh:h1');

    await state.save('edited');

    expect(backend.lastCallTo('ssh_fs_write')?.args).toEqual({
      hostId: 'h1',
      path: REMOTE,
      content: 'edited',
      expect: { targetId: 'ssh:h1', generation: 4 },
    });
    // The one that would look like success while writing here instead.
    expect(backend.lastCallTo('fs_write_file')).toBeUndefined();
    expect(state.error).toBeNull();
  });

  it('refuses, and says so, while its host is not connected', async () => {
    const state = new FileEditorState(REMOTE, null, 'ssh:h1');

    await state.save('edited');

    expect(backend.lastCallTo('ssh_fs_write')).toBeUndefined();
    expect(state.error).toMatch(/not connected/i);
    // An editor that silently does not save is worse than one that will not, so
    // the document stays dirty rather than being marked as stored.
    expect(state.readOnly).toBe(true);
  });

  it('leaves a local file on the path it always had', async () => {
    const state = new FileEditorState('/home/dev/app/main.rs', null, 'local');

    await state.save('edited');

    expect(backend.lastCallTo('fs_write_file')?.args).toEqual({
      path: '/home/dev/app/main.rs',
      content: 'edited',
    });
    expect(state.readOnly).toBe(false);
  });
});
