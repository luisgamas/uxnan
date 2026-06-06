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
 * In this skeleton increment `start` boots the daemon core without the live
 * relay/LAN transport; `stop`/`install-service` are deferred (FOR-DEV).
 */
import { encodePairingQr } from '@uxnan/shared';
import { startBridge } from './bridge.js';
import { renderPairingQr } from './qr.js';
import { BRIDGE_VERSION } from './version.js';

const USAGE = `uxnan-bridge v${BRIDGE_VERSION}

Usage: uxnan-bridge <command>

Commands:
  start            Start the bridge daemon (skeleton: no live transport yet)
  status           Print the current bridge status
  qr               Print the pairing QR code in the terminal
  stop             Stop the running daemon (FOR-DEV)
  install-service  Configure autostart for this platform (FOR-DEV)
  help             Show this help
`;

async function cmdQr(): Promise<void> {
  const bridge = await startBridge();
  const payload = bridge.generatePairingQr();
  const qr = await renderPairingQr(payload);
  process.stdout.write(`${qr}\n`);
  process.stdout.write('Scan with the Uxnan mobile app.\n');
  process.stdout.write(`Expires at: ${new Date(payload.expiresAt).toISOString()}\n`);
  process.stdout.write(`Payload: ${encodePairingQr(payload)}\n`);
  await bridge.stop();
}

async function cmdStatus(): Promise<void> {
  const bridge = await startBridge();
  process.stdout.write(`${JSON.stringify(bridge.status(), null, 2)}\n`);
  await bridge.stop();
}

async function cmdStart(): Promise<void> {
  const bridge = await startBridge();
  process.stdout.write(`${JSON.stringify(bridge.status(), null, 2)}\n`);
  process.stdout.write('Bridge core started. Press Ctrl+C to stop.\n');
  // FOR-DEV: replace this idle wait with the relay/LAN event loop.
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void bridge.stop().then(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

function cmdInstallService(): void {
  process.stdout.write(
    'FOR-DEV: autostart installation is not implemented yet.\n' +
      'See bridge/scripts/install-service-{windows.ps1,macos.sh,linux.sh}.\n',
  );
}

function cmdStop(): void {
  process.stdout.write(
    'FOR-DEV: stopping a running daemon needs the daemon process manager (lock file + IPC).\n',
  );
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'help';
  switch (command) {
    case 'qr':
      await cmdQr();
      return 0;
    case 'status':
      await cmdStatus();
      return 0;
    case 'start':
      await cmdStart();
      return 0;
    case 'stop':
      cmdStop();
      return 0;
    case 'install-service':
      cmdInstallService();
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
