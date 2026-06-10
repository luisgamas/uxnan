import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DAEMON_CONFIG, resolveDaemonConfig } from '../src/index.js';

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

test('an explicit empty models clears the seeded default', () => {
  const merged = resolveDaemonConfig({
    agents: { 'claude-code': { models: [] } },
  });
  assert.deepEqual(merged.agents['claude-code']?.models, []);
});

test('overriding one agent does not wipe another agent default', () => {
  const merged = resolveDaemonConfig({
    agents: { codex: { permissionMode: 'default' } },
  });
  assert.equal(merged.agents['codex']?.permissionMode, 'default');
  // Claude Code's seeded models are still present.
  assert.ok((merged.agents['claude-code']?.models?.length ?? 0) > 0);
});
