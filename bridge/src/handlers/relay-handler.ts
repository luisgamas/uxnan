/**
 * `relay/*` — the user's own relay (architecture/02a §5.10). Every client asks
 * the bridge, which owns the capability ({@link RelayService}); each method
 * answers with the relay's status after the action. Open to paired phones too:
 * a phone can set the relay up without the desktop (the token travels inside
 * the E2EE channel and is never echoed back).
 */
import { RpcError } from '@uxnan/shared';
import { decisionTime } from '../conversation/thread-store.js';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { optionalAge, optionalBoolean, optionalString, requireString } from './params.js';

export function registerRelayHandlers(router: HandlerRouter): void {
  router.register('relay/status', (_p, ctx: BridgeContext) => ctx.relay().status());

  router.register('relay/setup', (p, ctx: BridgeContext) => {
    const provider = requireString(p, 'provider');
    if (provider !== 'cloudflare') throw RpcError.invalidParams('provider must be "cloudflare"');
    const remember = optionalBoolean(p, 'remember');
    return ctx.relay().setup({
      provider,
      accountId: requireString(p, 'accountId'),
      apiToken: requireString(p, 'apiToken'),
      ...(remember !== undefined ? { remember } : {}),
    });
  });

  router.register('relay/use', (p, ctx: BridgeContext) => ctx.relay().use(requireString(p, 'url')));

  router.register('relay/set', (p, ctx: BridgeContext) => {
    const enabled = optionalBoolean(p, 'enabled');
    if (enabled === undefined) throw RpcError.invalidParams('enabled is required');
    return ctx.relay().setEnabled(enabled, decisionTime(ctx.now(), optionalAge(p)));
  });

  router.register('relay/update', (p, ctx: BridgeContext) => ctx.relay().update(credentials(p)));

  router.register('relay/rotate', (_p, ctx: BridgeContext) => ctx.relay().rotate());

  router.register('relay/remove', (p, ctx: BridgeContext) => {
    const deleteWorker = optionalBoolean(p, 'deleteWorker');
    return ctx.relay().remove({
      ...credentials(p),
      ...(deleteWorker !== undefined ? { deleteWorker } : {}),
    });
  });
}

function credentials(p: unknown): { apiToken?: string; remember?: boolean } {
  const apiToken = optionalString(p, 'apiToken');
  const remember = optionalBoolean(p, 'remember');
  return {
    ...(apiToken !== undefined ? { apiToken } : {}),
    ...(remember !== undefined ? { remember } : {}),
  };
}
