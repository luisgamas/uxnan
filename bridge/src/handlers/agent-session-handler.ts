/**
 * Agent sessions (architecture/02a §5.8.19): every agent's own sessions in a
 * folder, and which of them a desktop terminal holds.
 *
 * `agent/sessions` asks each agent's CLI through the adapter
 * (`AgentManager.listAgentSessions`) and adds what the bridge knows: the
 * conversation that continues a session and the terminal that holds one.
 * A session counts only when a person had it — one a program ran headless is
 * listed only when a conversation continues it, and Uxnan's own one-shots
 * (naming, commit messages) never are.
 *
 * `hold` / `release` / `handoffAnswer` come only from Uxnan Desktop, over the
 * local control channel: a hold is the desktop's word that one of its
 * terminals is the session's writer.
 */
import {
  JsonRpcErrorCode,
  RpcError,
  isOneShotPrompt,
  type AgentId,
  type AgentSessionHandoffResult,
  type AgentSessionHold,
  type AgentSessionHoldsResult,
  type AgentSessionListResult,
  type AgentSessionSummary,
} from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter, RequestSession } from '../handler-router.js';
import { sessionKey } from '../conversation/thread-store.js';
import { optionalBoolean, optionalString, requireString } from './params.js';

const HANDOFF_ANSWERS = new Set(['released', 'busy', 'declined']);

function requireLocal(session: RequestSession | undefined, method: string): string {
  if (!session?.local) {
    throw new RpcError(
      JsonRpcErrorCode.AuthenticationRequired,
      `${method} is only accepted over the local control channel`,
    );
  }
  return session.local;
}

/** Who is asking, by the name every client shows. */
function askerName(ctx: BridgeContext, session: RequestSession | undefined): string {
  if (!session || session.local !== undefined) return ctx.settings.get().name;
  return ctx.sessions.get(session.deviceId)?.displayName ?? 'Phone';
}

export function registerAgentSessionHandlers(router: HandlerRouter): void {
  router.register(
    'agent/sessions',
    async (p, ctx: BridgeContext): Promise<AgentSessionListResult> => {
      const cwd = requireString(p, 'cwd');
      const only = optionalString(p, 'agentId') as AgentId | undefined;
      const [{ lists, unlisted }, links] = await Promise.all([
        ctx.agentManager.listAgentSessions(cwd, only),
        ctx.threadStore.sessionLinks(),
      ]);
      const now = ctx.now();
      const seen = new Set<string>();
      const sessions: AgentSessionSummary[] = [];
      for (const { agentId, sessions: native } of lists) {
        for (const s of native) {
          const key = sessionKey(agentId, s.sessionId);
          const threadId = links.get(key);
          if (!s.interactive && threadId === undefined) continue;
          if (s.title !== undefined && isOneShotPrompt(s.title)) continue;
          const hold = ctx.sessionHolds.find(agentId, s.sessionId);
          seen.add(key);
          sessions.push({
            agentId,
            sessionId: s.sessionId,
            cwd,
            ...(s.title !== undefined ? { title: s.title } : {}),
            updatedAgoMs: Math.max(0, now - s.updatedAt),
            ...(threadId !== undefined ? { threadId } : {}),
            ...(hold !== undefined ? { hold } : {}),
          });
        }
      }
      // A session open in a terminal is there even when its CLI cannot list
      // it (Antigravity) or has not written it down yet.
      for (const hold of ctx.sessionHolds.list()) {
        if (hold.cwd !== cwd || (only !== undefined && hold.agentId !== only)) continue;
        const key = sessionKey(hold.agentId, hold.sessionId);
        if (seen.has(key)) continue;
        const threadId = links.get(key);
        sessions.push({
          agentId: hold.agentId,
          sessionId: hold.sessionId,
          cwd,
          updatedAgoMs: hold.heldAgoMs,
          ...(threadId !== undefined ? { threadId } : {}),
          hold,
        });
      }
      sessions.sort((a, b) => a.updatedAgoMs - b.updatedAgoMs);
      return { sessions, unlisted };
    },
  );

  router.register(
    'agent/holds',
    (_p, ctx: BridgeContext): AgentSessionHoldsResult => ({ holds: ctx.sessionHolds.list() }),
  );

  router.register(
    'agent/hold',
    async (p, ctx: BridgeContext, session): Promise<AgentSessionHold> => {
      const clientId = requireLocal(session, 'agent/hold');
      const agentId = requireString(p, 'agentId') as AgentId;
      const sessionId = requireString(p, 'sessionId');
      const cwd = optionalString(p, 'cwd');
      const busy = optionalBoolean(p, 'busy');
      const thread = await ctx.threadStore.threadForSession(agentId, sessionId);
      const hold = ctx.sessionHolds.hold(clientId, {
        agentId,
        sessionId,
        ...(cwd !== undefined ? { cwd } : {}),
        ...(busy !== undefined ? { busy } : {}),
        ...(thread !== undefined ? { threadId: thread.id } : {}),
      });
      // The terminal is now the session's writer: let go of the process this
      // bridge may keep for the conversation (never cancelling a turn).
      if (thread !== undefined) await ctx.agentManager.releaseThreadProcess(thread.id);
      return hold;
    },
  );

  router.register('agent/release', (p, ctx: BridgeContext, session) => {
    const clientId = requireLocal(session, 'agent/release');
    ctx.sessionHolds.release(clientId, {
      agentId: requireString(p, 'agentId') as AgentId,
      sessionId: requireString(p, 'sessionId'),
    });
  });

  router.register(
    'agent/requestHandoff',
    async (p, ctx: BridgeContext, session): Promise<AgentSessionHandoffResult> => ({
      outcome: await ctx.sessionHolds.requestHandoff(
        {
          agentId: requireString(p, 'agentId') as AgentId,
          sessionId: requireString(p, 'sessionId'),
        },
        askerName(ctx, session),
      ),
    }),
  );

  router.register('agent/handoffAnswer', (p, ctx: BridgeContext, session) => {
    const clientId = requireLocal(session, 'agent/handoffAnswer');
    const outcome = requireString(p, 'outcome');
    if (!HANDOFF_ANSWERS.has(outcome)) {
      throw RpcError.invalidParams('outcome must be released, busy or declined');
    }
    ctx.sessionHolds.answer(
      clientId,
      requireString(p, 'requestId'),
      outcome as 'released' | 'busy' | 'declined',
    );
  });
}
