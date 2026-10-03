import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_DAEMON_CONFIG,
  DaemonState,
  InMemorySecretStore,
  normalizeRelayUrl,
  startBridge,
  type Bridge,
  type FetchLike,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cf-token-that-must-never-leak-0123456789';

/** The Cloudflare API plus the deployed relay's `/v1/version`, in their real shapes. */
function fakeCloud(): { fetch: FetchLike; methods: string[] } {
  const methods: string[] = [];
  let deployed: string | undefined;
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status });
  return {
    methods,
    fetch: async (url, init = {}) => {
      const { hostname, pathname } = new URL(url);
      const method = init.method ?? 'GET';
      if (hostname.endsWith('.workers.dev')) {
        return json(200, { name: 'uxnan-relay', protocol: 1, version: '9.9.9' });
      }
      methods.push(`${method} ${pathname.replace(`/client/v4/accounts/${ACCOUNT}`, '')}`);
      if (pathname.endsWith('/workers/subdomain')) {
        return json(200, { success: true, result: { subdomain: 'demo' } });
      }
      if (pathname.endsWith('/uxnan-relay/settings')) {
        return deployed === undefined
          ? json(404, { success: false, errors: [{ code: 10007, message: 'not found' }] })
          : json(200, {
              success: true,
              result: {
                bindings: [{ type: 'plain_text', name: 'UXNAN_HOST_KEYS', text: deployed }],
              },
            });
      }
      if (pathname.endsWith('/uxnan-relay') && method === 'PUT') {
        deployed = 'k'.repeat(64);
        return json(200, { success: true, result: {} });
      }
      if (pathname.endsWith('/uxnan-relay') && method === 'DELETE') {
        deployed = undefined;
        return json(200, { success: true, result: {} });
      }
      return json(200, { success: true, result: {} });
    },
  };
}

async function withBridge(
  run: (
    bridge: Bridge,
    ctx: { baseDir: string; secrets: InMemorySecretStore; methods: string[] },
  ) => Promise<void>,
): Promise<void> {
  const baseDir = join(tmpdir(), `uxnan-relay-svc-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  await state.writeConfig({ ...DEFAULT_DAEMON_CONFIG, lanEnabled: false });
  const secrets = new InMemorySecretStore();
  const cloud = fakeCloud();
  const bridge = await startBridge({
    baseDir,
    secretStore: secrets,
    logLevel: 'error',
    relayFetch: cloud.fetch,
    // The fake deploy names a real-looking workers.dev host: never dial it.
    relayConnect: false,
  });
  await bridge.startRelay();
  try {
    await run(bridge, { baseDir, secrets, methods: cloud.methods });
  } finally {
    await bridge.stop();
    await rmrf(baseDir);
  }
}

test('setup deploys, shares the endpoint, and forgets the token unless asked', async () => {
  await withBridge(async (bridge, { baseDir, secrets, methods }) => {
    const status = await bridge.context
      .relay()
      .setup({ provider: 'cloudflare', accountId: ACCOUNT, apiToken: TOKEN });
    assert.equal(status.endpoint?.url, 'wss://uxnan-relay.demo.workers.dev');
    assert.match(status.endpoint?.routingId ?? '', /^[0-9a-f]{32}$/);
    assert.equal(status.provider, 'cloudflare');
    assert.equal(status.tokenRemembered, false);
    assert.equal(await secrets.get('relay.cloudflare-token'), null);
    assert.deepEqual(bridge.context.settings.get().relay, status.endpoint);
    assert.ok(methods.includes('PUT /workers/scripts/uxnan-relay'));
    // The token is nowhere in what the bridge reports or writes.
    assert.ok(!JSON.stringify(status).includes(TOKEN));
    for (const file of ['relay.json', 'daemon-config.json']) {
      assert.ok(!(await readFile(join(baseDir, file), 'utf8')).includes(TOKEN), file);
    }
  });
});

test('setup with remember keeps the token in the secret store, and update uses it', async () => {
  await withBridge(async (bridge, { secrets, methods }) => {
    const relay = bridge.context.relay();
    await relay.setup({
      provider: 'cloudflare',
      accountId: ACCOUNT,
      apiToken: TOKEN,
      remember: true,
    });
    assert.equal(await secrets.get('relay.cloudflare-token'), TOKEN);
    assert.equal(relay.status().tokenRemembered, true);
    const routingId = relay.status().endpoint?.routingId;
    methods.length = 0;
    await relay.update({});
    assert.ok(methods.includes('PUT /workers/scripts/uxnan-relay'));
    assert.equal(relay.status().endpoint?.routingId, routingId, 'an update keeps the address');
  });
});

test('update without a token, none remembered, asks for one', async () => {
  await withBridge(async (bridge) => {
    const relay = bridge.context.relay();
    await relay.setup({ provider: 'cloudflare', accountId: ACCOUNT, apiToken: TOKEN });
    await assert.rejects(relay.update({}), /token is needed/);
  });
});

test('setup refuses a malformed account id or token before calling Cloudflare', async () => {
  await withBridge(async (bridge, { methods }) => {
    const relay = bridge.context.relay();
    await assert.rejects(
      relay.setup({ provider: 'cloudflare', accountId: 'acct', apiToken: TOKEN }),
      /32 hexadecimal/,
    );
    await assert.rejects(
      relay.setup({ provider: 'cloudflare', accountId: ACCOUNT, apiToken: 'short' }),
      /does not look like/,
    );
    assert.equal(methods.length, 0);
  });
});

test('remove with deleteWorker takes the Worker off and clears the shared setting', async () => {
  await withBridge(async (bridge, { secrets, methods }) => {
    const relay = bridge.context.relay();
    await relay.setup({
      provider: 'cloudflare',
      accountId: ACCOUNT,
      apiToken: TOKEN,
      remember: true,
    });
    const status = await relay.remove({ deleteWorker: true });
    assert.equal(status.endpoint, null);
    assert.equal(status.state, 'off');
    assert.equal(bridge.context.settings.get().relay, null);
    assert.equal(await secrets.get('relay.cloudflare-token'), null);
    assert.ok(methods.includes('DELETE /workers/scripts/uxnan-relay'));
  });
});

test('actions that need a relay say so when none is set up', async () => {
  await withBridge(async (bridge) => {
    const relay = bridge.context.relay();
    await assert.rejects(relay.setEnabled(true, Date.now()), /No relay is set up/);
    await assert.rejects(relay.rotate(), /No relay is set up/);
    assert.equal(relay.status().endpoint, null);
    assert.equal(relay.pairingRelay(), undefined);
  });
});

test('normalizeRelayUrl keeps scheme and host, and allows plain ws only on this machine', () => {
  assert.equal(normalizeRelayUrl('wss://r.example.com/v1/x/'), 'wss://r.example.com');
  assert.equal(normalizeRelayUrl('https://r.example.com'), 'wss://r.example.com');
  assert.equal(normalizeRelayUrl('ws://127.0.0.1:8787'), 'ws://127.0.0.1:8787');
  assert.throws(() => normalizeRelayUrl('ws://r.example.com'), /wss:\/\//);
  assert.throws(() => normalizeRelayUrl('not a url'), /wss:\/\//);
});
