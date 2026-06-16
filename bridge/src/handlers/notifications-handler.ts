/**
 * Push-notification JSON-RPC handlers. The phone registers its FCM/APNs token so
 * the bridge can forward it to the relay and later deliver turn-completed pushes.
 *
 * Delivery is GATED on the relay having Firebase/APNs credentials
 * (relay/FOR-HUMAN.md); without them registration succeeds but nothing is
 * delivered. See architecture/02a §5.10 and bridge/src/push/push-service.ts.
 */
import type { NotificationPreferences, PushPlatform } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter, RequestSession } from '../handler-router.js';
import { asObject, optionalBoolean, requireString } from './params.js';

export function registerNotificationHandlers(router: HandlerRouter): void {
  router.register('notifications/register', async (p, ctx: BridgeContext, session) => {
    if (!ctx.pushService) return { registered: false };
    const sessionId = sessionIdFor(ctx, session);
    if (!sessionId) {
      ctx.logger.warn('push register without a known session — ignored');
      return { registered: false };
    }
    const pushToken = requireString(p, 'pushToken');
    const platform = requirePlatform(p);
    const preferences = readPreferences(p);
    return ctx.pushService.register({
      sessionId,
      ...(session?.deviceId !== undefined ? { deviceId: session.deviceId } : {}),
      pushToken,
      platform,
      ...(preferences ? { preferences } : {}),
    });
  });

  router.register('notifications/update', (p, ctx: BridgeContext, session) => {
    const preferences = readPreferences(p);
    const sessionId = sessionIdFor(ctx, session);
    if (ctx.pushService && preferences && sessionId) {
      ctx.pushService.updatePreferences(sessionId, preferences);
    }
    return null;
  });

  router.register('notifications/unregister', (_p, ctx: BridgeContext, session) => {
    const sessionId = sessionIdFor(ctx, session);
    if (sessionId) ctx.pushService?.unregister(sessionId);
    return null;
  });
}

/**
 * Resolve which phone session a `notifications/*` call targets: the request's own
 * session (set by the secure transport when several phones are concurrent), falling
 * back to the most-recently established session for single-phone setups / paths
 * that don't carry per-request identity.
 */
function sessionIdFor(ctx: BridgeContext, session?: RequestSession): string | undefined {
  return session?.sessionId ?? ctx.pushService?.activeSessionId;
}

function requirePlatform(params: unknown): PushPlatform {
  const platform = requireString(params, 'platform');
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error("platform must be 'ios' or 'android'");
  }
  return platform;
}

function readPreferences(params: unknown): NotificationPreferences | undefined {
  const prefs = asObject(params)['preferences'];
  if (prefs === undefined || prefs === null) return undefined;
  return {
    turnCompleted: optionalBoolean(prefs, 'turnCompleted') ?? true,
    turnError: optionalBoolean(prefs, 'turnError') ?? true,
  };
}
