import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { extractPath, mergePath } from '../src/login-path.js';

test('the probe output is read between its markers, ignoring rc-file noise', () => {
  assert.equal(extractPath('Welcome!\n__UXNAN_PATH_BEGIN__/a:/b__UXNAN_PATH_END__\nbye'), '/a:/b');
  assert.equal(extractPath('no markers'), undefined);
  assert.equal(extractPath('__UXNAN_PATH_BEGIN____UXNAN_PATH_END__'), undefined);
});

test('merging appends only existing, missing folders and never reorders', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uxnan-path-'));
  try {
    const current = ['/usr/bin', dir].join(delimiter);
    const merged = mergePath(current, [dir, '/definitely/not/here', tmpdir()]);
    assert.deepEqual(merged.split(delimiter), ['/usr/bin', dir, tmpdir()]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
