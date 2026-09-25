import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { GrokAdapter } from '../../src/adapters/grok-adapter.js';
import { ZeroAdapter } from '../../src/adapters/zero-adapter.js';
import { findOnPath } from '../../src/adapters/path-scan.js';

// An agent whose CLI is not installed must answer "no models", never take the
// bridge down: an unhandled `error` (ENOENT) event used to crash the process
// when the desktop asked an uninstalled Grok for its models.
test('asking an agent whose binary is missing for its models answers none, and nothing crashes', async () => {
  const missing = join(tmpdir(), 'uxnan-no-such-cli', 'grok');
  const grok = new GrokAdapter({ binaryPath: missing });
  assert.deepEqual(await grok.listModels(), []);
  const zero = new ZeroAdapter({ binaryPath: join(tmpdir(), 'uxnan-no-such-cli', 'zero') });
  assert.deepEqual(await zero.listModels(), []);
  // Still alive, and a second ask is just as calm.
  assert.deepEqual(await grok.listModels(), []);
});

test('findOnPath finds a regular file on PATH and nothing else', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uxnan-path-'));
  try {
    await writeFile(join(dir, 'fakecli'), '#!/bin/sh\n');
    await mkdir(join(dir, 'adir'));
    const env = { PATH: ['/definitely/not/here', dir].join(delimiter) };
    assert.equal(findOnPath('fakecli', env), join(dir, 'fakecli'));
    assert.equal(findOnPath('adir', env), undefined);
    assert.equal(findOnPath('missing', env), undefined);
    assert.equal(findOnPath('fakecli', {}), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
