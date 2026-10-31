/**
 * Which model names a conversation, for every agent: its cheapest when the CLI
 * can name one (Claude Code, Codex, Antigravity — covered in their own tests),
 * else the conversation's own model, else the configured default, else the
 * CLI's own. The CLIs here are stand-ins that print the arguments they were run
 * with, so the flags are the ones a real run would get.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrokAdapter } from '../../src/adapters/grok-adapter.js';
import { PiAdapter } from '../../src/adapters/pi-adapter.js';
import { ZeroAdapter } from '../../src/adapters/zero-adapter.js';
import { openCodeRunArgs } from '../../src/adapters/opencode-version.js';
import { rmrf } from '../helpers/fs.js';

/** A CLI that prints `ran` and every argument but the last (the prompt), and exits. */
async function standIn(): Promise<{ dir: string; prependArgs: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'uxnan-title-model-'));
  const script = join(dir, 'cli.js');
  await writeFile(script, "console.log('ran ' + process.argv.slice(2, -1).join(' '));\n");
  return { dir, prependArgs: [script] };
}

const ASK = { userText: 'ship it', assistantText: 'done', cwd: tmpdir() };

test('Grok names on the conversation’s model, else its default, else its own', async () => {
  const { dir, prependArgs } = await standIn();
  try {
    const plain = new GrokAdapter({ binaryPath: process.execPath, prependArgs });
    assert.equal(await plain.generateTitle(ASK), 'ran -p');
    assert.equal(await plain.generateTitle({ ...ASK, model: 'grok-4.7' }), 'ran -m grok-4.7 -p');
    const withDefault = new GrokAdapter({
      binaryPath: process.execPath,
      prependArgs,
      defaultModel: 'grok-fast',
    });
    assert.equal(await withDefault.generateTitle(ASK), 'ran -m grok-fast -p');
    assert.equal(
      await withDefault.generateTitle({ ...ASK, model: 'grok-4.7' }),
      'ran -m grok-4.7 -p',
    );
  } finally {
    await rmrf(dir);
  }
});

test('Zero names read-only, on the conversation’s model, else its default, else its own', async () => {
  const { dir, prependArgs } = await standIn();
  try {
    const plain = new ZeroAdapter({ binaryPath: process.execPath, prependArgs });
    assert.equal(await plain.generateTitle(ASK), 'ran exec --plan');
    assert.equal(
      await plain.generateTitle({ ...ASK, model: 'gpt-4.1-mini' }),
      'ran exec --plan -m gpt-4.1-mini',
    );
    const withDefault = new ZeroAdapter({
      binaryPath: process.execPath,
      prependArgs,
      defaultModel: 'gpt-4.1-nano',
    });
    assert.equal(await withDefault.generateTitle(ASK), 'ran exec --plan -m gpt-4.1-nano');
  } finally {
    await rmrf(dir);
  }
});

test('pi names on the conversation’s model, else its default, else its own', async () => {
  const { dir, prependArgs } = await standIn();
  try {
    const plain = new PiAdapter({ binaryPath: process.execPath, prependArgs });
    assert.equal(await plain.generateTitle(ASK), 'ran -p --no-session');
    assert.equal(
      await plain.generateTitle({ ...ASK, model: 'openai/gpt-4o-mini' }),
      'ran -p --no-session --model openai/gpt-4o-mini',
    );
    const withDefault = new PiAdapter({
      binaryPath: process.execPath,
      prependArgs,
      defaultModel: 'anthropic/claude-haiku-4-5',
    });
    assert.equal(
      await withDefault.generateTitle(ASK),
      'ran -p --no-session --model anthropic/claude-haiku-4-5',
    );
  } finally {
    await rmrf(dir);
  }
});

test('OpenCode’s one-shot carries the model on both protocols, before the prompt', () => {
  assert.deepEqual(openCodeRunArgs(2, 'p'), ['run', '--standalone', 'p']);
  assert.deepEqual(openCodeRunArgs(2, 'p', 'anthropic/claude-haiku-4-5'), [
    'run',
    '--standalone',
    '--model',
    'anthropic/claude-haiku-4-5',
    'p',
  ]);
  // OpenCode 2 keeps the run's session: titled like a conversation id it is the bridge's.
  assert.deepEqual(openCodeRunArgs(2, 'p', undefined, 'abc'), [
    'run',
    '--standalone',
    '--title',
    'abc',
    'p',
  ]);
  assert.deepEqual(openCodeRunArgs(1, 'p', 'openai/gpt-4o-mini'), [
    'run',
    '--model',
    'openai/gpt-4o-mini',
    'p',
  ]);
});
