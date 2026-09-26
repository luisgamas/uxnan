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
    attemptedFor: null,
    installing: false,
    ...over,
  });

describe('updateOffer', () => {
  it('asks the bridge itself when it can, the app installer when it cannot', () => {
    expect(updateOffer({ update: UPDATE })).toEqual({ via: 'self', version: '0.0.30' });
    expect(updateOffer({ update: { ...UPDATE, canApply: false } })).toEqual({
      via: 'installer',
      version: '0.0.30',
    });
    expect(updateOffer({ update: { ...UPDATE, available: false } })).toBeNull();
    expect(updateOffer({ update: { ...UPDATE, phase: 'updating' } })).toBeNull();
  });

  it('offers the installer to a bridge that predates updating itself', () => {
    expect(updateOffer({})).toEqual({ via: 'installer', version: null });
    expect(updateOffer(null)).toBeNull();
  });
});

describe('autoUpdateDue', () => {
  it('updates a bridge the app runs, at a quiet moment, once per version', () => {
    expect(due()).toBe(true);
    expect(due({ attemptedFor: '0.0.30' })).toBe(false);
  });

  it('never runs while a turn is in flight on any client', () => {
    expect(due({ status: { version: '0.0.29', update: UPDATE, activeTurns: 2 } })).toBe(false);
  });

  it('stays off unless enabled, for a bridge it runs, with an update out', () => {
    expect(due({ enabled: false })).toBe(false);
    expect(due({ managed: false })).toBe(false);
    expect(due({ installing: true })).toBe(false);
    expect(
      due({ status: { version: '0.0.29', update: { ...UPDATE, available: false }, activeTurns: 0 } }),
    ).toBe(false);
  });

  it('brings a bridge that predates updating itself up to date, once', () => {
    expect(due({ status: { version: '0.0.28', activeTurns: 0 } })).toBe(true);
    expect(due({ status: { version: '0.0.28', activeTurns: 0 }, attemptedFor: 'from:0.0.28' })).toBe(
      false,
    );
  });
});

describe('BridgeInstallStore', () => {
  it('probes what is installed', async () => {
    installFakeBackend({
      bridge_install_probe: () => ({
        installed: false,
        version: null,
        npm: true,
        nodeVersion: 'v22.1.0',
        command: 'npm install -g uxnan-bridge@latest',
      }),
    });
    const store = new BridgeInstallStore(new BridgeClientStore());
    await store.probe();
    expect(store.info?.installed).toBe(false);
    expect(store.info?.command).toBe('npm install -g uxnan-bridge@latest');
  });

  it('streams the install output and keeps how it ended', async () => {
    const backend = installFakeBackend({
      bridge_install_probe: () => ({
        installed: true,
        version: '0.0.30',
        npm: true,
        nodeVersion: 'v22.1.0',
        command: 'npm install -g uxnan-bridge@latest',
      }),
      bridge_install: async () => {
        backend.emit('bridge:install-log', 'added 1 package in 2s');
        await new Promise((r) => setTimeout(r, 5));
        return { ok: true, version: '0.0.30', permissionDenied: false, tail: [], restarted: true };
      },
    });
    const store = new BridgeInstallStore(new BridgeClientStore());
    await store.start();
    const result = await store.install();
    expect(result?.ok).toBe(true);
    expect(result?.restarted).toBe(true);
    expect(store.log).toEqual(['added 1 package in 2s']);
    expect(store.info?.version).toBe('0.0.30');
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
    expect(result?.tail).toEqual(['boom']);
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
