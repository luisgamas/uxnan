/**
 * Antigravity's spend, from the conversation stores `agy` keeps itself.
 *
 * Every conversation — one the bridge drives over `--input-format stream-json`
 * and one a person runs in a terminal alike — is a SQLite database at
 * `~/.gemini/antigravity-cli/conversations/<conversation id>.db`. Its
 * `gen_metadata` table holds one row per model call, a protobuf message whose
 * usage block carries the same numbers the driven surface reports on that
 * call's `agent_response` `step_update` (verified on agy 1.4.12: a turn that
 * streamed `input_tokens 10069, output_tokens 33, thinking_tokens 32,
 * cache_read_tokens 0` stored exactly those in its row). The `steps` table
 * repeats each call's usage on its `agent_response` step, with the time it
 * finished — that is where the timestamp comes from.
 *
 * The messages are read field by field (wire format only, no schema), so an
 * unknown field is skipped and a malformed row is dropped, never guessed at:
 *
 * - `gen_metadata.data` → field 1 (the generation) → field 4 (usage), field 19
 *   (the model's id, e.g. `gemini-3.8-flash`), field 21 (its display name),
 *   field 17 (attempts: each `{2: usage}`, the last of them the call itself).
 * - usage → 1 model number, 2 input not read from the cache, 3 output (thinking
 *   included), 4 cache writes, 5 cache reads, 9 thinking, 11 the response id.
 * - `steps.metadata` → field 9 (usage, the same block), field 8 (finished at)
 *   and field 1 (created at), each `{1: seconds, 2: nanos}`.
 * - `trajectory_metadata_blob.data` → field 2: when the conversation started,
 *   the fallback time for a call whose step carries none.
 *
 * Antigravity bills against its plan quota, not per token, and Uxnan knows no
 * per-token price for it: its spend is tokens, shown as unpriced.
 */
import type { UsageRecord } from './transcript-usage.js';

/** A message's fields by number: varints as numbers, everything else as bytes. */
type Fields = Map<number, (number | Uint8Array)[]>;

/** Decodes one protobuf message's top level. Throws on a malformed message. */
export function protoFields(bytes: Uint8Array): Fields {
  let offset = 0;
  const out: Fields = new Map();
  const varint = (): number => {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new Error('truncated varint');
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 128;
    }
    throw new Error('varint too long');
  };
  while (offset < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 0) throw new Error('field 0');
    let value: number | Uint8Array;
    if (wire === 0) {
      value = varint();
    } else if (wire === 1 || wire === 2 || wire === 5) {
      const length = wire === 2 ? varint() : wire === 1 ? 8 : 4;
      if (length > bytes.length - offset) throw new Error('truncated field');
      value = bytes.subarray(offset, offset + length);
      offset += length;
      if (wire !== 2) continue;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
    const list = out.get(field) ?? [];
    list.push(value);
    out.set(field, list);
  }
  return out;
}

function int(fields: Fields, field: number): number {
  const value = fields.get(field)?.[0];
  return typeof value === 'number' ? value : 0;
}

function bytesOf(fields: Fields, field: number): Uint8Array | undefined {
  const value = fields.get(field)?.[0];
  return value instanceof Uint8Array ? value : undefined;
}

function nested(fields: Fields, field: number): Fields {
  const bytes = bytesOf(fields, field);
  return bytes ? protoFields(bytes) : new Map();
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function text(fields: Fields, field: number): string {
  const bytes = bytesOf(fields, field);
  if (!bytes) return '';
  try {
    return utf8.decode(bytes).trim();
  } catch {
    return '';
  }
}

/** A `{1: seconds, 2: nanos}` timestamp in epoch ms, or undefined. */
function time(fields: Fields): number | undefined {
  const seconds = int(fields, 1);
  return seconds > 0 ? seconds * 1000 + Math.floor(int(fields, 2) / 1e6) : undefined;
}

/** The raw rows of one conversation database. */
export interface AntigravityRows {
  /** `gen_metadata.data`, one per model call. */
  generations: Uint8Array[];
  /** `steps.metadata` (rows without one left out). */
  steps: Uint8Array[];
  /** `trajectory_metadata_blob.data`. */
  trajectory: Uint8Array[];
}

interface Usage {
  id: string;
  model: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  thinking: number;
}

function usageOf(bytes: Uint8Array): Usage | undefined {
  const u = protoFields(bytes);
  const usage: Usage = {
    id: text(u, 11),
    model: int(u, 1),
    input: int(u, 2),
    output: int(u, 3),
    cacheWrite: int(u, 4),
    cacheRead: int(u, 5),
    thinking: int(u, 9),
  };
  return usage.input + usage.output + usage.cacheWrite + usage.cacheRead > 0 ? usage : undefined;
}

/**
 * One record per model call of a conversation. A failed attempt that a call
 * retried (another usage under the call's attempts, with its own response id)
 * spent tokens too and counts on its own; the attempt that is the call itself
 * repeats the call's usage and counts once. [fallbackAt] (the file's time) is
 * used when neither the call's step nor the conversation says when.
 */
export function antigravityRecords(rows: AntigravityRows, fallbackAt: number): UsageRecord[] {
  const finishedAt = new Map<string, number>();
  for (const raw of rows.steps) {
    let step: Fields;
    try {
      step = protoFields(raw);
    } catch {
      continue;
    }
    const usage = bytesOf(step, 9);
    if (!usage) continue;
    try {
      const id = text(protoFields(usage), 11);
      const at = time(nested(step, 8)) ?? time(nested(step, 1));
      if (id && at !== undefined) finishedAt.set(id, at);
    } catch {
      continue;
    }
  }
  let startedAt: number | undefined;
  for (const raw of rows.trajectory) {
    try {
      startedAt ??= time(nested(protoFields(raw), 2));
    } catch {
      continue;
    }
  }

  const out: UsageRecord[] = [];
  const seen = new Set<string>();
  for (const raw of rows.generations) {
    let generation: Fields;
    try {
      generation = nested(protoFields(raw), 1);
    } catch {
      continue;
    }
    const model =
      text(generation, 19) ||
      text(generation, 21) ||
      (int(generation, 3) > 0 ? `antigravity-model-${int(generation, 3)}` : 'unknown');
    const usages: Usage[] = [];
    try {
      const main = bytesOf(generation, 4);
      const call = main ? usageOf(main) : undefined;
      if (call) usages.push(call);
      for (const attempt of generation.get(17) ?? []) {
        if (!(attempt instanceof Uint8Array)) continue;
        const bytes = bytesOf(protoFields(attempt), 2);
        const tried = bytes ? usageOf(bytes) : undefined;
        if (tried && tried.id !== call?.id) usages.push(tried);
      }
    } catch {
      continue;
    }
    for (const usage of usages) {
      const key = usage.id || `${model}:${out.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        agentId: 'antigravity-cli',
        model,
        at: (usage.id ? finishedAt.get(usage.id) : undefined) ?? startedAt ?? fallbackAt,
        inputTokens: usage.input,
        cachedInputTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        outputTokens: Math.max(usage.output, usage.thinking),
        reasoningTokens: Math.min(usage.thinking, Math.max(usage.output, usage.thinking)),
      });
    }
  }
  return out;
}

/** A conversation database's rows, opened read-only (`node:sqlite`). */
export async function readAntigravityDb(path: string): Promise<AntigravityRows> {
  const { DatabaseSync } = (await import('node:sqlite')) as typeof import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(
      (
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
          name: string;
        }[]
      ).map((row) => row.name),
    );
    const blobs = (sql: string, table: string): Uint8Array[] =>
      tables.has(table)
        ? (db.prepare(sql).all() as { data: unknown }[])
            .map((row) => row.data)
            .filter((data): data is Uint8Array => data instanceof Uint8Array)
        : [];
    return {
      generations: blobs('SELECT data FROM gen_metadata ORDER BY idx', 'gen_metadata'),
      steps: blobs(
        'SELECT metadata AS data FROM steps WHERE metadata IS NOT NULL ORDER BY idx',
        'steps',
      ),
      trajectory: blobs('SELECT data FROM trajectory_metadata_blob', 'trajectory_metadata_blob'),
    };
  } finally {
    db.close();
  }
}
