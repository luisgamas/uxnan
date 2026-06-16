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
    assert.equal(await reader.readTurns({ agentId: 'gemini', agentSessionId: 'x' }, 't'), null);
    assert.equal(await reader.readTurns({ agentId: 'claude-code' }, 't'), null);
    assert.equal(await reader.readTurns({ agentSessionId: 'x' }, 't'), null);
    assert.equal(
      await reader.readTurns({ agentId: 'claude-code', agentSessionId: 'nope' }, 't'),
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
