import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DAEMON_CONFIG, mergeAgentModels, resolveDaemonConfig } from '../src/index.js';

/** Extract the model ids from a resolved Claude Code config. */
function claudeModelIds(config: ReturnType<typeof resolveDaemonConfig>): string[] {
  return (config.agents['claude-code']?.models ?? []).map((m) =>
    typeof m === 'string' ? m : m.id,
  );
}

test('resolveDaemonConfig returns the defaults for null/empty input', () => {
  assert.deepEqual(resolveDaemonConfig(null), DEFAULT_DAEMON_CONFIG);
  assert.deepEqual(resolveDaemonConfig({}), DEFAULT_DAEMON_CONFIG);
});

test('resolveDaemonConfig seeds Claude Code with concrete pinned models', () => {
  const ids = (resolveDaemonConfig({}).agents['claude-code']?.models ?? []).map((m) =>
    typeof m === 'string' ? m : m.id,
  );
  assert.ok(ids.includes('claude-fable-5'));
  assert.ok(ids.includes('claude-opus-4-8'));
  assert.ok(ids.includes('claude-sonnet-5'));
  assert.ok(ids.includes('claude-sonnet-4-6'));
});

test('a partial per-agent override preserves seeded defaults like models', () => {
  const merged = resolveDaemonConfig({
    agents: { 'claude-code': { permissionMode: 'bypassPermissions' } },
  });
  const claude = merged.agents['claude-code'];
  assert.equal(claude?.permissionMode, 'bypassPermissions');
  // models survived the partial override (not wiped by the shallow merge)
  assert.ok((claude?.models?.length ?? 0) > 0);
});

test('an explicit empty models keeps the seeded baseline (union, not replace)', () => {
  const merged = resolveDaemonConfig({
    agents: { 'claude-code': { models: [] } },
  });
  // Empty user list no longer wipes the seed — the built-in baseline stays.
  assert.ok(claudeModelIds(merged).includes('claude-sonnet-5'));
});

test('a persisted models list still gains newly-seeded models (no shadow)', () => {
  // Simulate an install whose on-disk config was frozen before Sonnet 5 existed:
  // an older subset of pins, missing claude-sonnet-5.
  const merged = resolveDaemonConfig({
    agents: {
      'claude-code': {
        models: [
          { id: 'claude-opus-4-8', displayName: 'Opus 4.8' },
          { id: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
        ],
      },
    },
  });
  const ids = claudeModelIds(merged);
  assert.ok(ids.includes('claude-sonnet-5')); // surfaced from the live seed
  assert.ok(ids.includes('claude-opus-4-8')); // the user's pin survives
});

test('a user models entry overrides the seed displayName for the same id', () => {
  const merged = resolveDaemonConfig({
    agents: { 'claude-code': { models: [{ id: 'claude-sonnet-5', displayName: 'My Sonnet' }] } },
  });
  const sonnet = (merged.agents['claude-code']?.models ?? []).find(
    (m) => (typeof m === 'string' ? m : m.id) === 'claude-sonnet-5',
  );
  assert.equal(typeof sonnet === 'string' ? undefined : sonnet?.displayName, 'My Sonnet');
});

test('mergeAgentModels unions by id (user wins, seed order first)', () => {
  const out = mergeAgentModels(
    [{ id: 'a', displayName: 'A' }, 'b'],
    [{ id: 'b', displayName: 'B2' }, { id: 'c' }],
  );
  assert.deepEqual(
    out?.map((m) => (typeof m === 'string' ? m : m.id)),
    ['a', 'b', 'c'],
  );
  const b = out?.find((m) => (typeof m === 'string' ? m : m.id) === 'b');
  assert.equal(typeof b === 'string' ? undefined : b?.displayName, 'B2');
  // Nothing on either side → undefined (field stays absent, not an empty array).
  assert.equal(mergeAgentModels(undefined, undefined), undefined);
  assert.equal(mergeAgentModels([], []), undefined);
});

test('overriding one agent does not wipe another agent default', () => {
  const merged = resolveDaemonConfig({
    agents: { codex: { permissionMode: 'default' } },
  });
  assert.equal(merged.agents['codex']?.permissionMode, 'default');
  // Claude Code's seeded models are still present.
  assert.ok((merged.agents['claude-code']?.models?.length ?? 0) > 0);
});
