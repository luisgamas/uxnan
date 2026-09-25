import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { GrokAdapter } from '../../src/adapters/grok-adapter.js';
import { ZeroAdapter } from '../../src/adapters/zero-adapter.js';
import { agentLocation, locateAgent, type LocateEnvironment } from '@uxnan/shared';

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

test('the shared locator checks native paths, then npm entries, then PATH — and says where it looked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uxnan-locate-'));
  try {
    const home = join(dir, 'home');
    const prefix = join(dir, 'node');
    const binDir = join(dir, 'bin');
    await mkdir(join(prefix, 'bin'), { recursive: true });
    await mkdir(binDir, { recursive: true });
    const where = (path: string): LocateEnvironment => ({
      platform: 'linux',
      env: { PATH: ['/definitely/not/here', path].join(delimiter) },
      home,
      nodePath: join(prefix, 'bin', 'node'),
      // Only the running node's own prefix: never this machine's real installs.
      npmRoots: ['$NODE_PREFIX/lib/node_modules'],
    });

    // Nothing installed: unavailable, every location reported.
    const zero = agentLocation('zero')!;
    const missing = locateAgent(zero, undefined, where(binDir));
    assert.equal(missing.available, false);
    assert.equal(missing.binaryPath, 'zero');
    assert.ok(missing.checked.includes(join(prefix, 'lib', 'node_modules', zero.npmEntry!)));
    assert.ok(missing.checked.includes(`PATH:${binDir}`));

    // On PATH: found there. A directory of the same name never counts.
    await mkdir(join(binDir, 'grok'));
    assert.equal(locateAgent(agentLocation('grok')!, undefined, where(binDir)).available, false);
    await writeFile(join(binDir, 'zero'), '#!/bin/sh\n');
    assert.equal(locateAgent(zero, undefined, where(binDir)).binaryPath, join(binDir, 'zero'));

    // An npm entry under the running node's own prefix (nvm, Homebrew, fnm…)
    // wins over PATH and runs through that node.
    const entry = join(prefix, 'lib', 'node_modules', zero.npmEntry!);
    await mkdir(join(entry, '..'), { recursive: true });
    await writeFile(entry, '');
    const viaNpm = locateAgent(zero, undefined, where(binDir));
    assert.equal(viaNpm.binaryPath, join(prefix, 'bin', 'node'));
    assert.deepEqual(viaNpm.prependArgs, [entry]);

    // A native install beats both; a configured path beats everything.
    const grokNative = join(home, '.grok', 'bin', 'grok');
    await mkdir(join(grokNative, '..'), { recursive: true });
    await writeFile(grokNative, '');
    assert.equal(
      locateAgent(agentLocation('grok')!, undefined, where(binDir)).binaryPath,
      grokNative,
    );
    const configured = locateAgent(zero, '/nope/zero', where(binDir));
    assert.deepEqual([configured.binaryPath, configured.available], ['/nope/zero', false]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every agent the bridge drives has an entry in the shared location table', () => {
  for (const id of [
    'claude-code',
    'codex',
    'opencode',
    'pi-agent',
    'antigravity-cli',
    'grok',
    'zero',
  ]) {
    assert.ok(agentLocation(id), id);
  }
});
