/**
 * The reaper never inspects or signals a real process here: every test injects
 * the inspector, the liveness check, the signaller and the command runner, and
 * uses a temporary state directory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  DAEMON_FILES,
  DaemonState,
  InMemorySecretStore,
  START_TOLERANCE_MS,
  childLabel,
  commandLineMatches,
  inspectProcess,
  parseElapsed,
  parsePsLine,
  parseWindowsProcess,
  reapOrphanedChildren,
  startBridge,
  windowsInspectScript,
  type ChildLedgerFile,
  type ChildRecord,
  type CommandRunner,
  type ProcessSnapshot,
  type ReapDeps,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

const SELF = 50_000;
const DEAD_BRIDGE = 40_000;
const T0 = 1_800_000_000_000;

const OPENCODE = '/Users/me/.opencode/bin/opencode';
const SERVE_ARGS = ['serve', '--port', '61234', '--hostname', '127.0.0.1'];

function record(overrides: Partial<ChildRecord> = {}): ChildRecord {
  return {
    pid: 1234,
    command: OPENCODE,
    args: SERVE_ARGS,
    cwd: '/work/project',
    startedAt: T0,
    ownerPid: DEAD_BRIDGE,
    ownerStartedAt: T0 - 60_000,
    ...overrides,
  };
}

async function stateWith(records: unknown): Promise<DaemonState> {
  const dir = join(tmpdir(), `uxnan-reaper-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const state = new DaemonState(dir);
  await state.writeJson(DAEMON_FILES.agentProcesses, { version: 1, processes: records });
  return state;
}

/** A fake system: a table of processes, and a log of what was done to them. */
function fakeSystem(
  processes: Record<number, ProcessSnapshot>,
  options: { alive?: number[]; ignoresTerm?: boolean; platform?: NodeJS.Platform } = {},
) {
  const alive = new Set<number>([...Object.keys(processes).map(Number), ...(options.alive ?? [])]);
  const signals: Array<[number, NodeJS.Signals]> = [];
  const runs: Array<[string, string[]]> = [];
  const inspected: number[] = [];
  const deps: ReapDeps = {
    platform: options.platform ?? 'darwin',
    selfPid: SELF,
    isAlive: (pid) => alive.has(pid),
    inspect: async (pid) => {
      inspected.push(pid);
      return alive.has(pid) ? processes[pid] : undefined;
    },
    signal: (pid, sig) => {
      signals.push([pid, sig]);
      if (sig === 'SIGKILL' || !options.ignoresTerm) alive.delete(pid);
    },
    run: async (command, args) => {
      runs.push([command, args]);
      if (command === 'taskkill') alive.delete(Number(args[1]));
      return { code: 0, stdout: '' };
    },
    sleep: async () => undefined,
    graceMs: 300,
  };
  return { deps, signals, runs, inspected, alive };
}

const orphanSnap: ProcessSnapshot = {
  ppid: 1,
  commandLine: `${OPENCODE} ${SERVE_ARGS.join(' ')}`,
  startedAt: T0 + 400,
};

test('reaps a recorded orphan that still runs the recorded command', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({ 1234: orphanSnap });
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result, { reaped: ['opencode'], skipped: 0, gone: 0 });
  assert.deepEqual(sys.signals, [[1234, 'SIGTERM']]);
  assert.deepEqual(sys.runs, []);
  await rmrf(state.baseDir);
});

test('forces an orphan that ignores SIGTERM, once it is still the same orphan', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({ 1234: orphanSnap }, { ignoresTerm: true });
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result.reaped, ['opencode']);
  assert.deepEqual(sys.signals, [
    [1234, 'SIGTERM'],
    [1234, 'SIGKILL'],
  ]);
  await rmrf(state.baseDir);
});

test('leaves a reused pid alone: a different command line', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({
    1234: { ppid: 1, commandLine: '/usr/bin/vim notes.md', startedAt: T0 + 400 },
  });
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result, { reaped: [], skipped: 1, gone: 0 });
  assert.deepEqual(sys.signals, []);
  await rmrf(state.baseDir);
});

test('leaves a reused pid alone: same command, started at another time', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({
    1234: { ...orphanSnap, startedAt: T0 + START_TOLERANCE_MS + 60_000 },
  });
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result, { reaped: [], skipped: 1, gone: 0 });
  assert.deepEqual(sys.signals, []);
  await rmrf(state.baseDir);
});

test('leaves alone a process whose recorded bridge is still its live parent', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({ 1234: { ...orphanSnap, ppid: DEAD_BRIDGE } }, { alive: [DEAD_BRIDGE] });
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result, { reaped: [], skipped: 1, gone: 0 });
  assert.deepEqual(sys.signals, []);
  await rmrf(state.baseDir);
});

test("leaves alone this bridge's own children and its own pid", async () => {
  const state = await stateWith([record(), record({ pid: SELF })]);
  const sys = fakeSystem({ 1234: { ...orphanSnap, ppid: SELF } }, { alive: [SELF] });
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result, { reaped: [], skipped: 1, gone: 1 });
  assert.deepEqual(sys.signals, []);
  await rmrf(state.baseDir);
});

test('counts a recorded process that is no longer running as gone, without inspecting it', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({});
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result, { reaped: [], skipped: 0, gone: 1 });
  assert.deepEqual(sys.inspected, []);
  await rmrf(state.baseDir);
});

test('only inspects recorded pids', async () => {
  const state = await stateWith([record({ pid: 7 }), record({ pid: 8 })]);
  const sys = fakeSystem({
    7: orphanSnap,
    8: orphanSnap,
    9: orphanSnap, // an orphan nobody recorded
  });
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.equal(result.reaped.length, 2);
  assert.deepEqual([...sys.inspected].sort(), [7, 8]);
  assert.ok(sys.alive.has(9));
  await rmrf(state.baseDir);
});

test('Windows: ends the orphan tree with taskkill, even with the stale parent pid', async () => {
  const exe = 'C:\\Users\\me\\AppData\\Local\\pi\\pi.exe';
  const args = ['--mode', 'rpc', '--session', 'C:\\Users\\me\\s 1.jsonl'];
  const state = await stateWith([record({ pid: 4321, command: exe, args })]);
  const sys = fakeSystem(
    {
      // Windows keeps the dead parent's pid; the owner is simply not running.
      4321: {
        ppid: DEAD_BRIDGE,
        commandLine: `"${exe}" --mode rpc --session "C:\\Users\\me\\s 1.jsonl"`,
        startedAt: T0 + 10,
      },
    },
    { platform: 'win32' },
  );
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result.reaped, ['pi']);
  assert.deepEqual(sys.runs, [['taskkill', ['/PID', '4321', '/T', '/F']]]);
  assert.deepEqual(sys.signals, []);
  await rmrf(state.baseDir);
});

test('Windows: a live owner with that pid keeps its child', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem(
    { 1234: { ...orphanSnap, ppid: DEAD_BRIDGE } },
    { platform: 'win32', alive: [DEAD_BRIDGE] },
  );
  const result = await reapOrphanedChildren(state, sys.deps);
  assert.deepEqual(result.skipped, 1);
  assert.deepEqual(sys.runs, []);
  await rmrf(state.baseDir);
});

test('a missing or corrupt record reaps nothing', async () => {
  const dir = join(tmpdir(), `uxnan-reaper-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const state = new DaemonState(dir);
  const sys = fakeSystem({ 1234: orphanSnap });
  assert.deepEqual(await reapOrphanedChildren(state, sys.deps), {
    reaped: [],
    skipped: 0,
    gone: 0,
  });
  await writeFile(state.pathFor(DAEMON_FILES.agentProcesses), 'garbage', 'utf-8');
  assert.deepEqual(await reapOrphanedChildren(state, sys.deps), {
    reaped: [],
    skipped: 0,
    gone: 0,
  });
  assert.deepEqual(sys.signals, []);
  await rmrf(dir);
});

test('an inspector that throws leaves the process alone', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({ 1234: orphanSnap });
  const result = await reapOrphanedChildren(state, {
    ...sys.deps,
    inspect: () => Promise.reject(new Error('ps missing')),
  });
  assert.deepEqual(result, { reaped: [], skipped: 1, gone: 0 });
  assert.deepEqual(sys.signals, []);
  await rmrf(state.baseDir);
});

test('commandLineMatches: the recorded executable and arguments', () => {
  const r = { command: OPENCODE, args: SERVE_ARGS };
  assert.equal(commandLineMatches(r, `${OPENCODE} ${SERVE_ARGS.join(' ')}`), true);
  // Started by bare name; the system shows the name it was given.
  assert.equal(commandLineMatches(r, `opencode ${SERVE_ARGS.join(' ')}`), true);
  // Another port: another process.
  assert.equal(commandLineMatches(r, `${OPENCODE} serve --port 1 --hostname 127.0.0.1`), false);
  // The arguments, but another program.
  assert.equal(commandLineMatches(r, `/usr/bin/other ${SERVE_ARGS.join(' ')}`), false);
  // The program, extra arguments after the recorded ones.
  assert.equal(commandLineMatches(r, `${OPENCODE} ${SERVE_ARGS.join(' ')} --extra`), false);
  // The recorded arguments only as the tail of a longer one.
  assert.equal(
    commandLineMatches({ command: 'codex', args: ['app-server'] }, 'codex my-app-server'),
    false,
  );
});

test('commandLineMatches: a script run by an interpreter, and Windows quoting', () => {
  assert.equal(
    commandLineMatches(
      { command: '/usr/local/bin/node', args: ['/opt/pi/cli.js', '--mode', 'rpc'] },
      'node /opt/pi/cli.js --mode rpc',
    ),
    true,
  );
  assert.equal(
    commandLineMatches(
      { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\x\\agy.js', 'a b'] },
      '"C:\\Program Files\\nodejs\\node.exe" C:\\x\\agy.js "a b"',
    ),
    true,
  );
  // A multi-line prompt argument, as macOS `ps` prints it.
  assert.equal(
    commandLineMatches(
      { command: '/bin/opencode', args: ['run', 'line one\nline\ttwo'] },
      '/bin/opencode run line one\\012line\\011two',
    ),
    true,
  );
  assert.equal(commandLineMatches({ command: 'zero', args: [] }, 'zero'), true);
  assert.equal(commandLineMatches({ command: 'zero', args: [] }, 'grok'), false);
});

test('parseElapsed reads every ps elapsed form', () => {
  assert.equal(parseElapsed('00:07'), 7_000);
  assert.equal(parseElapsed('12:34'), 754_000);
  assert.equal(parseElapsed('01:00:00'), 3_600_000);
  assert.equal(parseElapsed('2-03:04:05'), (2 * 86_400 + 3 * 3_600 + 4 * 60 + 5) * 1000);
  assert.equal(parseElapsed('soon'), undefined);
});

test('parsePsLine reads the parent, the start and the whole command line', () => {
  const snap = parsePsLine(
    `    1       01:05 ${OPENCODE} serve --port 5 --hostname 127.0.0.1\n`,
    T0,
  );
  assert.deepEqual(snap, {
    ppid: 1,
    commandLine: `${OPENCODE} serve --port 5 --hostname 127.0.0.1`,
    startedAt: T0 - 65_000,
  });
  assert.equal(parsePsLine('', T0), undefined);
});

test('parseWindowsProcess reads the CIM answer and refuses what it cannot describe', () => {
  assert.deepEqual(parseWindowsProcess('{"ppid":8,"cmd":"\\"C:\\\\a.exe\\" x","start":123}'), {
    ppid: 8,
    commandLine: '"C:\\a.exe" x',
    startedAt: 123,
  });
  assert.deepEqual(parseWindowsProcess('{"ppid":8,"cmd":"a x","start":null}'), {
    ppid: 8,
    commandLine: 'a x',
  });
  // Another user's process: Windows gives no command line.
  assert.equal(parseWindowsProcess('{"ppid":8,"cmd":null,"start":1}'), undefined);
  assert.equal(parseWindowsProcess(''), undefined);
  assert.equal(parseWindowsProcess('not json'), undefined);
});

test('inspectProcess asks ps on POSIX and PowerShell on Windows', async () => {
  const calls: Array<[string, string[]]> = [];
  const run: CommandRunner = async (command, args) => {
    calls.push([command, args]);
    return command === 'ps'
      ? { code: 0, stdout: '  1  00:03 /bin/x a\n' }
      : { code: 0, stdout: '{"ppid":2,"cmd":"x a","start":9}' };
  };
  assert.deepEqual(await inspectProcess(77, { platform: 'linux', run, now: () => T0 }), {
    ppid: 1,
    commandLine: '/bin/x a',
    startedAt: T0 - 3_000,
  });
  assert.deepEqual(calls[0], ['ps', ['-ww', '-o', 'ppid=,etime=,command=', '-p', '77']]);
  assert.deepEqual(await inspectProcess(77, { platform: 'win32', run, now: () => T0 }), {
    ppid: 2,
    commandLine: 'x a',
    startedAt: 9,
  });
  assert.equal(calls[1]![0], 'powershell.exe');
  assert.equal(calls[1]![1].at(-1), windowsInspectScript(77));
  assert.match(windowsInspectScript(77), /Win32_Process -Filter "ProcessId=77"/);

  // Not running: ps exits non-zero.
  const missing: CommandRunner = async () => ({ code: 1, stdout: '' });
  assert.equal(
    await inspectProcess(77, { platform: 'darwin', run: missing, now: () => T0 }),
    undefined,
  );
});

test('childLabel names the agent, never its arguments', () => {
  assert.equal(childLabel({ command: OPENCODE, args: SERVE_ARGS }), 'opencode');
  assert.equal(childLabel({ command: 'C:\\x\\codex.exe', args: ['app-server'] }), 'codex');
  assert.equal(
    childLabel({
      command: '/usr/bin/node',
      args: ['/opt/node_modules/pi-coding-agent/dist/cli.js', '--mode', 'rpc'],
    }),
    'pi-coding-agent',
  );
  assert.equal(childLabel({ command: 'node', args: ['/dist/cli.js'] }), 'node');
});

test('startBridge with recordChildProcesses reaps, then starts a fresh record', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({ 1234: orphanSnap });
  const bridge = await startBridge({
    baseDir: state.baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
    recordChildProcesses: true,
    reapDeps: sys.deps,
  });
  assert.deepEqual(sys.signals, [[1234, 'SIGTERM']]);
  const file = JSON.parse(
    await readFile(state.pathFor(DAEMON_FILES.agentProcesses), 'utf-8'),
  ) as ChildLedgerFile;
  assert.deepEqual(file.processes, []);
  await bridge.stop();
  await rmrf(state.baseDir);
});

test('startBridge without the flag leaves the record alone', async () => {
  const state = await stateWith([record()]);
  const sys = fakeSystem({ 1234: orphanSnap });
  const bridge = await startBridge({
    baseDir: state.baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
    reapDeps: sys.deps,
  });
  assert.deepEqual(sys.signals, []);
  const file = JSON.parse(
    await readFile(state.pathFor(DAEMON_FILES.agentProcesses), 'utf-8'),
  ) as ChildLedgerFile;
  assert.equal(file.processes.length, 1);
  await bridge.stop();
  await rmrf(state.baseDir);
});
