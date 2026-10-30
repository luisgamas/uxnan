/**
 * Installing and updating the bridge from the app, over the real IPC seam, and
 * the policy that decides when an automatic update may run.
 */

import { describe, expect, it } from 'vitest';
import { installFakeBackend } from '../../test/tauri';
import { BridgeClientStore } from './client.svelte';
import { BridgeInstallStore, autoUpdateDue, updateOffer } from './install.svelte';
import type { BridgeStatus, BridgeUpdate } from '$shared/models/session';

const UPDATE: BridgeUpdate = {
  version: '0.0.29',
  latestVersion: '0.0.30',
  available: true,
  canApply: true,
  phase: 'idle',
};

const due = (over: Partial<Parameters<typeof autoUpdateDue>[0]> = {}) =>
  autoUpdateDue({
    enabled: true,
    managed: true,
    status: { version: '0.0.29', update: UPDATE, activeTurns: 0 },
    bundledVersion: null,
    attemptedFor: null,
    installing: false,
    ...over,
  });

const INFO = {
  bundledVersion: '0.0.31',
  serviceSupported: true,
  service: 'bundled' as const,
  serviceVersion: '0.0.31',
  pathFound: false,
  pathVersion: null,
};

describe('updateOffer', () => {
  it('asks an independent bridge to update itself when it can', () => {
    expect(updateOffer({ version: '0.0.29', update: UPDATE }, null)).toEqual({ via: 'self', version: '0.0.30' });
    expect(updateOffer({ version: '0.0.29', update: { ...UPDATE, available: false } }, null)).toBeNull();
    expect(updateOffer({ version: '0.0.29', update: { ...UPDATE, phase: 'updating' } }, null)).toBeNull();
    // It cannot, and this app carries nothing newer: nothing to offer.
    expect(updateOffer({ version: '0.0.29', update: { ...UPDATE, canApply: false } }, '0.0.29')).toBeNull();
  });

  it("offers the app's own bridge in place of one that cannot update itself", () => {
    expect(updateOffer({ version: '0.0.29', update: { ...UPDATE, canApply: false } }, '0.0.31')).toEqual({
      via: 'app',
      version: '0.0.31',
    });
    // Older than updating itself (no `update`).
    expect(updateOffer({ version: '0.0.20' }, '0.0.31')).toEqual({ via: 'app', version: '0.0.31' });
    expect(updateOffer(null, '0.0.31')).toBeNull();
  });

  it('keeps the bridge this app installed at the version the app carries, nothing else', () => {
    const own = { version: '0.0.29', host: { launchedBy: 'service' as const, machineName: 'm', install: 'bundled' as const } };
    expect(updateOffer({ ...own, update: UPDATE }, '0.0.31')).toEqual({ via: 'app', version: '0.0.31' });
    // npm has something newer, but the app does not: it waits for the app.
    expect(updateOffer({ ...own, update: UPDATE }, '0.0.29')).toBeNull();
    expect(updateOffer({ ...own, update: UPDATE }, null)).toBeNull();
  });
});

describe('autoUpdateDue', () => {
  const own = { launchedBy: 'service' as const, machineName: 'm', install: 'bundled' as const };

  it('updates an independent bridge when allowed, at a quiet moment, once per version', () => {
    expect(due()).toBe(true);
    expect(due({ attemptedFor: 'self:0.0.30' })).toBe(false);
    expect(due({ enabled: false })).toBe(false);
  });

  it('never runs while a turn is in flight on any client', () => {
    expect(due({ status: { version: '0.0.29', update: UPDATE, activeTurns: 2 } })).toBe(false);
    expect(
      due({ status: { version: '0.0.29', host: own, activeTurns: 1 }, bundledVersion: '0.0.31' }),
    ).toBe(false);
  });

  it('keeps its own bridge current even with the switch off, and never swaps the user\'s unasked', () => {
    expect(
      due({ enabled: false, status: { version: '0.0.29', host: own, activeTurns: 0 }, bundledVersion: '0.0.31' }),
    ).toBe(true);
    // An independent bridge too old to update itself: offered, never automatic.
    expect(due({ status: { version: '0.0.20', activeTurns: 0 }, bundledVersion: '0.0.31' })).toBe(false);
  });

  it('stays off for a bridge it does not keep running, or while installing', () => {
    expect(due({ managed: false })).toBe(false);
    expect(due({ installing: true })).toBe(false);
    expect(
      due({ status: { version: '0.0.29', update: { ...UPDATE, available: false }, activeTurns: 0 } }),
    ).toBe(false);
  });
});

describe('BridgeInstallStore', () => {
  it('probes what is on this machine', async () => {
    installFakeBackend({ bridge_install_probe: () => INFO });
    const store = new BridgeInstallStore(new BridgeClientStore());
    await store.probe();
    expect(store.info?.service).toBe('bundled');
    expect(store.bundledVersion).toBe('0.0.31');
  });

  it("installs the app's bridge and keeps how it ended", async () => {
    installFakeBackend({
      bridge_install_probe: () => INFO,
      bridge_install: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { ok: true, version: '0.0.31', rolledBack: false, error: null };
      },
    });
    const store = new BridgeInstallStore(new BridgeClientStore());
    await store.start();
    const result = await store.install();
    expect(result?.ok).toBe(true);
    expect(result?.version).toBe('0.0.31');
    expect(store.lastResult?.ok).toBe(true);
    expect(store.installing).toBe(false);
  });

  it('reports a failed install instead of throwing', async () => {
    installFakeBackend({
      bridge_install: () => {
        throw { message: 'boom', code: 'X' };
      },
      bridge_install_probe: () => null,
    });
    const store = new BridgeInstallStore(new BridgeClientStore());
    const result = await store.install();
    expect(result?.ok).toBe(false);
    expect(result?.error).toBe('boom');
  });

  it('brings the bridge it installed up to the version it carries, once no turn runs', async () => {
    let turns = 1;
    const status = (): BridgeStatus => ({
      version: '0.0.29',
      relayConnected: false,
      lanEnabled: true,
      activeSessions: 0,
      platform: 'darwin',
      uptimeMs: 1,
      activeTurns: turns,
      host: { launchedBy: 'service', machineName: 'm', install: 'bundled' },
      update: { ...UPDATE, available: false, canApply: false },
    });
    const backend = installFakeBackend({
      bridge_client_status: () => ({ state: 'connected', bridgeVersion: '0.0.29', managed: true }),
      bridge_install_probe: () => INFO,
      bridge_install: () => ({ ok: true, version: '0.0.31', rolledBack: false, error: null }),
      bridge_call: (args) => (args.method === 'bridge/status' ? status() : null),
    });
    const client = new BridgeClientStore();
    await client.start();
    const store = new BridgeInstallStore(client);
    await store.start();
    await store.refreshStatus();
    expect(store.offer).toEqual({ via: 'app', version: '0.0.31' });
    expect(backend.called('bridge_install')).toBe(false);
    turns = 0;
    await store.refreshStatus();
    expect(backend.called('bridge_install')).toBe(true);
    expect(store.outcome).toEqual({ ok: true, version: '0.0.31' });
  });

  it('removes the bridge it installed through the backend', async () => {
    const backend = installFakeBackend({ bridge_uninstall: () => null, bridge_install_probe: () => INFO });
    const store = new BridgeInstallStore(new BridgeClientStore());
    await store.uninstall();
    expect(backend.called('bridge_uninstall')).toBe(true);
    expect(store.uninstalling).toBe(false);
  });

  it('"Check again" asks the running bridge for the newest version now', async () => {
    const calls: string[] = [];
    let latest = '0.0.29';
    const status = (): BridgeStatus => ({
      version: '0.0.29',
      relayConnected: false,
      lanEnabled: true,
      activeSessions: 0,
      platform: 'darwin',
      uptimeMs: 1,
      update: { ...UPDATE, latestVersion: latest, available: latest !== '0.0.29' },
    });
    installFakeBackend({
      bridge_client_status: () => ({ state: 'connected', bridgeVersion: '0.0.29', managed: true }),
      bridge_install_probe: () => ({ ...INFO, bundledVersion: null }),
      bridge_call: (args) => {
        calls.push(String(args.method));
        if (args.method === 'bridge/checkForUpdate') {
          latest = '0.0.30';
          return status().update;
        }
        if (args.method === 'bridge/status') return status();
        return null;
      },
    });
    const client = new BridgeClientStore();
    await client.start();
    const store = new BridgeInstallStore(client);
    await store.start();
    await store.refreshStatus();
    expect(store.offer).toBeNull();

    await store.checkForUpdate();
    expect(calls).toContain('bridge/checkForUpdate');
    expect(store.offer).toEqual({ via: 'self', version: '0.0.30' });
  });

  it('asks the bridge to update itself, then says so when it is back on the new version', async () => {
    const calls: string[] = [];
    let status: BridgeStatus = {
      version: '0.0.29',
      relayConnected: false,
      lanEnabled: true,
      activeSessions: 0,
      platform: 'darwin',
      uptimeMs: 1,
      update: UPDATE,
    };
    const backend = installFakeBackend({
      bridge_client_status: () => ({ state: 'connected', bridgeVersion: '0.0.29', managed: true }),
      bridge_call: (args) => {
        calls.push(String(args.method));
        if (args.method === 'bridge/status') return status;
        if (args.method === 'bridge/update')
          return { ...UPDATE, phase: 'updating', targetVersion: '0.0.30' };
        return null;
      },
    });
    const client = new BridgeClientStore();
    await client.start();
    const store = new BridgeInstallStore(client);
    await store.start();
    await store.refreshStatus();
    expect(store.offer).toEqual({ via: 'self', version: '0.0.30' });

    await store.update();
    expect(calls).toContain('bridge/update');
    expect(store.updating).toBe(true);
    expect(store.pendingVersion).toBe('0.0.30');

    // Every client hears it from the bridge, whoever asked.
    backend.emit('bridge:notification', {
      jsonrpc: '2.0',
      method: 'stream/bridge/updated',
      params: { update: { ...UPDATE, phase: 'updating', targetVersion: '0.0.30' } },
    });
    expect(store.status?.update?.phase).toBe('updating');

    // The bridge comes back on the new version.
    status = { ...status, version: '0.0.30', update: { ...UPDATE, version: '0.0.30', available: false } };
    await store.refreshStatus();
    expect(store.updating).toBe(false);
    expect(store.outcome).toEqual({ ok: true, version: '0.0.30' });
    expect(store.offer).toBeNull();
  });

  it('reports the failure the bridge that came back tells', async () => {
    let status: BridgeStatus = {
      version: '0.0.29',
      relayConnected: false,
      lanEnabled: true,
      activeSessions: 0,
      platform: 'darwin',
      uptimeMs: 1,
      update: UPDATE,
    };
    installFakeBackend({
      bridge_client_status: () => ({ state: 'connected', bridgeVersion: '0.0.29', managed: true }),
      bridge_call: (args) =>
        args.method === 'bridge/update'
          ? { ...UPDATE, phase: 'updating', targetVersion: '0.0.30' }
          : status,
    });
    const client = new BridgeClientStore();
    await client.start();
    const store = new BridgeInstallStore(client);
    await store.refreshStatus();
    await store.update();
    status = {
      ...status,
      update: {
        ...UPDATE,
        phase: 'failed',
        failure: { reason: 'permission', message: 'EACCES', command: 'npm install -g uxnan-bridge@latest' },
      },
    };
    await store.refreshStatus();
    expect(store.outcome).toEqual({ ok: false, version: '0.0.30', message: 'EACCES' });
    expect(store.updating).toBe(false);
  });
});
