import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_MODES, effectiveAccessMode } from '../src/index.js';

test('ACCESS_MODES lists every mode once, in the order the apps show them', () => {
  assert.deepEqual(ACCESS_MODES, ['requestApproval', 'approveForMe', 'fullAccess', 'plan']);
});

test('a stored mode the agent offers is the one it runs in', () => {
  assert.equal(
    effectiveAccessMode(
      { accessModes: ['requestApproval', 'fullAccess'], defaultAccessMode: 'fullAccess' },
      'requestApproval',
    ),
    'requestApproval',
  );
});

test('a stored mode the agent does not offer runs as its default', () => {
  const caps = {
    accessModes: ['approveForMe', 'fullAccess'],
    defaultAccessMode: 'fullAccess',
  } as const;
  const offered = { ...caps, accessModes: [...caps.accessModes] };
  assert.equal(effectiveAccessMode(offered, 'plan'), 'fullAccess');
  assert.equal(effectiveAccessMode(offered, undefined), 'fullAccess');
});

test('a default the agent does not list falls back to its first mode', () => {
  assert.equal(
    effectiveAccessMode(
      { accessModes: ['requestApproval'], defaultAccessMode: 'fullAccess' },
      undefined,
    ),
    'requestApproval',
  );
});

test('an agent with no modes runs as configured', () => {
  assert.equal(effectiveAccessMode({}, 'fullAccess'), undefined);
  assert.equal(effectiveAccessMode({ accessModes: [] }, 'plan'), undefined);
});
