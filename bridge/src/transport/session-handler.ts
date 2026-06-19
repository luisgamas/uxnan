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
  let sessionId: string | undefined;
  try {
    const handshakeOptions = {
      queue,
      send,
      deviceState,
      trustStore,
      displayName,
      now: ctx.now,
      // Build the channel over this phone's persistent outbound log so its seq
      // continues across reconnects and outbound messages are retained for
      // seq-based catch-up.
      outboundLogFor: (id: string) => ctx.sessionRegistry.logFor(id),
      ...(options.expectedSessionId !== undefined
        ? { expectedSessionId: options.expectedSessionId }
        : {}),
    };
    const result = await performServerHandshake(handshakeOptions);
    phoneDeviceId = result.phoneDeviceId;
    sessionId = result.sessionId;
    // Mark this as the active session so a `notifications/register` from the phone
    // (and later turn-end pushes) target the right relay session.
    ctx.pushService.setActiveSession(result.sessionId);

    // Catch-up (architecture/02a §5.9.2): replay every retained outbound message
    // the phone hasn't applied yet (seq > resumeState.lastAppliedBridgeOutboundSeq),
    // re-encrypted under the new session key, BEFORE registering the live sink so
    // the replayed backlog precedes any new traffic and ordering is preserved.
    const outboundLog = ctx.sessionRegistry.logFor(result.phoneDeviceId);
    for (const entry of outboundLog.entriesAfter(result.lastAppliedBridgeOutboundSeq)) {
      io.send(
        Buffer.from(
          JSON.stringify(result.channel.encryptReplay(entry.seq, entry.plaintext)),
          'utf-8',
        ),
      );
    }

    // Register the encrypted sink synchronously (before any further await) so the
    // bridge can push notifications immediately. Each live send is encrypted by
    // the channel, which records it in the outbound log for future catch-up.
    ctx.sessionRegistry.register(result.phoneDeviceId, {
      send: (message) =>
        io.send(Buffer.from(JSON.stringify(result.channel.encrypt(toBytes(message))), 'utf-8')),
    });

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
      // Tag the request with this connection's session identity so per-phone
      // handlers (notifications/*) target the right session when several phones
      // are connected concurrently.
      const response = await router.dispatchRaw(request, {
        sessionId: result.sessionId,
        deviceId: result.phoneDeviceId,
      });
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
      ctx.sessionRegistry.unregister(phoneDeviceId);
      if (sessionId !== undefined) ctx.pushService.clearActiveSession(sessionId);
      ctx.logger.info(`phone session closed: ${phoneDeviceId}`);
    }
    io.close();
  }
}

function toBytes(message: unknown): Buffer {
  return Buffer.from(JSON.stringify(message), 'utf-8');
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
