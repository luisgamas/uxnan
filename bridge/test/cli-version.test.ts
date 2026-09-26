import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BRIDGE_VERSION } from '../src/version.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('`version` prints only the installed version, without starting a daemon', async () => {
  for (const arg of ['version', '--version', '-v']) {
    const { stdout } = await run(process.execPath, [cli, arg], { timeout: 10_000 });
    assert.equal(stdout, `${BRIDGE_VERSION}\n`);
  }
});

test('`update` with no bridge running says how to update, and fails', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'uxnan-cli-update-'));
  try {
    await assert.rejects(
      run(process.execPath, [cli, 'update'], {
        timeout: 10_000,
        env: { ...process.env, HOME: home, USERPROFILE: home },
      }),
      (err: { code?: number; stderr?: string }) => {
        // A failed command keeps its exit code (main() used to reset it to 0).
        assert.equal(err.code, 1);
        assert.match(err.stderr ?? '', /No bridge is running.*npm install -g uxnan-bridge@latest/);
        return true;
      },
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
