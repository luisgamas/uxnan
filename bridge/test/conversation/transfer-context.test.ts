/**
 * What a continuation carries to its agent (architecture/02a §5.8.21): a
 * deterministic, budgeted selection — never an invented summary — and the
 * person's own words never shortened to make room.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSFER_CONTEXT_MAX_BYTES, TRANSFER_PIECE_MAX_CHARS, utf8Length } from '@uxnan/shared';
import {
  TRANSFER_CONTEXT_CLOSE,
  TRANSFER_CONTEXT_OPEN,
  buildTransferContext,
  withTransferContext,
} from '../../src/conversation/transfer-context.js';
import type { TurnDigest } from '../../src/conversation/thread-digest.js';

function turns(count: number, replyChars: number): TurnDigest[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    at: i,
    u: i === 0 ? 'Build a retry policy for the payments service.' : `Follow-up ${i + 1}`,
    a: `Reply ${i + 1}: ${'detail '.repeat(Math.ceil(replyChars / 7))}`.slice(0, replyChars),
    ...(i === 3 ? { files: ['src/retry/policy.ts'] } : {}),
  }));
}

const source = (digests: TurnDigest[]) => ({
  threadId: 'src-1',
  title: 'Payments retries',
  agentName: 'Codex',
  cwd: '/work/payments',
  turns: digests,
});

test('a short conversation goes whole, framed, with its facts and files', () => {
  const { text, summary } = buildTransferContext(source(turns(5, 200)), 'selection');
  assert.ok(text.startsWith(TRANSFER_CONTEXT_OPEN));
  assert.ok(text.endsWith(TRANSFER_CONTEXT_CLOSE));
  assert.match(text, /"Payments retries" \(agent: Codex, folder: \/work\/payments, 5 turns\)/);
  for (let n = 1; n <= 5; n++) assert.match(text, new RegExp(`### Turn ${n}\\n`));
  assert.match(text, /Files its edits changed: src\/retry\/policy\.ts/);
  // Nothing left out, so no opening request repeated and no "left out" line.
  assert.doesNotMatch(text, /began with this request/);
  assert.doesNotMatch(text, /left out;/);
  assert.deepEqual(summary, {
    turns: 5,
    omittedTurns: 0,
    bytes: utf8Length(text),
    approxTokens: Math.ceil(utf8Length(text) / 4),
  });
});

test('a long conversation stays within the budget: newest whole, older shortened, oldest left out', () => {
  const { text, summary } = buildTransferContext(source(turns(400, 1_500)), 'selection');
  assert.ok(utf8Length(text) <= TRANSFER_CONTEXT_MAX_BYTES, `${utf8Length(text)} bytes`);
  assert.ok(summary.omittedTurns > 0);
  assert.equal(summary.turns + summary.omittedTurns, 400);
  // The newest exchange is whole; an older one is shortened.
  assert.ok(text.includes(turns(400, 1_500)[399]!.a.trim()));
  const shortened = text.split('\n').filter((l) => l.startsWith('Assistant: ') && l.endsWith('…'));
  assert.ok(shortened.length > 0);
  for (const line of shortened) {
    assert.ok(line.length <= 'Assistant: '.length + TRANSFER_PIECE_MAX_CHARS);
  }
  // The opening request is kept although its turn was left out.
  assert.match(text, /began with this request:\nBuild a retry policy/);
  assert.match(text, new RegExp(`${summary.omittedTurns} earlier turns were left out`));
});

test('the same conversation always gives the same context', () => {
  const a = buildTransferContext(source(turns(120, 900)), 'selection');
  const b = buildTransferContext(source(turns(120, 900)), 'selection');
  assert.equal(a.text, b.text);
});

test('a reference carries only a pointer: the opening request and the last exchange, shortened', () => {
  const { text, summary } = buildTransferContext(source(turns(30, 2_000)), 'reference');
  assert.match(text, /Only a pointer to it is included/);
  assert.match(text, /It began with: Build a retry policy/);
  assert.match(text, /User: Follow-up 30/);
  assert.ok(utf8Length(text) < 2_000);
  assert.equal(summary.turns, 2);
  assert.equal(summary.omittedTurns, 28);
});

test('a fork carries a selection', () => {
  const s = source(turns(3, 50));
  assert.equal(buildTransferContext(s, 'fork').text, buildTransferContext(s, 'selection').text);
});

test("the person's message is never shortened to make room", () => {
  const { text } = buildTransferContext(source(turns(400, 1_500)), 'selection');
  const message = `Please continue. ${'Exact words that must survive. '.repeat(5_000)}`;
  const first = withTransferContext(text, message);
  assert.ok(first.endsWith(message));
  assert.equal(first, `${text}\n\n${message}`);
  assert.equal(withTransferContext(text, ''), text);
});

test('an empty conversation still says where it came from', () => {
  const { text, summary } = buildTransferContext(source([]), 'selection');
  assert.match(text, /0 turns/);
  assert.equal(summary.turns, 0);
});
