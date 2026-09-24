/**
 * Installing and updating the bridge from the app, over the real IPC seam, and
 * the policy that decides when an automatic update may run.
 */

import { describe, expect, it } from 'vitest';
import { installFakeBackend } from '../../test/tauri';
import { BridgeClientStore } from './client.svelte';
import { BridgeInstallStore, autoUpdateDue } from './install.svelte';

const due = (over: Partial<Parameters<typeof autoUpdateDue>[0]> = {}) =>
  autoUpdateDue({
    enabled: true,
    managed: true,
    status: { updateAvailable: true, latestVersion: '0.0.30', activeTurns: 0 },
    attemptedFor: null,
    installing: false,
    ...over,
  });

describe('autoUpdateDue', () => {
  it('updates a bridge the app runs, at a quiet moment, once per version', () => {
    expect(due()).toBe(true);
    expect(due({ attemptedFor: '0.0.30' })).toBe(false);
  });

  it('never runs while a turn is in flight on any client', () => {
    expect(due({ status: { updateAvailable: true, latestVersion: '0.0.30', activeTurns: 2 } })).toBe(false);
  });

  it('stays off unless enabled, for a bridge it can restart, with an update out', () => {
    expect(due({ enabled: false })).toBe(false);
    expect(due({ managed: false })).toBe(false);
    expect(due({ installing: true })).toBe(false);
    expect(due({ status: { updateAvailable: false, latestVersion: '0.0.30' } })).toBe(false);
    expect(due({ status: null })).toBe(false);
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
});
