/**
 * Drives a single mobile connection: runs the E2EE handshake, then decrypts
 * inbound envelopes, dispatches the JSON-RPC request through the router, and
 * returns the encrypted response.
 *
 * Transport-agnostic: works over any {@link MessageIO} (relay client or LAN
 * server connection).
 */
import { validateE2EEnvelope, type MetricsTransport, type SecureEnvelope } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import type { SecureDeviceState } from '../secure-device-state.js';
import { queueFor, type MessageIO } from './message-io.js';
import { performServerHandshake } from './server-handshake.js';
import type { SessionSink } from './session-registry.js';
import type { TrustStore } from './trust-store.js';

export interface SecureConnectionOptions {
  io: MessageIO;
  ctx: BridgeContext;
  router: HandlerRouter;
  deviceState: SecureDeviceState;
  trustStore: TrustStore;
  displayName: string;
  /** Which transport this connection runs over, for the connection metrics. */
  transport: MetricsTransport;
  expectedSessionId?: string;
  /**
   * Gate a `qr_bootstrap` handshake on an operator-armed pairing window (LAN
   * only — see `PairingCodeService.arm`/`isArmed`). Omitted on the relay path,
   * which is left ungated here: it already scopes bootstrap to one
   * `expectedSessionId` per connection.
   */
  isPairingArmed?: () => boolean;
}

/**
 * Handle a connection end-to-end. Resolves when the connection closes. Never
 * throws — handshake/transport failures are logged and the channel is closed.
 */
export async function handleSecureConnection(options: SecureConnectionOptions): Promise<void> {
  const { io, ctx, router, deviceState, trustStore, displayName, transport } = options;
  const queue = queueFor(io);
  const send = (message: unknown): void => io.send(Buffer.from(JSON.stringify(message), 'utf-8'));

  let phoneDeviceId: string | undefined;
  let sessionId: string | undefined;
  let sink: SessionSink | undefined;
  // Log-row id for this connection's metric session (relay/direct connected time),
  // or undefined until the channel is established.
  let metricsSessionId: string | undefined;
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
      ...(options.isPairingArmed !== undefined ? { isPairingArmed: options.isPairingArmed } : {}),
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
    const replayEntries = outboundLog.entriesAfter(result.lastAppliedBridgeOutboundSeq);
    for (const entry of replayEntries) {
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
    // Kept in a variable so the teardown below only fires when this connection
    // is still the current one (a reconnecting phone may have superseded it).
    sink = {
      send: (message) =>
        io.send(Buffer.from(JSON.stringify(result.channel.encrypt(toBytes(message))), 'utf-8')),
    };
    ctx.sessionRegistry.register(result.phoneDeviceId, sink);
    // A phone is now connected: grant a fresh window to any approval that was
    // waiting (its card replays via the catch-up above) so the user can answer
    // it instead of it auto-rejecting while they were away.
    ctx.agentManager.onPhoneConnected();

    const trusted = await trustStore.get(result.phoneDeviceId);
    ctx.sessions.add({
      deviceId: result.phoneDeviceId,
      displayName: trusted?.displayName ?? result.phoneDeviceId,
      connectedAt: ctx.now(),
      lastSeen: ctx.now(),
    });
    ctx.logger.info(`phone session established (${result.mode}): ${result.phoneDeviceId}`);
    // Open a metric session row so the profile can report connected time, longest
    // session, session count and the relay-vs-direct split. Best-effort: a failure
    // never affects the live channel.
    try {
      metricsSessionId = await ctx.metrics.startSession(result.phoneDeviceId, transport);
    } catch (err) {
      ctx.logger.warn(`failed to open metric session: ${errorMessage(err)}`);
    }

    for (;;) {
      const raw = await queue.next();
      const parsed = tryParse(raw);
      const validation = validateE2EEnvelope(parsed);
      if (!validation.valid) continue;

      let plaintext: Buffer;
      try {
        plaintext = result.channel.decrypt(validation.data as SecureEnvelope);
      } catch {
        // A replayed/out-of-order envelope fails the strictly-increasing seq
        // check; drop it silently and wait for the next valid frame.
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
      // Only tear down the shared session state if THIS connection still owns
      // it. A reconnecting phone (LAN/direct) may have opened a newer connection
      // that already replaced our sink + active session while our old socket was
      // still half-open; when our stale connection finally closes, clobbering
      // the newer one's sink/session/active-id would silently kill its push
      // delivery. `unregister` returns false when we were superseded.
      const stillCurrent =
        sink === undefined || ctx.sessionRegistry.unregister(phoneDeviceId, sink);
      if (stillCurrent) {
        ctx.sessions.remove(phoneDeviceId);
        if (sessionId !== undefined) ctx.pushService.clearActiveSession(sessionId);
      }
      ctx.logger.info(`phone session closed: ${phoneDeviceId}`);
      // Close this connection's metric session at its teardown time. Each
      // connection owns the row it opened (a reconnecting phone opened its own),
      // so this is unconditional — not gated on `stillCurrent`.
      if (metricsSessionId !== undefined) {
        void ctx.metrics.endSession(metricsSessionId).catch(() => {
          /* best-effort — a dangling row is closed at startup instead */
        });
      }
      // If this was the last connected phone, stop the approval auto-reject
      // countdown so a pending approval waits for the user to return rather than
      // defaulting to reject. No-op while another phone is still connected.
      ctx.agentManager.onPhoneDisconnected();
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
