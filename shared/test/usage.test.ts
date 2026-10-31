import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USAGE_PROVIDERS, type UsageProvider } from '../src/index.js';

test('USAGE_PROVIDERS lists every usage provider once, Gemini CLI never', () => {
  // Assigning each id proves the list and the type agree.
  const expected: UsageProvider[] = [
    'codex',
    'claude',
    'copilot',
    'grok',
    'antigravity',
    'opencode',
  ];
  assert.deepEqual([...USAGE_PROVIDERS], expected);
  assert.equal(new Set(USAGE_PROVIDERS).size, USAGE_PROVIDERS.length);
  assert.ok(!(USAGE_PROVIDERS as readonly string[]).includes('gemini'));
});
