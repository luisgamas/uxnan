/**
 * Listing sessions from a CLI's own store (Claude Code, pi, Grok): the
 * folder's sessions only, the person's own words or the CLI's title, never
 * whole transcripts. Fixtures follow the shapes the CLIs write (verified
 * 2026-09-27 against claude 2.1.283, pi 0.85.1 and Grok's session folders).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claudeProjectDir,
  cleanTitle,
  grokSessionDir,
  listClaudeSessions,
  listGrokSessions,
  listPiSessions,
  piSessionDir,
  promptText,
} from '../../src/adapters/native-sessions.js';

const CWD = '/Users/me/app_one';

const jsonl = (lines: unknown[]): string => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'uxnan-native-'));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function write(path: string, text: string, ageSeconds: number): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
  const at = Date.now() / 1000 - ageSeconds;
  await utimes(path, at, at);
}

test('the store folders are the ones each CLI writes', () => {
  assert.equal(
    claudeProjectDir('/h', '/Users/me/app_one.v2'),
    join('/h', '.claude', 'projects', '-Users-me-app-one-v2'),
  );
  assert.equal(
    piSessionDir('/h/.pi/agent', '/Users/me/app_one'),
    join('/h/.pi/agent', 'sessions', '--Users-me-app_one--'),
  );
  assert.equal(
    grokSessionDir('/h', '/Users/me/app one'),
    join('/h', '.grok', 'sessions', '%2FUsers%2Fme%2Fapp%20one'),
  );
});

test('a prompt is the person’s words: CLI wrappers and caveats are not', () => {
  assert.equal(promptText('  fix the login  '), 'fix the login');
  assert.equal(promptText([{ type: 'text', text: 'hola' }, { type: 'image' }]), 'hola');
  assert.equal(promptText('<command-name>/clear</command-name>'), undefined);
  assert.equal(promptText('Caveat: the messages below were generated'), undefined);
  assert.equal(promptText(''), undefined);
  assert.equal(promptText(42), undefined);
  assert.equal(cleanTitle('  two\n lines  '), 'two lines');
  assert.equal(cleanTitle('x'.repeat(100))?.length, 80);
  assert.equal(cleanTitle('   '), undefined);
});

test('Claude Code: its terminal sessions and headless runs, titled, newest first', async () => {
  await withHome(async (home) => {
    const dir = claudeProjectDir(home, CWD);
    const user = (text: string, entrypoint: string) => ({
      type: 'user',
      cwd: CWD,
      entrypoint,
      sessionId: 'x',
      message: { role: 'user', content: text },
    });
    // A terminal session the CLI named, grown past what is read from each end.
    await write(
      join(dir, 'tui-1.jsonl'),
      jsonl([
        { type: 'permission-mode', permissionMode: 'default' },
        user('<command-name>/model</command-name>', 'cli'),
        user('refactor the payment flow', 'cli'),
        ...Array.from({ length: 900 }, (_, i) => ({
          type: 'assistant',
          cwd: CWD,
          filler: 'y'.repeat(200),
          i,
        })),
        { type: 'ai-title', aiTitle: 'Payment flow refactor', sessionId: 'tui-1' },
      ]),
      60,
    );
    // A headless run (the bridge's, or a one-shot).
    await write(join(dir, 'sdk-1.jsonl'), jsonl([user('go on', 'sdk-cli')]), 10);
    // Another folder whose name encodes the same way.
    await write(
      join(dir, 'other-cwd.jsonl'),
      jsonl([{ ...user('elsewhere', 'cli'), cwd: '/Users/me/app/one' }]),
      5,
    );
    // Opened and left without a word.
    await write(join(dir, 'empty.jsonl'), jsonl([{ type: 'permission-mode', cwd: CWD }]), 1);

    const sessions = await listClaudeSessions(home, CWD);
    assert.deepEqual(
      sessions.map((s) => [s.sessionId, s.title, s.interactive]),
      [
        ['sdk-1', 'go on', false],
        ['tui-1', 'Payment flow refactor', true],
      ],
    );
    assert.ok(sessions.every((s) => s.cwd === CWD && s.updatedAt > 0));
    assert.deepEqual(await listClaudeSessions(home, '/nowhere'), []);
  });
});

test('pi: the sessions whose header names the folder, titled by the first message', async () => {
  await withHome(async (home) => {
    const agentDir = join(home, '.pi', 'agent');
    const dir = piSessionDir(agentDir, CWD);
    const message = (role: string, text: string) => ({
      type: 'message',
      message: { role, content: [{ type: 'text', text }] },
    });
    await write(
      join(dir, '2026-09-25T05-31_p-1.jsonl'),
      jsonl([
        { type: 'session', version: 3, id: 'p-1', cwd: CWD },
        { type: 'model_change', modelId: 'm' },
        message('user', 'describe this project'),
        message('assistant', 'It is…'),
      ]),
      30,
    );
    await write(
      join(dir, '2026-09-25T05-40_p-2.jsonl'),
      jsonl([{ type: 'session', version: 3, id: 'p-2', cwd: '/else' }, message('user', 'x')]),
      5,
    );
    await write(
      join(dir, '2026-09-25T05-50_p-3.jsonl'),
      jsonl([{ type: 'session', id: 'p-3', cwd: CWD }]),
      1,
    );

    const sessions = await listPiSessions(agentDir, CWD);
    assert.deepEqual(
      sessions.map((s) => [s.sessionId, s.title, s.interactive]),
      [['p-1', 'describe this project', true]],
    );
  });
});

test('Grok: sessions with a prompt, titled by it; an empty one is not a session', async () => {
  await withHome(async (home) => {
    const dir = grokSessionDir(home, CWD);
    const update = (sessionUpdate: string, text?: string) => ({
      method: '_x.ai/session/update',
      params: {
        sessionId: 'g',
        update: {
          sessionUpdate,
          ...(text !== undefined ? { content: { type: 'text', text } } : {}),
        },
      },
    });
    await write(
      join(dir, 'g-1', 'updates.jsonl'),
      jsonl([
        update('hook_execution'),
        update('user_message_chunk', 'add dark '),
        update('user_message_chunk', 'mode'),
        update('agent_message_chunk', 'Sure'),
        update('user_message_chunk', 'and tests'),
      ]),
      20,
    );
    await write(join(dir, 'g-2', 'updates.jsonl'), jsonl([update('hook_execution')]), 5);
    const sessions = await listGrokSessions(home, CWD);
    assert.deepEqual(
      sessions.map((s) => [s.sessionId, s.title, s.interactive]),
      [['g-1', 'add dark mode', true]],
    );
    assert.deepEqual(await listGrokSessions(home, '/nowhere'), []);
  });
});
