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
 * prints the pairing QR + manual code; `stop`, `status`, `code`, `qr` and
 * `install-service`/`uninstall-service` manage the running daemon;
 * `service-status`/`service-start` let Uxnan Desktop run it as the user's
 * service; `config` reads and changes the settings shared with every client.
 */
import { fileURLToPath } from 'node:url';
import { agentLocation, encodePairingQr, locateAgent, type BridgeSettings } from '@uxnan/shared';
import { startBridge } from './bridge.js';
import { renderPairingQr } from './qr.js';
import { BRIDGE_VERSION } from './version.js';
import { ensureUpdateStatus, updateNoticeMessage } from './update-check.js';
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
  status             Print the current bridge status
  qr                 Print the pairing QR code in the terminal
  code               Print the current manual-pairing code (matches the daemon)
  stop               Stop the running daemon
  install-service    Run the bridge as your user's service (starts at logon, now too)
  uninstall-service  Remove the service
  service-status     Print whether the service is installed and running (JSON)
  service-start      Start the installed service now
  mcp-proxy          (internal) Uxnan Desktop's tools for Antigravity
  config get [key]           Print the shared settings (or one of them)
  config set home <folder>   Set the start folder new projects are explored from
  config set name <name>     Set what every client calls this PC
  version            Print the installed version (no daemon is started)
  help               Show this help
`;

/**
 * Best-effort "a newer bridge is available" notice, printed to stderr (so it
 * never corrupts the stdout of commands like `status`/`code`). TTL-gated via the
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
  const bridge = live ? undefined : await startBridge();
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

async function cmdCode(): Promise<void> {
  // Prints the current manual-pairing code. Shares the code with a running
  // daemon via `~/.uxnan/pairing-code.json`, so this matches what the daemon
  // serving `/pair/resolve` accepts — handy when the daemon runs hidden (autostart).
  // This is the flow that works against a hidden daemon: arming is NOT
  // cross-process, but the phone resolving this code over `/pair/resolve` arms
  // the daemon that serves it (proving the code was read off the PC is the
  // operator action the bootstrap gate looks for).
  const bridge = await startBridge();
  process.stdout.write(`${bridge.currentPairingCode()}\n`);
  await bridge.stop();
  await printUpdateNotice();
}

async function cmdStatus(): Promise<void> {
  const bridge = await startBridge();
  process.stdout.write(`${JSON.stringify(bridge.status(), null, 2)}\n`);
  await bridge.stop();
  await printUpdateNotice();
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
  const bridge = await startBridge({ manageGlobalEntries: true });

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
  if (bridge.context.config.relayEnabled && payload.relay) {
    try {
      await bridge.connectRelay(payload.sessionId);
      process.stdout.write(`Connected to relay ${payload.relay}; waiting for a phone.\n`);
    } catch (err) {
      process.stderr.write(
        `Relay connection failed (${errText(err)}); the direct LAN/Tailscale path remains available.\n`,
      );
    }
  } else {
    process.stdout.write('Relay disabled; using the direct LAN/Tailscale path only.\n');
  }

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
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(
      `uxnan-bridge error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  },
);
