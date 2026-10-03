/**
 * Every locale fills the same placeholders as English.
 *
 * Key parity is the type's job: `es` is a `Record<MessageKey, string>`, so a
 * missing or extra key fails to compile. What the type cannot see is inside the
 * strings — a translation that renamed `{host}` to `{servidor}`, or dropped it,
 * compiles and then shows a raw `{servidor}` (or nothing) on screen.
 */

import { describe, expect, it } from 'vitest';

import { en, type MessageKey } from './en';
import { es } from './es';

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe('locale placeholders', () => {
  it('Spanish fills exactly the placeholders English does', () => {
    const drift = (Object.keys(en) as MessageKey[])
      .filter((key) => placeholders(en[key]).join() !== placeholders(es[key]).join())
      .map((key) => `${key}: en {${placeholders(en[key])}} / es {${placeholders(es[key])}}`);

    expect(drift).toEqual([]);
  });
});
