/**
 * Uxnan Desktop's tools for the agents this bridge runs (architecture/02a
 * §5.8.15).
 *
 * The desktop hands the agents it launches in its terminals an MCP server —
 * its browser, terminals, other agents, the control catalog — scoped to the
 * project the agent works in. `desktop/attach` gives the agents of the
 * bridge's conversations the same server, so a chat on the desktop (or on the
 * phone, while the desktop is attached) can use them too.
 *
 * Only a client on the local control channel may attach: the endpoint is a
 * loopback URL and the token a credential, and a phone must never be able to
 * point this machine's agents at a server of its choosing. The bridge forgets
 * both when that client disconnects (`AgentManager.clearDesktopTools`).
 */
import {
  JsonRpcErrorCode,
  RpcError,
  isDesktopToken,
  isLoopbackMcpUrl,
  type DesktopAttachResult,
} from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter, RequestSession } from '../handler-router.js';
import { requireString } from './params.js';

function requireLocal(session: RequestSession | undefined): string {
  if (!session?.local) {
    throw new RpcError(
      JsonRpcErrorCode.AuthenticationRequired,
      'desktop/attach is only accepted over the local control channel',
    );
  }
  return session.local;
}

export function registerDesktopHandlers(router: HandlerRouter): void {
  router.register('desktop/attach', (p, ctx: BridgeContext, session): DesktopAttachResult => {
    const clientId = requireLocal(session);
    const mcpUrl = requireString(p, 'mcpUrl');
    const token = requireString(p, 'token');
    if (!isLoopbackMcpUrl(mcpUrl)) {
      throw RpcError.invalidParams(
        'mcpUrl must be a loopback http://127.0.0.1:<port>/mcp endpoint',
      );
    }
    if (!isDesktopToken(token)) throw RpcError.invalidParams('token is not a desktop token');
    ctx.agentManager.setDesktopTools({ mcpUrl, token }, clientId);
    ctx.logger.info(`desktop tools attached by local client ${clientId}`);
    return { attached: true };
  });
  router.register('desktop/detach', (_p, ctx: BridgeContext, session): DesktopAttachResult => {
    const clientId = requireLocal(session);
    ctx.agentManager.clearDesktopTools(clientId);
    return { attached: ctx.agentManager.desktopToolsAttached };
  });
}
