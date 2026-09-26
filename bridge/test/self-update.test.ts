import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonRpcErrorCode, RpcError, type BridgeUpdate } from '@uxnan/shared';
import {
  BridgeUpdater,
  DaemonState,
  DAEMON_FILES,
  installFailure,
  manualUpdateCommand,
  resolveUpdateLayout,
  runSelfUpdateHelper,
  type BridgeUpdaterOptions,
  type UpdateLayout,
  type UpdateResult,
} from '../src/index.js';
import { rmrf } from './helpers/fs.js';

const OLD = '0.0.28-alpha.20260926';
const NEW = '0.0.29-alpha.20260927';

function freshState(): DaemonState {
  return new DaemonState(join(tmpdir(), `uxnan-self-update-${randomUUID()}`));
}

const LAYOUT: UpdateLayout = {
  packageRoot: '/usr/local/lib/node_modules/uxnan-bridge',
  prefix: '/usr/local',
  npmCli: '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
};

function updater(
  state: DaemonState,
  over: Partial<BridgeUpdaterOptions> = {},
  latest?: string,
): { updater: BridgeUpdater; changes: BridgeUpdate[]; handed: string[] } {
  const changes: BridgeUpdate[] = [];
  const handed: string[] = [];
  const u = new BridgeUpdater(
    {
      state,
      version: OLD,
      launchedBy: 'service',
      layout: LAYOUT,
      activeTurns: () => 0,
      now: () => 1_000_000,
      onChange: (update) => changes.push(update),
      handOver: (version) => handed.push(version),
      ...over,
    },
    latest,
  );
  return { updater: u, changes, handed };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 450));

test('resolveUpdateLayout finds the global install and the npm beside it', () => {
  const unix = resolveUpdateLayout(
    '/usr/local/lib/node_modules/uxnan-bridge/dist/src/cli.js',
    'darwin',
    (p) => p === '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
  );
  assert.deepEqual(unix, LAYOUT);
  // Each platform's rules, whatever the host running the test.
  const win = resolveUpdateLayout(
    'C:\\nodejs\\node_modules\\uxnan-bridge\\dist\\src\\cli.js',
    'win32',
    (p) => p === 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
  );
  assert.deepEqual(win, {
    packageRoot: 'C:\\nodejs\\node_modules\\uxnan-bridge',
    prefix: 'C:\\nodejs',
    npmCli: 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
  });
  // A source checkout, and a global install without npm beside it, cannot update.
  assert.match(
    (
      resolveUpdateLayout('/src/uxnan/bridge/dist/src/cli.js', 'darwin', () => true) as {
        reason: string;
      }
    ).reason,
    /source checkout/,
  );
  assert.match(
    (
      resolveUpdateLayout(
        '/usr/local/lib/node_modules/uxnan-bridge/dist/src/cli.js',
        'linux',
        () => false,
      ) as { reason: string }
    ).reason,
    /npm/,
  );
});

test('installFailure tells a permission problem from any other', () => {
  assert.equal(installFailure(true, ['added 1 package']), undefined);
  const denied = installFailure(false, ['npm error code EACCES', 'npm error syscall mkdir']);
  assert.equal(denied?.reason, 'permission');
  assert.equal(denied?.command, manualUpdateCommand());
  assert.equal(installFailure(false, ['npm error code E404'])?.reason, 'install');
});

test('the snapshot says whether an update is out and whether this bridge can apply it', async () => {
  const state = freshState();
  const service = updater(state, {}, NEW).updater.snapshot();
  assert.equal(service.available, true);
  assert.equal(service.canApply, true);
  assert.equal(service.phase, 'idle');
  const cli = updater(state, { launchedBy: 'cli' }, NEW).updater.snapshot();
  assert.equal(cli.canApply, false);
  assert.match(cli.unsupportedReason ?? '', /terminal/);
  const checkout = updater(state, {
    layout: { reason: 'from a source checkout' },
  }).updater.snapshot();
  assert.equal(checkout.canApply, false);
  assert.equal(checkout.available, false);
  await rmrf(state.baseDir);
});

test('the hourly check tells every client only when the newest version changes', async () => {
  const state = freshState();
  let published: string | undefined = OLD;
  const { updater: u, changes } = updater(state, { check: async () => published });
  await u.refresh();
  assert.equal(changes.length, 1);
  await u.refresh();
  assert.equal(changes.length, 1, 'no change, no notification');
  published = NEW;
  await u.refresh();
  assert.equal(changes.length, 2);
  assert.equal(changes[1]?.available, true);
  assert.equal(changes[1]?.latestVersion, NEW);
  published = undefined;
  await u.refresh();
  assert.equal(changes.length, 2, 'an offline check keeps what was known');
  await rmrf(state.baseDir);
});

test('bridge/update hands over to the helper once the answer is out', async () => {
  const state = freshState();
  const { updater: u, changes, handed } = updater(state, { fetchLatest: async () => NEW });
  const entered = await u.apply();
  assert.equal(entered.phase, 'updating');
  assert.equal(entered.targetVersion, NEW);
  assert.equal(changes.at(-1)?.phase, 'updating');
  assert.deepEqual(handed, [], 'not before the reply leaves');
  await settle();
  assert.deepEqual(handed, [NEW]);
  // A second request while updating does not start a second helper.
  assert.equal((await u.apply()).phase, 'updating');
  await settle();
  assert.deepEqual(handed, [NEW]);
  await rmrf(state.baseDir);
});

test('bridge/update refuses under a running turn and on a bridge that cannot replace itself', async () => {
  const state = freshState();
  const busy = updater(state, { activeTurns: () => 1, fetchLatest: async () => NEW }).updater;
  await assert.rejects(busy.apply(), (err: unknown) => {
    assert.ok(err instanceof RpcError);
    assert.equal(err.code, JsonRpcErrorCode.AgentBusy);
    assert.deepEqual(err.data, { reason: 'busy' });
    return true;
  });
  assert.equal(busy.snapshot().phase, 'idle', 'a refusal is not a failed update');
  const cli = updater(state, { launchedBy: 'cli', fetchLatest: async () => NEW }).updater;
  await assert.rejects(cli.apply(), (err: unknown) => {
    assert.ok(err instanceof RpcError);
    assert.equal((err.data as { reason: string }).reason, 'unsupported');
    return true;
  });
  // Nothing newer published: nothing happens.
  const current = updater(state, { fetchLatest: async () => OLD });
  assert.equal((await current.updater.apply()).phase, 'idle');
  await settle();
  assert.deepEqual(current.handed, []);
  await rmrf(state.baseDir);
});

test('the bridge that comes back reports a failed install and forgets a done one', async () => {
  const state = freshState();
  await state.ensureDir();
  const failed: UpdateResult = {
    at: 999_000,
    from: OLD,
    to: NEW,
    ok: false,
    failure: { reason: 'permission', message: 'EACCES', command: manualUpdateCommand() },
  };
  await state.writeJson(DAEMON_FILES.updateResult, failed);
  const back = updater(state).updater;
  await back.init();
  assert.equal(back.snapshot().phase, 'failed');
  assert.equal(back.snapshot().failure?.reason, 'permission');
  assert.equal(await state.readJson(DAEMON_FILES.updateResult), null, 'read once');

  await state.writeJson(DAEMON_FILES.updateResult, { at: 999_000, from: OLD, to: NEW, ok: true });
  const updated = updater(state, { version: NEW }).updater;
  await updated.init();
  assert.equal(updated.snapshot().phase, 'idle');
  await rmrf(state.baseDir);
});

test('the helper waits for the bridge, installs, records the outcome and starts the service', async () => {
  let alive = 3;
  let npmSpec = '';
  let started = 0;
  const written: UpdateResult[] = [];
  let clock = 0;
  const result = await runSelfUpdateHelper({
    pid: 42,
    to: NEW,
    from: OLD,
    cliPath: '/nowhere/src/uxnan/bridge/dist/src/cli.js',
    resultPath: '/tmp/r.json',
    platform: 'darwin',
    startService: async () => {
      started += 1;
    },
    runNpm: async (_layout, spec) => {
      npmSpec = spec;
      return { ok: true, output: [] };
    },
    writeResult: async (_p, r) => {
      written.push(r);
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    alive: () => alive-- > 0,
  });
  // That cli path is a source checkout: nothing is installed, yet the service
  // is started again so the old bridge comes back and says why.
  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, 'unsupported');
  assert.equal(npmSpec, '');
  assert.equal(started, 1);
  assert.equal(written.length, 1);
});

test('the helper records a stuck bridge instead of installing under it', async () => {
  let clock = 0;
  let ran = false;
  const result = await runSelfUpdateHelper({
    pid: 42,
    to: NEW,
    from: OLD,
    cliPath: '/usr/local/lib/node_modules/uxnan-bridge/dist/src/cli.js',
    resultPath: '/tmp/r.json',
    platform: 'darwin',
    startService: async () => undefined,
    runNpm: async () => {
      ran = true;
      return { ok: true, output: [] };
    },
    writeResult: async () => undefined,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    alive: () => true,
    forceStop: () => undefined,
  });
  assert.equal(ran, false);
  assert.equal(result.ok, false);
  assert.match(result.failure?.message ?? '', /did not stop/);
});

test('a bridge stuck after stopping is ended, and the update goes on', async () => {
  let clock = 0;
  let stuck = true;
  const forced: number[] = [];
  let ran = false;
  const result = await runSelfUpdateHelper({
    pid: 42,
    to: NEW,
    from: OLD,
    cliPath: '/usr/local/lib/node_modules/uxnan-bridge/dist/src/cli.js',
    resultPath: '/tmp/r.json',
    platform: 'darwin',
    layout: LAYOUT,
    startService: async () => undefined,
    runNpm: async () => {
      ran = true;
      return { ok: false, output: ['npm error code E404'] };
    },
    writeResult: async () => undefined,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    alive: () => stuck,
    forceStop: (pid) => {
      forced.push(pid);
      stuck = false;
    },
  });
  assert.deepEqual(forced, [42]);
  assert.equal(ran, true, 'npm ran once the stuck bridge was gone');
  assert.equal(result.failure?.reason, 'install');
});

test('a successful install leaves the new version on disk and says so', async () => {
  const state = freshState();
  await state.ensureDir();
  const packageRoot = join(state.baseDir, 'node_modules', 'uxnan-bridge');
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(packageRoot, { recursive: true });
  let spec = '';
  let clock = 0;
  const order: string[] = [];
  const result = await runSelfUpdateHelper({
    pid: 42,
    to: NEW,
    from: OLD,
    cliPath: join(packageRoot, 'dist', 'src', 'cli.js'),
    resultPath: '/tmp/r.json',
    platform: 'darwin',
    layout: { ...LAYOUT, packageRoot },
    startService: async () => void order.push('start'),
    runNpm: async (layout, s) => {
      spec = s;
      assert.equal(layout.prefix, '/usr/local', 'into the prefix it came from');
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ version: NEW }));
      return { ok: true, output: ['added 1 package'] };
    },
    writeResult: async () => void order.push('result'),
    releaseLock: async () => void order.push('release'),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    alive: () => false,
  });
  // The lock is let go only after the install, right before the service starts.
  assert.deepEqual(order, ['result', 'release', 'start']);
  assert.equal(spec, `uxnan-bridge@${NEW}`);
  assert.equal(result.ok, true);
  assert.equal(result.failure, undefined);
  await rmrf(state.baseDir);
});

test('check asks the registry now, past the hourly cache, and tells the clients', async () => {
  const state = freshState();
  await state.ensureDir();
  const { updater: u, changes } = updater(state, { fetchLatest: async () => NEW });
  const answer = await u.check();
  assert.equal(answer.latestVersion, NEW);
  assert.equal(answer.available, true);
  assert.equal(changes.length, 1, 'every client hears of the new version');
  await u.check();
  assert.equal(changes.length, 1, 'nothing new, nothing announced');
  await rmrf(state.baseDir);
});
