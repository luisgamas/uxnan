import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  CHILD_LEDGER_VERSION,
  ChildLedger,
  DAEMON_FILES,
  DaemonState,
  defaultSpawn,
  readChildLedger,
  recordChildrenIn,
  spawnPiped,
  type ChildLedgerFile,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

async function tempState(): Promise<DaemonState> {
  const dir = join(tmpdir(), `uxnan-child-ledger-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return new DaemonState(dir);
}

async function onDisk(state: DaemonState): Promise<ChildLedgerFile> {
  return JSON.parse(
    await readFile(state.pathFor(DAEMON_FILES.agentProcesses), 'utf-8'),
  ) as ChildLedgerFile;
}

/** Resolves once [pid] is no longer in the record on disk. */
async function waitUntilForgotten(ledger: ChildLedger, state: DaemonState, pid: number) {
  for (let i = 0; i < 200; i++) {
    await ledger.flush();
    if (!(await onDisk(state)).processes.some((p) => p.pid === pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`pid ${pid} was never removed from the record`);
}

test('a ledger writes what it records, with the owner and start markers', async () => {
  const state = await tempState();
  let clock = 1_000;
  const ledger = new ChildLedger(state, { ownerPid: 4242, ownerStartedAt: 500, now: () => clock });
  ledger.add({ pid: 11, command: '/bin/opencode', args: ['serve', '--port', '1'], cwd: '/p' });
  clock = 2_000;
  ledger.add({ pid: 12, command: 'pi', args: ['--mode', 'rpc'], cwd: '/q' });
  await ledger.flush();
  const file = await onDisk(state);
  assert.equal(file.version, CHILD_LEDGER_VERSION);
  assert.deepEqual(file.processes, [
    {
      pid: 11,
      command: '/bin/opencode',
      args: ['serve', '--port', '1'],
      cwd: '/p',
      startedAt: 1_000,
      ownerPid: 4242,
      ownerStartedAt: 500,
    },
    {
      pid: 12,
      command: 'pi',
      args: ['--mode', 'rpc'],
      cwd: '/q',
      startedAt: 2_000,
      ownerPid: 4242,
      ownerStartedAt: 500,
    },
  ]);

  ledger.remove(11);
  ledger.remove(999); // never recorded: nothing to write
  await ledger.flush();
  assert.deepEqual(
    (await onDisk(state)).processes.map((p) => p.pid),
    [12],
  );
  await rmrf(state.baseDir);
});

test('reset clears the record a previous bridge left', async () => {
  const state = await tempState();
  await state.writeJson(DAEMON_FILES.agentProcesses, {
    version: 1,
    processes: [
      {
        pid: 5,
        command: 'x',
        args: [],
        cwd: '/',
        startedAt: 0,
        ownerPid: 1,
        ownerStartedAt: 0,
      },
    ],
  });
  const ledger = new ChildLedger(state);
  await ledger.reset();
  assert.deepEqual((await onDisk(state)).processes, []);
  await rmrf(state.baseDir);
});

test('a write that fails is reported, never thrown', async () => {
  const errors: unknown[] = [];
  const failing = {
    writeJson: () => Promise.reject(new Error('disk full')),
  } as unknown as DaemonState;
  const ledger = new ChildLedger(failing, { onError: (err) => errors.push(err) });
  ledger.add({ pid: 1, command: 'a', args: [], cwd: '/' });
  await ledger.flush();
  assert.equal(errors.length, 1);
  assert.deepEqual(
    ledger.records.map((r) => r.pid),
    [1],
  );
});

test('a burst of changes ends with the newest state on disk', async () => {
  const state = await tempState();
  const ledger = new ChildLedger(state);
  for (let pid = 1; pid <= 20; pid++) {
    ledger.add({ pid, command: 'a', args: [String(pid)], cwd: '/' });
    if (pid % 2 === 0) ledger.remove(pid);
  }
  await ledger.flush();
  assert.deepEqual(
    (await onDisk(state)).processes.map((p) => p.pid),
    [1, 3, 5, 7, 9, 11, 13, 15, 17, 19],
  );
  await rmrf(state.baseDir);
});

test('readChildLedger: a missing file is an empty record', async () => {
  const state = await tempState();
  assert.deepEqual(await readChildLedger(state), []);
  await rmrf(state.baseDir);
});

test('readChildLedger: a corrupt file is an empty record', async () => {
  const state = await tempState();
  await writeFile(state.pathFor(DAEMON_FILES.agentProcesses), '{ not json', 'utf-8');
  assert.deepEqual(await readChildLedger(state), []);
  await writeFile(state.pathFor(DAEMON_FILES.agentProcesses), '[1, 2]', 'utf-8');
  assert.deepEqual(await readChildLedger(state), []);
  await rmrf(state.baseDir);
});

test('readChildLedger drops malformed rows and keeps the rest', async () => {
  const state = await tempState();
  const good = {
    pid: 7,
    command: '/bin/agy',
    args: ['--output-format', 'stream-json'],
    cwd: '/p',
    startedAt: 1,
    ownerPid: 2,
    ownerStartedAt: 0,
  };
  await state.writeJson(DAEMON_FILES.agentProcesses, {
    version: 1,
    processes: [
      good,
      { ...good, pid: -1 },
      { ...good, pid: 1.5 },
      { ...good, command: '' },
      { ...good, args: ['ok', 3] },
      { ...good, ownerPid: undefined },
      'nope',
      null,
    ],
  });
  assert.deepEqual(await readChildLedger(state), [good]);
  await rmrf(state.baseDir);
});

test('without an installed ledger, spawning records nothing', async () => {
  const state = await tempState();
  recordChildrenIn(undefined);
  const child = defaultSpawn(process.execPath, ['-e', ''], state.baseDir);
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
  assert.equal(existsSync(state.pathFor(DAEMON_FILES.agentProcesses)), false);
  await rmrf(state.baseDir);
});

test('defaultSpawn records a child as it starts and forgets it when it exits', async () => {
  const state = await tempState();
  const ledger = new ChildLedger(state);
  recordChildrenIn(ledger);
  try {
    const args = ['-e', 'setTimeout(() => {}, 300)'];
    const child = defaultSpawn(process.execPath, args, state.baseDir) as unknown as {
      pid: number;
    };
    await ledger.flush();
    const recorded = (await onDisk(state)).processes;
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.pid, child.pid);
    assert.equal(recorded[0]!.command, process.execPath);
    assert.deepEqual(recorded[0]!.args, args);
    assert.equal(recorded[0]!.cwd, state.baseDir);
    assert.equal(recorded[0]!.ownerPid, process.pid);
    await waitUntilForgotten(ledger, state, child.pid);
  } finally {
    recordChildrenIn(undefined);
  }
  await rmrf(state.baseDir);
});

test('spawnPiped records a long-lived child until it exits', async () => {
  const state = await tempState();
  const ledger = new ChildLedger(state);
  recordChildrenIn(ledger);
  try {
    // Reads stdin until EOF, like a protocol server does.
    const child = spawnPiped(process.execPath, ['-e', 'process.stdin.resume()'], {
      cwd: state.baseDir,
    });
    await ledger.flush();
    assert.deepEqual(
      (await onDisk(state)).processes.map((p) => p.pid),
      [child.pid],
    );
    child.stdin.end();
    await waitUntilForgotten(ledger, state, child.pid!);
  } finally {
    recordChildrenIn(undefined);
  }
  await rmrf(state.baseDir);
});

test('a spawn that never starts records nothing', async () => {
  const state = await tempState();
  const ledger = new ChildLedger(state);
  recordChildrenIn(ledger);
  try {
    const child = defaultSpawn(join(state.baseDir, 'no-such-binary'), [], state.baseDir);
    await new Promise<void>((resolve) => child.on('close', () => resolve()));
    await ledger.flush();
    assert.deepEqual(ledger.records, []);
  } finally {
    recordChildrenIn(undefined);
  }
  await rmrf(state.baseDir);
});
