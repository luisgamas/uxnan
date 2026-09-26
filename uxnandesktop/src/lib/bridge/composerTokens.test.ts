import { describe, expect, it } from 'vitest';
import type { AgentCommand } from '$shared/agents/agent-capabilities';
import { asCommand, complete, matchCommands, tokenAt } from './composerTokens';

const commands: AgentCommand[] = [
  { name: 'compact', description: 'Free up context', source: 'builtin' },
  { name: 'review', description: 'Review the diff', source: 'custom' },
  { name: 'hyperframes', description: 'Make a video', source: 'skill' },
  { name: 'tui-only', source: 'builtin', headlessSupported: false },
];

describe('tokenAt', () => {
  it('reads a command only as the first word', () => {
    expect(tokenAt('/com', 4)).toEqual({ kind: 'command', query: 'com', start: 0, end: 4 });
    expect(tokenAt('/', 1)).toEqual({ kind: 'command', query: '', start: 0, end: 1 });
    expect(tokenAt('fix /com', 8)).toBeUndefined();
    expect(tokenAt('/compact now', 12)).toBeUndefined();
  });

  it('reads a mention that starts a word, anywhere', () => {
    expect(tokenAt('look at @src/li', 15)).toEqual({
      kind: 'mention',
      query: 'src/li',
      start: 8,
      end: 15,
    });
    expect(tokenAt('@', 1)).toEqual({ kind: 'mention', query: '', start: 0, end: 1 });
    expect(tokenAt('mail me@example', 15)).toBeUndefined();
  });

  it('covers the rest of the word after the caret', () => {
    expect(tokenAt('see @src/lib.ts please', 8)).toMatchObject({ start: 4, end: 15 });
  });
});

describe('complete', () => {
  it('replaces the token and leaves the caret after a space', () => {
    const token = tokenAt('look at @sr and then', 11)!;
    expect(complete('look at @sr and then', token, '@src/main.ts')).toEqual({
      text: 'look at @src/main.ts and then',
      caret: 21,
    });
    const cmd = tokenAt('/re', 3)!;
    expect(complete('/re', cmd, '/review')).toEqual({ text: '/review ', caret: 8 });
  });

  it('keeps a picked folder open so the mention drills into it', () => {
    const token = tokenAt('see @sr', 7)!;
    const next = complete('see @sr', token, '@src/');
    expect(next).toEqual({ text: 'see @src/', caret: 9 });
    expect(tokenAt(next.text, next.caret)).toMatchObject({ kind: 'mention', query: 'src/' });
  });
});

describe('matchCommands', () => {
  it('groups skills, own commands, built-ins; ranks within; hides what cannot run', () => {
    expect(matchCommands(commands, '').map((c) => c.name)).toEqual([
      'hyperframes',
      'review',
      'compact',
    ]);
    expect(matchCommands(commands, 'rev').map((c) => c.name)).toEqual(['review']);
    expect(matchCommands(commands, 'up').map((c) => c.name)).toEqual(['compact']);
    expect(matchCommands(commands, 'video').map((c) => c.name)).toEqual(['hyperframes']);
    expect(matchCommands(commands, 'tui')).toEqual([]);
  });
});

describe('asCommand', () => {
  it('sends a known command with its arguments, and anything else as text', () => {
    expect(asCommand('/compact', commands)).toEqual({ name: 'compact' });
    expect(asCommand(' /review  src/app.ts \n', commands)).toEqual({
      name: 'review',
      args: 'src/app.ts',
    });
    expect(asCommand('/unknown thing', commands)).toBeUndefined();
    expect(asCommand('/tui-only', commands)).toBeUndefined();
    expect(asCommand('please /compact', commands)).toBeUndefined();
  });
});
