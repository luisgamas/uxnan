import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { SessionHistoryReader } from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

/** Build a throwaway fake-home tree and return its path + a cleanup fn. */
async function fakeHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = join(tmpdir(), `uxnan-hist-${randomUUID()}`);
  await mkdir(home, { recursive: true });
  return { home, cleanup: () => rmrf(home) };
}

async function writeLines(file: string, objs: unknown[]): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, objs.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf-8');
}

async function writeJson(file: string, obj: unknown): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(obj), 'utf-8');
}

/** Treat an unknown block as a typed record for property access in asserts. */
function block(b: unknown): Record<string, unknown> {
  return b as Record<string, unknown>;
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
    // Zero has no on-disk history reader yet (its ACP sessions aren't parsed).
    assert.equal(await reader.readTurns({ agentId: 'zero', agentSessionId: 'x' }, 't'), null);
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

// --- Structured block / tool-call reconstruction -----------------------------

test('claude: pairs tool_use + tool_result into structured blocks on the assistant message', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-claude-tools-1';
    await writeLines(join(home, '.claude', 'projects', 'p', `${sid}.jsonl`), [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'list files' }] } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'running ls' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt\nb.txt' }],
        },
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'claude-code', agentSessionId: sid }, 'th-CB');
    assert.equal(turns!.length, 1);
    const assistant = turns![0]!.messages.find(
      (m) => m.role === 'assistant' && m.content === 'running ls',
    );
    assert.ok(assistant, 'expected the first assistant message to be present');
    assert.equal(assistant!.blocks?.length, 1);
    assert.equal(block(assistant!.blocks![0]).type, 'command_execution');
    assert.equal(block(assistant!.blocks![0]).command, 'ls');
    assert.equal(block(assistant!.blocks![0]).status, 'completed');
    assert.equal(block(assistant!.blocks![0]).output, 'a.txt\nb.txt');
    const secondAssistant = turns![0]!.messages.find(
      (m) => m.role === 'assistant' && m.content === 'done',
    );
    assert.deepEqual(secondAssistant!.blocks ?? [], []);
  } finally {
    await cleanup();
  }
});

test('claude: Edit tool becomes a diff block with +/- lines', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-claude-edit';
    await writeLines(join(home, '.claude', 'projects', 'p', `${sid}.jsonl`), [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'rename' }] } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'e1',
              name: 'Edit',
              input: { file_path: 'a.txt', old_string: 'foo', new_string: 'bar' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }],
        },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'claude-code', agentSessionId: sid }, 'th-CE');
    const assistant = turns![0]!.messages[1]!;
    assert.equal(assistant.blocks?.length, 1);
    assert.equal(block(assistant.blocks![0]).type, 'diff');
    assert.equal(block(assistant.blocks![0]).filename, 'a.txt');
    assert.equal(block(assistant.blocks![0]).diff, '-foo\n+bar');
    assert.equal(block(assistant.blocks![0]).additions, 1);
    assert.equal(block(assistant.blocks![0]).deletions, 1);
  } finally {
    await cleanup();
  }
});

test('codex (legacy): command_execution becomes a command_execution block', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-codex-legacy-cmd';
    const file = join(
      home,
      '.codex',
      'sessions',
      '2026',
      '06',
      '01',
      `rollout-2026-06-01T00-00-00-${sid}.jsonl`,
    );
    await writeLines(file, [
      { type: 'session_meta', payload: { id: sid } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'run ls' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'command_execution',
          command: 'ls',
          aggregated_output: 'a\nb\nc',
          exit_code: 0,
          status: 'completed',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'three files' }],
        },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'codex', agentSessionId: sid }, 'th-CL');
    assert.equal(turns!.length, 1);
    const assistant = turns![0]!.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant?.blocks?.length, 1);
    assert.equal(block(assistant!.blocks![0]).type, 'command_execution');
    assert.equal(block(assistant!.blocks![0]).command, 'ls');
    assert.equal(block(assistant!.blocks![0]).output, 'a\nb\nc');
    assert.equal(block(assistant!.blocks![0]).status, 'completed');
  } finally {
    await cleanup();
  }
});

test('codex (legacy): file_change becomes a file_change diff block (path + counts)', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-codex-legacy-fc';
    const file = join(
      home,
      '.codex',
      'sessions',
      '2026',
      '06',
      '01',
      `rollout-2026-06-01T00-00-00-${sid}.jsonl`,
    );
    await writeLines(file, [
      { type: 'session_meta', payload: { id: sid } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'edit foo.txt' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'file_change',
          changes: [{ path: 'foo.txt', kind: 'update' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'edited' }],
        },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'codex', agentSessionId: sid }, 'th-CF');
    const assistant = turns![0]!.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant?.blocks?.length, 1);
    assert.equal(block(assistant!.blocks![0]).type, 'diff');
    assert.equal(block(assistant!.blocks![0]).filename, 'foo.txt');
  } finally {
    await cleanup();
  }
});

test('codex (newer 0.98+): function_call shell_command pairs with function_call_output into a command_execution block', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-codex-new-shell';
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
      { type: 'session_meta', payload: { id: sid } },
      {
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go' }] },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          arguments: '{"command":"echo hi"}',
          call_id: 'call_1',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nhi',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'said hi' }],
        },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'codex', agentSessionId: sid }, 'th-CN');
    const assistant = turns![0]!.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant?.blocks?.length, 1);
    assert.equal(block(assistant!.blocks![0]).type, 'command_execution');
    assert.equal(block(assistant!.blocks![0]).command, 'echo hi');
    assert.equal(block(assistant!.blocks![0]).status, 'completed');
    assert.match(block(assistant!.blocks![0]).output as string, /hi/);
  } finally {
    await cleanup();
  }
});

test('codex: function_call with non-zero exit code surfaces as command_execution error', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-codex-shell-err';
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
      { type: 'session_meta', payload: { id: sid } },
      {
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go' }] },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          arguments: '{"command":"false"}',
          call_id: 'call_1',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'Exit code: 1\nOutput:\nboom',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'failed' }],
        },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'codex', agentSessionId: sid }, 'th-CE');
    const assistant = turns![0]!.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant?.blocks?.length, 1);
    assert.equal(block(assistant!.blocks![0]).type, 'command_execution');
    assert.equal(block(assistant!.blocks![0]).status, 'error');
  } finally {
    await cleanup();
  }
});

test('codex: reasoning items surface as assistant thinking (summary only when encrypted)', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-codex-reasoning';
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
      { type: 'session_meta', payload: { id: sid } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'think about it' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: ['Step 1', 'Step 2'],
          encrypted_content: 'gAAAAA...',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'the answer' }],
        },
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'codex', agentSessionId: sid }, 'th-CR');
    const assistant = turns![0]!.messages.find((m) => m.role === 'assistant');
    assert.ok(assistant);
    assert.match(assistant!.thinking ?? '', /Step 1.*Step 2/s);
  } finally {
    await cleanup();
  }
});

test('opencode: tool parts in a message become structured blocks (bash + edit)', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'ses_oc_blocks_1';
    const storage = join(home, '.local', 'share', 'opencode', 'storage');
    await writeJson(join(storage, 'message', sid, 'msg1.json'), {
      id: 'msg1',
      sessionID: sid,
      role: 'user',
      time: { created: 100 },
    });
    await writeJson(join(storage, 'part', 'msg1', 'p1.json'), {
      id: 'p1',
      type: 'text',
      text: 'do work',
    });
    await writeJson(join(storage, 'message', sid, 'msg2.json'), {
      id: 'msg2',
      sessionID: sid,
      role: 'assistant',
      time: { created: 200 },
    });
    await writeJson(join(storage, 'part', 'msg2', 't1.json'), {
      id: 't1',
      type: 'text',
      text: 'running ls',
    });
    await writeJson(join(storage, 'part', 'msg2', 'tool1.json'), {
      id: 'tool1',
      type: 'tool',
      callID: 'c1',
      tool: 'bash',
      state: {
        status: 'completed',
        input: { command: 'ls' },
        output: 'a\nb',
      },
    });
    await writeJson(join(storage, 'message', sid, 'msg3.json'), {
      id: 'msg3',
      sessionID: sid,
      role: 'assistant',
      time: { created: 300 },
    });
    await writeJson(join(storage, 'part', 'msg3', 't2.json'), {
      id: 't2',
      type: 'text',
      text: 'edited',
    });
    await writeJson(join(storage, 'part', 'msg3', 'tool2.json'), {
      id: 'tool2',
      type: 'tool',
      callID: 'c2',
      tool: 'edit',
      state: {
        status: 'completed',
        input: { filePath: 'a.txt', oldString: 'foo', newString: 'bar' },
        output: '',
      },
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'opencode', agentSessionId: sid }, 'th-OC');
    assert.equal(turns!.length, 1);
    const messages = turns![0]!.messages;
    assert.equal(messages.length, 3);
    const msg2 = messages.find((m) => m.content === 'running ls');
    assert.equal(msg2?.blocks?.length, 1);
    assert.equal(block(msg2!.blocks![0]).type, 'command_execution');
    assert.equal(block(msg2!.blocks![0]).command, 'ls');
    const msg3 = messages.find((m) => m.content === 'edited');
    assert.equal(msg3?.blocks?.length, 1);
    assert.equal(block(msg3!.blocks![0]).type, 'diff');
    assert.equal(block(msg3!.blocks![0]).filename, 'a.txt');
    assert.match(block(msg3!.blocks![0]).diff as string, /-foo.*\+bar/s);
  } finally {
    await cleanup();
  }
});

test('opencode: reasoning parts become assistant thinking', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'ses_oc_thinking_1';
    const storage = join(home, '.local', 'share', 'opencode', 'storage');
    await writeJson(join(storage, 'message', sid, 'msg1.json'), {
      id: 'msg1',
      sessionID: sid,
      role: 'user',
      time: { created: 100 },
    });
    await writeJson(join(storage, 'part', 'msg1', 'p1.json'), {
      id: 'p1',
      type: 'text',
      text: 'think please',
    });
    await writeJson(join(storage, 'message', sid, 'msg2.json'), {
      id: 'msg2',
      sessionID: sid,
      role: 'assistant',
      time: { created: 200 },
    });
    await writeJson(join(storage, 'part', 'msg2', 'r1.json'), {
      id: 'r1',
      type: 'reasoning',
      text: 'pondering the answer',
    });
    await writeJson(join(storage, 'part', 'msg2', 't1.json'), {
      id: 't1',
      type: 'text',
      text: 'the answer',
    });
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'opencode', agentSessionId: sid }, 'th-OT');
    const assistant = turns![0]!.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant?.thinking, 'pondering the answer');
    assert.equal(assistant?.content, 'the answer');
  } finally {
    await cleanup();
  }
});

test('pi: toolCall content block in assistant + toolResult message become a paired block', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-pi-tools-1';
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
        message: { role: 'user', content: [{ type: 'text', text: 'readme' }] },
        timestamp: '2026-06-15T00:00:00.000Z',
      },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'pwd' } },
          ],
        },
        timestamp: '2026-06-15T00:00:05.000Z',
      },
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'C:/proj' }],
        },
        timestamp: '2026-06-15T00:00:06.000Z',
      },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'you are in C:/proj' }] },
        timestamp: '2026-06-15T00:00:10.000Z',
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'pi-agent', agentSessionId: sid }, 'th-PT');
    const firstAssistant = turns![0]!.messages.find(
      (m) => m.role === 'assistant' && m.content === '',
    );
    assert.ok(firstAssistant, 'expected the tool-call assistant message to be present');
    assert.equal(firstAssistant!.blocks?.length, 1);
    assert.equal(block(firstAssistant!.blocks![0]).type, 'command_execution');
    assert.equal(block(firstAssistant!.blocks![0]).command, 'pwd');
    assert.equal(block(firstAssistant!.blocks![0]).output, 'C:/proj');
    const secondAssistant = turns![0]!.messages.find(
      (m) => m.role === 'assistant' && m.content === 'you are in C:/proj',
    );
    assert.deepEqual(secondAssistant?.blocks ?? [], []);
  } finally {
    await cleanup();
  }
});

test('pi: think tags inside assistant text are extracted into Message.thinking', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'sess-pi-thinking';
    const file = join(
      home,
      '.pi',
      'agent',
      'sessions',
      '--C--proj--',
      `2026-06-15T00-00-00-000Z_${sid}.jsonl`,
    );
    await writeLines(file, [
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '<think>I need to think about this</think>Here is the answer.',
            },
          ],
        },
        timestamp: '2026-06-15T00:00:00.000Z',
      },
    ]);
    const reader = new SessionHistoryReader({ homeDir: home });
    const turns = await reader.readTurns({ agentId: 'pi-agent', agentSessionId: sid }, 'th-PTh');
    const assistant = turns![0]!.messages[0]!;
    assert.equal(assistant.role, 'assistant');
    assert.equal(assistant.thinking, 'I need to think about this');
    assert.equal(assistant.content, 'Here is the answer.');
  } finally {
    await cleanup();
  }
});
test('opencode: reads the official serve message API and ignores a live assistant record', async () => {
  const reader = new SessionHistoryReader({
    openCodeMessages: async () => [
      {
        info: { id: 'u1', role: 'user', time: { created: 1000 } },
        parts: [{ type: 'text', text: 'from OpenCode Desktop' }],
      },
      {
        info: { id: 'a1', role: 'assistant', finish: 'stop', time: { created: 1001 } },
        parts: [
          { type: 'reasoning', text: 'checking' },
          { type: 'text', text: 'completed answer' },
        ],
      },
      {
        info: { id: 'u2', role: 'user', time: { created: 2000 } },
        parts: [{ type: 'text', text: 'still running' }],
      },
      {
        info: { id: 'a2', role: 'assistant', time: { created: 2001 } },
        parts: [{ type: 'text', text: 'partial answer' }],
      },
    ],
  });
  const turns = await reader.readTurns(
    { agentId: 'opencode', agentSessionId: 'ses_external', cwd: '/repo' },
    'th-opencode',
  );
  assert.equal(turns?.length, 2);
  assert.equal(turns?.[0]?.messages[1]?.content, 'completed answer');
  assert.equal(turns?.[0]?.messages[1]?.thinking, 'checking');
  assert.equal(turns?.[1]?.messages.length, 1, 'the unfinished answer is not imported');
});

test('zero: parses persisted ACP message events', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = 'zero-session-1';
    await writeLines(join(home, '.local', 'share', 'zero', 'sessions', sid, 'events.jsonl'), [
      {
        id: `${sid}:1`,
        sessionId: sid,
        sequence: 1,
        type: 'message',
        createdAt: '2026-08-01T12:00:00Z',
        payload: { role: 'user', content: 'from Zero TUI' },
      },
      {
        id: `${sid}:2`,
        sessionId: sid,
        sequence: 2,
        type: 'message',
        createdAt: '2026-08-01T12:00:01Z',
        payload: { role: 'assistant', content: 'zero answer' },
      },
    ]);
    const turns = await new SessionHistoryReader({ homeDir: home }).readTurns(
      { agentId: 'zero', agentSessionId: sid },
      'th-zero',
    );
    assert.equal(turns?.length, 1);
    assert.deepEqual(
      turns?.[0]?.messages.map((message) => [message.role, message.content]),
      [
        ['user', 'from Zero TUI'],
        ['assistant', 'zero answer'],
      ],
    );
  } finally {
    await cleanup();
  }
});

test('grok: imports only ACP turns closed by turn_completed', async () => {
  const { home, cleanup } = await fakeHome();
  try {
    const sid = '019fa5ab-5769-7391-965c-14aa144b43dd';
    const file = join(home, '.grok', 'sessions', 'C%3A%5Crepo', sid, 'updates.jsonl');
    const update = (timestamp: string, sessionUpdate: string, text?: string) => ({
      timestamp,
      method: 'session/update',
      params: {
        sessionId: sid,
        update: {
          sessionUpdate,
          ...(text !== undefined ? { content: { type: 'text', text } } : {}),
        },
      },
    });
    await writeLines(file, [
      update('2026-08-01T12:00:00Z', 'user_message_chunk', 'from Grok TUI'),
      update('2026-08-01T12:00:01Z', 'agent_thought_chunk', 'thinking'),
      update('2026-08-01T12:00:02Z', 'agent_message_chunk', 'grok answer'),
      update('2026-08-01T12:00:03Z', 'turn_completed'),
      update('2026-08-01T12:01:00Z', 'user_message_chunk', 'not finished'),
      update('2026-08-01T12:01:01Z', 'agent_message_chunk', 'partial'),
    ]);
    const turns = await new SessionHistoryReader({ homeDir: home }).readTurns(
      { agentId: 'grok', agentSessionId: sid },
      'th-grok',
    );
    assert.equal(turns?.length, 1);
    assert.equal(turns?.[0]?.messages[0]?.content, 'from Grok TUI');
    assert.equal(turns?.[0]?.messages[1]?.content, 'grok answer');
    assert.equal(turns?.[0]?.messages[1]?.thinking, 'thinking');
  } finally {
    await cleanup();
  }
});
