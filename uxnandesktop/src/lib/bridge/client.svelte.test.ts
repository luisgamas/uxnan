/**
 * The window's side of the bridge connection, over the real Tauri IPC seam:
 * the status the backend reports, the notifications it forwards, and the one
 * call path.
 */

import { describe, expect, it, vi } from 'vitest';
import { installFakeBackend, type FakeBackend } from '../../test/tauri';
import { BridgeCallError, BridgeClientStore, isNotification } from './client.svelte';

// `setup.dom.ts` uninstalls the fake backend after every test.
let backend: FakeBackend;

describe('BridgeClientStore', () => {
  it('hydrates the status, then follows the backend events', async () => {
    backend = installFakeBackend({
      bridge_client_status: () => ({ state: 'connecting' }),
    });
    const client = new BridgeClientStore();
    await client.start();
    expect(client.status).toEqual({ state: 'connecting' });
    const connected = vi.fn();
    client.onConnected(connected);
    backend.emit('bridge:status', {
      state: 'connected',
      bridgeVersion: '1.0',
      instanceId: 'i',
      managed: false,
    });
    await vi.waitFor(() => expect(client.connected).toBe(true));
    expect(connected).toHaveBeenCalledTimes(1);
  });

  it('forwards well-formed notifications and drops the rest', async () => {
    backend = installFakeBackend({ bridge_client_status: () => ({ state: 'off' }) });
    const client = new BridgeClientStore();
    await client.start();
    const seen = vi.fn();
    const stop = client.onNotification(seen);
    backend.emit('bridge:notification', { method: 'stream/turn/started', params: { threadId: 't' } });
    backend.emit('bridge:notification', { nope: true });
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    stop();
    backend.emit('bridge:notification', { method: 'stream/turn/started' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('fires onConnected only on entering the connected state', () => {
    const client = new BridgeClientStore();
    const connected = vi.fn();
    client.onConnected(connected);
    const up = { state: 'connected' as const, bridgeVersion: '1', instanceId: 'i', managed: false };
    client.applyStatus(up);
    client.applyStatus(up);
    client.applyStatus({ state: 'connecting' });
    client.applyStatus(up);
    expect(connected).toHaveBeenCalledTimes(2);
  });

  it('calls through bridge_call and surfaces the backend error code', async () => {
    backend = installFakeBackend({
      bridge_call: (args) => {
        if (args.method === 'thread/list') return { threads: [] };
        throw { message: 'not connected to the bridge', code: 'BRIDGE_NOT_CONNECTED' };
      },
    });
    const client = new BridgeClientStore();
    await expect(client.call('thread/list', {})).resolves.toEqual({ threads: [] });
    expect(backend.lastCallTo('bridge_call')?.args).toEqual({ method: 'thread/list', params: {} });
    const failure = client.call('turn/send', { threadId: 't' });
    await expect(failure).rejects.toBeInstanceOf(BridgeCallError);
    await expect(failure).rejects.toMatchObject({ code: 'BRIDGE_NOT_CONNECTED' });
  });
});

describe('isNotification', () => {
  it('requires a string method', () => {
    expect(isNotification({ method: 'x' })).toBe(true);
    expect(isNotification({ method: 1 })).toBe(false);
    expect(isNotification(null)).toBe(false);
    expect(isNotification('stream/x')).toBe(false);
  });
});
