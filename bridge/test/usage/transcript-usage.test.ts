import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
  parseOpenCodeMessage,
  parsePiLine,
  parseZeroLine,
  type CodexParseState,
} from '../../src/usage/transcript-usage.js';
import { estimateCost } from '../../src/usage/usage-prices.js';
import { UsageScanner, localDay, type UsageLocations } from '../../src/usage/usage-scan.js';
import { DaemonState } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

// Lines in the shapes the CLIs write (trimmed to the fields that matter).
const claude = (id: string, req: string, output: number, at = '2026-09-24T03:07:28.665Z') =>
  JSON.stringify({
    type: 'assistant',
    requestId: req,
    timestamp: at,
    sessionId: 's1',
    message: {
      id,
      model: 'claude-opus-5-5',
      role: 'assistant',
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 5000,
        output_tokens: output,
        output_tokens_details: { thinking_tokens: 10 },
        cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 },
      },
    },
  });

test('a Claude response: tokens as written, the cache split by lifetime, a key for its copies', () => {
  const r = parseClaudeLine(claude('msg_1', 'req_1', 400));
  assert.deepEqual(r, {
    agentId: 'claude-code',
    model: 'claude-opus-5-5',
    at: Date.parse('2026-09-24T03:07:28.665Z'),
    inputTokens: 2,
    cachedInputTokens: 5000,
    cacheWriteTokens: 1000,
    cacheWriteLongTokens: 1000,
    outputTokens: 400,
    reasoningTokens: 10,
    dedupeKey: 'msg_1:req_1',
  });
  // Priced at Claude Code's own rates for its tier ($10/$50 per million).
  assert.equal(
    estimateCost(r!)!.toFixed(6),
    ((2 * 10 + 5000 * 1 + 1000 * 20 + 400 * 50) / 1e6).toFixed(6),
  );
  // Not a model response, or one Claude Code wrote itself.
  assert.equal(parseClaudeLine(JSON.stringify({ type: 'user', message: {} })), undefined);
  assert.equal(
    parseClaudeLine(claude('m', 'r', 1).replace('claude-opus-5-5', '<synthetic>')),
    undefined,
  );
  assert.equal(parseClaudeLine('{not json "usage" "assistant"'), undefined);
});

test('Codex: the model from its turn context, cached input taken out, a repeat skipped', () => {
  const state: CodexParseState = {};
  const ctx = JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-luna' } });
  const tokens = JSON.stringify({
    timestamp: '2026-09-27T03:20:58.160Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 17565,
          cached_input_tokens: 8960,
          cache_write_input_tokens: 0,
          output_tokens: 582,
          reasoning_output_tokens: 186,
        },
      },
    },
  });
  assert.equal(parseCodexLine(ctx, state), undefined);
  const r = parseCodexLine(tokens, state);
  assert.equal(r?.model, 'gpt-5.6-luna');
  assert.equal(r?.inputTokens, 17565 - 8960);
  assert.equal(r?.cachedInputTokens, 8960);
  assert.equal(r?.reasoningTokens, 186);
  assert.equal(parseCodexLine(tokens, state), undefined, 'the same event again spends nothing');
  // No price is known for Codex models: never guessed.
  assert.equal(estimateCost(r!), undefined);
});

test('pi, Grok and OpenCode: the cost they recorded, a free model at $0', () => {
  const pi = parsePiLine(
    JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        provider: 'openrouter',
        model: 'qwen/qwen3.8-27b:free',
        timestamp: 1790110908933,
        usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      },
    }),
  );
  assert.equal(pi?.model, 'openrouter/qwen/qwen3.8-27b:free');
  assert.equal(pi?.costUsd, 0);

  const grok = parseGrokLine(
    JSON.stringify({
      timestamp: 1790376084,
      params: {
        update: {
          sessionUpdate: 'turn_completed',
          usage: {
            costUsdTicks: 490380000,
            modelUsage: {
              'grok-4.7': {
                inputTokens: 40098,
                outputTokens: 87,
                cachedReadTokens: 21120,
                cacheCreationTokens: 0,
                reasoningTokens: 41,
              },
            },
          },
        },
      },
    }),
  );
  assert.equal(grok.length, 1);
  assert.equal(grok[0]?.at, 1790376084 * 1000);
  assert.equal(grok[0]?.inputTokens, 40098 - 21120);
  assert.equal(grok[0]?.costUsd?.toFixed(4), '0.0490');

  const oc = parseOpenCodeMessage(
    JSON.stringify({
      role: 'assistant',
      modelID: 'big-pickle',
      providerID: 'opencode',
      cost: 0.012,
      tokens: { input: 50, output: 10, reasoning: 5, cache: { read: 30, write: 0 } },
      time: { created: 1788278695954 },
    }),
  );
  assert.equal(oc?.model, 'opencode/big-pickle');
  assert.equal(oc?.outputTokens, 15);
  assert.equal(oc?.costUsd, 0.012);
  // A failed call spent nothing: not usage.
  assert.equal(
    parseOpenCodeMessage(
      JSON.stringify({
        role: 'assistant',
        modelID: 'x',
        cost: 0,
        tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        time: { created: 1 },
      }),
    ),
    undefined,
  );
});

test('Zero: a provider_usage event, at the session model, never priced', () => {
  const r = parseZeroLine(
    JSON.stringify({
      id: 's:2',
      sessionId: 's',
      sequence: 2,
      type: 'provider_usage',
      createdAt: '2026-09-25T05:40:59Z',
      payload: {
        completionTokens: 106,
        promptTokens: 14069,
        reasoningTokens: 106,
        totalTokens: 14175,
      },
    }),
    'openrouter/free',
  );
  assert.deepEqual(r, {
    agentId: 'zero',
    model: 'openrouter/free',
    at: Date.parse('2026-09-25T05:40:59Z'),
    inputTokens: 14069,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 106,
    reasoningTokens: 106,
  });
  assert.equal(estimateCost(r!), undefined);
  assert.equal(parseZeroLine(JSON.stringify({ type: 'message', payload: {} }), 'm'), undefined);
});

test('the scan counts each Claude response once across files and reads only what was appended', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-usage-'));
  const locations: UsageLocations = {
    claude: join(root, 'claude'),
    codex: [join(root, 'codex')],
    pi: join(root, 'pi'),
    grok: join(root, 'grok'),
    zero: join(root, 'zero'),
    openCodeDb: join(root, 'none.db'),
  };
  try {
    await mkdir(join(root, 'claude', 'proj'), { recursive: true });
    const now = Date.parse('2026-09-24T12:00:00Z');
    const a = join(root, 'claude', 'proj', 'a.jsonl');
    // One response written as two content-block lines, then another one.
    await writeFile(
      a,
      [claude('m1', 'r1', 100), claude('m1', 'r1', 100), claude('m2', 'r2', 50)].join('\n') + '\n',
    );
    // A resumed session's file repeats m1, and adds m3.
    await writeFile(
      join(root, 'claude', 'proj', 'b.jsonl'),
      [claude('m1', 'r1', 100), claude('m3', 'r3', 7)].join('\n') + '\n',
    );
    const state = new DaemonState(join(root, 'state'));
    const scanner = () => new UsageScanner({ state, locations, now: () => now });

    const first = await scanner().summary(7);
    const bucket = () => first.days[0]!.buckets[0]!;
    assert.equal(first.days.length, 1);
    assert.equal(first.days[0]!.day, localDay(Date.parse('2026-09-24T03:07:28.665Z')));
    assert.equal(bucket().responses, 3, 'm1 once, m2, m3');
    assert.equal(bucket().outputTokens, 157);
    assert.deepEqual(first.agents, [{ agentId: 'claude-code', sessions: 2, status: 'ok' }]);

    // Appended later: read from where the last scan stopped, from the cache.
    await appendFile(a, claude('m4', 'r4', 1000) + '\n');
    const second = await scanner().summary(7);
    assert.equal(second.days[0]!.buckets[0]!.responses, 4);
    assert.equal(second.days[0]!.buckets[0]!.outputTokens, 1157);

    // Out of the period asked for: not listed.
    const later = new UsageScanner({ state, locations, now: () => now + 30 * 86_400_000 });
    assert.deepEqual((await later.summary(7)).days, []);
  } finally {
    await rmrf(root);
  }
});

test('the scan reads a Zero session with the model its metadata names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-usage-zero-'));
  const locations: UsageLocations = {
    claude: join(root, 'claude'),
    codex: [join(root, 'codex')],
    pi: join(root, 'pi'),
    grok: join(root, 'grok'),
    zero: join(root, 'zero'),
    openCodeDb: join(root, 'none.db'),
  };
  try {
    const session = join(root, 'zero', 'zero_1');
    await mkdir(session, { recursive: true });
    await writeFile(join(session, 'metadata.json'), JSON.stringify({ modelId: 'openrouter/free' }));
    await writeFile(
      join(session, 'events.jsonl'),
      [
        JSON.stringify({ type: 'message', createdAt: '2026-09-25T05:40:58Z', payload: {} }),
        JSON.stringify({
          type: 'provider_usage',
          createdAt: '2026-09-25T05:40:59Z',
          payload: { completionTokens: 10, promptTokens: 90, reasoningTokens: 0 },
        }),
      ].join('\n') + '\n',
    );
    const scanner = new UsageScanner({
      state: new DaemonState(join(root, 'state')),
      locations,
      now: () => Date.parse('2026-09-26T12:00:00Z'),
    });
    const summary = await scanner.summary(7);
    const bucket = summary.days[0]!.buckets[0]!;
    assert.equal(bucket.agentId, 'zero');
    assert.equal(bucket.model, 'openrouter/free');
    assert.equal(bucket.inputTokens + bucket.outputTokens, 100);
    assert.equal(bucket.unpricedTokens, 100, 'no price is known, and none is guessed');
    assert.deepEqual(summary.agents, [{ agentId: 'zero', sessions: 1, status: 'ok' }]);
  } finally {
    await rmrf(root);
  }
});
