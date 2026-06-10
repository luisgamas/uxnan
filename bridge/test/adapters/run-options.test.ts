import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REASONING_KEY,
  reasoningOption,
  reasoningValue,
  withOptions,
} from '../../src/adapters/run-options.js';
import type { AgentModel } from '@uxnan/shared';

test('reasoningValue prefers the reasoning knob over the legacy effort', () => {
  assert.equal(
    reasoningValue({ threadId: 't', turnId: 'u', text: 'x', options: { reasoning: 'max' } }),
    'max',
  );
  assert.equal(
    reasoningValue({
      threadId: 't',
      turnId: 'u',
      text: 'x',
      effort: 'high',
      options: { reasoning: 'low' },
    }),
    'low',
  );
});

test('reasoningValue falls back to the legacy effort, else undefined', () => {
  assert.equal(reasoningValue({ threadId: 't', turnId: 'u', text: 'x', effort: 'high' }), 'high');
  assert.equal(reasoningValue({ threadId: 't', turnId: 'u', text: 'x' }), undefined);
  // a non-string / empty knob is ignored
  assert.equal(
    reasoningValue({ threadId: 't', turnId: 'u', text: 'x', options: { reasoning: '' } }),
    undefined,
  );
  assert.equal(
    reasoningValue({ threadId: 't', turnId: 'u', text: 'x', options: { reasoning: true } }),
    undefined,
  );
});

test('reasoningOption builds an enum knob under the reasoning key', () => {
  const opt = reasoningOption([
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
  ]);
  assert.equal(opt.key, REASONING_KEY);
  assert.equal(opt.kind, 'enum');
  assert.deepEqual(
    opt.values?.map((v) => v.value),
    ['low', 'high'],
  );
});

test('withOptions attaches options to every model and is a no-op when empty', () => {
  const models: AgentModel[] = [
    { id: 'a', displayName: 'A' },
    { id: 'b', displayName: 'B' },
  ];
  const opt = reasoningOption([{ value: 'low', label: 'Low' }]);
  const out = withOptions(models, [opt]);
  assert.deepEqual(
    out.map((m) => m.options?.[0]?.key),
    ['reasoning', 'reasoning'],
  );
  // empty options leaves the models untouched (same array contents)
  assert.deepEqual(withOptions(models, []), models);
});
