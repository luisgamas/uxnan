import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { agentEnv, DESKTOP_TERMINAL_ENV_KEYS, defaultSpawn } from '../../src/index.js';

// The desktop ADE hands each terminal an identity (`UXNAN_AGENT_ID` + its hook
// server's coordinates). Environment variables are inherited by the whole
// process tree, so a bridge started from inside such a terminal would pass that
// identity to every agent CLI it spawns — and their hooks would report to the
// ADE as if they were that terminal. These tests pin the scrub that prevents it.

/** Run node with `script` and resolve its stdout, using `spawn` as given. */
function readChildOutput(
  run: (args: string[]) => {
    stdout: NodeJS.ReadableStream;
    on: (e: 'close', cb: () => void) => unknown;
  },
  script: string,
): Promise<string> {
  return new Promise((resolve) => {
    const child = run(['-e', script]);
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf-8')));
    child.on('close', () => resolve(out));
  });
}

const PRINT_AGENT_ID = "process.stdout.write(process.env.UXNAN_AGENT_ID ?? 'absent')";

test('agentEnv drops every key the desktop injects per terminal', () => {
  const inherited: Record<string, string> = {};
  for (const key of DESKTOP_TERMINAL_ENV_KEYS) inherited[key] = 'inherited';
  const before = { ...process.env };
  Object.assign(process.env, inherited);
  try {
    const env = agentEnv();
    for (const key of DESKTOP_TERMINAL_ENV_KEYS) {
      assert.equal(env[key], undefined, `${key} survived the scrub`);
    }
    // Everything else the bridge runs with is still there — this is a scrub, not
    // an empty environment.
    assert.equal(env['PATH'] ?? env['Path'], before['PATH'] ?? before['Path']);
  } finally {
    for (const key of DESKTOP_TERMINAL_ENV_KEYS) delete process.env[key];
  }
});

test('a value the bridge sets itself wins over the scrub', () => {
  // The approval hook's own coordinates travel this way (see the Claude
  // adapter): scrubbing must not stop the bridge from addressing its own server.
  process.env['UXNAN_HOOK_URL'] = 'http://127.0.0.1:1/inherited';
  try {
    const env = agentEnv({ UXNAN_HOOK_URL: 'http://127.0.0.1:2/mine' });
    assert.equal(env['UXNAN_HOOK_URL'], 'http://127.0.0.1:2/mine');
  } finally {
    delete process.env['UXNAN_HOOK_URL'];
  }
});

test('a spawned agent CLI cannot see the terminal identity the bridge inherited', async () => {
  process.env['UXNAN_AGENT_ID'] = 'phantom-terminal-4a7f1e';
  try {
    // Control: plain `spawn` does inherit it. Without this the assertion below
    // could pass for the wrong reason (e.g. the child never reading its env).
    const leaked = await readChildOutput(
      (args) =>
        spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
      PRINT_AGENT_ID,
    );
    assert.equal(leaked, 'phantom-terminal-4a7f1e');

    const scrubbed = await readChildOutput(
      (args) => defaultSpawn(process.execPath, args, process.cwd()),
      PRINT_AGENT_ID,
    );
    assert.equal(scrubbed, 'absent');
  } finally {
    delete process.env['UXNAN_AGENT_ID'];
  }
});
