/**
 * Bridge-control JSON-RPC handlers (desktop → bridge, and CLI introspection).
 *
 * These are implemented for real in the skeleton; they do not depend on the
 * (still deferred) live transport. Disconnecting an active session's transport
 * and persisting trust changes are wired further as those modules land.
 *
 * See uxnandesktop/architecture/02e-bridge-integration.md §4.4.
 */
import { hostname } from 'node:os';
import { RpcError } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { buildBridgeStatus } from '../bridge-status.js';
import { generatePairingPayload } from '../qr.js';

export function registerBridgeControlHandlers(router: HandlerRouter): void {
  router.register('bridge/status', (_params, ctx: BridgeContext) =>
    buildBridgeStatus({
      version: ctx.version,
      relayConnected: ctx.relayConnected(),
      lanEnabled: ctx.config.lanEnabled,
      activeSessions: ctx.sessions.count,
      startedAt: ctx.startedAt,
      now: ctx.now(),
    }),
  );

  router.register('bridge/generatePairingQr', (_params, ctx: BridgeContext) =>
    generatePairingPayload({
      relayUrl: ctx.config.relayUrl,
      macDeviceId: ctx.deviceState.identity.macDeviceId,
      macIdentityPublicKey: ctx.deviceState.identity.macIdentityPublicKey,
      displayName: hostname(),
      now: ctx.now(),
    }),
  );

  router.register('bridge/connectedPhones', (_params, ctx: BridgeContext) => ctx.sessions.list());

  router.register('bridge/trustedDevices', (_params, ctx: BridgeContext) => ctx.trustStore.list());

  router.register('bridge/disconnectPhone', (params, ctx: BridgeContext) => {
    const deviceId = requireDeviceId(params);
    ctx.sessions.remove(deviceId);
    // FOR-DEV: also close the live transport for this device once wired.
    return null;
  });

  router.register('bridge/removeTrustedDevice', async (params, ctx: BridgeContext) => {
    const deviceId = requireDeviceId(params);
    // Revoke trust so the phone can no longer trusted-reconnect, and drop any
    // live session/sink so a currently-connected device is disconnected now.
    // Idempotent: removing an already-absent device is not an error (the phone
    // deletes locally first and calls this best-effort).
    await ctx.trustStore.remove(deviceId);
    ctx.sessions.remove(deviceId);
    ctx.sessionRegistry.unregister(deviceId);
    return null;
  });
}

function requireDeviceId(params: unknown): string {
  if (
    params &&
    typeof params === 'object' &&
    'deviceId' in params &&
    typeof (params as { deviceId: unknown }).deviceId === 'string'
  ) {
    return (params as { deviceId: string }).deviceId;
  }
  throw RpcError.invalidParams('expected { deviceId: string }');
}
