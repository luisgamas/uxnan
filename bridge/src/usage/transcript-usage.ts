/**
 * What each agent CLI spent, read from the records it keeps on disk itself.
 *
 * Every CLI the bridge drives writes a transcript of every session — the ones
 * the bridge runs and the ones a person runs in a terminal alike — and each
 * model response in it carries the tokens it used. Counting those is the only
 * way to know what an agent really spent on this machine: the bridge's own
 * turn ledger sees only the turns it ran.
 *
 * One pure parser per format. Each takes one line (or one row) and yields at
 * most one {@link UsageRecord}; a line that is not a model response yields
 * nothing. They never throw: a line that does not parse is skipped.
 *
 * | Agent | Where | A response |
 * |---|---|---|
 * | Claude Code | `$CLAUDE_CONFIG_DIR|~/.claude/projects/<project>/<session>.jsonl` | `type:"assistant"` with `message.usage` (one line per content block, each repeating the whole usage: kept once per `message.id` + `requestId`) |
 * | Codex | `$CODEX_HOME|~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `event_msg` `token_count` `info.last_token_usage` (the model from the latest `turn_context`) |
 * | pi | `$PI_CODING_AGENT_DIR|~/.pi/agent/sessions/<cwd>/<session>.jsonl` | `type:"message"` assistant with `message.usage` and its `cost.total` |
 * | Grok | `$GROK_HOME|~/.grok/sessions/<cwd>/<session>/updates.jsonl` | `turn_completed` `usage.modelUsage` per model, `costUsdTicks` (1 USD = 1e10) |
 * | OpenCode 2 | `$XDG_DATA_HOME|~/.local/share/opencode/opencode.db` (SQLite `message.data`) | an assistant message with `tokens` and `cost` |
 * | Zero | `$XDG_DATA_HOME|~/.local/share/zero/sessions/<session>/events.jsonl` | a `provider_usage` event (the model from the session's `metadata.json`) |
 *
 * Antigravity is the one wired agent missing: its transcript
 * (`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`)
 * records no token counts at all.
 *
 * Verified against the CLIs on the maintainer's machine (Claude Code 2.1.283,
 * Codex 0.13x, pi 0.85, Grok 4.7, OpenCode 2.0.16, Zero), 2026-09-27.
 */

/** One model response's spend, as its transcript states it. */
export interface UsageRecord {
  /** Wire agent id (`claude-code`, `codex`, `pi-agent`, `grok`, `opencode`). */
  agentId: string;
  model: string;
  /** Epoch ms of the response. */
  at: number;
  /** Input tokens not read from the cache. */
  inputTokens: number;
  /** Input tokens read from the cache. */
  cachedInputTokens: number;
  /** Input tokens written to the cache. */
  cacheWriteTokens: number;
  /** Of which written for an hour (Claude's longer-lived cache, priced higher). */
  cacheWriteLongTokens?: number;
  /** Output tokens, reasoning included. */
  outputTokens: number;
  /** The reasoning part of {@link outputTokens}, when the CLI says. */
  reasoningTokens: number;
  /** What the provider billed, when the CLI records it. */
  costUsd?: number;
  /** Identity for de-duplication when a record can appear twice. */
  dedupeKey?: string;
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A billed amount the CLI recorded — zero included (a free model costs $0). */
function billed(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function time(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds or milliseconds since the epoch.
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function parse(line: string): Json | undefined {
  try {
    return record(JSON.parse(line));
  } catch {
    return undefined;
  }
}

/** A Claude Code transcript line → its response's usage. */
export function parseClaudeLine(line: string): UsageRecord | undefined {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return undefined;
  const row = parse(line);
  if (!row || row['type'] !== 'assistant') return undefined;
  const message = record(row['message']);
  const usage = record(message?.['usage']);
  const at = time(row['timestamp']);
  if (!message || !usage || at === undefined) return undefined;
  const model = str(message['model']);
  // `<synthetic>` marks a message Claude Code wrote itself (no model ran).
  if (!model || model.startsWith('<')) return undefined;
  const creation = record(usage['cache_creation']);
  const cacheWrite = num(usage['cache_creation_input_tokens']);
  const details = record(usage['output_tokens_details']);
  const id = str(message['id']);
  return {
    agentId: 'claude-code',
    model,
    at,
    inputTokens: num(usage['input_tokens']),
    cachedInputTokens: num(usage['cache_read_input_tokens']),
    cacheWriteTokens: cacheWrite,
    ...(creation ? { cacheWriteLongTokens: num(creation['ephemeral_1h_input_tokens']) } : {}),
    outputTokens: num(usage['output_tokens']),
    reasoningTokens: num(details?.['thinking_tokens']),
    ...(id ? { dedupeKey: `${id}:${str(row['requestId']) ?? ''}` } : {}),
  };
}

/** Codex's per-file state: the model its token events belong to. */
export interface CodexParseState {
  model?: string;
  /** The last usage seen, to skip a repeated event. */
  last?: string;
}

/** A Codex rollout line → a response's usage, tracking the model in [state]. */
export function parseCodexLine(line: string, state: CodexParseState): UsageRecord | undefined {
  if (line.includes('"turn_context"')) {
    const row = parse(line);
    const payload = record(row?.['payload']);
    if (row?.['type'] === 'turn_context') {
      const model = str(payload?.['model']);
      if (model) state.model = model;
    }
    return undefined;
  }
  if (!line.includes('"token_count"')) return undefined;
  const row = parse(line);
  const payload = record(row?.['payload']);
  if (row?.['type'] !== 'event_msg' || payload?.['type'] !== 'token_count') return undefined;
  const last = record(record(payload['info'])?.['last_token_usage']);
  const at = time(row['timestamp']);
  if (!last || at === undefined) return undefined;
  const fingerprint = JSON.stringify(last);
  // Codex repeats the same event when nothing new was spent.
  if (fingerprint === state.last) return undefined;
  state.last = fingerprint;
  const input = num(last['input_tokens']);
  const cached = num(last['cached_input_tokens']);
  const cacheWrite = num(last['cache_write_input_tokens']);
  return {
    agentId: 'codex',
    model: state.model ?? 'unknown',
    at,
    // Codex counts the cached part inside `input_tokens`.
    inputTokens: Math.max(0, input - cached - cacheWrite),
    cachedInputTokens: cached,
    cacheWriteTokens: cacheWrite,
    outputTokens: num(last['output_tokens']),
    reasoningTokens: num(last['reasoning_output_tokens']),
  };
}

/** A pi session line → a response's usage, with the cost pi computed. */
export function parsePiLine(line: string): UsageRecord | undefined {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return undefined;
  const row = parse(line);
  const message = record(row?.['message']);
  if (row?.['type'] !== 'message' || message?.['role'] !== 'assistant') return undefined;
  const usage = record(message['usage']);
  const at = time(message['timestamp']) ?? time(row['timestamp']);
  const model = str(message['model']);
  if (!usage || at === undefined || !model) return undefined;
  const provider = str(message['provider']);
  const cost = billed(record(usage['cost'])?.['total']);
  const record_: UsageRecord = {
    agentId: 'pi-agent',
    model: provider ? `${provider}/${model}` : model,
    at,
    inputTokens: num(usage['input']),
    cachedInputTokens: num(usage['cacheRead']),
    cacheWriteTokens: num(usage['cacheWrite']),
    outputTokens: num(usage['output']),
    reasoningTokens: 0,
    ...(cost !== undefined ? { costUsd: cost } : {}),
  };
  return spent(record_) ? record_ : undefined;
}

/** A Grok `updates.jsonl` line → one record per model the turn used. */
export function parseGrokLine(line: string): UsageRecord[] {
  if (!line.includes('turn_completed')) return [];
  const row = parse(line);
  const update = record(record(row?.['params'])?.['update']);
  if (update?.['sessionUpdate'] !== 'turn_completed') return [];
  const usage = record(update['usage']);
  const at = time(row?.['timestamp']);
  if (!usage || at === undefined) return [];
  const byModel = record(usage['modelUsage']) ?? {};
  const models = Object.entries(byModel)
    .map(([model, raw]) => [model, record(raw)] as const)
    .filter((entry): entry is readonly [string, Json] => entry[1] !== undefined);
  const ticks = billed(usage['costUsdTicks']);
  const turnCost = (ticks ?? 0) / 1e10;
  const tokensOf = (u: Json) => num(u['inputTokens']) + num(u['outputTokens']);
  const allTokens = models.reduce((sum, [, u]) => sum + tokensOf(u), 0);
  const build = (model: string, u: Json, cost: number | undefined): UsageRecord => {
    const input = num(u['inputTokens']);
    const cached = num(u['cachedReadTokens']);
    return {
      agentId: 'grok',
      model,
      at,
      // Grok counts the cached part inside `inputTokens`.
      inputTokens: Math.max(0, input - cached),
      cachedInputTokens: cached,
      cacheWriteTokens: num(u['cacheCreationTokens']),
      outputTokens: num(u['outputTokens']),
      reasoningTokens: num(u['reasoningTokens']),
      ...(cost !== undefined ? { costUsd: cost } : {}),
    };
  };
  if (models.length === 0) {
    return [build('grok', usage, ticks === undefined ? undefined : turnCost)].filter(spent);
  }
  return models
    .map(([model, u]) => {
      const own = billed(u['costUsdTicks']);
      // A cost reported only for the turn is shared by each model's tokens.
      const cost =
        own !== undefined
          ? own / 1e10
          : ticks === undefined
            ? undefined
            : allTokens > 0
              ? (turnCost * tokensOf(u)) / allTokens
              : 0;
      return build(model, u, cost);
    })
    .filter(spent);
}

/** An OpenCode `message.data` row → a response's usage, with its cost. */
export function parseOpenCodeMessage(data: string): UsageRecord | undefined {
  const row = parse(data);
  if (row?.['role'] !== 'assistant') return undefined;
  const tokens = record(row['tokens']);
  const cache = record(tokens?.['cache']);
  const at = time(record(row['time'])?.['created']);
  const model = str(row['modelID']);
  if (!tokens || at === undefined || !model) return undefined;
  const provider = str(row['providerID']);
  const cost = billed(row['cost']);
  const record_: UsageRecord = {
    agentId: 'opencode',
    model: provider ? `${provider}/${model}` : model,
    at,
    inputTokens: num(tokens['input']),
    cachedInputTokens: num(cache?.['read']),
    cacheWriteTokens: num(cache?.['write']),
    outputTokens: num(tokens['output']) + num(tokens['reasoning']),
    reasoningTokens: num(tokens['reasoning']),
    ...(cost !== undefined ? { costUsd: cost } : {}),
  };
  return spent(record_) ? record_ : undefined;
}

/**
 * A Zero `events.jsonl` line → a response's usage. Zero records no model per
 * event: [model] is the session's (`metadata.json` `modelId`). It records no
 * cache split and no cost either.
 */
export function parseZeroLine(line: string, model: string): UsageRecord | undefined {
  if (!line.includes('"provider_usage"')) return undefined;
  const row = parse(line);
  if (row?.['type'] !== 'provider_usage') return undefined;
  const payload = record(row['payload']);
  const at = time(row['createdAt']);
  if (!payload || at === undefined) return undefined;
  const record_: UsageRecord = {
    agentId: 'zero',
    model,
    at,
    inputTokens: num(payload['promptTokens']),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: num(payload['completionTokens']),
    reasoningTokens: num(payload['reasoningTokens']),
  };
  return spent(record_) ? record_ : undefined;
}

/** A response that spent nothing (a failed call) is not usage. */
function spent(r: UsageRecord): boolean {
  return r.inputTokens + r.cachedInputTokens + r.cacheWriteTokens + r.outputTokens > 0;
}
