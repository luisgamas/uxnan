import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../test/tauri';
import { listDirOn, readDataUrlOn, readFileOn, writeFileOn } from './fsRouter';

const ENTRY = { name: 'main.rs', path: '/home/dev/app/main.rs', isDir: false, ignored: false };
const FILE = { content: 'fn main() {}', binary: false, tooLarge: false };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend({
    fs_list_dir: () => [ENTRY],
    fs_read_file: () => FILE,
    fs_read_data_url: () => PNG,
    fs_write_file: () => null,
  });
});

describe('fsRouter', () => {
  it('names this machine when the target is local or absent', async () => {
    await listDirOn(undefined, '/home/dev/app');
    expect(backend.lastCallTo('fs_list_dir')?.args).toEqual({
      path: '/home/dev/app',
      target: null,
    });
    await readFileOn('local', '/home/dev/app/main.rs');
    expect(backend.lastCallTo('fs_read_file')?.args).toEqual({
      path: '/home/dev/app/main.rs',
      target: 'local',
    });
  });

  it('names the host when the target is one, on the same commands', async () => {
    // One set of commands: the backend sends a host's call to its engine. A
    // call that lost its target would read this machine's disk at a path from
    // another one, so the target is what this asserts.
    await listDirOn('ssh:h1', 'C:/Users/gamas/app');
    expect(backend.lastCallTo('fs_list_dir')?.args).toEqual({
      path: 'C:/Users/gamas/app',
      target: 'ssh:h1',
    });
    await readFileOn('ssh:h1', 'C:/Users/gamas/app/main.rs');
    expect(backend.lastCallTo('fs_read_file')?.args).toEqual({
      path: 'C:/Users/gamas/app/main.rs',
      target: 'ssh:h1',
    });
  });

  it('reads a preview from the machine the file is on', async () => {
    // The image viewer used to ask this machine for every file, so a host's
    // image showed the read failure instead of the picture.
    expect(await readDataUrlOn('ssh:h1', 'C:/Users/gamas/app/logo.png')).toBe(PNG);
    expect(backend.lastCallTo('fs_read_data_url')?.args).toEqual({
      path: 'C:/Users/gamas/app/logo.png',
      target: 'ssh:h1',
    });
  });

  it('saves to this machine with no expectation', async () => {
    await writeFileOn('local', '/home/dev/app/main.rs', 'fn main() {}');
    expect(backend.lastCallTo('fs_write_file')?.args).toEqual({
      path: '/home/dev/app/main.rs',
      content: 'fn main() {}',
      target: 'local',
      expect: null,
    });
  });

  it('saves to the host with the expectation the backend fences on', async () => {
    // The same absolute path usually exists on both machines, so a misrouted
    // save is the one failure that looks exactly like success. The expectation
    // is what lets the backend refuse it.
    await writeFileOn('ssh:h1', 'C:/Users/gamas/app/main.rs', 'edited', 7);
    expect(backend.lastCallTo('fs_write_file')?.args).toEqual({
      path: 'C:/Users/gamas/app/main.rs',
      content: 'edited',
      target: 'ssh:h1',
      expect: { targetId: 'ssh:h1', generation: 7 },
    });
  });

  it('refuses a remote save it cannot name a connection for', async () => {
    // Sending a zero would be an expectation nobody issued — either rejected
    // after a round trip, or satisfied by accident. Neither is an answer.
    await expect(
      writeFileOn('ssh:h1', 'C:/Users/gamas/app/main.rs', 'edited'),
    ).rejects.toThrow(/no live connection/);
    expect(backend.lastCallTo('fs_write_file')).toBeUndefined();
  });
});
