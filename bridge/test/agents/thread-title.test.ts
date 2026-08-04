/**
 * Naming a conversation: the provisional title, the prompt handed to the cheap
 * model, and — the part that actually matters — reducing whatever the CLI
 * printed back to a bare title.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE_MAX_LENGTH,
  buildTitlePrompt,
  provisionalTitle,
  sanitizeTitle,
} from '../../src/agents/thread-title.js';

test('provisionalTitle collapses whitespace and clips long openings', () => {
  assert.equal(provisionalTitle('  fix   the\n login  bug '), 'fix the login bug');
  const long = 'a'.repeat(200);
  const title = provisionalTitle(long);
  assert.equal(title.length, TITLE_MAX_LENGTH);
  assert.ok(title.endsWith('…'));
});

test('buildTitlePrompt includes the reply when there is one, and clips both', () => {
  const withReply = buildTitlePrompt('why is login failing', 'because the token expired');
  assert.match(withReply, /User: why is login failing/);
  assert.match(withReply, /Assistant: because the token expired/);
  // The instruction has to survive: language + "only the title" are what keep
  // the output usable without a second pass.
  assert.match(withReply, /same language/i);
  assert.match(withReply, /ONLY the title/);

  const withoutReply = buildTitlePrompt('just the question');
  assert.equal(withoutReply.includes('Assistant:'), false);

  const clipped = buildTitlePrompt('x'.repeat(5000), 'y'.repeat(5000));
  assert.ok(clipped.length < 2000, `prompt should stay small, got ${clipped.length}`);
});

test('sanitizeTitle strips the decoration a CLI adds around a title', () => {
  assert.equal(sanitizeTitle('Fix the login bug'), 'Fix the login bug');
  assert.equal(sanitizeTitle('"Fix the login bug"'), 'Fix the login bug');
  assert.equal(sanitizeTitle('“Fix the login bug”'), 'Fix the login bug');
  assert.equal(sanitizeTitle('`Fix the login bug`'), 'Fix the login bug');
  assert.equal(sanitizeTitle('## Fix the login bug'), 'Fix the login bug');
  assert.equal(sanitizeTitle('- Fix the login bug'), 'Fix the login bug');
  assert.equal(sanitizeTitle('Title: Fix the login bug'), 'Fix the login bug');
  assert.equal(sanitizeTitle('Título: Arreglar el login'), 'Arreglar el login');
  assert.equal(sanitizeTitle('Fix the login bug.'), 'Fix the login bug');
  // A question mark is part of the title; a full stop never is.
  assert.equal(sanitizeTitle('Why does login fail?'), 'Why does login fail?');
});

test('sanitizeTitle takes the first line with content, ignoring a preamble', () => {
  assert.equal(sanitizeTitle('\n\n  Fix the login bug\nSome rambling after.'), 'Fix the login bug');
});

test('sanitizeTitle rejects nothing-usable rather than inventing a title', () => {
  assert.equal(sanitizeTitle(''), undefined);
  assert.equal(sanitizeTitle('   \n  '), undefined);
  assert.equal(sanitizeTitle('""'), undefined);
  // A model that ignored the instruction and wrote prose is not a title — the
  // provisional name is better than a wall of text in a card.
  assert.equal(sanitizeTitle('x'.repeat(TITLE_MAX_LENGTH * 2 + 1)), undefined);
});

test('sanitizeTitle clips a slightly-too-long title instead of dropping it', () => {
  // Between the keep-and-clip ceiling and the "this is prose" one.
  const title = sanitizeTitle('word '.repeat(20));
  assert.ok(title);
  assert.equal(title.length, TITLE_MAX_LENGTH);
  assert.ok(title.endsWith('…'));
});

test('a non-Latin title survives untouched', () => {
  assert.equal(sanitizeTitle('"Arreglar el inicio de sesión"'), 'Arreglar el inicio de sesión');
});
