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
import type { UsageRecord } from '../../src/usage/transcript-usage.js';
import { estimateCost, openAiTier } from '../../src/usage/usage-prices.js';
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
  // Opus 5.5's published rates: $4/$20 per million, a cache hit at 0.05x
  // ($0.20), the hour-long write at 2x ($8). The 1000 written tokens are all
  // `cacheWriteLongTokens`, so nothing is priced as a 5m write.
  assert.equal(
    estimateCost(r!)!.toFixed(6),
    ((2 * 4 + 5000 * 0.2 + 1000 * 8 + 400 * 20) / 1e6).toFixed(6),
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
  // At OpenAI's published GPT-5.6 Luna rates: fresh, cached and output
  // (reasoning included, once).
  assert.ok(Math.abs(estimateCost(r!)! - (8605 * 0.2 + 8960 * 0.02 + 582 * 1.2) / 1e6) < 1e-12);
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

// --- Claude price table: pinned to Anthropic's published rates ----------------
// These are a transcription of the model-pricing table read 2026-10-31
// (platform.claude.com/docs/en/about-claude/pricing), one million tokens of a
// single kind so the answer IS that kind's rate. They exist because the table
// is hand-kept: Opus 5.5 once carried Fable's $10/$50, Fable 5.1 carried
// Fable 5's cache-read rate and Sonnet 4.6 carried Sonnet 5's, and none of it
// broke anything until a spend screen showed numbers 2.5x and 4x too high.
// Re-read the table and update these when a model is added — do not adjust them
// to make a code change pass.
const record = (model: string, tokens: Partial<UsageRecord>): UsageRecord => ({
  agentId: 'claude-code',
  model,
  at: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  ...tokens,
});

const RATES_PER_MTOK: readonly (readonly [string, [number, number, number, number, number]])[] = [
  // model,                 input, output, cacheRead, 5m write, 1h write
  ['claude-fable-5-1', [10, 50, 0.25, 12.5, 20]],
  ['claude-mythos-5-1', [10, 50, 0.25, 12.5, 20]],
  ['claude-fable-5', [10, 50, 1, 12.5, 20]],
  ['claude-mythos-5', [10, 50, 1, 12.5, 20]],
  ['claude-opus-5-5', [4, 20, 0.2, 5, 8]],
  ['claude-opus-5', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-8', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-7', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-6', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-5', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-1', [15, 75, 1.5, 18.75, 30]],
  ['claude-opus-4', [15, 75, 1.5, 18.75, 30]],
  ['claude-sonnet-5-5', [2, 10, 0.1, 2.5, 4]],
  ['claude-sonnet-5', [2, 10, 0.2, 2.5, 4]],
  ['claude-sonnet-4-6', [3, 15, 0.3, 3.75, 6]],
  ['claude-sonnet-4-5', [3, 15, 0.3, 3.75, 6]],
  ['claude-sonnet-4', [3, 15, 0.3, 3.75, 6]],
  ['claude-haiku-4-5', [1, 5, 0.1, 1.25, 2]],
];

test("every Claude model is priced at Anthropic's published rates", () => {
  const one = (model: string, kind: Partial<UsageRecord>): number =>
    estimateCost(record(model, kind))!;
  // Rates are multiples of the input price, so they land a hair off; compare
  // them the way money is compared, not by bit pattern.
  const worth = (got: number, want: number): boolean => Math.abs(got - want) < 1e-9;
  for (const [model, [input, output, cacheRead, write5m, write1h]] of RATES_PER_MTOK) {
    assert.ok(worth(one(model, { inputTokens: 1e6 }), input), `${model} input`);
    assert.ok(worth(one(model, { outputTokens: 1e6 }), output), `${model} output`);
    assert.ok(worth(one(model, { cachedInputTokens: 1e6 }), cacheRead), `${model} cache read`);
    assert.ok(worth(one(model, { cacheWriteTokens: 1e6 }), write5m), `${model} 5m cache write`);
    assert.ok(
      worth(one(model, { cacheWriteTokens: 1e6, cacheWriteLongTokens: 1e6 }), write1h),
      `${model} 1h cache write`,
    );
  }
});

test('a dated snapshot prices as the generation it belongs to', () => {
  // Claude Code records the dated id for the models that still carry one.
  assert.ok(
    Math.abs(estimateCost(record('claude-haiku-4-5-20251001', { inputTokens: 1e6 }))! - 1) < 1e-9,
  );
  assert.ok(
    Math.abs(estimateCost(record('claude-opus-4-5-20251101', { inputTokens: 1e6 }))! - 5) < 1e-9,
  );
  // A routing variant is the same model too.
  assert.ok(
    Math.abs(estimateCost(record('claude-opus-5-5[1m]', { inputTokens: 1e6 }))! - 4) < 1e-9,
  );
});

test('a moving alias is not priced: what it resolves to depends on the account', () => {
  // `opus` is Opus 5.5 today on this account and Opus 5 on an older one, so
  // pricing the alias would mean guessing. Transcripts name the concrete model,
  // so a real turn is always priced; the alias only reaches here if something
  // hands us the shorthand, and an unknown price is the honest answer.
  assert.equal(estimateCost(record('opus', { inputTokens: 1e6 })), undefined);
  assert.equal(estimateCost(record('sonnet', { inputTokens: 1e6 })), undefined);
  assert.equal(estimateCost(record('haiku', { inputTokens: 1e6 })), undefined);
});

test('Haiku 5.5 costs five times more past a 100k prompt', () => {
  const cost = (promptTokens: number): number | undefined =>
    estimateCost(record('claude-haiku-5-5', { inputTokens: promptTokens }));
  // Every line of the rate is 5x above the threshold, and the whole prompt —
  // fresh, cached or written — is what counts against it.
  assert.equal(cost(99_999), (99_999 * 0.1) / 1e6);
  assert.equal(cost(100_000), (100_000 * 0.1) / 1e6);
  assert.equal(cost(100_001), (100_001 * 0.5) / 1e6);
  // Cache tokens count toward the prompt even when they carry no fresh input.
  assert.equal(
    estimateCost(record('claude-haiku-5-5', { cachedInputTokens: 100_001 })),
    (100_001 * 0.05) / 1e6,
  );
  // Output at the higher band too, not just input.
  assert.equal(
    estimateCost(record('claude-haiku-5-5', { inputTokens: 100_001, outputTokens: 1_000 })),
    (100_001 * 0.5 + 1_000 * 2.5) / 1e6,
  );
});

test('every priced model has an unbounded last band, however long the prompt', () => {
  // A model whose bands stop short of the top would silently fall out of the
  // table on a long conversation and report no cost at all.
  for (const [model] of RATES_PER_MTOK) {
    assert.notEqual(
      estimateCost(record(model, { inputTokens: 900_000_000 })),
      undefined,
      `${model} is still priced at a 900M-token prompt`,
    );
  }
});

test('a model outside the table is left unpriced rather than guessed', () => {
  assert.equal(estimateCost(record('claude-mystery-9', { inputTokens: 1e6 })), undefined);
  assert.equal(estimateCost(record('gpt-5.6-luna', { inputTokens: 1e6 })), undefined);
  // Only Claude Code is priced here; another agent's spend is its own.
  assert.equal(
    estimateCost({ ...record('claude-opus-5-5', { inputTokens: 1e6 }), agentId: 'codex' }),
    undefined,
  );
});

// --- Codex price table: pinned to OpenAI's published rates -------------------
// A transcription of developers.openai.com/api/docs/pricing read 2026-10-31,
// one million tokens of a single kind so the answer IS that kind's rate. Re-read
// the page and update these when a model is added or a price moves — do not
// adjust them to make a code change pass.
const codex = (model: string, tokens: Partial<UsageRecord>, serviceTier?: string): UsageRecord => ({
  ...record(model, tokens),
  agentId: 'codex',
  ...(serviceTier ? { serviceTier } : {}),
});

type OpenAiRow = [number, number, number];
const OPENAI_RATES: readonly (readonly [string, string, OpenAiRow, OpenAiRow | null])[] = [
  // model, tier, short [input, output, cached], long (>272K) [input, output, cached]
  ['gpt-6-astra', 'standard', [10, 50, 1], [20, 75, 2]],
  ['gpt-6-astra', 'flex', [5, 25, 0.5], [10, 37.5, 1]],
  ['gpt-6-astra', 'fast', [20, 100, 2], [40, 150, 4]],
  ['gpt-6-astra', 'ultrafast', [60, 300, 6], [120, 450, 12]],
  ['gpt-6.1-sol', 'standard', [2, 10, 0.1], [4, 15, 0.2]],
  ['gpt-6.1-sol', 'flex', [1, 5, 0.05], [2, 7.5, 0.1]],
  ['gpt-6.1-sol', 'fast', [4, 20, 0.2], [8, 30, 0.4]],
  ['gpt-6.1-sol', 'ultrafast', [12, 60, 0.6], [24, 90, 1.2]],
  ['gpt-6.1-terra', 'standard', [1, 5, 0.05], [2, 7.5, 0.1]],
  ['gpt-6.1-terra', 'flex', [0.5, 2.5, 0.025], [1, 3.75, 0.05]],
  ['gpt-6.1-terra', 'fast', [2, 10, 0.1], [4, 15, 0.2]],
  ['gpt-6-sol', 'standard', [2, 10, 0.2], [4, 15, 0.4]],
  ['gpt-6-sol', 'flex', [1, 5, 0.1], [2, 7.5, 0.2]],
  ['gpt-6-sol', 'fast', [4, 20, 0.4], [8, 30, 0.8]],
  ['gpt-6-luna', 'standard', [0.1, 0.5, 0.01], [0.2, 0.75, 0.02]],
  ['gpt-6-luna', 'flex', [0.05, 0.25, 0.005], [0.1, 0.375, 0.01]],
  ['gpt-6-luna', 'fast', [0.2, 1, 0.02], [0.4, 1.5, 0.04]],
  ['gpt-5.6-sol', 'standard', [4, 20, 0.4], [8, 30, 0.8]],
  ['gpt-5.6-sol', 'flex', [2, 10, 0.2], [4, 15, 0.4]],
  ['gpt-5.6-sol', 'fast', [8, 40, 0.8], [16, 60, 1.6]],
  ['gpt-5.6-terra', 'standard', [2, 12, 0.2], [4, 18, 0.4]],
  ['gpt-5.6-terra', 'flex', [1, 6, 0.1], [2, 9, 0.2]],
  ['gpt-5.6-terra', 'fast', [4, 24, 0.4], [8, 36, 0.8]],
  ['gpt-5.6-luna', 'standard', [0.2, 1.2, 0.02], [0.4, 1.8, 0.04]],
  ['gpt-5.6-luna', 'flex', [0.1, 0.6, 0.01], [0.2, 0.9, 0.02]],
  ['gpt-5.6-luna', 'fast', [0.4, 2.4, 0.04], [0.8, 3.6, 0.08]],
  ['gpt-5.3-codex', 'standard', [1.75, 14, 0.175], null],
  ['gpt-5.3-codex', 'fast', [3.5, 28, 0.35], null],
];

test("every Codex model is priced at OpenAI's published rates, per tier and context length", () => {
  const worth = (got: number | undefined, want: number): boolean =>
    got !== undefined && Math.abs(got - want) < 1e-9;
  // A short request is one million tokens of a kind (the rate); a long one is
  // that kind past the 272K line, read per million the same way.
  const long = 400_000;
  for (const [model, tier, [input, output, cached], longRow] of OPENAI_RATES) {
    const at = (tokens: Partial<UsageRecord>) => estimateCost(codex(model, tokens, tier));
    const label = `${model} ${tier}`;
    assert.ok(worth(at({ inputTokens: 200_000 }), input / 5), `${label} input`);
    assert.ok(worth(at({ cachedInputTokens: 200_000 }), cached / 5), `${label} cached input`);
    assert.ok(worth(at({ outputTokens: 1e6 }), output), `${label} output`);
    if (longRow) {
      const [li, lo, lc] = longRow;
      assert.ok(worth(at({ inputTokens: long }), (long * li) / 1e6), `${label} long input`);
      assert.ok(
        worth(at({ cachedInputTokens: long }), (long * lc) / 1e6),
        `${label} long cached input`,
      );
      assert.ok(
        worth(at({ inputTokens: long, outputTokens: 1e6 }), (long * li) / 1e6 + lo),
        `${label} long output`,
      );
    } else {
      assert.equal(at({ inputTokens: long }), undefined, `${label}: no long-context price`);
    }
  }
});

test('Codex: reasoning is output, priced once; a cache write, an unknown id or tier is unpriced', () => {
  // `output_tokens` already holds the reasoning: adding it again would double it.
  assert.equal(
    estimateCost(codex('gpt-6-luna', { outputTokens: 1e6, reasoningTokens: 900_000 })),
    0.5,
  );
  // Written tokens carry no lifetime, and a 30-minute and a 12-hour write differ.
  assert.equal(estimateCost(codex('gpt-6-luna', { cacheWriteTokens: 10 })), undefined);
  assert.equal(estimateCost(codex('codex-auto-review', { inputTokens: 1e6 })), undefined);
  assert.equal(estimateCost(codex('gpt-6-luna-preview', { inputTokens: 1e6 })), undefined);
  assert.equal(estimateCost(codex('gpt-6-luna', { inputTokens: 1e6 }, 'ultrafast')), undefined);
  assert.equal(openAiTier('priority'), 'fast');
  assert.equal(openAiTier(undefined), 'standard');
  assert.equal(openAiTier('default'), 'standard');
});

test('Codex: the service tier comes from the thread settings it ran with', () => {
  const state: CodexParseState = {};
  const settings = (tier?: string) =>
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'thread_settings_applied',
        thread_settings: { model: 'gpt-6-luna', ...(tier ? { service_tier: tier } : {}) },
      },
    });
  const tokens = (n: number) =>
    JSON.stringify({
      timestamp: '2026-10-30T10:00:00Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: n,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
          },
        },
      },
    });
  parseCodexLine(JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-luna' } }), state);
  parseCodexLine(settings('fast'), state);
  // Both under the 272K line: fast at $0.20, standard at $0.10 per million.
  const fast = parseCodexLine(tokens(100_000), state)!;
  assert.equal(fast.serviceTier, 'fast');
  assert.ok(Math.abs(estimateCost(fast)! - 0.02) < 1e-9);
  parseCodexLine(settings(), state);
  const standard = parseCodexLine(tokens(200_000), state)!;
  assert.equal(standard.serviceTier, undefined);
  assert.ok(Math.abs(estimateCost(standard)! - 0.02) < 1e-9);
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
    antigravity: join(root, 'antigravity'),
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
    antigravity: join(root, 'antigravity'),
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
