import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { SessionHistoryReader } from '../../src/index.js';
import { TranscriptTails, type TranscriptParser } from '../../src/conversation/transcript-tail.js';
import { rmrf } from '../helpers/fs.js';
import { stepsOf } from '../helpers/steps.js';

async function fakeHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = join(tmpdir(), `uxnan-tail-${randomUUID()}`);
  await mkdir(home, { recursive: true });
  return { home, cleanup: () => rmrf(home) };
}

const at = (s: number): string => new Date(Date.UTC(2026, 10, 3, 10, 0, s)).toISOString();

/** One transcript per agent, with what carries across lines in each. */
const TRANSCRIPTS: Array<{
  agentId: string;
  sid: string;
  path: (home: string, sid: string) => string;
  lines: (sid: string) => unknown[];
  hasSteps: boolean;
}> = [
  {
    agentId: 'claude-code',
    sid: 'tail-claude',
    path: (home, sid) => join(home, '.claude', 'projects', 'p', `${sid}.jsonl`),
    lines: () => [
      {
        type: 'user',
        message: { role: 'user', content: 'arregla el diálogo — ñandú 🦤' },
        timestamp: at(0),
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Leo el archivo primero.' },
            { type: 'text', text: 'Voy a leerlo.' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls src' } },
          ],
        },
        timestamp: at(1),
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.ts\nb.ts' }],
        },
        timestamp: at(2),
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: ' Listo ✅' }] },
        timestamp: at(3),
      },
      { type: 'user', message: { role: 'user', content: 'gracias' }, timestamp: at(4) },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'De nada.' }] },
        timestamp: at(5),
      },
    ],
    hasSteps: true,
  },
  {
    agentId: 'codex',
    sid: 'tail-codex',
    path: (home, sid) =>
      join(
        home,
        '.codex',
        'sessions',
        '2026',
        '11',
        '03',
        `rollout-2026-11-03T10-00-00-${sid}.jsonl`,
      ),
    lines: (sid) => [
      { type: 'session_meta', payload: { id: sid, cwd: '/x' } },
      {
        type: 'response_item',
        timestamp: at(0),
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '¿qué hay en src? 🗂' }],
        },
      },
      {
        type: 'response_item',
        timestamp: at(1),
        payload: {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Listar el directorio.' }],
        },
      },
      {
        type: 'response_item',
        timestamp: at(2),
        payload: {
          type: 'function_call',
          name: 'shell_command',
          call_id: 'c1',
          arguments: JSON.stringify({ command: 'ls src' }),
        },
      },
      {
        type: 'response_item',
        timestamp: at(3),
        payload: { type: 'function_call_output', call_id: 'c1', output: 'a.ts\nb.ts' },
      },
      {
        type: 'response_item',
        timestamp: at(4),
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Dos archivos.' }],
        },
      },
      {
        type: 'response_item',
        timestamp: at(5),
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'y en test' }],
        },
      },
      // A run still going: reasoning with no reply yet — a reply of its own.
      {
        type: 'response_item',
        timestamp: at(6),
        payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Mirando test/.' }] },
      },
    ],
    hasSteps: true,
  },
  {
    agentId: 'pi-agent',
    sid: 'tail-pi',
    path: (home, sid) =>
      join(
        home,
        '.pi',
        'agent',
        'sessions',
        '--C--proj--',
        `2026-11-03T10-00-00-000Z_${sid}.jsonl`,
      ),
    lines: (sid) => [
      { type: 'session', id: sid, cwd: 'C:/proj' },
      {
        type: 'message',
        timestamp: at(0),
        message: { role: 'user', content: [{ type: 'text', text: 'lista src — ü' }] },
      },
      {
        type: 'message',
        timestamp: at(1),
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Listo:' },
            { type: 'toolCall', id: 'p1', name: 'bash', arguments: { command: 'ls src' } },
          ],
        },
      },
      {
        type: 'message',
        timestamp: at(2),
        message: {
          role: 'toolResult',
          toolCallId: 'p1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'a.ts' }],
        },
      },
    ],
    hasSteps: true,
  },
  {
    agentId: 'zero',
    sid: 'tail-zero',
    path: (home, sid) => join(home, '.local', 'share', 'zero', 'sessions', sid, 'events.jsonl'),
    lines: () => [
      {
        type: 'message',
        createdAt: at(0),
        payload: { role: 'user', content: 'hola — ¿qué tal? 🙂' },
      },
      { type: 'message', createdAt: at(1), payload: { role: 'assistant', content: 'Bien.' } },
      { type: 'message', createdAt: at(2), payload: { role: 'user', content: 'otra' } },
      { type: 'message', createdAt: at(3), payload: { role: 'assistant', content: 'Va.' } },
    ],
    hasSteps: false,
  },
  {
    agentId: 'grok',
    sid: 'tail-grok',
    path: (home, sid) => join(home, '.grok', 'sessions', 'C%3A%5Crepo', sid, 'updates.jsonl'),
    lines: (sid) => {
      const update = (s: number, sessionUpdate: string, text?: string): unknown => ({
        timestamp: at(s),
        params: {
          sessionId: sid,
          update: {
            sessionUpdate,
            ...(text === undefined ? {} : { content: { type: 'text', text } }),
          },
        },
      });
      return [
        update(0, 'user_message_chunk', 'qué '),
        update(0, 'user_message_chunk', 'hora es — ñ'),
        update(1, 'agent_thought_chunk', 'Pienso'),
        update(1, 'agent_thought_chunk', ' un poco.'),
        update(2, 'agent_message_chunk', 'Las '),
        update(2, 'agent_message_chunk', 'diez.'),
        update(3, 'turn_completed'),
        update(4, 'user_message_chunk', 'gracias'),
        update(5, 'agent_message_chunk', 'De nada'),
      ];
    },
    hasSteps: false,
  },
];

/** Cut points across the whole file — inside lines, inside multi-byte characters. */
function cuts(length: number): number[] {
  const out = new Set<number>();
  for (let n = 1; n < length; n += 7) out.add(n);
  out.add(length);
  return [...out].sort((a, b) => a - b);
}

for (const t of TRANSCRIPTS) {
  test(`${t.agentId}: a transcript read as it grows reads the same as read whole, at every cut`, async () => {
    const { home, cleanup } = await fakeHome();
    try {
      const file = t.path(home, t.sid);
      await mkdir(join(file, '..'), { recursive: true });
      const bytes = Buffer.from(
        t
          .lines(t.sid)
          .map((l) => JSON.stringify(l))
          .join('\n') + '\n',
        'utf-8',
      );
      await writeFile(file, '');
      const growing = new SessionHistoryReader({ homeDir: home });
      const source = { agentId: t.agentId, agentSessionId: t.sid };
      let written = 0;
      for (const cut of cuts(bytes.length)) {
        await appendFile(file, bytes.subarray(written, cut));
        written = cut;
        const read = await growing.readTurns(source, 'th');
        const whole = await new SessionHistoryReader({ homeDir: home }).readTurns(source, 'th');
        assert.deepEqual(read, whole, `cut at byte ${cut} of ${bytes.length}`);
      }
      const final = await growing.readTurns(source, 'th');
      assert.ok(final && final.length >= 1, 'the transcript has its turns');
      if (t.hasSteps) {
        assert.ok(
          final!.some((turn) => turn.messages.some((m) => stepsOf(m).length > 0)),
          'a step paired across lines survived the cuts',
        );
      }
    } finally {
      await cleanup();
    }
  });
}

/** A parser that records every record it is fed. */
function recorder(): TranscriptParser<{ n: number; seen: string[] }> {
  const fed: { n: number; seen: string[] }[] = [];
  return {
    feed: (r) => fed.push({ n: Number(r['n']), seen: [] }),
    messages: () => fed,
  };
}

test('a file rewritten in place is read again from its start', async () => {
  const dir = join(tmpdir(), `uxnan-tail-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    const file = join(dir, 't.jsonl');
    const tails = new TranscriptTails();
    await writeFile(file, '{"n":1}\n{"n":2}\n');
    assert.deepEqual(
      (await tails.read(file, 'r', recorder))!.map((m) => m.n),
      [1, 2],
    );
    // Same length, different content: not the file that was read.
    await writeFile(file, '{"n":7}\n{"n":8}\n');
    assert.deepEqual(
      (await tails.read(file, 'r', recorder))!.map((m) => m.n),
      [7, 8],
    );
    // Shorter: read again.
    await writeFile(file, '{"n":9}\n');
    assert.deepEqual(
      (await tails.read(file, 'r', recorder))!.map((m) => m.n),
      [9],
    );
    // Replaced by another file (another inode), longer.
    await rm(file);
    await writeFile(file, '{"n":9}\n{"n":10}\n{"n":11}\n');
    assert.deepEqual(
      (await tails.read(file, 'r', recorder))!.map((m) => m.n),
      [9, 10, 11],
    );
  } finally {
    await rmrf(dir);
  }
});

test('only new lines are fed, a half-written line waits, and what a caller keeps is its own', async () => {
  const dir = join(tmpdir(), `uxnan-tail-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    const file = join(dir, 't.jsonl');
    let fedTotal = 0;
    const counting = (): TranscriptParser<{ n: number }> => {
      const out: { n: number }[] = [];
      return {
        feed: (r) => {
          fedTotal += 1;
          out.push({ n: Number(r['n']) });
        },
        messages: () => out,
      };
    };
    const tails = new TranscriptTails();
    await writeFile(file, '{"n":1}\n{"n":2}\n{"n":');
    const first = (await tails.read(file, 'c', counting))!;
    assert.deepEqual(
      first.map((m) => m.n),
      [1, 2],
    );
    first[0]!.n = 99; // the caller's copy, not the parser's state
    await appendFile(file, '3}\n{"n":4}');
    const second = (await tails.read(file, 'c', counting))!;
    assert.deepEqual(
      second.map((m) => m.n),
      [1, 2, 3, 4],
      'a complete last line counts',
    );
    assert.equal(fedTotal, 4, 'no line was fed twice');
    await appendFile(file, '\n{"n":5}\n');
    assert.deepEqual(
      (await tails.read(file, 'c', counting))!.map((m) => m.n),
      [1, 2, 3, 4, 5],
    );
    assert.equal(fedTotal, 5);
  } finally {
    await rmrf(dir);
  }
});

test('reads of one file at once are taken in turn, and only the last few files are kept', async () => {
  const dir = join(tmpdir(), `uxnan-tail-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    let built = 0;
    const make = (): TranscriptParser<{ n: number }> => {
      built += 1;
      const out: { n: number }[] = [];
      return { feed: (r) => out.push({ n: Number(r['n']) }), messages: () => out };
    };
    const tails = new TranscriptTails(2);
    const file = join(dir, 'a.jsonl');
    await writeFile(file, Array.from({ length: 50 }, (_, n) => `{"n":${n}}`).join('\n') + '\n');
    const reads = await Promise.all([1, 2, 3, 4].map(() => tails.read(file, 'k', make)));
    for (const r of reads) assert.equal(r!.length, 50, 'every concurrent read saw each line once');
    assert.equal(built, 1);

    for (const name of ['b', 'c']) {
      await writeFile(join(dir, `${name}.jsonl`), '{"n":0}\n');
      await tails.read(join(dir, `${name}.jsonl`), 'k', make);
    }
    // `a` was the least recently read of three: forgotten, so it is parsed anew.
    await tails.read(file, 'k', make);
    assert.equal(built, 4);
    assert.equal(await tails.read(join(dir, 'missing.jsonl'), 'k', make), null);
  } finally {
    await rmrf(dir);
  }
});
