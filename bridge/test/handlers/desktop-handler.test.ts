import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRequest } from '@uxnan/shared';
import { startBridge } from '../../src/bridge.js';
import { InMemorySecretStore } from '../../src/secret-store.js';

const TOOLS = { mcpUrl: 'http://127.0.0.1:51234/mcp', token: 'desktop-token-0123456789' };
const LOCAL = { sessionId: 'local:desktop', deviceId: 'local:desktop', local: 'desktop' };
const PHONE = { sessionId: 'relay-1', deviceId: 'phone-1' };

test('only a local client attaches desktop tools, and only a loopback endpoint', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'uxnan-desktop-'));
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  try {
    const call = (params: unknown, session: typeof LOCAL | typeof PHONE) =>
      bridge.router.dispatch(makeRequest('a', 'desktop/attach', params as never), session);

    const fromPhone = (await call(TOOLS, PHONE)) as { error?: { code: number } };
    assert.equal(fromPhone.error?.code, -32001);
    assert.equal(bridge.context.agentManager.desktopToolsAttached, false);

    const remote = (await call({ ...TOOLS, mcpUrl: 'http://10.0.0.5:51234/mcp' }, LOCAL)) as {
      error?: { code: number };
    };
    assert.equal(remote.error?.code, -32602);

    const ok = (await call(TOOLS, LOCAL)) as { result?: { attached: boolean } };
    assert.deepEqual(ok.result, { attached: true });
    assert.equal(bridge.context.agentManager.desktopToolsAttached, true);

    // Another local client cannot drop what the desktop attached; the desktop can.
    bridge.context.agentManager.clearDesktopTools('someone-else');
    assert.equal(bridge.context.agentManager.desktopToolsAttached, true);
    const detached = (await bridge.router.dispatch(makeRequest('d', 'desktop/detach'), LOCAL)) as {
      result?: { attached: boolean };
    };
    assert.deepEqual(detached.result, { attached: false });
  } finally {
    await bridge.stop();
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("two desktop profiles keep their own tools; one leaving does not take the other's", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'uxnan-desktop-'));
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  try {
    const installed = LOCAL;
    const dev = {
      sessionId: 'local:desktop-dev',
      deviceId: 'local:desktop-dev',
      local: 'desktop-dev',
    };
    const attach = (session: typeof LOCAL, token: string) =>
      bridge.router.dispatch(makeRequest('a', 'desktop/attach', { ...TOOLS, token }), session);
    await attach(installed, 'installed-token-0123456789');
    await attach(dev, 'dev-token-0123456789abcdef');
    const detached = (await bridge.router.dispatch(makeRequest('d', 'desktop/detach'), dev)) as {
      result?: { attached: boolean };
    };
    // The development build went away; the installed app's agents keep theirs.
    assert.deepEqual(detached.result, { attached: true });
    bridge.context.agentManager.clearDesktopTools(installed.local);
    assert.equal(bridge.context.agentManager.desktopToolsAttached, false);
  } finally {
    await bridge.stop();
    await rm(baseDir, { recursive: true, force: true });
  }
});
