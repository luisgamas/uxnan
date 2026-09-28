/**
 * Ends the agent processes a bridge that was killed hard left running.
 *
 * The bridge records every child it starts (`child-ledger.ts`). When the next
 * bridge starts — holding the single-instance lock, before it serves anything —
 * it reads that record and ends each process that is, all at once:
 *
 * - **still running**;
 * - **orphaned**: its parent is no longer the bridge that started it. On POSIX
 *   a process whose parent died is re-parented (to init or a subreaper), so its
 *   parent pid changes; Windows keeps the dead parent's pid, so there the
 *   recorded owner must also be gone;
 * - **the same process**: its command line still ends with the recorded
 *   arguments after the recorded executable, and — where the platform says when
 *   it started — it started when the record says. A pid the system handed to
 *   another program since fails both, and is left alone.
 *
 * Anything else — not running, owned, a different command, a process that
 * cannot be inspected — is left alone. Nothing that is not in the record is
 * ever looked at. The whole check fails safe: a doubt leaves an orphan running,
 * never ends a process the bridge did not start.
 *
 * Process inspection needs no native module: `ps` on macOS and Linux, and
 * PowerShell's `Get-CimInstance Win32_Process` on Windows, both through an
 * injectable runner so the tests never inspect or signal a real process.
 */
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import type { DaemonState } from '../daemon-state.js';
import { isProcessAlive } from '../lock-file.js';
import { readChildLedger, type ChildRecord } from './child-ledger.js';

/** What the system says about a running process. */
export interface ProcessSnapshot {
  /** Its parent pid. */
  ppid: number;
  /** Its full command line, as the system shows it. */
  commandLine: string;
  /** Epoch ms at which it started, when the platform reports it. */
  startedAt?: number;
}

/** Runs a command without a shell; resolves with its exit code and stdout. */
export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<{ code: number | null; stdout: string }>;

/** Everything the reaper touches outside itself — injectable for tests. */
export interface ReapDeps {
  platform?: NodeJS.Platform;
  /** This bridge's pid. */
  selfPid?: number;
  isAlive?: (pid: number) => boolean;
  /** Looks a process up; `undefined` when it is not running or cannot be read. */
  inspect?: (pid: number) => Promise<ProcessSnapshot | undefined>;
  /** Sends a POSIX signal. */
  signal?: (pid: number, signal: NodeJS.Signals) => void;
  /** Runs `ps` / PowerShell / `taskkill`. */
  run?: CommandRunner;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long a process gets to exit on `SIGTERM` before `SIGKILL` (POSIX). */
  graceMs?: number;
}

/** What one reap did. */
export interface ReapResult {
  /** A short name per ended process (the agent's executable, never its arguments). */
  reaped: string[];
  /** Recorded processes still running that were left alone (owned, or not the recorded command). */
  skipped: number;
  /** Recorded processes no longer running. */
  gone: number;
}

/** Default `SIGTERM` → `SIGKILL` grace. */
export const REAP_GRACE_MS = 3_000;

/**
 * How far a process's start may be from the recorded one and still be the same
 * process. The record is written right after `spawn`, and `ps` reports elapsed
 * time in whole seconds; a pid reused later is minutes or days off.
 */
export const START_TOLERANCE_MS = 5_000;

const RUN_TIMEOUT_MS = 10_000;

const defaultRun: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: RUN_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout: String(stdout ?? '') });
      },
    );
  });

const defaultSignal = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Gone already (ESRCH), or not ours to signal (EPERM): nothing to do.
  }
};

/** An executable's bare name: no directory, no extension, lower case. */
function exeName(path: string): string {
  return basename(path.replace(/\\/g, '/'))
    .replace(/\.(exe|cmd|bat|js|mjs|cjs)$/i, '')
    .toLowerCase();
}

/** Interpreters whose script, not themselves, names the agent. */
const INTERPRETERS = new Set(['node', 'bun', 'deno', 'python', 'python3']);

/** Path segments that say nothing about which package a script belongs to. */
const GENERIC_SEGMENTS = new Set(['cli', 'index', 'main', 'bin', 'dist', 'src', 'lib', 'build']);

/**
 * A short, argument-free name for a recorded process, for the log: the
 * executable, or — for a script run by an interpreter — the script's package
 * (`…/pi-coding-agent/dist/cli.js` → `pi-coding-agent`).
 */
export function childLabel(record: Pick<ChildRecord, 'command' | 'args'>): string {
  const name = exeName(record.command);
  const script = record.args[0];
  if (!INTERPRETERS.has(name) || script === undefined) return name;
  const segments = script.replace(/\\/g, '/').split('/').filter(Boolean).reverse();
  const telling = segments.map(exeName).find((s) => !GENERIC_SEGMENTS.has(s));
  return telling ?? name;
}

/**
 * Quotes dropped and whitespace collapsed, so an argv joined by `ps` (spaces)
 * and one quoted by Windows compare equal. Arguments that differ only in
 * quoting or spacing are rare in what the bridge starts, and a mismatch leaves
 * the process alone.
 */
function normalize(text: string): string {
  return text.replace(/"/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Whether [commandLine] is the recorded command: it ends with the recorded
 * arguments, and what comes before them names the recorded executable (a
 * script run by an interpreter shows as `node /path/to/script …`, so any token
 * of that head may carry the name).
 */
export function commandLineMatches(
  record: Pick<ChildRecord, 'command' | 'args'>,
  commandLine: string,
): boolean {
  // macOS `ps` shows a control character as an octal escape (a newline in a
  // prompt argument is `\012`): read those back as the whitespace they were.
  const line = normalize(commandLine.replace(/\\0[0-3][0-7]/g, ' '));
  const tail = normalize(record.args.join(' '));
  let head = line;
  if (tail.length > 0) {
    if (!line.endsWith(` ${tail}`)) return false;
    head = line.slice(0, line.length - tail.length - 1);
  }
  const want = exeName(record.command);
  return want.length > 0 && head.split(' ').some((token) => exeName(token) === want);
}

/** `ps` elapsed time, `[[dd-]hh:]mm:ss`, in ms; `undefined` when unreadable. */
export function parseElapsed(text: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (!match) return undefined;
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes) * 60 +
    Number(seconds);
  return total * 1000;
}

/** Parses `ps -o ppid=,etime=,command=` for one process. */
export function parsePsLine(stdout: string, now: number): ProcessSnapshot | undefined {
  const line = stdout.split('\n').find((l) => l.trim().length > 0);
  const match = line ? /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line) : null;
  if (!match) return undefined;
  const elapsed = parseElapsed(match[2]!);
  return {
    ppid: Number(match[1]),
    commandLine: match[3]!.trim(),
    ...(elapsed !== undefined ? { startedAt: now - elapsed } : {}),
  };
}

/** The PowerShell that describes one process as compact JSON (nothing when absent). */
export function windowsInspectScript(pid: number): string {
  return (
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}"; ` +
    'if ($p) { [pscustomobject]@{ ppid = $p.ParentProcessId; cmd = $p.CommandLine; ' +
    'start = if ($p.CreationDate) { ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } else { $null } } ' +
    '| ConvertTo-Json -Compress }'
  );
}

/** Parses {@link windowsInspectScript}'s output. */
export function parseWindowsProcess(stdout: string): ProcessSnapshot | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const { ppid, cmd, start } = value as { ppid?: unknown; cmd?: unknown; start?: unknown };
  // No command line means another user's process, or one Windows would not
  // describe: never a candidate.
  if (typeof ppid !== 'number' || typeof cmd !== 'string' || cmd.length === 0) return undefined;
  return {
    ppid,
    commandLine: cmd,
    ...(typeof start === 'number' ? { startedAt: start } : {}),
  };
}

/**
 * Looks one process up on this platform.
 *
 * FOR-DEV: run live on Linux and Windows only through unit tests so far — a
 * hard-killed bridge on each (bridge/FOR-DEV.md → *The orphan reap, live on
 * Linux and Windows*); macOS is verified live.
 */
export async function inspectProcess(
  pid: number,
  deps: { platform: NodeJS.Platform; run: CommandRunner; now: () => number },
): Promise<ProcessSnapshot | undefined> {
  if (deps.platform === 'win32') {
    const { code, stdout } = await deps.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      windowsInspectScript(pid),
    ]);
    return code === 0 ? parseWindowsProcess(stdout) : undefined;
  }
  // `-ww`: never cut the command line to a terminal's width.
  const { code, stdout } = await deps.run('ps', [
    '-ww',
    '-o',
    'ppid=,etime=,command=',
    '-p',
    String(pid),
  ]);
  return code === 0 ? parsePsLine(stdout, deps.now()) : undefined;
}

type Verdict = 'gone' | 'skip' | 'reap';

interface ResolvedDeps {
  platform: NodeJS.Platform;
  selfPid: number;
  isAlive: (pid: number) => boolean;
  inspect: (pid: number) => Promise<ProcessSnapshot | undefined>;
  signal: (pid: number, signal: NodeJS.Signals) => void;
  run: CommandRunner;
  sleep: (ms: number) => Promise<void>;
  graceMs: number;
}

function resolveDeps(deps: ReapDeps): ResolvedDeps {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  const now = deps.now ?? (() => Date.now());
  return {
    platform,
    selfPid: deps.selfPid ?? process.pid,
    isAlive: deps.isAlive ?? isProcessAlive,
    inspect: deps.inspect ?? ((pid) => inspectProcess(pid, { platform, run, now })),
    signal: deps.signal ?? defaultSignal,
    run,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    graceMs: deps.graceMs ?? REAP_GRACE_MS,
  };
}

/** Whether [record]'s pid is still that process, orphaned. */
async function judge(record: ChildRecord, d: ResolvedDeps): Promise<Verdict> {
  if (record.pid === d.selfPid || !d.isAlive(record.pid)) return 'gone';
  const snap = await d.inspect(record.pid);
  if (!snap) return 'gone';
  return isOrphanedChild(record, snap, d) ? 'reap' : 'skip';
}

function isOrphanedChild(record: ChildRecord, snap: ProcessSnapshot, d: ResolvedDeps): boolean {
  if (snap.ppid === d.selfPid) return false;
  if (snap.ppid === record.ownerPid && d.isAlive(record.ownerPid)) return false;
  if (!commandLineMatches(record, snap.commandLine)) return false;
  if (
    snap.startedAt !== undefined &&
    Math.abs(snap.startedAt - record.startedAt) > START_TOLERANCE_MS
  ) {
    return false;
  }
  return true;
}

/** Ends one orphan: its whole tree on Windows; `SIGTERM`, then `SIGKILL` on POSIX. */
async function terminate(record: ChildRecord, d: ResolvedDeps): Promise<void> {
  if (d.platform === 'win32') {
    await d.run('taskkill', ['/PID', String(record.pid), '/T', '/F']);
    return;
  }
  d.signal(record.pid, 'SIGTERM');
  const step = 100;
  for (let waited = 0; waited < d.graceMs; waited += step) {
    await d.sleep(step);
    if (!d.isAlive(record.pid)) return;
  }
  // Still there after the grace: make sure it is still the same orphan (its
  // pid was not freed and handed out meanwhile) before forcing it.
  if ((await judge(record, d)) === 'reap') d.signal(record.pid, 'SIGKILL');
}

/**
 * Reads the record a previous bridge left and ends its orphans. It does not
 * rewrite the record: the caller's new `ChildLedger` does that (`reset`), the
 * record's one writer.
 */
export async function reapOrphanedChildren(
  state: DaemonState,
  deps: ReapDeps = {},
): Promise<ReapResult> {
  const d = resolveDeps(deps);
  const records = await readChildLedger(state);
  const result: ReapResult = { reaped: [], skipped: 0, gone: 0 };
  await Promise.all(
    records.map(async (record) => {
      let verdict: Verdict;
      try {
        verdict = await judge(record, d);
      } catch {
        verdict = 'skip';
      }
      if (verdict === 'gone') result.gone++;
      else if (verdict === 'skip') result.skipped++;
      else {
        try {
          await terminate(record, d);
          result.reaped.push(childLabel(record));
        } catch {
          result.skipped++;
        }
      }
    }),
  );
  return result;
}
