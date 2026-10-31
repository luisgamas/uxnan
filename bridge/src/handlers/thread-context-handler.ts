/**
 * Thread/turn JSON-RPC handlers — conversation CRUD backed by the
 * {@link ThreadStore}, with `turn/send` driving the {@link AgentManager}.
 * Streaming output reaches the phone via `stream/*` notifications.
 *
 * Source: architecture/02a-system-architecture.md §5.8.8.
 */
import {
  ACCESS_MODES,
  JsonRpcErrorCode,
  MAX_ATTACHMENT_BYTES,
  inlineAttachmentsError,
  RpcError,
  previewStepRange,
  summarizeTurn,
} from '@uxnan/shared';
import type {
  AccessMode,
  AgentCommandInvocation,
  AgentId,
  ApprovalDecision,
  ApprovalResponse,
  QuestionResponse,
  TurnAttachment,
  TurnList,
} from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import type { SendTurnOptions } from '../agents/agent-manager.js';
import {
  optionalAge,
  optionalBoolean,
  optionalNumber,
  optionalObject,
  optionalString,
  requireIndex,
  requireString,
} from './params.js';
import { withLiveState } from './sync-handler.js';
import { originOf, turnRuntimeOptions } from './turn-runtime.js';
import {
  continueConversation,
  createdByOf,
  optionalStrategy,
  optionalTransferKey,
} from './conversation-handler.js';
import { decisionTime } from '../conversation/thread-store.js';

// Every change below is announced by the ThreadStore itself (`onChange`, wired
// in bridge.ts) once it is on disk, with its sync revision — so no handler can
// change a thread and forget to tell the clients.

export function registerThreadHandlers(router: HandlerRouter): void {
  // Both carry the live `activeTurnId`, so a client that just connected sees
  // which conversations are working without reading each one's turns.
  router.register('thread/list', async (p, ctx: BridgeContext) => {
    const list = await ctx.threadStore.listThreads(optionalString(p, 'projectId'));
    return { ...list, threads: list.threads.map((t) => withLiveState(t, ctx)) };
  });
  router.register('thread/read', async (p, ctx: BridgeContext) =>
    withLiveState(await ctx.threadStore.getThread(requireString(p, 'threadId')), ctx),
  );
  router.register('thread/start', async (p, ctx: BridgeContext, session) => {
    // The folder decides the project, never the other way round: a client that
    // sent a stale or mismatched `projectId` next to its `cwd` must not file the
    // conversation under another project. Without a `cwd` the project's folder
    // is used. Either way the project is registered, so a conversation always
    // lists under a project every client knows.
    const requestedCwd = optionalString(p, 'cwd');
    const cwd = requestedCwd ?? ctx.projects.byId(requireString(p, 'projectId')).cwd;
    const project = await ctx.projects.add(cwd, { source: 'thread' });
    const projectId = project.id;
    // Per-project pin: when the phone omits agent/model, fall back to the
    // project's configured agent (then the bridge's global default). The pinned
    // model only applies when the resolved agent IS the pinned one, so we never
    // force one agent's model onto a thread the phone steered to another agent.
    const pin = ctx.projects.agentConfigFor(cwd);
    const explicitAgent = optionalString(p, 'agentId') as AgentId | undefined;
    const agentId = explicitAgent ?? pin?.agentId ?? ctx.agentManager.defaultAgent;
    if (ctx.agentManager.isDeprecated(agentId)) {
      throw new RpcError(
        JsonRpcErrorCode.AgentNotRunning,
        `agent '${agentId}' is deprecated and cannot start new threads`,
      );
    }
    const explicitModel = optionalString(p, 'model');
    const model = explicitModel ?? (pin && agentId === pin.agentId ? pin.model : undefined);
    // Continuing one of the agent's own sessions (`agent/sessions`): one
    // conversation per session, so the one that already continues it is
    // returned rather than a second writer being made.
    const agentSessionId = optionalString(p, 'agentSessionId');
    // Continuing another conversation (§5.8.21): the same continuation
    // `thread/transfer` makes, in the folder and with the agent chosen here.
    const continueFrom = optionalObject(p, 'continueFrom');
    if (continueFrom !== undefined) {
      if (agentSessionId !== undefined) {
        throw RpcError.invalidParams('continueFrom cannot go with agentSessionId');
      }
      const title = optionalString(p, 'title');
      const key = optionalTransferKey(continueFrom);
      const made = await continueConversation(
        ctx,
        {
          sourceThreadId: requireString(continueFrom, 'threadId'),
          strategy: optionalStrategy(continueFrom),
          agentId,
          ...(model !== undefined ? { model } : {}),
          ...(title !== undefined ? { title } : {}),
          cwd,
          ...(key !== undefined ? { key } : {}),
          createdBy: createdByOf(continueFrom),
        },
        session,
      );
      return withLiveState(made.thread, ctx);
    }
    if (agentSessionId !== undefined) {
      if (explicitAgent === undefined) {
        throw RpcError.invalidParams('agentSessionId requires agentId');
      }
      const existing = await ctx.threadStore.threadForSession(agentId, agentSessionId);
      if (existing) return withLiveState(existing, ctx);
    }
    // A session picked without a name takes the one the bridge gave it, if it
    // has (`SessionTitles`) — provisional, like the CLI's own.
    const title =
      optionalString(p, 'title') ??
      (agentSessionId !== undefined
        ? ctx.sessionTitles.titleOf(agentId, agentSessionId)
        : undefined);
    // The conversation starts in its agent's default mode, set here by the
    // owner of threads — not by whichever client opened it, so every surface
    // starts alike and the first turn never runs in a mode nobody chose.
    const accessMode = ctx.agentManager.defaultAccessModeOf(agentId);
    const thread = await ctx.threadStore.startThread(
      {
        projectId,
        ...(title !== undefined ? { title } : {}),
        ...(accessMode !== undefined ? { accessMode } : {}),
        agentId,
        ...(model !== undefined ? { model } : {}),
        cwd,
        ...(originOf(ctx, session) ? { origin: originOf(ctx, session) } : {}),
        // The session's name (its CLI's title, or the first thing asked) is
        // provisional, like a first prompt: the bridge still names the
        // conversation from its first exchange here.
        ...(agentSessionId !== undefined
          ? { agentSessionId, ...(title !== undefined ? { titleSource: 'prompt' as const } : {}) }
          : {}),
      },
      ctx.now(),
    );
    if (agentSessionId !== undefined) {
      ctx.sessionHolds.attachThread({ agentId, sessionId: agentSessionId }, thread.id);
    }
    return thread;
  });
  // Opening a conversation changes nothing on it (see ThreadStore.resumeThread).
  router.register('thread/resume', (p, ctx: BridgeContext) =>
    ctx.threadStore.resumeThread(requireString(p, 'threadId')),
  );
  // A fork: the same agent, the history copied, and its first message carrying
  // a selection of it (its agent session starts empty) — §5.8.21.
  router.register('thread/fork', async (p, ctx: BridgeContext, session) => {
    const key = optionalTransferKey(p);
    const made = await continueConversation(
      ctx,
      {
        sourceThreadId: requireString(p, 'threadId'),
        strategy: 'fork',
        ...(key !== undefined ? { key } : {}),
        createdBy: createdByOf(p),
      },
      session,
    );
    return withLiveState(made.thread, ctx);
  });
  router.register('thread/setModel', async (p, ctx: BridgeContext) => {
    const threadId = requireString(p, 'threadId');
    await ctx.threadStore.setModel(threadId, requireString(p, 'model'));
    return null;
  });
  router.register('thread/rename', async (p, ctx: BridgeContext) => {
    const now = ctx.now();
    return withLiveState(
      await ctx.threadStore.renameThread(
        requireString(p, 'threadId'),
        requireString(p, 'title'),
        now,
        // Only a client's own auto-naming may declare itself provisional; anything
        // else is a hand-rename, and that name is final. `'agent'` is deliberately
        // not accepted from the wire — the bridge writes those when it generates one.
        optionalString(p, 'source') === 'prompt' ? 'prompt' : 'user',
        decisionTime(now, optionalAge(p)),
      ),
      ctx,
    );
  });
  router.register('thread/setAccessMode', async (p, ctx: BridgeContext) => {
    const threadId = requireString(p, 'threadId');
    const mode = parseAccessMode(requireString(p, 'mode'));
    // A mode is a promise about what the agent will do; one its adapter cannot
    // keep is refused rather than stored and silently run as something else.
    const thread = await ctx.threadStore.getThread(threadId);
    const agentId = (thread.agentId as AgentId | undefined) ?? ctx.agentManager.defaultAgent;
    const offered = ctx.agentManager.accessModesOf(agentId);
    if (!offered.includes(mode)) {
      throw RpcError.invalidParams(
        offered.length === 0
          ? `${agentId} offers no access mode`
          : `${agentId} offers ${offered.join(' | ')}, not ${mode}`,
      );
    }
    return ctx.threadStore.setAccessMode(threadId, mode);
  });
  // `ageMs`: an action a client took offline and sends now (architecture/02a
  // §5.8.17). It applies only if nothing decided the same later elsewhere; a
  // superseded one answers with the thread as it stands.
  router.register('thread/archive', async (p, ctx: BridgeContext) => {
    const threadId = requireString(p, 'threadId');
    const age = optionalAge(p);
    const now = ctx.now();
    if (age === undefined) {
      await ctx.agentManager.closeThreadSession(threadId);
      return ctx.threadStore.archiveThread(threadId, now);
    }
    const thread = await ctx.threadStore.archiveThread(threadId, now, decisionTime(now, age));
    if (thread.status === 'archived') await ctx.agentManager.closeThreadSession(threadId);
    return thread;
  });
  router.register('thread/unarchive', (p, ctx: BridgeContext) => {
    const now = ctx.now();
    return ctx.threadStore.unarchiveThread(
      requireString(p, 'threadId'),
      now,
      decisionTime(now, optionalAge(p)),
    );
  });
  router.register('thread/delete', async (p, ctx: BridgeContext) => {
    const threadId = requireString(p, 'threadId');
    const age = optionalAge(p);
    if (age === undefined) {
      await ctx.agentManager.closeThreadSession(threadId);
      await ctx.threadStore.deleteThread(threadId);
      return null;
    }
    // A superseded delete leaves the conversation, and its agent session, alone.
    const deleted = await ctx.threadStore.deleteThread(threadId, decisionTime(ctx.now(), age));
    if (deleted) await ctx.agentManager.closeThreadSession(threadId);
    return null;
  });

  router.register('turn/list', async (p, ctx: BridgeContext, session) => {
    const threadId = requireString(p, 'threadId');
    const cursor = optionalString(p, 'cursor');
    const limit = optionalNumber(p, 'limit');
    const fromEnd = optionalBoolean(p, 'fromEnd') ?? false;
    // Surface the LIVE in-flight turn (if any) so a phone reconnecting mid-turn
    // re-attaches its streaming view instead of treating the turn as ended.
    // This is the AgentManager's authoritative state, not a stored `streaming`
    // status (which can dangle after a restart) — see TurnList.activeTurnId.
    const activeTurnId = ctx.agentManager.activeTurnId(threadId);
    // Same idea for the message queue: it is live AgentManager state, so a phone
    // resyncing restores its queued bubbles (and the paused banner) from here
    // rather than having to find them inside whatever page it asked for.
    const queue = ctx.agentManager.queueState(threadId);
    const withActive = (list: TurnList): TurnList => ({
      ...list,
      ...(activeTurnId !== undefined ? { activeTurnId } : {}),
      ...(queue.queuedTurnIds.length > 0 ? { queuedTurnIds: queue.queuedTurnIds } : {}),
      ...(queue.paused ? { queuePaused: true } : {}),
      ...(queue.pausedReason !== undefined ? { queuePausedReason: queue.pausedReason } : {}),
      ...(queue.deliveringTurnId !== undefined
        ? { queueDeliveringTurnId: queue.deliveringTurnId }
        : {}),
    });
    // Reconcile the agent-owned transcript before paging: a turn written from
    // the agent's own app or terminal on the same native session appears here.
    // The watcher owns the rules — never while the bridge drives a turn on the
    // thread, and not at all while neither the transcript nor the thread
    // changed — and announces a change (`stream/history/changed`), so every
    // other client showing the conversation re-reads it too.
    await ctx.historyWatcher.reconcile(threadId);
    // The page the store serves is already the summarized one, within its
    // byte budget (`TurnList`).
    const page = await ctx.threadStore.listTurns(threadId, cursor, limit, fromEnd);
    // A client that read the conversation keeps it watched, so what is written
    // there later reaches it without asking (architecture/02a §5.8.8).
    if (session !== undefined) ctx.historyWatcher.watch(threadId, session.deviceId);
    return withActive(page);
  });
  router.register('turn/read', async (p, ctx: BridgeContext) =>
    summarizeTurn(await ctx.threadStore.getTurn(requireString(p, 'turnId'))),
  );
  // What a page leaves out, on demand: a run's steps as previews, one step
  // whole — a thought's whole text included. A step's address is its index in
  // the stored `segments` of the turn's reply (architecture/02b, bounded history).
  router.register('turn/steps', async (p, ctx: BridgeContext) => {
    const from = requireIndex(p, 'from');
    const to = requireIndex(p, 'to');
    if (to < from) throw RpcError.invalidParams("'to' must not be before 'from'");
    const reply = await ctx.threadStore.readReply(
      requireString(p, 'threadId'),
      requireString(p, 'turnId'),
    );
    const segments = reply.segments ?? [];
    if (from >= segments.length) {
      throw new RpcError(JsonRpcErrorCode.ResourceNotFound, `no step at ${from}`);
    }
    return previewStepRange(segments, from, to);
  });
  router.register('turn/step', async (p, ctx: BridgeContext) => {
    const index = requireIndex(p, 'index');
    const reply = await ctx.threadStore.readReply(
      requireString(p, 'threadId'),
      requireString(p, 'turnId'),
    );
    const block = reply.segments?.[index];
    if (block === undefined || isTextRun(block)) {
      throw new RpcError(JsonRpcErrorCode.ResourceNotFound, `no step at ${index}`);
    }
    return { block };
  });
  router.register('turn/send', async (p, ctx: BridgeContext, session) => {
    const threadId = requireString(p, 'threadId');
    // A `turn/send` may instead be a control-only reply to a pending approval or
    // question: no new turn is created — it is routed to the agent adapter.
    const approval = optionalApprovalResponse(p);
    if (approval) {
      return ctx.agentManager.respondApproval(threadId, approval.approvalId, approval.decision);
    }
    const question = optionalQuestionResponse(p);
    if (question) {
      return ctx.agentManager.respondQuestion(threadId, question.questionId, question.answers);
    }
    // `text` is OPTIONAL: an image-only message (empty text + attachments) is
    // valid, so we no longer hard-require a non-empty string. Reject only when
    // there is neither text nor an attachment to act on.
    const text = optionalString(p, 'text') ?? '';
    const attachments = optionalAttachments(p);
    // A turn may instead be a command invocation (no free-form text): the bridge
    // resolves it to the prompt the agent runs.
    const command = optionalCommand(p);
    if (text.length === 0 && attachments.length === 0 && !command) {
      throw RpcError.invalidParams('turn/send requires non-empty text, attachments, or a command');
    }
    // Every attachment sits in the message where the person put it: one
    // marker each, in order — in the command's arguments for a command.
    const markerError = inlineAttachmentsError(
      command ? (command.args ?? '') : text,
      attachments.length,
    );
    if (markerError !== undefined) throw RpcError.invalidParams(markerError);
    // A turn runs with the thread's agent/model/cwd/mode (refused while a
    // terminal holds its session); explicit params override.
    const runtime = await turnRuntimeOptions(ctx, threadId, session);
    const service = optionalString(p, 'service') ?? runtime.service;
    const options: SendTurnOptions = {
      ...runtime,
      ...(service !== undefined ? { service } : {}),
      ...optionalEffort(p),
      ...optionalRunOptions(p),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(command !== undefined ? { command } : {}),
      // Absent → the manager queues behind an in-flight turn (the safe default);
      // `false` asks it to reject with `AgentBusy` instead.
      ...optionalQueue(p),
      ...optionalClientTurnId(p),
    };
    return ctx.agentManager.sendTurn(threadId, text, options);
  });
  router.register('turn/attachment', (p, ctx: BridgeContext) =>
    ctx.threadStore.readAttachment(requireString(p, 'threadId'), requireString(p, 'attachmentId')),
  );
  router.register('turn/cancel', async (p, ctx: BridgeContext) => {
    await ctx.agentManager.cancelTurn(requireString(p, 'threadId'), requireString(p, 'turnId'));
    return null;
  });
  router.register('queue/resume', (p, ctx: BridgeContext) =>
    ctx.agentManager.resumeQueue(requireString(p, 'threadId')),
  );
  router.register('queue/clear', (p, ctx: BridgeContext) =>
    ctx.agentManager.clearQueue(requireString(p, 'threadId')),
  );
  router.register('queue/sendNow', (p, ctx: BridgeContext) =>
    ctx.agentManager.sendQueuedNow(requireString(p, 'threadId'), requireString(p, 'turnId')),
  );
}

/** Whether a stored segment is a text run — prose, which pages carry whole. */
function isTextRun(segment: unknown): boolean {
  return (
    typeof segment === 'object' &&
    segment !== null &&
    (segment as { type?: unknown }).type === 'text'
  );
}

/** Validates a wire `mode` string against the {@link AccessMode} union. */
function parseAccessMode(mode: string): AccessMode {
  if ((ACCESS_MODES as readonly string[]).includes(mode)) return mode as AccessMode;
  throw RpcError.invalidParams(`mode must be one of ${ACCESS_MODES.join(' | ')}`);
}

function optionalEffort(params: unknown): { effort?: string } {
  const value = optionalString(params, 'effort');
  return value === undefined ? {} : { effort: value };
}

/**
 * Extracts `queue` from `turn/send` params. Only a real boolean counts — a
 * garbled value falls back to the default (queue behind an in-flight turn),
 * which is the safe side: the alternative would be starting a second concurrent
 * turn on a thread that already has one.
 */
function optionalQueue(params: unknown): { queue?: boolean } {
  const value = optionalBoolean(params, 'queue');
  return value === undefined ? {} : { queue: value };
}

/**
 * Extracts `clientTurnId` (the sender's optimistic-bubble id, echoed on
 * `stream/turn/created`). Opaque and never persisted; anything that is not a
 * short non-empty string is dropped rather than rejected — it only affects how
 * the sender matches its own echo.
 */
function optionalClientTurnId(params: unknown): { clientTurnId?: string } {
  const value = optionalString(params, 'clientTurnId');
  return value !== undefined && value.length > 0 && value.length <= 128
    ? { clientTurnId: value }
    : {};
}

const APPROVAL_DECISIONS = new Set<ApprovalDecision>(['approve', 'reject', 'approveSession']);

/**
 * Extracts the `approvalResponse` from `turn/send` params, or `undefined` when
 * absent. Validates the shape (`approvalId` non-empty + a known `decision`) and
 * throws `invalidParams` on a malformed one — an approval reply is control data,
 * so a garbled one should surface rather than silently start a turn.
 */
function optionalApprovalResponse(params: unknown): ApprovalResponse | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const raw = (params as Record<string, unknown>)['approvalResponse'];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw RpcError.invalidParams('approvalResponse must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const approvalId = obj['approvalId'];
  const decision = obj['decision'];
  if (typeof approvalId !== 'string' || approvalId.length === 0) {
    throw RpcError.invalidParams('approvalResponse.approvalId must be a non-empty string');
  }
  if (typeof decision !== 'string' || !APPROVAL_DECISIONS.has(decision as ApprovalDecision)) {
    throw RpcError.invalidParams(
      'approvalResponse.decision must be approve | reject | approveSession',
    );
  }
  return { approvalId, decision: decision as ApprovalDecision };
}

/**
 * Extracts the `questionResponse` from `turn/send` params, or `undefined` when
 * absent. Validates the shape (`questionId` non-empty + `answers` an array of
 * string arrays) and throws `invalidParams` on a malformed one — like an
 * approval reply, a garbled question answer is control data that should surface.
 */
function optionalQuestionResponse(params: unknown): QuestionResponse | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const raw = (params as Record<string, unknown>)['questionResponse'];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw RpcError.invalidParams('questionResponse must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const questionId = obj['questionId'];
  const answers = obj['answers'];
  if (typeof questionId !== 'string' || questionId.length === 0) {
    throw RpcError.invalidParams('questionResponse.questionId must be a non-empty string');
  }
  if (
    !Array.isArray(answers) ||
    !answers.every((a) => Array.isArray(a) && a.every((label) => typeof label === 'string'))
  ) {
    throw RpcError.invalidParams('questionResponse.answers must be an array of string arrays');
  }
  return { questionId, answers: answers as string[][] };
}

/**
 * Extracts the inline `attachments` from `turn/send` params. Each one stands
 * for a marker in the message's text, so none may be dropped quietly — that
 * would shift every later attachment onto the wrong marker: an entry that is
 * not an object, carries no bytes, or is past {@link MAX_ATTACHMENT_BYTES}
 * is refused with `invalidParams` (it is the person's file, and sending the
 * turn without it is not what they asked for).
 */
function optionalAttachments(params: unknown): TurnAttachment[] {
  if (!params || typeof params !== 'object') return [];
  const raw = (params as Record<string, unknown>)['attachments'];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw RpcError.invalidParams('attachments must be an array');
  const out: TurnAttachment[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') {
      throw RpcError.invalidParams(`attachment ${index + 1} is not an object`);
    }
    const obj = item as Record<string, unknown>;
    const mimeType =
      typeof obj['mimeType'] === 'string' && obj['mimeType'].length > 0
        ? obj['mimeType']
        : 'application/octet-stream';
    const base64Data = typeof obj['base64Data'] === 'string' ? obj['base64Data'] : '';
    if (base64Data.length === 0) {
      throw RpcError.invalidParams(`attachment ${index + 1} carries no data`);
    }
    if (Math.floor((base64Data.length * 3) / 4) > MAX_ATTACHMENT_BYTES) {
      throw RpcError.invalidParams(
        `an attachment is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`,
      );
    }
    const att: TurnAttachment = {
      type: obj['type'] === 'file' ? 'file' : 'image',
      mimeType,
      base64Data,
    };
    const name = attachmentName(obj['name']);
    if (name !== undefined) att.name = name;
    if (typeof obj['width'] === 'number') att.width = obj['width'];
    if (typeof obj['height'] === 'number') att.height = obj['height'];
    out.push(att);
  }
  return out;
}

/** A file's name, reduced to its last segment and a sane length, or none. */
function attachmentName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const base = raw.split(/[\\/]/).pop()?.trim() ?? '';
  const name = base.replace(/[\u0000-\u001f]/g, '').slice(0, 120);
  return name.length > 0 && name !== '.' && name !== '..' ? name : undefined;
}

/**
 * Extracts the `command` invocation (`{ name, args? }`) from `turn/send` params,
 * or `undefined` when absent. Validates `name` is a non-empty string and `args`
 * (optional) is a string. Throws `invalidParams` on a malformed one — a command
 * is an explicit user action, so a garbled one should surface rather than run.
 */
function optionalCommand(params: unknown): AgentCommandInvocation | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const raw = (params as Record<string, unknown>)['command'];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw RpcError.invalidParams('command must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const name = obj['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw RpcError.invalidParams('command.name must be a non-empty string');
  }
  const args = obj['args'];
  if (args !== undefined && typeof args !== 'string') {
    throw RpcError.invalidParams('command.args must be a string when present');
  }
  return { name, ...(typeof args === 'string' ? { args } : {}) };
}

/**
 * Extracts the per-model run-option values (`{ options: { key: value } }`) from
 * `turn/send` params, keeping only string/boolean values (tolerant — unknown
 * shapes are dropped, never thrown).
 */
function optionalRunOptions(params: unknown): {
  options?: Record<string, string | boolean>;
} {
  if (!params || typeof params !== 'object') return {};
  const raw = (params as Record<string, unknown>)['options'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
  }
  return Object.keys(out).length > 0 ? { options: out } : {};
}
