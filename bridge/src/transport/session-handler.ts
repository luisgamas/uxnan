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
import type { SessionSink } from './session-registry.js';
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
  let sink: SessionSink | undefined;
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

    // FOR-DEV: Bug A (relink latency / the 8 s post-reconnect `bridge/status`
    // heartbeat loop). The `[reconn]` logs in this handler are TEMPORARY
    // diagnostics — the bridge-side counterpart to the mobile ones — to pin where
    // a reconnected link breaks: the catch-up backlog size/time (a flood that
    // starves the heartbeat reply), a superseded half-open connection, or inbound
    // envelopes rejected as replays. Remove once root-caused. See
    // uxnanmobile/FOR-DEV.md → "Bug A".
    const supersedingOnConnect = ctx.sessionRegistry.isActive(result.phoneDeviceId);
    ctx.logger.info(
      `[reconn] handshake done mode=${result.mode} device=${result.phoneDeviceId} ` +
        `lastApplied=${result.lastAppliedBridgeOutboundSeq} superseding=${supersedingOnConnect}`,
    );

    // Catch-up (architecture/02a §5.9.2): replay every retained outbound message
    // the phone hasn't applied yet (seq > resumeState.lastAppliedBridgeOutboundSeq),
    // re-encrypted under the new session key, BEFORE registering the live sink so
    // the replayed backlog precedes any new traffic and ordering is preserved.
    const outboundLog = ctx.sessionRegistry.logFor(result.phoneDeviceId);
    const replayEntries = outboundLog.entriesAfter(result.lastAppliedBridgeOutboundSeq);
    const replayStartedAt = Date.now();
    let replayBytes = 0;
    for (const entry of replayEntries) {
      io.send(
        Buffer.from(
          JSON.stringify(result.channel.encryptReplay(entry.seq, entry.plaintext)),
          'utf-8',
        ),
      );
      replayBytes += entry.plaintext.byteLength;
    }
    if (replayEntries.length > 0) {
      ctx.logger.info(
        `[reconn] replayed ${replayEntries.length} msg(s) ${replayBytes}B ` +
          `seq ${replayEntries[0]?.seq}..${replayEntries[replayEntries.length - 1]?.seq} ` +
          `in ${Date.now() - replayStartedAt}ms`,
      );
    } else {
      ctx.logger.info('[reconn] no catch-up backlog to replay');
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
    ctx.logger.info(
      `[reconn] sink registered device=${result.phoneDeviceId} nextOutboundSeq=${outboundLog.nextSeq}`,
    );
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

    for (;;) {
      const raw = await queue.next();
      const parsed = tryParse(raw);
      const validation = validateE2EEnvelope(parsed);
      if (!validation.valid) continue;

      let plaintext: Buffer;
      try {
        plaintext = result.channel.decrypt(validation.data as SecureEnvelope);
      } catch (err) {
        ctx.logger.warn(
          `[reconn] envelope rejected: ${errorMessage(err)} ` +
            `(channel lastInbound=${result.channel.lastInboundSeq})`,
        );
        continue;
      }

      const request = tryParse(plaintext);
      if (methodOf(request) === 'bridge/status') {
        ctx.logger.info(
          `[reconn] bridge/status received seq=${(validation.data as SecureEnvelope).seq} ` +
            `→ dispatch+reply`,
        );
      }
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
      ctx.logger.info(
        `[reconn] connection teardown device=${phoneDeviceId} stillCurrent=${stillCurrent}`,
      );
      if (stillCurrent) {
        ctx.sessions.remove(phoneDeviceId);
        if (sessionId !== undefined) ctx.pushService.clearActiveSession(sessionId);
      }
      ctx.logger.info(`phone session closed: ${phoneDeviceId}`);
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

/** The JSON-RPC `method` of a parsed request, if present (for `[reconn]` logs). */
function methodOf(value: unknown): string | undefined {
  if (value !== null && typeof value === 'object' && 'method' in value) {
    const method = (value as { method?: unknown }).method;
    return typeof method === 'string' ? method : undefined;
  }
  return undefined;
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
