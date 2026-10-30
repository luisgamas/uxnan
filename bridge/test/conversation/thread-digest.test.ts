/**
 * The digest a conversation keeps beside it, and the search that runs over it
 * (architecture/02a §5.8.21): folding, matching, snippets — pure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIGEST_TEXT_MAX_CHARS,
  digestOfTurn,
  fold,
  foldedWithMap,
  parseDigest,
  queryTerms,
  searchTurns,
  searchableTurns,
  snippetOf,
} from '../../src/conversation/thread-digest.js';

test('a digest keeps what was said, the files edited and the commands counted — no step bodies', () => {
  const digest = digestOfTurn({ seq: 3, createdAt: 100 }, [
    { role: 'user', text: 'Fix the retry policy' },
    {
      role: 'assistant',
      text: 'Done: the policy now backs off.',
      segments: [
        { type: 'text', text: 'Done: ' },
        { type: 'command_execution', command: 'npm test', output: 'x'.repeat(10_000) },
        { type: 'diff', filename: 'src/retry/policy.ts', diff: '+a' },
        { type: 'diff', filename: 'src/retry/policy.ts', diff: '+b' },
        { type: 'diff', filename: 'src/retry/backoff.ts', diff: '+c' },
        { type: 'text', text: 'the policy now backs off.' },
      ],
    },
  ]);
  assert.deepEqual(digest, {
    seq: 3,
    at: 100,
    u: 'Fix the retry policy',
    a: 'Done: the policy now backs off.',
    files: ['src/retry/policy.ts', 'src/retry/backoff.ts'],
    commands: 1,
  });
});

test('a digest reads each attachment as its name, never the marker', () => {
  const digest = digestOfTurn({ createdAt: 1 }, [
    {
      role: 'user',
      text: 'compare \uFFFC with \uFFFC',
      attachments: [{ name: 'before.png' }, {}],
    },
    { role: 'assistant', text: 'ok' },
  ]);
  assert.equal(digest.u, 'compare [before.png] with [attachment]');
  assert.ok(!digest.u.includes('\uFFFC'));
  // A search finds the name, and the marker itself finds nothing.
  const turns = searchableTurns([{ turnId: 't', ...digest }]);
  assert.equal(searchTurns(turns, queryTerms('before.png')).matchCount, 1);
  assert.equal(searchTurns(turns, queryTerms('\uFFFC')).matchCount, 0);
});

test('a digest keeps only the start of a huge message', () => {
  const digest = digestOfTurn({ createdAt: 1 }, [
    { role: 'user', text: 'q' },
    { role: 'assistant', text: 'y'.repeat(DIGEST_TEXT_MAX_CHARS * 2) },
  ]);
  assert.equal(digest.a.length, DIGEST_TEXT_MAX_CHARS);
});

test('folding drops case, accents and repeated whitespace', () => {
  assert.equal(fold('  Canción   DE\tCuna\n'), ' cancion de cuna ');
  assert.deepEqual(queryTerms('Canción  cuna canción'), ['cancion', 'cuna']);
});

test('the folded map points every folded character at its original', () => {
  const text = 'Él dijo  ¡Hola!';
  const { folded, map } = foldedWithMap(text);
  assert.equal(folded, fold(text));
  assert.equal(text[map[folded.indexOf('hola')]!], 'H');
});

test('a snippet is cut around the match, on one line, with the match located', () => {
  const text = `${'filler words '.repeat(20)}the codename is\nPELICAN-7342 and more ${'tail '.repeat(40)}`;
  const { snippet, matchStart, matchLength } = snippetOf(text, ['pelican-7342']);
  assert.equal(snippet.slice(matchStart, matchStart + matchLength), 'PELICAN-7342');
  assert.ok(!snippet.includes('\n'));
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
  assert.ok(snippet.length <= 160, `snippet is ${snippet.length} long`);
});

test('every word must be in the same message; newest first; at most three named', () => {
  const entries = [1, 2, 3, 4, 5].map((seq) => ({
    turnId: `t${seq}`,
    seq,
    at: seq,
    u: `question ${seq} about retries`,
    a: seq % 2 === 0 ? 'Retries use exponential backoff.' : 'Unrelated answer.',
  }));
  const turns = searchableTurns(entries);
  const both = searchTurns(turns, queryTerms('RETRIES backoff'));
  assert.equal(both.matchCount, 2);
  assert.deepEqual(
    both.matches.map((m) => [m.turnId, m.role]),
    [
      ['t4', 'assistant'],
      ['t2', 'assistant'],
    ],
  );
  const one = searchTurns(turns, queryTerms('retries'));
  assert.equal(one.matchCount, 7);
  assert.equal(one.matches.length, 3);
  assert.equal(one.matches[0]?.turnId, 't5');
  assert.deepEqual(searchTurns(turns, queryTerms('retries banana')).matchCount, 0);
});

test('an unreadable digest is no digest', () => {
  assert.equal(parseDigest(null), undefined);
  assert.equal(parseDigest('{nope'), undefined);
  assert.equal(parseDigest('{"v":2,"turns":{}}'), undefined);
  assert.deepEqual(parseDigest('{"v":1,"turns":{}}'), { v: 1, turns: {} });
});
