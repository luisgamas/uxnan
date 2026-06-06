/**
 * Drives a single mobile connection: runs the E2EE handshake, then decrypts
 * inbound envelopes, dispatches the JSON-RPC request through the router, and
 * returns the encrypted response.
 *
 * Transport-agnostic: works over any {@link MessageIO} (relay client or LAN
 * server connection).
 */
import { validateE2EEnvelope, type SecureEnvelope } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import type { SecureDeviceState } from '../secure-device-state.js';
import { queueFor, type MessageIO } from './message-io.js';
import { performServerHandshake } from './server-handshake.js';
import type { TrustStore } from './trust-store.js';

export interface SecureConnectionOptions {
  io: MessageIO;
  ctx: BridgeContext;
  router: HandlerRouter;
  deviceState: SecureDeviceState;
  trustStore: TrustStore;
  displayName: string;
  expectedSessionId?: string;
}

/**
 * Handle a connection end-to-end. Resolves when the connection closes. Never
 * throws — handshake/transport failures are logged and the channel is closed.
 */
export async function handleSecureConnection(options: SecureConnectionOptions): Promise<void> {
  const { io, ctx, router, deviceState, trustStore, displayName } = options;
  const queue = queueFor(io);
  const send = (message: unknown): void => io.send(Buffer.from(JSON.stringify(message), 'utf-8'));

  let phoneDeviceId: string | undefined;
  try {
    const handshakeOptions = {
      queue,
      send,
      deviceState,
      trustStore,
      displayName,
      now: ctx.now,
      ...(options.expectedSessionId !== undefined
        ? { expectedSessionId: options.expectedSessionId }
        : {}),
    };
    const result = await performServerHandshake(handshakeOptions);
    phoneDeviceId = result.phoneDeviceId;

    const trusted = await trustStore.get(result.phoneDeviceId);
    ctx.sessions.add({
      deviceId: result.phoneDeviceId,
      displayName: trusted?.displayName ?? result.phoneDeviceId,
      connectedAt: ctx.now(),
      lastSeen: ctx.now(),
    });
    ctx.logger.info(`phone session established (${result.mode}): ${result.phoneDeviceId}`);

    for (;;) {
      const raw = await queue.next();
      const parsed = tryParse(raw);
      const validation = validateE2EEnvelope(parsed);
      if (!validation.valid) continue;

      let plaintext: Buffer;
      try {
        plaintext = result.channel.decrypt(validation.data as SecureEnvelope);
      } catch (err) {
        ctx.logger.warn(`envelope rejected: ${errorMessage(err)}`);
        continue;
      }

      const request = tryParse(plaintext);
      const response = await router.dispatchRaw(request);
      send(result.channel.encrypt(Buffer.from(JSON.stringify(response), 'utf-8')));
    }
  } catch (err) {
    // queue closed (normal disconnect) or handshake failure.
    if (phoneDeviceId === undefined) {
      ctx.logger.warn(`handshake failed: ${errorMessage(err)}`);
    }
  } finally {
    if (phoneDeviceId !== undefined) {
      ctx.sessions.remove(phoneDeviceId);
      ctx.logger.info(`phone session closed: ${phoneDeviceId}`);
    }
    io.close();
  }
}

function tryParse(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf-8'));
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
