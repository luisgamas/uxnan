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
import {
  askAntigravityUsage,
  askClaudeUsage,
  askCodexUsage,
  askCopilotUsage,
  askGrokUsage,
  askOpenCodeUsage,
  jsonLines,
  parseSemver,
  readAntigravityAnswer,
  readCopilotAnswer,
  readOpenCodeAnswer,
  resetAntigravityLatch,
  runOnce,
  type OneShotResult,
  type RunOnce,
} from '../../src/usage/cli-usage.js';
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

test('Grok: `_x.ai/billing` is asked once `initialize` answered', async () => {
  const { binary, dir } = await fakeCli(`
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1 } });
    if (m.method === '_x.ai/billing') out({ jsonrpc: '2.0', id: m.id, result: { config: { creditUsagePercent: 12 }, subscription_tier: 'Free' } });
  `);
  try {
    const answer = await askGrokUsage(binary);
    assert.equal(answer?.billing?.['subscription_tier'], 'Free');
  } finally {
    await rmrf(dir);
  }
});

test('Grok: an error answer is passed on as the message', async () => {
  const { binary, dir } = await fakeCli(`
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: {} });
    if (m.method === '_x.ai/billing') out({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'Not authenticated.' } });
  `);
  try {
    assert.deepEqual(await askGrokUsage(binary), { error: 'Not authenticated.' });
  } finally {
    await rmrf(dir);
  }
});

const ok = (stdout: string, stderr = ''): OneShotResult => ({ stdout, stderr, code: 0 });

/** What agy 1.4.12 prints for `-p /usage --output-format json` (trimmed). */
const AGY_USAGE_LINE = JSON.stringify({
  conversation_id: '',
  status: 'SUCCESS',
  response: 'Gemini Models\tWeekly Limit Remaining\t91%\t2026-11-06T05:10:52Z\n',
  duration_seconds: 0,
  num_turns: 0,
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  command: {
    name: 'usage',
    data: {
      groups: [
        { name: 'Gemini Models', buckets: [{ id: 'gemini-weekly', remaining_fraction: 0.91 }] },
      ],
    },
  },
});
const AGY_CREDITS_LINE = JSON.stringify({
  conversation_id: '',
  status: 'SUCCESS',
  num_turns: 0,
  command: { name: 'credits', data: { remaining_credits: 0, upgrade_uri: 'https://x' } },
});

/** A fake agy: answers by argv, records every call. */
function fakeAgy(
  version: string,
  answers: Record<string, OneShotResult>,
  calls: string[][] = [],
): RunOnce {
  return async (_binary, args) => {
    calls.push(args);
    if (args[0] === '--version') return ok(`${version}\n`);
    return answers[args[1] ?? ''] ?? { stdout: '', stderr: '', code: 1 };
  };
}

const AGY = { path: 'agy', prependArgs: [] };

test('Antigravity: /usage and /credits, never with --disable-slash-commands', async () => {
  resetAntigravityLatch();
  const calls: string[][] = [];
  const answer = await askAntigravityUsage(
    AGY,
    fakeAgy('1.4.12', { '/usage': ok(AGY_USAGE_LINE), '/credits': ok(AGY_CREDITS_LINE) }, calls),
  );
  assert.ok(answer?.usage?.['groups']);
  assert.equal(answer?.credits?.['remaining_credits'], 0);
  assert.ok(calls.every((c) => !c.includes('--disable-slash-commands')));
  assert.deepEqual(calls[1], ['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s']);
});

test('Antigravity: a build older than 1.1.11 is never asked', async () => {
  resetAntigravityLatch();
  const calls: string[][] = [];
  const answer = await askAntigravityUsage(AGY, fakeAgy('1.1.10', {}, calls));
  assert.deepEqual(answer, { failure: { kind: 'tooOld', version: '1.1.10' } });
  assert.equal(calls.length, 1);
});

test('Antigravity: an answer that ran a turn latches — it is not asked again', async () => {
  resetAntigravityLatch();
  const turn = JSON.stringify({
    conversation_id: 'c-1',
    status: 'SUCCESS',
    num_turns: 1,
    response: 'hi',
  });
  const calls: string[][] = [];
  const run = fakeAgy('1.4.12', { '/usage': ok(turn), '/credits': ok(turn) }, calls);
  assert.deepEqual(await askAntigravityUsage(AGY, run), { failure: { kind: 'ranTurn' } });
  const before = calls.length;
  assert.deepEqual(await askAntigravityUsage(AGY, run), { failure: { kind: 'ranTurn' } });
  assert.equal(calls.length, before);
  resetAntigravityLatch();
});

test('readAntigravityAnswer: signed out, rate-limited, timed out, wrong command', () => {
  assert.deepEqual(
    readAntigravityAnswer(
      { stdout: '', stderr: 'Authentication required. Please visit the URL', code: 1 },
      'usage',
    ),
    { failure: { kind: 'signedOut' } },
  );
  const limited = readAntigravityAnswer(
    { stdout: 'AGY_ERROR:{"status":"RESOURCE_EXHAUSTED"}', stderr: '', code: 1 },
    'usage',
  );
  assert.equal('failure' in limited && limited.failure.kind, 'error');
  assert.deepEqual(readAntigravityAnswer({ stdout: '', stderr: '', code: null }, 'usage'), {
    failure: { kind: 'error', message: 'Antigravity did not answer in time' },
  });
  const other = readAntigravityAnswer(ok(AGY_CREDITS_LINE), 'usage');
  assert.ok('failure' in other);
});

test('parseSemver and jsonLines', () => {
  assert.deepEqual(parseSemver('agy 1.4.12\n'), [1, 4, 12]);
  assert.equal(parseSemver('dev build'), undefined);
  assert.deepEqual(jsonLines('banner\n{"a":1}\nnot {json\n{"b":2}'), [{ a: 1 }, { b: 2 }]);
});

test('OpenCode: the private server is asked for its usage limits', async () => {
  const calls: string[][] = [];
  const answer = await askOpenCodeUsage({ path: 'opencode', prependArgs: [] }, async (_b, args) => {
    calls.push(args);
    return ok(
      '{"location":{"directory":"/h"},"data":{"workspace":{"id":"w","usageURL":"u"},"budgets":[]}}',
    );
  });
  assert.deepEqual(calls, [['api', '--standalone', 'GET', '/api/experimental/usage/limits']]);
  assert.deepEqual(answer?.data, { workspace: { id: 'w', usageURL: 'u' }, budgets: [] });
});

test('readOpenCodeAnswer: signed out, the Console down, an old OpenCode', () => {
  assert.deepEqual(readOpenCodeAnswer(ok('{"location":{},"data":null}')), { data: null });
  assert.match(
    readOpenCodeAnswer({
      stdout: '{"_tag":"ServiceUnavailableError","message":"x"}',
      stderr: '',
      code: 1,
    }).failure ?? '',
    /did not answer/,
  );
  assert.match(
    readOpenCodeAnswer({ stdout: '', stderr: 'unknown command api', code: 1 }).failure ?? '',
    /needs OpenCode 2/,
  );
});

test('Copilot: gh asks the endpoint itself; a missing gh is not installed', async () => {
  const calls: string[][] = [];
  const answer = await askCopilotUsage({ path: 'gh', prependArgs: [] }, async (_b, args) => {
    calls.push(args);
    return ok('{"login":"octo","quota_snapshots":{}}');
  });
  assert.equal(answer?.user?.['login'], 'octo');
  assert.equal(calls[0]?.[1], '/copilot_internal/user');
  assert.ok(!calls[0]?.includes('token'));
  const missing = await askCopilotUsage({ path: 'gh', prependArgs: [] }, async () => ({
    stdout: '',
    stderr: '',
    code: null,
    missing: true,
  }));
  assert.equal(missing, undefined);
});

test('readCopilotAnswer: signed out, no Copilot, other failures', () => {
  assert.deepEqual(
    readCopilotAnswer({
      stdout: '',
      stderr: 'To get started with GitHub CLI, please run:  gh auth login',
      code: 4,
    }),
    { signedOut: true },
  );
  assert.deepEqual(
    readCopilotAnswer({
      stdout: '{"message":"Not Found"}',
      stderr: 'gh: Not Found (HTTP 404)',
      code: 1,
    }),
    { failure: 'this GitHub account has no Copilot access' },
  );
  assert.deepEqual(
    readCopilotAnswer({ stdout: '{"message":"Bad credentials"}', stderr: '', code: 1 }),
    {
      signedOut: true,
    },
  );
});

test('runOnce: what a real process printed, its exit code, a missing binary', async () => {
  const done = await runOnce(
    {
      path: process.execPath,
      prependArgs: ['-e', 'console.log("out"); console.error("err"); process.exit(3)'],
    },
    [],
    process.env,
  );
  assert.equal(done.stdout.trim(), 'out');
  assert.equal(done.stderr.trim(), 'err');
  assert.equal(done.code, 3);
  const missing = await runOnce(
    { path: '/nonexistent/uxnan-no-such-cli', prependArgs: [] },
    [],
    process.env,
  );
  assert.equal(missing.missing, true);
});
