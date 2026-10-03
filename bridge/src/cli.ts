#!/usr/bin/env node
/**
 * uxnan-bridge CLI.
 *
 * Commands (architecture/02a-system-architecture.md §5.8.5):
 *   start            start the daemon
 *   stop             stop the daemon
 *   status           print current status
 *   qr               print the pairing QR in the terminal
 *   install-service  configure autostart on this platform
 *
 * `start` boots the daemon with the live LAN (and optional relay) transport and
 * prints the pairing QR + manual code; `status` asks the running daemon for its
 * own status and `code` for its pairing code; `stop`, `qr` and
 * `install-service`/`uninstall-service` manage the running daemon;
 * `service-status`/`service-start` let Uxnan Desktop run it as the user's
 * service; `config` reads and changes the settings shared with every client;
 * `update` asks the running bridge to update itself and `self-update` is the
 * helper it hands that over to (`self-update.ts`).
 */
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  agentLocation,
  encodePairingQr,
  locateAgent,
  type BridgeSettings,
  type BridgeUpdate,
  type RelayStatus,
} from '@uxnan/shared';
import { startBridge } from './bridge.js';
import { renderPairingQr } from './qr.js';
import { BRIDGE_VERSION } from './version.js';
import { ensureUpdateStatus, updateNoticeMessage } from './update-check.js';
import { manualUpdateCommand, runSelfUpdateHelper } from './self-update.js';
import { DaemonState, DAEMON_FILES } from './daemon-state.js';
import { LockFile, isProcessAlive } from './lock-file.js';
import {
  currentServiceEnv,
  installService,
  isServiceInstalled,
  isServicePlatformSupported,
  startService,
  uninstallService,
} from './service-installer.js';
import { BRIDGE_HOST_ENV } from './presence/host-info.js';
import { callRunningBridge, runningBridgePairing } from './local-control-client.js';
import { bridgeStatusReport } from './status-report.js';
import { pairingCodeForCli } from './pairing/cli-pairing-code.js';
import { enrichProcessPath } from './login-path.js';
import { runMcpProxy } from './adapters/mcp-proxy.js';
import { removeGlobalEntry } from './agents/global-mcp-entry.js';
import {
  configuredHome,
  configuredName,
  validateHome,
  validateName,
} from './settings/bridge-settings.js';

const USAGE = `uxnan-bridge v${BRIDGE_VERSION}

Usage: uxnan-bridge <command>

Commands:
  start              Start the bridge daemon (LAN/relay transport + pairing)
  status             Print the running bridge's status (JSON; starts nothing)
  qr                 Print the pairing QR code in the terminal
  code               Print the running bridge's manual-pairing code
  stop               Stop the running daemon
  install-service    Run the bridge as your user's service (starts at logon, now too)
  uninstall-service  Remove the service
  service-status     Print whether the service is installed and running (JSON)
  service-start      Start the installed service now
  mcp-proxy          (internal) Uxnan Desktop's tools for Antigravity
  self-update        (internal) Install a new version once the running bridge stops
  config get [key]           Print the shared settings (or one of them)
  config set home <folder>   Set the start folder new projects are explored from
  config set name <name>     Set what every client calls this PC
  relay status               Print the relay's state (JSON)
  relay setup --account <id> [--remember]
                             Deploy your own relay to your Cloudflare account
                             (asks for an API token; never pass it as an argument)
  relay use <wss-url>        Use a relay you deployed yourself
  relay enable | disable     Serve phones on other networks through the relay, or stop
  relay update [--remember]  Deploy the relay version this bridge ships
  relay rotate               Give this PC a new address on the relay
  relay remove [--delete-worker]
                             Stop using the relay (optionally take it off Cloudflare)
  update             Ask the running bridge to update itself to the published version
  version            Print the installed version (no daemon is started)
  help               Show this help
`;

/**
 * Best-effort "a newer bridge is available" notice, printed to stderr (so it
 * never corrupts the stdout of commands like `qr`/`code`). TTL-gated via the
 * on-disk cache, bounded by a short fetch timeout, and silent when up to date,
 * offline, or the latest version is unknown.
 */
async function printUpdateNotice(options: { force?: boolean } = {}): Promise<void> {
  try {
    // `start` always re-checks: it is the one command a user runs deliberately,
    // and the 24h cache meant a release published inside that window went
    // unannounced for up to a day (reported after 0.0.9 shipped). Short-lived
    // commands keep the cache so they stay fast.
    const status = await ensureUpdateStatus(new DaemonState(), options.force ? { ttlMs: 0 } : {});
    const message = updateNoticeMessage(status);
    if (message) process.stderr.write(`\n${message}\n`);
  } catch {
    // Never let the update check affect the command's outcome.
  }
}

async function cmdQr(): Promise<void> {
  // A running bridge (the service, or one started by hand) prints ITS payload
  // and opens ITS pairing window. Only with none running does this process
  // stand one up to print a payload of its own.
  const live = await runningBridgePairing(new DaemonState());
  const bridge = live ? undefined : await startBridge({ useKeychain: true });
  const payload = live ?? bridge!.generatePairingQr();
  const qr = await renderPairingQr(payload);
  process.stdout.write(`${qr}\n`);
  process.stdout.write('Scan with the Uxnan mobile app.\n');
  if (bridge) {
    process.stdout.write(
      `Or enter this pairing code on the phone: ${bridge.currentPairingCode()}\n`,
    );
  } else {
    process.stdout.write("Or enter the code 'uxnan-bridge code' prints.\n");
  }
  process.stdout.write(`Expires at: ${new Date(payload.expiresAt).toISOString()}\n`);
  process.stdout.write(`Payload: ${encodePairingQr(payload)}\n`);
  await bridge?.stop();
  await printUpdateNotice();
}

/**
 * `uxnan-bridge code`: the manual-pairing code of the RUNNING bridge, asked
 * over its local channel — which also opens that bridge's pairing window.
 * With none answering it comes from the code store every bridge shares, and
 * nothing else is started (`pairing/cli-pairing-code.ts`).
 */
async function cmdCode(): Promise<void> {
  const { code, source } = await pairingCodeForCli(new DaemonState());
  process.stdout.write(`${code}\n`);
  if (source === 'stored') {
    process.stderr.write(
      "No bridge answered on its local channel. A bridge accepts this code when a phone enters it; start one with 'uxnan-bridge start' if none runs.\n",
    );
  }
  await printUpdateNotice();
}

/**
 * `uxnan-bridge status`: the RUNNING bridge's own `bridge/status`, asked over
 * its local channel (`status-report.ts`) — never a second bridge stood up to
 * describe itself. With none running it says so and starts nothing.
 */
async function cmdStatus(): Promise<void> {
  const report = await bridgeStatusReport(new DaemonState(), {
    installedVersion: BRIDGE_VERSION,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function cmdStart(): Promise<void> {
  const state = new DaemonState();
  await state.ensureDir();
  const lock = new LockFile(state.pathFor(DAEMON_FILES.lock));
  const asService = process.argv.includes('--service');
  if (asService) process.env[BRIDGE_HOST_ENV] = 'service';
  if (!(await lock.acquire())) {
    const held = await lock.read();
    process.stderr.write(
      `uxnan-bridge is already running${held ? ` (pid ${held.pid})` : ''}. Run 'uxnan-bridge stop' first.\n`,
    );
    // The service manager restarts a service that fails; a bridge already
    // running (started by hand) is not a failure, and restarting against it
    // would only loop. Exit cleanly and let that one serve.
    process.exitCode = asService ? 0 : 1;
    return;
  }

  // A service or a GUI launch gets a minimal PATH: take the user's own first,
  // so installed agents (and `node` for their launchers) are found.
  await enrichProcessPath().catch(() => undefined);
  const bridge = await startBridge({
    useKeychain: true,
    manageGlobalEntries: true,
    recordChildProcesses: true,
  });

  if (bridge.context.config.lanEnabled) {
    try {
      const { port } = await bridge.startLan();
      process.stdout.write(`LAN server listening on port ${port}.\n`);
    } catch (err) {
      process.stderr.write(`Failed to start LAN server: ${errText(err)}\n`);
    }
  }

  if (bridge.context.config.localControlEnabled) {
    try {
      const { port } = await bridge.startLocalControl();
      process.stdout.write(`Local control channel for Uxnan Desktop on 127.0.0.1:${port}.\n`);
    } catch (err) {
      process.stderr.write(`Failed to start the local control channel: ${errText(err)}\n`);
    }
  }

  // A service's output lands in a log file, and a pairing QR or code is a
  // credential while its window is open: the service prints neither, and
  // pairing goes through `uxnan-bridge qr` or Uxnan Desktop, which ask it.
  const payload = asService ? bridge.pairingInfo() : bridge.generatePairingQr();
  if (asService) {
    process.stdout.write(
      "Running as your user's service. Pair a phone with 'uxnan-bridge qr' or from Uxnan Desktop.\n",
    );
  } else {
    const qr = await renderPairingQr(payload);
    process.stdout.write(`${qr}\nScan with the Uxnan mobile app.\n`);
    // Manual-code pairing: this RUNNING daemon serves `GET /pair/resolve`, so
    // its own in-memory code is the one the phone must enter.
    process.stdout.write(
      `Or enter this pairing code on the phone: ${bridge.currentPairingCode()}\n`,
    );
  }
  if (payload.hosts && payload.hosts.length > 0) {
    process.stdout.write(`Direct addresses (LAN/Tailscale): ${payload.hosts.join(', ')}\n`);
  }
  await bridge.startRelay();
  const relay = bridge.context.relay().status();
  process.stdout.write(
    relay.endpoint?.enabled
      ? `Relay: ${relay.endpoint.url} (phones on other networks connect through it).\n`
      : "No relay: phones connect on the LAN or Tailscale. Set one up with 'uxnan-bridge relay setup'.\n",
  );

  await printUpdateNotice({ force: true });
  if (!asService) process.stdout.write('Press Ctrl+C to stop.\n');
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void Promise.allSettled([bridge.stop(), lock.release()]).then(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

async function cmdStop(): Promise<void> {
  const state = new DaemonState();
  const lock = new LockFile(state.pathFor(DAEMON_FILES.lock));
  const held = await lock.read();
  if (!held || !isProcessAlive(held.pid)) {
    process.stdout.write('uxnan-bridge is not running.\n');
    await lock.release(held?.pid);
    return;
  }
  try {
    process.kill(held.pid, 'SIGTERM');
    process.stdout.write(`Sent stop signal to uxnan-bridge (pid ${held.pid}).\n`);
  } catch (err) {
    process.stderr.write(`Failed to stop pid ${held.pid}: ${errText(err)}\n`);
    process.exitCode = 1;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function bridgeCliPath(): string {
  return fileURLToPath(import.meta.url);
}

async function cmdInstallService(): Promise<void> {
  if (!isServicePlatformSupported(process.platform)) {
    process.stderr.write(`Autostart is not supported on '${process.platform}'.\n`);
    process.exitCode = 1;
    return;
  }
  const plan = await installService(currentServiceEnv(bridgeCliPath()));
  process.stdout.write(`${plan.note}\n`);
}

async function cmdUninstallService(): Promise<void> {
  if (!isServicePlatformSupported(process.platform)) {
    process.stderr.write(`Autostart is not supported on '${process.platform}'.\n`);
    process.exitCode = 1;
    return;
  }
  const plan = await uninstallService(currentServiceEnv(bridgeCliPath()));
  process.stdout.write(`${plan.uninstallNote}\n`);
  // The `uxnan-browser` entry the service kept in Antigravity's config goes
  // with it.
  await enrichProcessPath().catch(() => undefined);
  for (const agent of ['antigravity-cli'] as const) {
    const location = agentLocation(agent);
    const located = location ? locateAgent(location) : undefined;
    if (located?.available && (await removeGlobalEntry(agent, located))) {
      process.stdout.write(`Removed the uxnan-browser entry from ${agent}.\n`);
    }
  }
}

async function cmdServiceStatus(): Promise<void> {
  const supported = isServicePlatformSupported(process.platform);
  const installed = supported
    ? await isServiceInstalled(currentServiceEnv(bridgeCliPath()))
    : false;
  const held = await new LockFile(new DaemonState().pathFor(DAEMON_FILES.lock)).read();
  const running = held !== null && held !== undefined && isProcessAlive(held.pid);
  process.stdout.write(
    `${JSON.stringify({ supported, installed, running, ...(running ? { pid: held.pid } : {}) })}\n`,
  );
}

/**
 * `uxnan-bridge update`: ask the RUNNING bridge to update itself
 * (`bridge/update`) — the same request Uxnan Desktop and the phone make, so a
 * terminal is one more client of the one owner, never a second installer.
 */
async function cmdUpdate(): Promise<void> {
  const state = new DaemonState();
  let live: { result: unknown } | undefined;
  try {
    live = await callRunningBridge(state, 'bridge/update', undefined);
  } catch (err) {
    process.stderr.write(`The bridge did not update: ${errText(err)}\n`);
    process.exitCode = 1;
    return;
  }
  if (!live) {
    process.stderr.write(
      `No bridge is running. Update the installed one with: ${manualUpdateCommand()}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const update = live.result as BridgeUpdate;
  if (update.phase === 'updating') {
    process.stdout.write(
      `Updating the bridge to ${update.targetVersion ?? update.latestVersion ?? 'the latest version'}; it restarts in a moment.\n`,
    );
  } else {
    process.stdout.write(`The bridge is up to date (${update.version}).\n`);
  }
}

/**
 * The helper a running bridge starts for `bridge/update`: `--pid` is the bridge
 * it replaces, `--to` the version to install. It installs once that bridge has
 * exited, leaves the outcome for the next one and starts the service again.
 */
async function cmdSelfUpdate(args: string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const pid = Number(flag('--pid'));
  const to = flag('--to');
  if (!Number.isInteger(pid) || pid <= 0 || !to) {
    process.stderr.write('usage: uxnan-bridge self-update --pid <pid> --to <version>\n');
    process.exitCode = 1;
    return;
  }
  const state = new DaemonState();
  await state.ensureDir();
  const cliPath = bridgeCliPath();
  const env = currentServiceEnv(cliPath);
  const result = await runSelfUpdateHelper({
    pid,
    to,
    from: BRIDGE_VERSION,
    cliPath,
    resultPath: state.pathFor(DAEMON_FILES.updateResult),
    platform: process.platform,
    startService: () => startService(env),
    releaseLock: () => new LockFile(state.pathFor(DAEMON_FILES.lock)).release(process.pid),
    writeResult: (_path, value) => state.writeJson(DAEMON_FILES.updateResult, value),
  });
  process.exitCode = result.ok ? 0 : 1;
}

async function cmdServiceStart(): Promise<void> {
  if (!isServicePlatformSupported(process.platform)) {
    process.stderr.write(`Services are not supported on '${process.platform}'.\n`);
    process.exitCode = 1;
    return;
  }
  const env = currentServiceEnv(bridgeCliPath());
  if (!(await isServiceInstalled(env))) {
    process.stderr.write(
      "The bridge service is not installed. Run 'uxnan-bridge install-service'.\n",
    );
    process.exitCode = 1;
    return;
  }
  await startService(env);
  process.stdout.write('Started the bridge service.\n');
}

/**
 * `config get [home|name]` / `config set home <folder>` / `config set name
 * <name>`. A running bridge is changed through its local channel, so every
 * client hears it at once; with none running, the config file is written and
 * the next start uses it.
 */
async function cmdConfig(args: string[]): Promise<void> {
  const [action, key, ...rest] = args;
  const value = rest.join(' ');
  const state = new DaemonState();
  if (action === 'get') {
    const live = await callRunningBridge(state, 'settings/get', undefined).catch(() => undefined);
    const config = await state.readConfig();
    const settings = (live?.result as BridgeSettings | undefined) ?? {
      home: configuredHome(config),
      name: configuredName(config),
      relay: config.relay ?? null,
      hosts: [],
    };
    if (key === undefined) process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
    else if (key === 'home' || key === 'name') process.stdout.write(`${settings[key]}\n`);
    else throw new Error(`unknown setting: ${key}`);
    return;
  }
  if (action === 'set' && (key === 'home' || key === 'name') && rest.length > 0) {
    const label = key === 'home' ? 'Start folder' : 'PC name';
    const live = await callRunningBridge(state, 'settings/set', { [key]: value });
    if (live) {
      process.stdout.write(`${label}: ${(live.result as BridgeSettings)[key]}\n`);
      return;
    }
    const config = await state.readConfig();
    if (key === 'home') {
      const home = await validateHome(value).catch(() => {
        throw new Error(`not a folder: ${value}`);
      });
      await state.writeConfig({ ...config, home });
      process.stdout.write(`${label}: ${home} (used from the next start)\n`);
    } else {
      const name = validateName(value);
      await state.writeConfig({ ...config, name: name.length > 0 ? name : undefined });
      process.stdout.write(`${label}: ${configuredName({ name })} (used from the next start)\n`);
    }
    return;
  }
  throw new Error(
    'usage: uxnan-bridge config get [home|name] | config set home <folder> | config set name <name>',
  );
}

/** How long a relay action may take: a fresh deploy waits for workers.dev. */
const RELAY_CALL_TIMEOUT_MS = 120_000;

async function cmdRelay(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const flag = (name: string): boolean => rest.includes(name);
  const option = (name: string): string | undefined => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  const state = new DaemonState();
  const call = async (method: string, params?: unknown): Promise<RelayStatus> => {
    const live = await callRunningBridge(state, method, params, {
      timeoutMs: RELAY_CALL_TIMEOUT_MS,
    });
    if (!live) {
      throw new Error("the bridge is not running; start it first ('uxnan-bridge start')");
    }
    return live.result as RelayStatus;
  };
  const print = (status: RelayStatus): void => {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  };
  // A token is asked for when the action needs one and none is remembered.
  const tokenIfNeeded = async (): Promise<string | undefined> => {
    const status = await call('relay/status');
    return status.tokenRemembered ? undefined : readSecret('Cloudflare API token: ');
  };
  switch (action) {
    case 'status':
      return print(await call('relay/status'));
    case 'setup': {
      const accountId = option('--account') ?? (await readLine('Cloudflare account id: '));
      const apiToken = await readSecret('Cloudflare API token: ');
      process.stdout.write('Deploying your relay…\n');
      return print(
        await call('relay/setup', {
          provider: 'cloudflare',
          accountId,
          apiToken,
          remember: flag('--remember'),
        }),
      );
    }
    case 'use': {
      const url = rest[0];
      if (!url) break;
      return print(await call('relay/use', { url }));
    }
    case 'enable':
    case 'disable':
      return print(await call('relay/set', { enabled: action === 'enable' }));
    case 'update': {
      const apiToken = await tokenIfNeeded();
      return print(
        await call('relay/update', {
          ...(apiToken ? { apiToken } : {}),
          ...(flag('--remember') ? { remember: true } : {}),
        }),
      );
    }
    case 'rotate':
      return print(await call('relay/rotate'));
    case 'remove': {
      const deleteWorker = flag('--delete-worker');
      const apiToken = deleteWorker ? await tokenIfNeeded() : undefined;
      return print(await call('relay/remove', { deleteWorker, ...(apiToken ? { apiToken } : {}) }));
    }
    default:
      break;
  }
  throw new Error(
    'usage: uxnan-bridge relay status | setup --account <id> [--remember] | use <wss-url> | ' +
      'enable | disable | update [--remember] | rotate | remove [--delete-worker]',
  );
}

/** One line from the terminal. */
async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

/** A secret from the terminal, without echoing it (piped stdin works too). */
async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) return readLine(prompt);
  process.stderr.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (fn: () => void): void => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      process.stderr.write('\n');
      fn();
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(value.trim()));
        if (ch === '\u0003') return done(() => reject(new Error('cancelled')));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.on('data', onData);
  });
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'help';
  switch (command) {
    case 'qr':
      await cmdQr();
      return 0;
    case 'code':
      await cmdCode();
      return 0;
    case 'status':
      await cmdStatus();
      return 0;
    case 'start':
      await cmdStart();
      return 0;
    case 'stop':
      await cmdStop();
      return 0;
    case 'install-service':
      await cmdInstallService();
      return 0;
    case 'uninstall-service':
      await cmdUninstallService();
      return 0;
    case 'service-status':
      await cmdServiceStatus();
      return 0;
    case 'service-start':
      await cmdServiceStart();
      return 0;
    case 'config':
      await cmdConfig(process.argv.slice(3));
      return 0;
    case 'relay':
      await cmdRelay(process.argv.slice(3));
      return 0;
    case 'update':
      await cmdUpdate();
      return 0;
    case 'self-update':
      await cmdSelfUpdate(process.argv.slice(3));
      return 0;
    case 'mcp-proxy':
      // Started by Zero / Antigravity as their `uxnan-browser` MCP server.
      // stdout is the protocol: nothing else may be written to it.
      await runMcpProxy({ input: process.stdin, output: process.stdout, version: BRIDGE_VERSION });
      return 0;
    case 'version':
    case '--version':
    case '-v':
      // Just the version, nothing else on stdout: Uxnan Desktop reads it to
      // tell which bridge is installed without starting one.
      process.stdout.write(`${BRIDGE_VERSION}\n`);
      return 0;
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

main().then(
  (code) => {
    // A command that failed has already set its own exit code; keep it.
    if (!process.exitCode) process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(
      `uxnan-bridge error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  },
);
