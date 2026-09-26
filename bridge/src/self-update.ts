/**
 * The bridge updates itself.
 *
 * The bridge owns its update end to end, so every client (Uxnan Desktop, every
 * paired phone) offers the same update by asking the same owner:
 *
 *   1. **Knowing** — the running bridge checks the npm registry itself, hourly
 *      ({@link DAEMON_UPDATE_CHECK_MS}), and tells every client when the newest
 *      version changes (`stream/bridge/updated`). A short CLI command keeps the
 *      24 h cache of `update-check.ts`; a daemon that learned of a release a day
 *      late is the bug this replaces.
 *   2. **Applying** — `bridge/update` hands over to a helper process
 *      (`uxnan-bridge self-update`) and stops. The helper waits for the bridge
 *      to exit, installs the published version with the npm that sits beside
 *      it in the same global folder (a service's PATH has no npm), writes the
 *      outcome to `update-result.json`, and starts the service again.
 *      Installing only after the bridge has stopped is what makes it work on
 *      Windows, where a running process keeps its native modules locked.
 *   3. **Reporting** — the bridge that comes back reads that file and reports a
 *      failure (`phase: 'failed'`) or nothing at all: a client sees the new
 *      version on reconnect.
 *
 * It only ever runs for a bridge that is the user's service and a global npm
 * install ({@link resolveUpdateLayout}); anything else reports why in
 * `BridgeUpdate.unsupportedReason`.
 *
 * Source: architecture/02a-system-architecture.md §5.8.18; shared `BridgeUpdate`.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path, { join } from 'node:path';
import {
  isNewerVersion,
  JsonRpcErrorCode,
  RpcError,
  type BridgeLaunchedBy,
  type BridgeUpdate,
  type BridgeUpdateFailure,
  type BridgeUpdatePhase,
} from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from './daemon-state.js';
import { isProcessAlive } from './lock-file.js';
import { BRIDGE_PACKAGE_NAME } from './version.js';
import { ensureUpdateStatus } from './update-check.js';

/** How often a running bridge asks the registry for a newer version. */
export const DAEMON_UPDATE_CHECK_MS = 60 * 60 * 1000;

/** How long the helper waits for the bridge it replaces to exit. */
const HANDOVER_TIMEOUT_MS = 60_000;

/** A result older than this is from some earlier run, not this start. */
const RESULT_MAX_AGE_MS = 15 * 60 * 1000;

/** Lines of npm output kept for a failure. */
const TAIL_LINES = 12;

/** Where a global npm install put this bridge, and the npm beside it. */
export interface UpdateLayout {
  /** `<prefix>/lib/node_modules/uxnan-bridge` (`<prefix>\node_modules\…` on Windows). */
  packageRoot: string;
  /** The npm prefix the bridge was installed under — reinstalled into the same one. */
  prefix: string;
  /** npm's own entry, run with this Node (`<global root>/npm/bin/npm-cli.js`). */
  npmCli: string;
}

/**
 * Where this bridge was installed, from the path of its own `cli.js`
 * (`<package>/dist/src/cli.js`). A bridge run from a source checkout, or one
 * whose npm is not beside it, cannot replace itself. Pure but for `exists`.
 */
export function resolveUpdateLayout(
  cliPath: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): UpdateLayout | { reason: string } {
  // The path rules of the platform the bridge runs on — named here rather than
  // taken from the process, so every platform's layout is checked on any host.
  const { basename, dirname, join } = platform === 'win32' ? path.win32 : path.posix;
  const packageRoot = dirname(dirname(dirname(cliPath)));
  const globalRoot = dirname(packageRoot);
  if (basename(packageRoot) !== BRIDGE_PACKAGE_NAME || basename(globalRoot) !== 'node_modules') {
    return { reason: 'this bridge runs from a source checkout, not a global npm install' };
  }
  const npmCli = join(globalRoot, 'npm', 'bin', 'npm-cli.js');
  if (!exists(npmCli)) return { reason: 'npm is not installed beside this bridge' };
  // Windows: <prefix>\node_modules. Elsewhere: <prefix>/lib/node_modules.
  const prefix = platform === 'win32' ? dirname(globalRoot) : dirname(dirname(globalRoot));
  return { packageRoot, prefix, npmCli };
}

/** The command a person runs to update by hand. */
export function manualUpdateCommand(version = 'latest'): string {
  return `npm install -g ${BRIDGE_PACKAGE_NAME}@${version}`;
}

/** What the helper leaves for the bridge that starts after it. */
export interface UpdateResult {
  at: number;
  from: string;
  to: string;
  ok: boolean;
  failure?: BridgeUpdateFailure;
}

/** npm's words for "I could not write the global folder". */
export function isPermissionFailure(lines: readonly string[]): boolean {
  return lines.some((l) => /\b(EACCES|EPERM)\b|permission denied/i.test(l));
}

/** The failure a finished npm run amounts to, or undefined when it worked. */
export function installFailure(
  ok: boolean,
  output: readonly string[],
): BridgeUpdateFailure | undefined {
  if (ok) return undefined;
  const tail = output
    .filter((l) => l.trim() !== '')
    .slice(-TAIL_LINES)
    .join('\n');
  if (isPermissionFailure(output)) {
    return {
      reason: 'permission',
      message: tail || 'npm could not write its global folder.',
      command: manualUpdateCommand(),
    };
  }
  return {
    reason: 'install',
    message: tail || 'npm could not install the new version.',
    command: manualUpdateCommand(),
  };
}

export interface BridgeUpdaterOptions {
  state: DaemonState;
  version: string;
  launchedBy: BridgeLaunchedBy;
  /** Where the bridge lives, or why it cannot replace itself. */
  layout: UpdateLayout | { reason: string };
  /** Threads with a turn in flight right now. */
  activeTurns: () => number;
  now: () => number;
  /** Told of every change; the bridge broadcasts `stream/bridge/updated`. */
  onChange: (update: BridgeUpdate) => void;
  /** Start the helper that installs `version`, then stop this bridge. */
  handOver: (version: string) => void;
  /** The newest published version, fresh from the registry (tests inject it). */
  fetchLatest?: () => Promise<string | undefined>;
  /** The periodic check (tests inject it); defaults to the cached registry query. */
  check?: () => Promise<string | undefined>;
}

/** The one owner of the bridge's update state. */
export class BridgeUpdater {
  readonly #o: BridgeUpdaterOptions;
  #latest: string | undefined;
  #phase: BridgeUpdatePhase = 'idle';
  #target: string | undefined;
  #failure: BridgeUpdateFailure | undefined;

  constructor(options: BridgeUpdaterOptions, latest?: string) {
    this.#o = options;
    this.#latest = latest;
  }

  /** Whether this bridge can replace itself, and if not, why. */
  #support(): { canApply: boolean; reason?: string } {
    if (this.#o.launchedBy !== 'service') {
      return {
        canApply: false,
        reason:
          this.#o.launchedBy === 'cli'
            ? 'the bridge was started in a terminal, not as your service'
            : 'the bridge was started by Uxnan Desktop, not as your service',
      };
    }
    if ('reason' in this.#o.layout) return { canApply: false, reason: this.#o.layout.reason };
    return { canApply: true };
  }

  snapshot(): BridgeUpdate {
    const support = this.#support();
    return {
      version: this.#o.version,
      ...(this.#latest !== undefined ? { latestVersion: this.#latest } : {}),
      available: isNewerVersion(this.#latest, this.#o.version),
      canApply: support.canApply,
      ...(support.reason !== undefined ? { unsupportedReason: support.reason } : {}),
      phase: this.#phase,
      ...(this.#phase === 'updating' && this.#target !== undefined
        ? { targetVersion: this.#target }
        : {}),
      ...(this.#phase === 'failed' && this.#failure !== undefined
        ? { failure: this.#failure }
        : {}),
    };
  }

  /** Read (and consume) what the helper of a previous update left. */
  async init(): Promise<void> {
    const result = await this.#o.state.readJson<UpdateResult>(DAEMON_FILES.updateResult);
    if (result === null) return;
    await this.#o.state.remove(DAEMON_FILES.updateResult).catch(() => undefined);
    if (this.#o.now() - result.at > RESULT_MAX_AGE_MS) return;
    if (result.ok && result.to === this.#o.version) return;
    this.#phase = 'failed';
    this.#failure = result.failure ?? {
      reason: 'install',
      message: `Installed ${result.to}, but the bridge still runs ${this.#o.version}.`,
      command: manualUpdateCommand(result.to),
    };
  }

  /** The periodic registry check: tells the clients when the newest version changes. */
  async refresh(): Promise<void> {
    const check =
      this.#o.check ??
      (async () =>
        (await ensureUpdateStatus(this.#o.state, { ttlMs: DAEMON_UPDATE_CHECK_MS })).latestVersion);
    let latest: string | undefined;
    try {
      latest = await check();
    } catch {
      return;
    }
    if (latest === undefined || latest === this.#latest) return;
    this.#latest = latest;
    this.#o.onChange(this.snapshot());
  }

  /**
   * `bridge/update`: hand over to the helper, which installs the published
   * version and starts the service on it. Refuses while a turn runs anywhere,
   * and on a bridge that cannot replace itself. Answers with the state it
   * entered; the bridge stops right after.
   */
  async apply(): Promise<BridgeUpdate> {
    if (this.#phase === 'updating') return this.snapshot();
    const support = this.#support();
    if (!support.canApply) {
      throw new RpcError(
        JsonRpcErrorCode.BridgeError,
        `This bridge cannot update itself: ${support.reason ?? 'unsupported'}.`,
        { reason: 'unsupported', command: manualUpdateCommand() },
      );
    }
    if (this.#o.activeTurns() > 0) {
      throw new RpcError(
        JsonRpcErrorCode.AgentBusy,
        'A turn is running; the bridge updates once no turn runs on any client.',
        { reason: 'busy' },
      );
    }
    const fresh = await (this.#o.fetchLatest?.() ?? Promise.resolve(undefined)).catch(
      () => undefined,
    );
    if (fresh !== undefined && fresh !== this.#latest) this.#latest = fresh;
    const target = this.#latest;
    if (target === undefined || !isNewerVersion(target, this.#o.version)) return this.snapshot();

    this.#phase = 'updating';
    this.#target = target;
    this.#failure = undefined;
    const entered = this.snapshot();
    this.#o.onChange(entered);
    // Let this answer and the notification leave before the bridge stops.
    const timer = setTimeout(() => this.#o.handOver(target), 400);
    timer.unref?.();
    return entered;
  }
}

/**
 * Start the helper (`uxnan-bridge self-update`) detached from this bridge, so
 * it outlives it. It runs from the user's home: a helper sitting in the
 * package folder would keep npm from replacing it on Windows.
 */
export function spawnUpdateHelper(input: {
  execPath: string;
  cliPath: string;
  pid: number;
  version: string;
}): void {
  const child = spawn(
    input.execPath,
    [input.cliPath, 'self-update', '--pid', String(input.pid), '--to', input.version],
    { cwd: homedir(), detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
}

export interface SelfUpdateHelperInput {
  pid: number;
  to: string;
  from: string;
  cliPath: string;
  resultPath: string;
  platform: NodeJS.Platform;
  /** Where the bridge lives (tests); defaults to {@link resolveUpdateLayout}. */
  layout?: UpdateLayout | { reason: string };
  /** Start the bridge's service again (the new version, or the old one if npm failed). */
  startService: () => Promise<void>;
  /** Run npm; resolves with whether it worked and its output. */
  runNpm?: (layout: UpdateLayout, spec: string) => Promise<{ ok: boolean; output: string[] }>;
  writeResult: (path: string, result: UpdateResult) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  alive?: (pid: number) => boolean;
}

/**
 * The helper's whole job: wait for the old bridge to exit, install, record the
 * outcome, start the service. Whatever npm did, the service is started again —
 * a failed install leaves the old version in place, which then reports why.
 */
// FOR-DEV: never run as a live service yet — the clean stop, this helper
// outliving the bridge, and startService under launchd / systemd / Task
// Scheduler are verified only in tests and an isolated npm prefix. Unblocks
// with the first release that carries it (see bridge/FOR-DEV.md).
export async function runSelfUpdateHelper(input: SelfUpdateHelperInput): Promise<UpdateResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const alive = input.alive ?? isProcessAlive;
  const layout = input.layout ?? resolveUpdateLayout(input.cliPath, input.platform);

  let result: UpdateResult;
  const deadline = now() + HANDOVER_TIMEOUT_MS;
  while (alive(input.pid) && now() < deadline) await sleep(250);

  if (alive(input.pid)) {
    result = {
      at: now(),
      from: input.from,
      to: input.to,
      ok: false,
      failure: { reason: 'install', message: 'The bridge did not stop, so nothing was installed.' },
    };
  } else if ('reason' in layout) {
    result = {
      at: now(),
      from: input.from,
      to: input.to,
      ok: false,
      failure: { reason: 'unsupported', message: layout.reason, command: manualUpdateCommand() },
    };
  } else {
    const run = input.runNpm ?? runNpmInstall;
    const { ok, output } = await run(layout, `${BRIDGE_PACKAGE_NAME}@${input.to}`);
    const installed = ok ? installedVersion(layout.packageRoot) : undefined;
    const done = ok && installed === input.to;
    const failure =
      installFailure(ok, output) ??
      (done
        ? undefined
        : {
            reason: 'install' as const,
            message: `npm finished, but the bridge on disk is ${installed ?? 'unknown'}.`,
            command: manualUpdateCommand(input.to),
          });
    result = {
      at: now(),
      from: input.from,
      to: input.to,
      ok: done,
      ...(failure ? { failure } : {}),
    };
  }

  await input.writeResult(input.resultPath, result).catch(() => undefined);
  await input.startService().catch(() => undefined);
  return result;
}

/** `npm install --global --prefix <prefix> <spec>`, with this Node, no shell. */
function runNpmInstall(
  layout: UpdateLayout,
  spec: string,
): Promise<{ ok: boolean; output: string[] }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [layout.npmCli, 'install', '--global', '--prefix', layout.prefix, spec],
      { cwd: homedir(), windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 },
      (err, stdout, stderr) => {
        const output = `${stdout ?? ''}\n${stderr ?? ''}`.split(/\r?\n/);
        resolve({ ok: !err, output });
      },
    );
  });
}

/** The version in `<package>/package.json`, as npm left it. */
function installedVersion(packageRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}
