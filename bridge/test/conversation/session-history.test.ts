import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { SessionHistoryReader } from '../../src/index.js';

/** Build a throwaway fake-home tree and return its path + a cleanup fn. */
async function fakeHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = join(tmpdir(), `uxnan-hist-${randomUUID()}`);
  await mkdir(home, { recursive: true });
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

async function writeLines(file: string, objs: unknown[]): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, objs.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf-8');
}

async function writeJson(file: string, obj: unknown): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(obj), 'utf-8');
}

test('claude: parses user/assistant turns, keeps thinking, skips tool_result echo', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-claude-1';
    await writeLines(join(home, '.claude', 'projects', 'C--proj', `${sid}.jsonl`), [
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hi claude' }] },
        timestamp: '2026-06-15T00:00:01Z',
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'pondering' },
            { type: 'text', text: 'hello there' },
          ],
        },
        timestamp: '2026-06-15T00:00:02Z',
      },
      // tool_result echo (role user, no plain text) — must be skipped.
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'x', content: 'out' }],
        },
        timestamp: '2026-06-15T00:00:03Z',
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'claude-code', agentSessionId: sid }, 'th-1');
    assert.ok(turns);
    assert.equal(turns!.length, 1);
    const t = turns![0]!;
    assert.equal(t.threadId, 'th-1');
    assert.equal(t.status, 'completed');
    assert.equal(t.messages.length, 2);
    assert.equal(t.messages[0]!.role, 'user');
    assert.equal(t.messages[0]!.content, 'hi claude');
    assert.equal(t.messages[1]!.role, 'assistant');
    assert.equal(t.messages[1]!.content, 'hello there');
    assert.equal(t.messages[1]!.thinking, 'pondering');
  } finally {
    await cleanup();
  }
});

test('codex: parses message items, skips developer/system priming', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-codex-1';
    const file = join(
      home,
      '.codex',
      'sessions',
      '2026',
      '06',
      '15',
      `rollout-2026-06-15T00-00-00-${sid}.jsonl`,
    );
    await writeLines(file, [
      { type: 'session_meta', payload: { id: sid, cwd: 'C:/x' } },
      {
        type: 'response_item',
        timestamp: '2026-06-15T00:00:00Z',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'system priming' }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-15T00:00:01Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi codex' }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-15T00:00:02Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hello from codex' }],
        },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'codex', agentSessionId: sid }, 'th-2');
    assert.ok(turns);
    assert.equal(turns!.length, 1);
    assert.equal(turns![0]!.messages.length, 2);
    assert.equal(turns![0]!.messages[0]!.content, 'hi codex');
    assert.equal(turns![0]!.messages[1]!.content, 'hello from codex');
  } finally {
    await cleanup();
  }
});

test('opencode: reads JSON message+part store, ordered by created time', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'ses_oc1';
    const storage = join(home, '.local', 'share', 'opencode', 'storage');
    await writeJson(join(storage, 'message', sid, 'msg2.json'), {
      id: 'msg2',
      sessionID: sid,
      role: 'assistant',
      time: { created: 200 },
    });
    await writeJson(join(storage, 'message', sid, 'msg1.json'), {
      id: 'msg1',
      sessionID: sid,
      role: 'user',
      time: { created: 100 },
    });
    await writeJson(join(storage, 'part', 'msg1', 'prt1.json'), {
      id: 'prt1',
      type: 'text',
      text: 'hi oc',
    });
    await writeJson(join(storage, 'part', 'msg2', 'prt2.json'), {
      id: 'prt2',
      type: 'text',
      text: 'oc reply',
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'opencode', agentSessionId: sid }, 'th-3');
    assert.ok(turns);
    assert.equal(turns!.length, 1);
    assert.equal(turns![0]!.messages[0]!.content, 'hi oc');
    assert.equal(turns![0]!.messages[1]!.content, 'oc reply');
  } finally {
    await cleanup();
  }
});

test('pi: parses message lines under encoded-cwd dir', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-pi-1';
    const file = join(
      home,
      '.pi',
      'agent',
      'sessions',
      '--C--proj--',
      `2026-06-15T00-00-00-000Z_${sid}.jsonl`,
    );
    await writeLines(file, [
      { type: 'session', id: sid, cwd: 'C:/proj' },
      {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: 'hola pi' }] },
        timestamp: '2026-06-15T00:00:01Z',
      },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hola humano' }] },
        timestamp: '2026-06-15T00:00:02Z',
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'pi-agent', agentSessionId: sid }, 'th-4');
    assert.ok(turns);
    assert.equal(turns!.length, 1);
    assert.equal(turns![0]!.messages[0]!.content, 'hola pi');
    assert.equal(turns![0]!.messages[1]!.content, 'hola humano');
  } finally {
    await cleanup();
  }
});

test('multi-turn grouping: each user message opens a new turn', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-claude-multi';
    await writeLines(join(home, '.claude', 'projects', 'p', `${sid}.jsonl`), [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'q1' }] } },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'q2' }] } },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'claude-code', agentSessionId: sid }, 'th-5');
    assert.equal(turns!.length, 2);
    assert.equal(turns![0]!.messages.map((m) => m.content).join('|'), 'q1|a1');
    assert.equal(turns![1]!.messages.map((m) => m.content).join('|'), 'q2|a2');
    // Message ids are unique across the whole list.
    const ids = turns!.flatMap((t) => t.messages.map((m) => m.id));
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    await cleanup();
  }
});

test('returns null for unknown agent, missing session id, or absent file', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const reader = new SessionHistoryReader({ homeDir: home });
    // Aider is the only wired agent without an on-disk history reader yet.
    assert.equal(await reader.readTurns({ agentId: 'aider', agentSessionId: 'x' }, 't'), null);
    assert.equal(await reader.readTurns({ agentId: 'claude-code' }, 't'), null);
    assert.equal(await reader.readTurns({ agentSessionId: 'x' }, 't'), null);
    assert.equal(
      await reader.readTurns({ agentId: 'claude-code', agentSessionId: 'nope' }, 't'),
      null,
    );
    // Gemini with a valid-looking id but no on-disk file → null (not "unknown agent").
    assert.equal(
      await reader.readTurns(
        { agentId: 'gemini-cli', agentSessionId: '00000000-0000-4000-8000-000000000000' },
        't',
      ),
      null,
    );
    // Gemini with a non-UUID session id → shortId derivation rejects it → null.
    assert.equal(
      await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: 'not-a-uuid' }, 't'),
      null,
    );
  } finally {
    await cleanup();
  }
});

test('tolerates malformed JSONL lines (partial final line)', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-claude-bad';
    const file = join(home, '.claude', 'projects', 'p', `${sid}.jsonl`);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(
      file,
      [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: 'ok' }] },
        }),
        '{ this is not valid json',
      ].join('\n'),
      'utf-8',
    );
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'claude-code', agentSessionId: sid }, 't');
    assert.ok(turns);
    assert.equal(turns!.length, 1);
    assert.equal(turns![0]!.messages[0]!.content, 'ok');
  } finally {
    await cleanup();
  }
});

test('path cache: resolved path is reused within the TTL, re-scanned after it', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-claude-cache';
    const fileA = join(home, '.claude', 'projects', 'proj-a', `${sid}.jsonl`);
    await writeLines(fileA, [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'A' }] } },
    ]);
    let clock = 1000;
    const reader = new SessionHistoryReader({
      homeDir: home,
      now: () => clock,
      cacheTtlMs: 60_000,
    });

    const first = await reader.readTurns({ agentId: 'claude-code', agentSessionId: sid }, 't');
    assert.equal(first![0]!.messages[0]!.content, 'A');

    // Move the log to a different project dir; the cached path (proj-a) is now gone.
    await rm(fileA, { force: true });
    const fileB = join(home, '.claude', 'projects', 'proj-b', `${sid}.jsonl`);
    await writeLines(fileB, [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'B' }] } },
    ]);

    // Within the TTL: still resolves the cached (deleted) path → no turns → null.
    assert.equal(
      await reader.readTurns({ agentId: 'claude-code', agentSessionId: sid }, 't'),
      null,
    );

    // After the TTL: re-scans and finds the new location.
    clock += 120_000;
    const after = await reader.readTurns({ agentId: 'claude-code', agentSessionId: sid }, 't');
    assert.equal(after![0]!.messages[0]!.content, 'B');
  } finally {
    await cleanup();
  }
});

// --- Gemini CLI ----------------------------------------------------------------

/** Write a single Gemini session JSON file under `~/.gemini/tmp/<hash>/chats/`. */
async function writeGeminiFile(
  home: string,
  hash: string,
  fileName: string,
  body: Record<string, unknown>,
): Promise<string> {
  const file = join(home, '.gemini', 'tmp', hash, 'chats', fileName);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(body), 'utf-8');
  return file;
}

test('gemini: parses user/gemini turns, skips info/error, derives shortId from UUID', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = '94565f0d-8a60-4df7-976d-f6ea5e5cf98c';
    const shortId = sid.replace(/-/g, '').slice(0, 8); // '94565f0d'
    await writeGeminiFile(home, 'hash-A', `session-2026-01-29T04-39-${shortId}.json`, {
      sessionId: sid,
      projectHash: 'hash-A',
      startTime: '2026-01-29T04:39:40.652Z',
      lastUpdated: '2026-01-29T04:39:40.652Z',
      messages: [
        // info entries are skipped — they are system meta, not a conversation turn.
        {
          id: 'i1',
          timestamp: '2026-01-29T04:39:40.652Z',
          type: 'info',
          content: 'Update successful',
        },
        { id: 'u1', timestamp: '2026-01-29T04:39:50.000Z', type: 'user', content: 'hola gemini' },
        { id: 'g1', timestamp: '2026-01-29T04:39:55.000Z', type: 'gemini', content: 'buenos dias' },
        // error entries are skipped too (not a real assistant turn).
        { id: 'e1', timestamp: '2026-01-29T04:40:00.000Z', type: 'error', content: 'boom' },
      ],
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 'th-g');
    assert.ok(turns);
    assert.equal(turns!.length, 1);
    const t = turns![0]!;
    assert.equal(t.threadId, 'th-g');
    assert.equal(t.status, 'completed');
    // 2 messages: user + assistant (info/error filtered out).
    assert.equal(t.messages.length, 2);
    assert.equal(t.messages[0]!.role, 'user');
    assert.equal(t.messages[0]!.content, 'hola gemini');
    assert.equal(t.messages[1]!.role, 'assistant');
    assert.equal(t.messages[1]!.content, 'buenos dias');
  } finally {
    await cleanup();
  }
});

test('gemini: joins thoughts[].description into the assistant message thinking', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const shortId = sid.replace(/-/g, '').slice(0, 8); // 'aaaaaaaa'
    await writeGeminiFile(home, 'hash-T', `session-2026-02-01T10-00-${shortId}.json`, {
      sessionId: sid,
      projectHash: 'hash-T',
      startTime: '2026-02-01T10:00:00.000Z',
      lastUpdated: '2026-02-01T10:00:30.000Z',
      messages: [
        { id: 'u1', timestamp: '2026-02-01T10:00:00.000Z', type: 'user', content: 'think please' },
        {
          id: 'g1',
          timestamp: '2026-02-01T10:00:15.000Z',
          type: 'gemini',
          content: 'here you go',
          thoughts: [
            { subject: 'Step 1', description: 'first I reason', timestamp: '2026-02-01T10:00:05Z' },
            { subject: 'Step 2', description: 'then I answer', timestamp: '2026-02-01T10:00:10Z' },
          ],
        },
      ],
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 'th-T');
    assert.equal(turns!.length, 1);
    const assistant = turns![0]!.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant?.thinking, 'first I reason\n\nthen I answer');
    assert.equal(assistant?.content, 'here you go');
  } finally {
    await cleanup();
  }
});

test('gemini: handles content as an array of {text} parts (multi-part prompts)', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = '11111111-2222-4333-8444-555555555555';
    const shortId = sid.replace(/-/g, '').slice(0, 8); // '11111111'
    await writeGeminiFile(home, 'hash-M', `session-2026-02-01T11-00-${shortId}.json`, {
      sessionId: sid,
      projectHash: 'hash-M',
      startTime: '2026-02-01T11:00:00.000Z',
      lastUpdated: '2026-02-01T11:00:10.000Z',
      messages: [
        // User prompt can bundle text + referenced files as parts.
        {
          id: 'u1',
          timestamp: '2026-02-01T11:00:00.000Z',
          type: 'user',
          content: [{ text: 'Question one' }, { text: '\n--- file ---\nfoo()' }],
        },
        { id: 'g1', timestamp: '2026-02-01T11:00:05.000Z', type: 'gemini', content: 'Answer' },
      ],
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 'th-M');
    assert.equal(turns!.length, 1);
    assert.equal(turns![0]!.messages[0]!.content, 'Question one\n--- file ---\nfoo()');
  } finally {
    await cleanup();
  }
});

test('gemini: merges multiple snapshots for the same sessionId, deduplicating by message id', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'cafef00d-1234-4567-89ab-cdef01234567';
    const shortId = sid.replace(/-/g, '').slice(0, 8); // 'cafef00d'
    // Snapshot 1: 2 messages (turn 1).
    await writeGeminiFile(home, 'hash-S', `session-2026-03-01T09-00-${shortId}.json`, {
      sessionId: sid,
      projectHash: 'hash-S',
      startTime: '2026-03-01T09:00:00.000Z',
      lastUpdated: '2026-03-01T09:00:30.000Z',
      messages: [
        { id: 'm1', timestamp: '2026-03-01T09:00:00.000Z', type: 'user', content: 'q1' },
        { id: 'm2', timestamp: '2026-03-01T09:00:10.000Z', type: 'gemini', content: 'a1' },
      ],
    });
    // Snapshot 2: same session id, NEW messages (m1/m2 re-emitted with same ids).
    // The Gemini CLI re-snapshots on each turn; this is what we see in practice.
    await writeGeminiFile(home, 'hash-S', `session-2026-03-01T09-30-${shortId}.json`, {
      sessionId: sid,
      projectHash: 'hash-S',
      startTime: '2026-03-01T09:00:00.000Z',
      lastUpdated: '2026-03-01T09:30:30.000Z',
      messages: [
        { id: 'm1', timestamp: '2026-03-01T09:00:00.000Z', type: 'user', content: 'q1' },
        { id: 'm2', timestamp: '2026-03-01T09:00:10.000Z', type: 'gemini', content: 'a1' },
        { id: 'm3', timestamp: '2026-03-01T09:30:00.000Z', type: 'user', content: 'q2' },
        { id: 'm4', timestamp: '2026-03-01T09:30:20.000Z', type: 'gemini', content: 'a2' },
      ],
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 'th-S');
    assert.equal(turns!.length, 2);
    assert.equal(turns![0]!.messages.map((m) => m.content).join('|'), 'q1|a1');
    assert.equal(turns![1]!.messages.map((m) => m.content).join('|'), 'q2|a2');
    // ids are unique across the whole list (no m1/m2 duplication from snapshot 2).
    const ids = turns!.flatMap((t) => t.messages.map((m) => m.id));
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    await cleanup();
  }
});

test('gemini: skips a file whose top-level sessionId does not match (shortId collision)', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'deadbeef-aaaa-4bbb-8ccc-dddddddddddd';
    const shortId = sid.replace(/-/g, '').slice(0, 8); // 'deadbeef'
    // Same shortId suffix, different FULL sessionId (collision).
    await writeGeminiFile(home, 'hash-X', `session-2026-03-02T10-00-${shortId}.json`, {
      sessionId: 'ffff0000-1111-4222-8333-444444444444',
      projectHash: 'hash-X',
      startTime: '2026-03-02T10:00:00.000Z',
      lastUpdated: '2026-03-02T10:00:10.000Z',
      messages: [
        { id: 'x1', timestamp: '2026-03-02T10:00:00.000Z', type: 'user', content: 'unrelated' },
      ],
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    // Our sessionId has no matching file → null.
    assert.equal(
      await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 'th-X'),
      null,
    );
  } finally {
    await cleanup();
  }
});

test('gemini: scans every hash/chats dir and picks the right one', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'feedface-0000-4111-8222-333333333333';
    const shortId = sid.replace(/-/g, '').slice(0, 8); // 'feedface'
    // Three project hashes, the session file is in the second one.
    await writeGeminiFile(home, 'hash-1', `session-2026-04-01T08-00-${shortId}.json`, {
      sessionId: '00000000-1111-4222-8333-444444444444',
      messages: [{ id: 'a', type: 'user', timestamp: '2026-04-01T08:00:00Z', content: 'other' }],
    });
    await writeGeminiFile(home, 'hash-2', `session-2026-04-01T08-30-${shortId}.json`, {
      sessionId: sid,
      projectHash: 'hash-2',
      startTime: '2026-04-01T08:30:00.000Z',
      lastUpdated: '2026-04-01T08:30:30.000Z',
      messages: [
        { id: 'b', timestamp: '2026-04-01T08:30:00.000Z', type: 'user', content: 'mine' },
        { id: 'c', timestamp: '2026-04-01T08:30:10.000Z', type: 'gemini', content: 'reply' },
      ],
    });
    await writeGeminiFile(home, 'hash-3', `session-2026-04-01T09-00-${shortId}.json`, {
      sessionId: '99999999-1111-4222-8333-444444444444',
      messages: [
        { id: 'd', type: 'user', timestamp: '2026-04-01T09:00:00Z', content: 'also other' },
      ],
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 'th-W');
    assert.equal(turns!.length, 1);
    assert.equal(turns![0]!.messages[0]!.content, 'mine');
    assert.equal(turns![0]!.messages[1]!.content, 'reply');
  } finally {
    await cleanup();
  }
});

test('gemini: multi-file path cache: TTL re-scan picks up new snapshot files', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = '12345678-aaaa-4bbb-8ccc-dddddddddddd';
    const shortId = sid.replace(/-/g, '').slice(0, 8); // '12345678'
    await writeGeminiFile(home, 'hash-C', `session-2026-05-01T12-00-${shortId}.json`, {
      sessionId: sid,
      projectHash: 'hash-C',
      startTime: '2026-05-01T12:00:00.000Z',
      lastUpdated: '2026-05-01T12:00:10.000Z',
      messages: [{ id: 'a', type: 'user', timestamp: '2026-05-01T12:00:00Z', content: 'first' }],
    });
    let clock = 1000;
    const reader = new SessionHistoryReader({
      homeDir: home,
      now: () => clock,
      cacheTtlMs: 60_000,
    });
    const first = await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 't');
    assert.equal(first![0]!.messages[0]!.content, 'first');

    // A new snapshot is written with additional messages.
    await writeGeminiFile(home, 'hash-C', `session-2026-05-01T12-30-${shortId}.json`, {
      sessionId: sid,
      projectHash: 'hash-C',
      startTime: '2026-05-01T12:00:00.000Z',
      lastUpdated: '2026-05-01T12:30:10.000Z',
      messages: [
        { id: 'a', type: 'user', timestamp: '2026-05-01T12:00:00Z', content: 'first' },
        { id: 'b', type: 'gemini', timestamp: '2026-05-01T12:30:00Z', content: 'second' },
      ],
    });
    // Within the TTL: the cached file list is reused; only the original snapshot is read.
    const cached = await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 't');
    assert.equal(cached!.length, 1);
    assert.equal(cached![0]!.messages.length, 1);

    // After the TTL: the directory is re-scanned and the new snapshot is picked up,
    // then dedup-merged by message id.
    clock += 120_000;
    const after = await reader.readTurns({ agentId: 'gemini-cli', agentSessionId: sid }, 't');
    assert.equal(after!.length, 1);
    assert.equal(after![0]!.messages.length, 2);
    assert.equal(after![0]!.messages[1]!.content, 'second');
  } finally {
    await cleanup();
  }
});
