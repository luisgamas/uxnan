#!/usr/bin/env node
/**
 * uxnan-relay CLI: start the relay server.
 *
 * Usage: uxnan-relay [port]   (default port 8787, or $RELAY_PORT)
 */
import { RelayServer } from './relay-server.js';
import { PushRegistry, createDefaultPushSender } from './push.js';

async function main(): Promise<void> {
  const portArg = process.argv[2] ?? process.env['RELAY_PORT'] ?? '8787';
  const port = Number.parseInt(portArg, 10);
  if (Number.isNaN(port)) {
    process.stderr.write(`Invalid port: ${portArg}\n`);
    process.exitCode = 1;
    return;
  }

  const logger = {
    info: (m: string) => process.stdout.write(`[relay] ${m}\n`),
    warn: (m: string) => process.stderr.write(`[relay] ${m}\n`),
  };
  // Push delivery uses FCM when UXNAN_FCM_SERVICE_ACCOUNT is set, else a noop
  // sender (registrations + dedupe still work; nothing is delivered).
  const pushRegistry = new PushRegistry({ sender: await createDefaultPushSender(logger), logger });
  const server = new RelayServer({ logger, pushRegistry });
  const handle = await server.start(port);
  process.stdout.write(`uxnan-relay listening on port ${handle.port}\n`);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void handle.close().then(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

void main();
