import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthStatus, type AccountStatusDeps } from '../src/index.js';

function deps(over: Partial<AccountStatusDeps> = {}): AccountStatusDeps {
  return {
    isAvailable: () => true,
    homeDir: '/home/dev',
    fileExists: async () => false,
    platform: 'linux',
    ...over,
  };
}

test('available agent with its auth file present is authenticated (no login needed)', async () => {
  const status = await getAuthStatus('codex', deps({ fileExists: async () => true }));
  assert.equal(status.agentId, 'codex');
  assert.equal(status.requiresLogin, false);
  assert.equal(status.authenticatedProvider, 'openai');
  assert.equal(status.loginInProgress, false);
  assert.equal(status.transportMode, 'local');
  assert.equal(status.platform, 'linux');
});

test('available agent without its auth file requires login (no provider leaked)', async () => {
  const status = await getAuthStatus('codex', deps({ fileExists: async () => false }));
  assert.equal(status.requiresLogin, true);
  assert.equal(status.authenticatedProvider, undefined);
});

test('an unavailable agent always requires login and never probes files', async () => {
  let probed = false;
  const status = await getAuthStatus(
    'claude-code',
    deps({
      isAvailable: () => false,
      fileExists: async () => {
        probed = true;
        return true;
      },
    }),
  );
  assert.equal(status.requiresLogin, true);
  assert.equal(probed, false);
});

test('an agent with no auth-file mapping falls back to availability', async () => {
  const status = await getAuthStatus('echo', deps({ isAvailable: () => true }));
  assert.equal(status.requiresLogin, false);
  assert.equal(status.authenticatedProvider, undefined);
});

test('the snapshot never contains a token/secret field', async () => {
  const status = await getAuthStatus('codex', deps({ fileExists: async () => true }));
  const keys = Object.keys(status);
  assert.ok(!keys.some((k) => /token|secret|key|password|credential/i.test(k)));
});
