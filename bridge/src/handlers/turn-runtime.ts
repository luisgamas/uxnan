/**
 * What every turn on a conversation runs with, wherever it is sent from —
 * `turn/send`, and the first message a continuation sends itself
 * (`thread/transfer { message }`) — so both go through one path: the thread's
 * agent, model, folder and access mode, refused while a desktop terminal holds
 * its session (§5.8.19), and the desktop's tools for a turn a desktop sent.
 *
 * Source: architecture/02a-system-architecture.md §5.8.8, §5.8.19, §5.8.21.
 */
import { JsonRpcErrorCode, RpcError, isDesktopClientId } from '@uxnan/shared';
import type { AgentId, ThreadOrigin } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { SendTurnOptions } from '../agents/agent-manager.js';
import type { RequestSession } from '../handler-router.js';

/** Which client is starting a conversation (`Thread.origin`). */
export function originOf(
  ctx: BridgeContext,
  session: RequestSession | undefined,
): ThreadOrigin | undefined {
  if (!session) return undefined;
  if (session.local !== undefined) return { kind: 'desktop', name: ctx.settings.get().name };
  const phone = ctx.sessions.get(session.deviceId);
  return { kind: 'phone', name: phone?.displayName ?? 'Phone' };
}

/**
 * The options a turn on [threadId] runs with. Throws `SessionHeld` while a
 * desktop terminal holds the conversation's agent session: a CLI's session has
 * one writer, and the client shows who holds it and can ask for it
 * (`agent/requestHandoff`).
 */
export async function turnRuntimeOptions(
  ctx: BridgeContext,
  threadId: string,
  session: RequestSession | undefined,
): Promise<SendTurnOptions> {
  const runtime = await ctx.threadStore.getThreadRuntime(threadId);
  const source = await ctx.threadStore.getHistorySource(threadId);
  if (source.agentId !== undefined && source.agentSessionId !== undefined) {
    const hold = ctx.sessionHolds.find(source.agentId, source.agentSessionId);
    if (hold) {
      throw new RpcError(
        JsonRpcErrorCode.SessionHeld,
        `This conversation is open in a terminal on ${hold.holder.name}`,
        hold,
      );
    }
  }
  return {
    ...(runtime.agentId !== undefined ? { agentId: runtime.agentId as AgentId } : {}),
    ...(runtime.model !== undefined ? { service: runtime.model } : {}),
    ...(runtime.cwd !== undefined ? { cwd: runtime.cwd } : {}),
    // The thread's persisted access mode (adapters map it to their permission
    // flag; absent → the adapter's configured posture).
    ...(runtime.accessMode !== undefined ? { accessMode: runtime.accessMode } : {}),
    // Sent from a desktop: its agents get that desktop's MCP server.
    ...(session?.local !== undefined && isDesktopClientId(session.local)
      ? { desktopClient: session.local }
      : {}),
  };
}
