import { beforeEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../test/tauri';
import { createDirOn, createFileOn, deleteOn, duplicateOn, renameOn } from './fsRouter';

// The tree's own actions. These are the ones that *change* a machine, so what
// matters is that they name the right one and carry the fence — a misrouted
// create is confusing, a misrouted delete cannot be taken back.

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend({
    fs_create_file: () => '/home/dev/app/new.ts',
    fs_create_dir: () => '/home/dev/app/sub',
    fs_rename: () => '/home/dev/app/renamed.ts',
    fs_delete: () => null,
    fs_duplicate: () => '/home/dev/app/new copy.ts',
  });
});

describe('fsRouter — tree operations', () => {
  it('keeps local work on this machine, with no expectation', async () => {
    await createFileOn('local', '/home/dev/app', 'new.ts');
    expect(backend.lastCallTo('fs_create_file')?.args).toEqual({
      dir: '/home/dev/app',
      path: 'new.ts',
      target: 'local',
      expect: null,
    });
    await deleteOn(undefined, '/home/dev/app/new.ts');
    expect(backend.lastCallTo('fs_delete')?.args).toEqual({
      path: '/home/dev/app/new.ts',
      target: null,
      expect: null,
    });
  });

  it('sends each one to the host, fenced', async () => {
    const onHost = { target: 'ssh:h1', expect: { targetId: 'ssh:h1', generation: 5 } };
    await createFileOn('ssh:h1', 'C:/app', 'src/new.ts', 5);
    expect(backend.lastCallTo('fs_create_file')?.args).toEqual({
      dir: 'C:/app',
      path: 'src/new.ts',
      ...onHost,
    });
    await createDirOn('ssh:h1', 'C:/app', 'sub', 5);
    expect(backend.lastCallTo('fs_create_dir')?.args).toMatchObject(onHost);
    await renameOn('ssh:h1', 'C:/app/new.ts', 'renamed.ts', 5);
    expect(backend.lastCallTo('fs_rename')?.args).toMatchObject({
      newName: 'renamed.ts',
      ...onHost,
    });
    await duplicateOn('ssh:h1', 'C:/app/new.ts', 5);
    expect(backend.lastCallTo('fs_duplicate')?.args).toMatchObject(onHost);
    await deleteOn('ssh:h1', 'C:/app/new.ts', 5);
    expect(backend.lastCallTo('fs_delete')?.args).toMatchObject(onHost);
  });

  it('refuses every remote operation it cannot name a connection for', async () => {
    for (const call of [
      () => createFileOn('ssh:h1', 'C:/app', 'new.ts'),
      () => createDirOn('ssh:h1', 'C:/app', 'sub'),
      () => renameOn('ssh:h1', 'C:/app/new.ts', 'renamed.ts'),
      () => duplicateOn('ssh:h1', 'C:/app/new.ts'),
      () => deleteOn('ssh:h1', 'C:/app/new.ts'),
    ]) {
      await expect(call()).rejects.toThrow(/no live connection/);
    }
    expect(backend.calls).toEqual([]);
  });
});
