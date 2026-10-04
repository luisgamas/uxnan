/**
 * The window's side of the bridge connection, over the real Tauri IPC seam:
 * the status the backend reports, the notifications it forwards, and the one
 * call path.
 */

import { describe, expect, it, vi } from 'vitest';
import { installFakeBackend, type FakeBackend } from '../../test/tauri';
import { BridgeCallError, BridgeClientStore, BridgeRegistry, isNotification } from './client.svelte';

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

describe('BridgeRegistry — the bridges of hosts', () => {
  const CONNECTED = { state: 'connected', bridgeVersion: '0.0.46', instanceId: 'i', managed: false };

  it('gives each host its own store, fed by the hosts\' events', async () => {
    backend = installFakeBackend({
      bridge_hosts_status: () => [{ hostId: 'h1', status: { state: 'connecting' } }],
    });
    const local = new BridgeClientStore();
    const bridges = new BridgeRegistry(local);
    await bridges.start();

    const h1 = bridges.for('ssh:h1');
    expect(h1.status).toEqual({ state: 'connecting' });
    expect(bridges.for('local')).toBe(local);
    expect(bridges.for(undefined)).toBe(local);

    backend.emit('bridge:host-status', { hostId: 'h1', status: CONNECTED });
    await vi.waitFor(() => expect(h1.connected).toBe(true));
    // Another host is a different machine: nothing it says reaches h1.
    backend.emit('bridge:host-status', { hostId: 'h2', status: { state: 'off' } });
    const heard = vi.fn();
    h1.onNotification(heard);
    backend.emit('bridge:host-notification', { hostId: 'h2', message: { method: 'stream/x' } });
    backend.emit('bridge:host-notification', { hostId: 'h1', message: { method: 'stream/y' } });
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    expect(heard).toHaveBeenCalledWith({ method: 'stream/y' });
    expect(local.connected).toBe(false);
  });

  it('sends a host store\'s calls and retries to that host, and the local one\'s as before', async () => {
    backend = installFakeBackend({
      bridge_call: () => ({ ok: true }),
      bridge_host_retry: () => null,
      bridge_client_retry: () => null,
    });
    const bridges = new BridgeRegistry(new BridgeClientStore());
    await bridges.for('ssh:h1').call('bridge/status');
    expect(backend.lastCallTo('bridge_call')?.args).toEqual({
      method: 'bridge/status',
      params: null,
      target: 'ssh:h1',
    });
    await bridges.local.call('bridge/status');
    expect(backend.lastCallTo('bridge_call')?.args).toEqual({ method: 'bridge/status', params: null });

    await bridges.for('ssh:h1').retry();
    expect(backend.lastCallTo('bridge_host_retry')?.args).toEqual({ hostId: 'h1' });
    expect(backend.called('bridge_client_retry')).toBe(false);
  });

  it('tells a late subscriber about the host stores already there', () => {
    installFakeBackend({});
    const bridges = new BridgeRegistry(new BridgeClientStore());
    bridges.for('ssh:h1');
    const seen: string[] = [];
    bridges.onHostStore((store) => seen.push(store.target));
    bridges.for('ssh:h2');
    bridges.for('ssh:h1');
    expect(seen).toEqual(['ssh:h1', 'ssh:h2']);
  });
});

describe('BridgeRegistry.offersChat', () => {
  it('offers a chat here always, and on a host only while its own bridge is connected', () => {
    installFakeBackend({});
    const bridges = new BridgeRegistry(new BridgeClientStore());
    expect(bridges.offersChat('local')).toBe(true);
    expect(bridges.offersChat(undefined)).toBe(true);
    // A host nobody has heard from: no store is made to answer.
    expect(bridges.offersChat('ssh:h9')).toBe(false);
    expect(bridges.hosts()).toEqual([]);
    const h1 = bridges.for('ssh:h1');
    expect(bridges.offersChat('ssh:h1')).toBe(false);
    h1.applyStatus({ state: 'connected', bridgeVersion: '0.0.46', instanceId: 'i', managed: false });
    expect(bridges.offersChat('ssh:h1')).toBe(true);
    h1.applyStatus({ state: 'off' });
    expect(bridges.offersChat('ssh:h1')).toBe(false);
  });
});
