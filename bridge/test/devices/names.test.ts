import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRequest, type TrustedDevice } from '@uxnan/shared';
import { DaemonState, InMemorySecretStore, startBridge } from '../../src/index.js';
import { FileTrustStore } from '../../src/transport/trust-store.js';
import { BridgeSettingsStore } from '../../src/settings/bridge-settings.js';
import { SyncLedger } from '../../src/sync/sync-ledger.js';
import { DEFAULT_DAEMON_CONFIG } from '../../src/daemon-config.js';
import { machineName } from '../../src/presence/host-info.js';

// Names every client shares (architecture/02a §5.8.17): each paired phone's,
// and the PC's own. A phone describes itself; a person may rename either on
// any client; the latest decision wins.

async function withState(run: (state: DaemonState, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'uxnan-names-'));
  try {
    await run(new DaemonState(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const phone = (deviceId: string): TrustedDevice => ({
  deviceId,
  displayName: deviceId,
  publicKey: 'ab'.repeat(32),
  pairedAt: 1,
});

test('a phone goes by what it calls itself until a person names it', async () => {
  await withState(async (state) => {
    const store = new FileTrustStore(state);
    const heard: string[][] = [];
    store.onChange((devices) => heard.push(devices.map((d) => d.displayName)));
    await store.upsert(phone('p1'));

    const described = await store.describe(
      'p1',
      { name: 'samsung SM-A556E', model: 'samsung SM-A556E', platform: 'android' },
      10,
    );
    assert.equal(described.device.displayName, 'samsung SM-A556E');
    assert.equal(described.device.nameSource, 'device');
    assert.equal(described.nameAgeMs, undefined);

    // Named on the desktop at 20: the phone's default no longer applies.
    await store.rename('p1', 'Work phone', 20);
    const again = await store.describe('p1', { name: 'samsung SM-A556E' }, 30);
    assert.equal(again.device.displayName, 'Work phone');
    assert.equal(again.nameAgeMs, 10);

    // Re-pairing proves the same phone again: its name stays.
    await store.upsert({ ...phone('p1'), pairedAt: 40 });
    assert.equal((await store.get('p1'))?.displayName, 'Work phone');

    // An empty rename goes back to what the phone calls itself.
    await store.rename('p1', '', 50);
    assert.equal((await store.get('p1'))?.displayName, 'samsung SM-A556E');
    assert.ok(heard.length >= 4, 'every change is announced');
    // What only the bridge needs never leaves it.
    assert.equal('describedName' in ((await store.list())[0] as object), false);
  });
});

test('the latest decision on a name wins, on whichever side it was made', async () => {
  await withState(async (state) => {
    const store = new FileTrustStore(state);
    await store.upsert(phone('p1'));
    await store.rename('p1', 'From the desktop', 100);
    // The owner renamed it on the phone at 60, offline: older, it loses…
    const older = await store.describe('p1', { name: 'From the phone' }, 200, 60);
    assert.equal(older.device.displayName, 'From the desktop');
    assert.equal(older.nameAgeMs, 100);
    // …and a rename decided after the desktop's wins.
    const newer = await store.describe('p1', { name: 'Renamed later' }, 200, 150);
    assert.equal(newer.device.displayName, 'Renamed later');
    const stale = await store.rename('p1', 'Late desktop', 120);
    assert.equal(stale.displayName, 'Renamed later');
  });
});

test("the PC's name is the machine's until changed, and the latest change wins", async () => {
  await withState(async (state, dir) => {
    await mkdir(join(dir, 'work'));
    const ledger = await SyncLedger.load(state);
    const store = new BridgeSettingsStore({ state, ledger, config: DEFAULT_DAEMON_CONFIG });
    await store.load();
    assert.equal(store.get().name, machineName());

    await store.set({ name: 'Studio' }, 100);
    assert.equal(store.get().name, 'Studio');
    assert.equal((await state.readConfig()).name, 'Studio');
    // Changed offline before that: superseded. The home folder is its own
    // decision and still applies.
    await store.set({ name: 'Old', home: join(dir, 'work') }, 50);
    assert.equal(store.get().name, 'Studio');
    assert.match(store.get().home, /work$/);

    // The decisions outlive a restart.
    const reloaded = new BridgeSettingsStore({
      state,
      ledger,
      config: await state.readConfig(),
    });
    await reloaded.load();
    await reloaded.set({ name: 'Older still' }, 80);
    assert.equal(reloaded.get().name, 'Studio');
    // Empty goes back to the machine's name.
    await reloaded.set({ name: '' }, 200);
    assert.equal(reloaded.get().name, machineName());
    assert.equal((await state.readConfig()).name, undefined);
  });
});

test('over the router: phones are in every sync, and only a phone describes itself', async () => {
  await withState(async (_state, dir) => {
    const bridge = await startBridge({
      baseDir: dir,
      secretStore: new InMemorySecretStore(),
      logLevel: 'error',
    });
    try {
      await bridge.trustStore.upsert(phone('p1'));
      const asPhone = { sessionId: 's', deviceId: 'p1' };
      const described = await bridge.router.dispatch(
        makeRequest('1', 'device/describe', { name: 'Pixel 9', platform: 'android' }),
        asPhone,
      );
      assert.ok('result' in described);

      const fromDesktop = await bridge.router.dispatch(
        makeRequest('2', 'device/describe', { name: 'Not a phone' }),
        { sessionId: 'local:desktop', deviceId: 'local:desktop', local: 'desktop' },
      );
      assert.ok('error' in fromDesktop);

      const renamed = await bridge.router.dispatch(
        makeRequest('3', 'device/rename', { deviceId: 'p1', name: 'Travel phone' }),
      );
      assert.ok('result' in renamed);

      const sync = await bridge.router.dispatch(makeRequest('4', 'sync/changes', {}));
      assert.ok('result' in sync);
      const result = sync.result as { devices: TrustedDevice[]; settings: { name: string } };
      assert.deepEqual(
        result.devices.map((d) => [d.displayName, d.platform]),
        [['Travel phone', 'android']],
      );
      assert.equal(result.settings.name, machineName());

      const tooLong = await bridge.router.dispatch(
        makeRequest('5', 'device/rename', { deviceId: 'p1', name: 'x'.repeat(81) }),
      );
      assert.ok('error' in tooLong);
    } finally {
      await bridge.stop();
    }
  });
});
