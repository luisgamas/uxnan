import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DAEMON_CONFIG, resolveDaemonConfig } from '../src/index.js';

test('resolveDaemonConfig returns the defaults for null/empty input', () => {
  assert.deepEqual(resolveDaemonConfig(null), DEFAULT_DAEMON_CONFIG);
  assert.deepEqual(resolveDaemonConfig({}), DEFAULT_DAEMON_CONFIG);
});

test('no agent ships a hand-kept model list: pickers come from each CLI', () => {
  // Claude Code's models come from its own `initialize`; a list kept here
  // would be a second source that goes stale with every release.
  assert.deepEqual(DEFAULT_DAEMON_CONFIG.agents, {});
  assert.equal(resolveDaemonConfig({}).agents['claude-code'], undefined);
});

test('a user models list is kept as written', () => {
  const merged = resolveDaemonConfig({
    agents: {
      'claude-code': {
        permissionMode: 'bypassPermissions',
        models: ['claude-opus-4-5', { id: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5' }],
      },
    },
  });
  const claude = merged.agents['claude-code'];
  assert.equal(claude?.permissionMode, 'bypassPermissions');
  assert.deepEqual(claude?.models, [
    'claude-opus-4-5',
    { id: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5' },
  ]);
});

test('overriding one agent leaves the others alone', () => {
  const merged = resolveDaemonConfig({
    agents: {
      codex: { permissionMode: 'default' },
      'claude-code': { model: 'opus' },
    },
  });
  assert.equal(merged.agents['codex']?.permissionMode, 'default');
  assert.equal(merged.agents['claude-code']?.model, 'opus');
});

test('retired Gemini CLI values are removed from persisted configuration', () => {
  const legacy = {
    defaultAgent: 'gemini-cli',
    agents: {
      'gemini-cli': { model: 'gemini-2.5-pro' },
      codex: { permissionMode: 'default' },
    },
    projectAgents: [
      { cwd: 'C:\\legacy', agentId: 'gemini-cli', model: 'gemini-2.5-pro' },
      { cwd: 'C:\\active', agentId: 'codex', model: 'gpt-5' },
    ],
  } as unknown as Parameters<typeof resolveDaemonConfig>[0];

  const resolved = resolveDaemonConfig(legacy);

  assert.equal(resolved.defaultAgent, DEFAULT_DAEMON_CONFIG.defaultAgent);
  assert.equal('gemini-cli' in resolved.agents, false);
  assert.deepEqual(resolved.projectAgents, [
    { cwd: 'C:\\active', agentId: 'codex', model: 'gpt-5' },
  ]);
  assert.equal(resolved.agents.codex?.permissionMode, 'default');
});
