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

  it('reads a quoted mention, spaces and all, up to its closing quote', () => {
    expect(tokenAt('see @"My Docs/no', 16)).toEqual({
      kind: 'mention',
      query: 'My Docs/no',
      start: 4,
      end: 16,
      quoted: true,
    });
    expect(tokenAt('see @"My Docs/notes.md" ok', 10)).toMatchObject({ query: 'My D', end: 23 });
    // After its closing quote the mention is over.
    expect(tokenAt('see @"a b.md" ', 13)).toBeUndefined();
    expect(tokenAt('see @"a b.md" ', 14)).toBeUndefined();
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

  it('keeps a quoted folder open and closes the quote on the file', () => {
    const open = tokenAt('see @"My Docs/', 14)!;
    expect(complete('see @"My Docs/', open, '@"My Docs/Old/')).toEqual({
      text: 'see @"My Docs/Old/',
      caret: 18,
    });
    const file = tokenAt('see @"My Docs/no" and', 16)!;
    expect(complete('see @"My Docs/no" and', file, '@"My Docs/notes.md"')).toEqual({
      text: 'see @"My Docs/notes.md" and',
      caret: 24,
    });
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

describe('tokens beside attachment chips', () => {
  const M = '￼';
  it('ends a word at a chip, as a space does', () => {
    expect(tokenAt(`${M}@sr`, 4)).toEqual({ kind: 'mention', query: 'sr', start: 1, end: 4 });
    expect(tokenAt(`@src${M}`, 4)).toEqual({ kind: 'mention', query: 'src', start: 0, end: 4 });
    expect(tokenAt(`/rev${M}`, 4)).toEqual({ kind: 'command', query: 'rev', start: 0, end: 4 });
  });

  it('keeps a chip inside a command\'s arguments', () => {
    expect(asCommand(`/review ${M} this`, commands)).toEqual({ name: 'review', args: `${M} this` });
  });
});
