import { describe, expect, it } from 'vitest';

import { lastReplyPreview } from './replyPreview';

/** A faithful capture of what a TUI agent actually leaves on screen: banner,
 *  tool calls, spinner frames, the reply, and the input box below it. */
const REAL_SESSION = [
  '╭───────────────────────────────────────────────╮',
  '│  ✻ Welcome to the Agent CLI                   │',
  '│    v2.1.220  ·  model: sonnet                 │',
  '╰───────────────────────────────────────────────╯',
  ' Tips for getting started:',
  ' 1. Ask questions about your codebase',
  '> ¿Qué es el proyecto Uxnan?',
  '⏺ Voy a leer el README para responderte.',
  '⏺ Read(README.md)',
  '  ⎿  Read 240 lines',
  '⠋ Thinking…',
  '⠙ Thinking…',
  '⏺ **Uxnan** es un monorepo en fase alpha que convierte cualquier CLI de agente',
  '  de IA en algo que puedes manejar desde el móvil.',
  '  - `uxnanmobile/` — app Flutter (Android + iOS)',
  '  - `bridge/` — demonio Node que conduce los CLI en tu PC',
  '╭──────────────────────────────────────────────╮',
  '│ >                                            │',
  '╰──────────────────────────────────────────────╯',
  '  ? for shortcuts                    Context: 12%',
].join('\n');

describe('lastReplyPreview', () => {
  it('shows the START of the last reply, not its tail', () => {
    // The bottom of a TUI is the input box, and the bottom of the reply is a
    // mid-paragraph fragment; neither is what the card should say.
    expect(lastReplyPreview(REAL_SESSION)).toBe(
      'Uxnan es un monorepo en fase alpha que convierte cualquier CLI de agente',
    );
  });

  it('skips the input box, the shortcut footer and the context meter', () => {
    const preview = lastReplyPreview(REAL_SESSION) ?? '';
    expect(preview).not.toMatch(/shortcuts|Context:/);
    expect(preview.startsWith('>')).toBe(false);
  });

  it('never shows a spinner frame', () => {
    expect(lastReplyPreview('⏺ Done deploying\n⠋ Thinking…\n⠙ Thinking…')).toBe('Done deploying');
  });

  it('never shows the user’s own prompt back to them', () => {
    // Walking up from the bottom must not stop on the user's turn: the card is
    // reporting what the agent answered.
    expect(lastReplyPreview('⏺ The token expired\n> and now?')).toBe('The token expired');
  });

  it('strips markdown and the CLI’s own leading markers', () => {
    expect(lastReplyPreview('⏺ **Fixed** the `login` bug')).toBe('Fixed the login bug');
    expect(lastReplyPreview('  •  Ran the tests')).toBe('Ran the tests');
  });

  it('collapses a wrapped reply into one readable line', () => {
    expect(lastReplyPreview('⏺ I checked   the    logs')).toBe('I checked the logs');
  });

  it('clips a long reply instead of overflowing the card', () => {
    const preview = lastReplyPreview(`⏺ ${'word '.repeat(80)}`, 40) ?? '';
    expect(preview.length).toBe(40);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('returns nothing rather than glyphs when there is no reply yet', () => {
    expect(lastReplyPreview(null)).toBeNull();
    expect(lastReplyPreview('')).toBeNull();
    expect(lastReplyPreview('╭────╮\n│    │\n╰────╯')).toBeNull();
    expect(lastReplyPreview('> just the user typing')).toBeNull();
    expect(lastReplyPreview('⠋\n⠙\n⠹')).toBeNull();
  });
});
