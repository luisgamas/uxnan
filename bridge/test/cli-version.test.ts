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
