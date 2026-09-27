/**
 * The CLIs are asked over their own headless surface; each answers concurrent
 * requests as it finishes them. A fake CLI answering in the opposite order
 * proves the reader waits for both answers instead of reading a signed-in
 * account as signed out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askClaudeUsage, askCodexUsage } from '../../src/usage/cli-usage.js';
import { rmrf } from '../helpers/fs.js';

/** A node script standing in for a CLI: it reads JSON lines and answers them. */
async function fakeCli(
  body: string,
): Promise<{ binary: { path: string; prependArgs: string[] }; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'uxnan-fake-cli-'));
  const script = join(dir, 'cli.mjs');
  await writeFile(
    script,
    `import { createInterface } from 'node:readline';
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const pending = [];
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  ${body}
});
setTimeout(() => process.exit(0), 5000);
`,
  );
  return { binary: { path: process.execPath, prependArgs: [script] }, dir };
}

test('Codex: the account is kept when the limits answer first', async () => {
  const { binary, dir } = await fakeCli(`
    if (m.id === 1) out({ id: 1, result: {} });
    if (m.id === 2) pending.push(m);
    if (m.id === 3) {
      out({ id: 3, result: { rateLimits: { primary: { usedPercent: 40 } } } });
      out({ id: 2, result: { account: { type: 'chatgpt', email: 'a@b.c', planType: 'plus' } } });
    }
  `);
  try {
    const answer = await askCodexUsage(binary);
    assert.equal((answer?.account as { email?: string } | undefined)?.email, 'a@b.c');
    assert.ok(answer?.rateLimits);
  } finally {
    await rmrf(dir);
  }
});

test('Claude Code: the account is kept when the usage answers first', async () => {
  const { binary, dir } = await fakeCli(`
    if (m.request?.subtype === 'initialize') pending.push(m);
    if (m.request?.subtype === 'get_usage') {
      out({ type: 'control_response', response: { request_id: 'uxnan-usage', response: { rate_limits: { limits: [] } } } });
      out({ type: 'control_response', response: { request_id: 'uxnan-init', response: { account: { email: 'a@b.c' } } } });
    }
  `);
  try {
    const answer = await askClaudeUsage(binary);
    assert.equal(answer?.account?.email, 'a@b.c');
    assert.ok(answer?.usage);
  } finally {
    await rmrf(dir);
  }
});
