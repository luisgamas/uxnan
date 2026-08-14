import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../test/tauri';
import { listDirOn, readFileOn } from './fsRouter';

const ENTRY = { name: 'main.rs', path: '/home/dev/app/main.rs', isDir: false, ignored: false };
const FILE = { content: 'fn main() {}', binary: false, tooLarge: false };

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend({
    fs_list_dir: () => [ENTRY],
    fs_read_file: () => FILE,
    ssh_fs_list: () => [ENTRY],
    ssh_fs_read: () => FILE,
  });
});

describe('fsRouter', () => {
  it('reads this machine when the target is local or absent', async () => {
    // Local paths keep exactly the calls they always had — the remote work must
    // not put a branch in front of the common case.
    await listDirOn(undefined, '/home/dev/app');
    expect(backend.lastCallTo('fs_list_dir')?.args).toEqual({ path: '/home/dev/app' });
    await readFileOn('local', '/home/dev/app/main.rs');
    expect(backend.lastCallTo('fs_read_file')?.args).toEqual({ path: '/home/dev/app/main.rs' });
    expect(backend.lastCallTo('ssh_fs_list')).toBeUndefined();
    expect(backend.lastCallTo('ssh_fs_read')).toBeUndefined();
  });

  it('reads the host when the target names one', async () => {
    // Over SFTP, so it works whatever shell that machine runs — the question
    // that broke every command-shaped approach.
    await listDirOn('ssh:h1', 'C:/Users/gamas/app');
    expect(backend.lastCallTo('ssh_fs_list')?.args).toEqual({
      hostId: 'h1',
      path: 'C:/Users/gamas/app',
    });
    await readFileOn('ssh:h1', 'C:/Users/gamas/app/main.rs');
    expect(backend.lastCallTo('ssh_fs_read')?.args).toEqual({
      hostId: 'h1',
      path: 'C:/Users/gamas/app/main.rs',
    });
  });

  it('never sends a remote path to the local reader', async () => {
    // The failure this rules out: a host's path handed to this machine's
    // filesystem, which answers about a folder that is not the one on screen.
    await listDirOn('ssh:h1', 'C:/Users/gamas/app');
    expect(backend.lastCallTo('fs_list_dir')).toBeUndefined();
  });
});
