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
 * `install-service`/`uninstall-service` manage the running daemon.
 */
import { fileURLToPath } from 'node:url';
import { encodePairingQr } from '@uxnan/shared';
import { startBridge } from './bridge.js';
import { renderPairingQr } from './qr.js';
import { BRIDGE_VERSION } from './version.js';
import { ensureUpdateStatus, updateNoticeMessage } from './update-check.js';
import { DaemonState, DAEMON_FILES } from './daemon-state.js';
import { LockFile, isProcessAlive } from './lock-file.js';
import {
  currentServiceEnv,
  installService,
  isServicePlatformSupported,
  uninstallService,
} from './service-installer.js';

const USAGE = `uxnan-bridge v${BRIDGE_VERSION}

Usage: uxnan-bridge <command>

Commands:
  start            Start the bridge daemon (LAN/relay transport + pairing)
  status           Print the current bridge status
  qr               Print the pairing QR code in the terminal
  code             Print the current manual-pairing code (matches the daemon)
  stop             Stop the running daemon
  install-service    Start the bridge automatically at logon (as the current user)
  uninstall-service  Remove the autostart entry
  help             Show this help
`;

/**
 * Best-effort "a newer bridge is available" notice, printed to stderr (so it
 * never corrupts the stdout of commands like `status`/`code`). TTL-gated via the
 * on-disk cache, bounded by a short fetch timeout, and silent when up to date,
 * offline, or the latest version is unknown.
 */
async function printUpdateNotice(): Promise<void> {
  try {
    const status = await ensureUpdateStatus(new DaemonState());
    const message = updateNoticeMessage(status);
    if (message) process.stderr.write(`\n${message}\n`);
  } catch {
    // Never let the update check affect the command's outcome.
  }
}

async function cmdQr(): Promise<void> {
  // Note: this arms the PAIRING WINDOW on THIS short-lived process's own
  // PairingCodeService instance (see bridge.ts `generatePairingQr`), not on a
  // separately-running autostarted daemon — and a phone that SCANS this QR goes
  // straight to the handshake without calling `/pair/resolve`, so nothing arms
  // that daemon either. Against a hidden daemon, pair with the manual code
  // instead (`uxnan-bridge code`): resolving it arms the daemon that serves it.
  // See the "Cross-process arming" item in FOR-DEV.md.
  const bridge = await startBridge();
  const payload = bridge.generatePairingQr();
  const qr = await renderPairingQr(payload);
  process.stdout.write(`${qr}\n`);
  process.stdout.write('Scan with the Uxnan mobile app.\n');
  process.stdout.write(`Or enter this pairing code on the phone: ${bridge.currentPairingCode()}\n`);
  process.stdout.write(`Expires at: ${new Date(payload.expiresAt).toISOString()}\n`);
  process.stdout.write(`Payload: ${encodePairingQr(payload)}\n`);
  await bridge.stop();
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
  if (!(await lock.acquire())) {
    const held = await lock.read();
    process.stderr.write(
      `uxnan-bridge is already running${held ? ` (pid ${held.pid})` : ''}. Run 'uxnan-bridge stop' first.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const bridge = await startBridge();

  if (bridge.context.config.lanEnabled) {
    try {
      const { port } = await bridge.startLan();
      process.stdout.write(`LAN server listening on port ${port}.\n`);
    } catch (err) {
      process.stderr.write(`Failed to start LAN server: ${errText(err)}\n`);
    }
  }

  const payload = bridge.generatePairingQr();
  const qr = await renderPairingQr(payload);
  process.stdout.write(`${qr}\nScan with the Uxnan mobile app.\n`);
  // Manual-code pairing: this RUNNING daemon serves `GET /pair/resolve`, so its
  // own in-memory code is the one the phone must enter (the `qr` command runs a
  // separate, short-lived process with a different code).
  process.stdout.write(`Or enter this pairing code on the phone: ${bridge.currentPairingCode()}\n`);
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

  await printUpdateNotice();
  process.stdout.write('Press Ctrl+C to stop.\n');
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
