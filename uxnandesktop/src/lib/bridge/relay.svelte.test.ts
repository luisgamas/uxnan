/**
 * The desktop's one replica of the bridge's relay: loaded on every connect,
 * replaced by `stream/relay/updated` and by each `relay/*` answer, and silent
 * about a bridge too old to own a relay.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RelayStatus } from '$shared/models/relay';
import { BridgeClientStore, bridgeErrorText, isUnknownMethodError } from './client.svelte';
import { isRelayStatus, RelayStore, relayUpdateAvailable } from './relay.svelte';

function relayStatus(extra: Partial<RelayStatus> = {}): RelayStatus {
  return {
    endpoint: null,
    state: 'off',
    bundledVersion: '0.2.0',
    tokenRemembered: false,
    connectedPhones: 0,
    hostKey: 'ab'.repeat(32),
    ...extra,
  };
}

const ENDPOINT = { url: 'wss://uxnan-relay.me.workers.dev', routingId: 'f'.repeat(32), enabled: true };

function harness(answer: (method: string, params: unknown) => unknown) {
  const client = new BridgeClientStore();
  const calls: { method: string; params: unknown }[] = [];
  client.call = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params });
    return answer(method, params) as never;
  }) as BridgeClientStore['call'];
  return { client, store: new RelayStore(client), calls };
}

describe('RelayStore', () => {
  it('loads the status on every connect and follows the notification', async () => {
    const { client, store, calls } = harness(() => relayStatus());
    store.start();
    client.applyStatus({ state: 'connected', bridgeVersion: '1', instanceId: 'i', managed: false });
    await vi.waitFor(() => expect(store.status?.endpoint).toBeNull());
    expect(calls.map((c) => c.method)).toEqual(['relay/status']);

    client.dispatch({
      method: 'stream/relay/updated',
      params: { status: relayStatus({ endpoint: ENDPOINT, state: 'connected', connectedPhones: 2 }) },
    });
    expect(store.status?.state).toBe('connected');
    expect(store.status?.connectedPhones).toBe(2);
  });

  it('drops a malformed notification instead of trusting it', () => {
    const { store } = harness(() => relayStatus());
    store.apply({ method: 'stream/relay/updated', params: { status: relayStatus() } });
    store.apply({ method: 'stream/relay/updated', params: { status: { state: 'connected' } } });
    expect(store.status?.state).toBe('off');
  });

  it('marks a bridge without relay methods as unsupported', async () => {
    const { store } = harness(() => {
      throw new Error('Method not found: relay/status (-32601)');
    });
    await store.load();
    expect(store.supported).toBe(false);
    expect(store.status).toBeNull();
  });

  it('keeps what it knew when a load fails for another reason', async () => {
    let fail = false;
    const { store } = harness(() => {
      if (fail) throw new Error('the bridge did not answer in time');
      return relayStatus({ endpoint: ENDPOINT });
    });
    await store.load();
    fail = true;
    await store.load();
    expect(store.supported).toBe(true);
    expect(store.status?.endpoint?.url).toBe(ENDPOINT.url);
  });

  it('sends each action with its contract params and adopts the answer', async () => {
    const { store, calls } = harness((method) =>
      method === 'relay/remove' ? relayStatus() : relayStatus({ endpoint: ENDPOINT, state: 'connected' }),
    );
    await store.setup('a'.repeat(32), 'secret-token-value-123456', true);
    await store.use('wss://relay.example.com');
    await store.setEnabled(false);
    await store.update();
    await store.update('another-token-value-1234567', false);
    await store.rotate();
    expect(store.status?.endpoint?.url).toBe(ENDPOINT.url);
    await store.remove({ deleteWorker: true });
    expect(store.status?.endpoint).toBeNull();
    expect(calls).toEqual([
      {
        method: 'relay/setup',
        params: { provider: 'cloudflare', accountId: 'a'.repeat(32), apiToken: 'secret-token-value-123456', remember: true },
      },
      { method: 'relay/use', params: { url: 'wss://relay.example.com' } },
      { method: 'relay/set', params: { enabled: false } },
      { method: 'relay/update', params: {} },
      { method: 'relay/update', params: { apiToken: 'another-token-value-1234567', remember: false } },
      { method: 'relay/rotate', params: undefined },
      { method: 'relay/remove', params: { deleteWorker: true } },
    ]);
    // The token is a parameter, never state.
    expect(JSON.stringify(store.status)).not.toContain('secret-token');
  });
});

describe('relayUpdateAvailable', () => {
  it('offers an update only for a relay this bridge deployed that runs another version', () => {
    expect(relayUpdateAvailable(null)).toBe(false);
    expect(relayUpdateAvailable(relayStatus())).toBe(false);
    const deployed = relayStatus({ endpoint: ENDPOINT, provider: 'cloudflare', deployedVersion: '0.1.0' });
    expect(relayUpdateAvailable(deployed)).toBe(true);
    expect(relayUpdateAvailable({ ...deployed, deployedVersion: '0.2.0' })).toBe(false);
    expect(relayUpdateAvailable({ ...deployed, provider: 'custom' })).toBe(false);
  });
});

describe('isRelayStatus', () => {
  it('accepts the contract shape and rejects the rest', () => {
    expect(isRelayStatus(relayStatus())).toBe(true);
    expect(isRelayStatus(relayStatus({ endpoint: ENDPOINT }))).toBe(true);
    expect(isRelayStatus({ ...relayStatus(), hostKey: undefined })).toBe(false);
    expect(isRelayStatus(null)).toBe(false);
  });
});

describe('bridge error helpers', () => {
  it('reads the bridge code the transport appends and drops it for people', () => {
    const err = { message: 'Method not found: relay/status (-32601)', code: 'BRIDGE_ERROR' };
    expect(isUnknownMethodError(err)).toBe(true);
    expect(isUnknownMethodError({ message: 'No relay is set up on this PC. (-32602)' })).toBe(false);
    expect(bridgeErrorText({ message: 'No relay is set up on this PC. (-32602)' })).toBe(
      'No relay is set up on this PC.',
    );
    expect(bridgeErrorText({ message: 'not connected to the bridge' })).toBe('not connected to the bridge');
  });
});

describe('RelayStore ordering', () => {
  it('keeps a notification that arrived while relay/status was in flight', async () => {
    let answer!: (status: RelayStatus) => void;
    const client = new BridgeClientStore();
    client.call = vi.fn(
      () => new Promise<RelayStatus>((resolve) => (answer = resolve)),
    ) as unknown as BridgeClientStore['call'];
    const store = new RelayStore(client);
    const loading = store.load();
    store.apply({
      method: 'stream/relay/updated',
      params: { status: relayStatus({ endpoint: ENDPOINT, state: 'connected' }) },
    });
    answer(relayStatus());
    await loading;
    expect(store.status?.state).toBe('connected');
  });
});
