/**
 * Account/auth JSON-RPC handlers.
 *
 * `auth/status` returns a SANITIZED per-agent snapshot (never tokens — see
 * `account-status.ts`). `auth/login`/`auth/logout` remain stubs: driving a CLI's
 * interactive login flow is a follow-up (FOR-DEV). NEVER expose tokens (§5.8.9).
 */
import { RpcError, type AgentId } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { getAuthStatus } from '../account-status.js';
import { requireString } from './params.js';
import { registerStubs } from './not-implemented.js';

/** Auth methods whose CLI login flow is still deferred. */
export const ACCOUNT_STUB_METHODS = ['auth/login', 'auth/logout'] as const;

export function registerAccountHandlers(router: HandlerRouter): void {
  router.register('auth/status', (p, ctx: BridgeContext) => {
    const agentId = requireString(p, 'agentId') as AgentId;
    if (!ctx.agentManager.hasAdapter(agentId)) {
      throw RpcError.invalidParams(`unknown agent: ${agentId}`);
    }
    return getAuthStatus(agentId, {
      isAvailable: (id) => ctx.agentManager.isAvailable(id),
      platform: process.platform,
    });
  });
  registerStubs(router, ACCOUNT_STUB_METHODS);
}
