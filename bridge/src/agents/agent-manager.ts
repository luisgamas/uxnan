/**
 * Orchestrates agent turns: routes `turn/send` to the right adapter, persists the
 * streamed output to the {@link ThreadStore}, and pushes streaming notifications
 * to connected phones.
 *
 * Source: architecture/02a-system-architecture.md §5.2 / §5.8.
 *
 * FOR-DEV: the agent is currently chosen by a single `defaultAgent`; resolve it
 * per project/thread from the project's AgentConfig once project management lands
 * (src/agents/agent-manager.ts).
 */
import {
  JsonRpcErrorCode,
  RpcError,
  StreamNotification,
  makeNotification,
  type AccessMode,
  type AgentCommand,
  type AgentCommandInvocation,
  type AgentDescriptor,
  type AgentId,
  type AgentModel,
  type AgentStreamEvent,
  type ApprovalDecision,
  type ApprovalRequestBlock,
  type IAgentAdapter,
  type TurnAttachment,
} from '@uxnan/shared';
import { rm } from 'node:fs/promises';
import type { ThreadStore } from '../conversation/thread-store.js';
import type { Logger } from '../logger.js';
import { materializeAttachments } from './attachments.js';
import { approvalBlock, errorBlock, questionBlock } from '../adapters/content-blocks.js';
import type { QuestionItem } from '@uxnan/shared';

/** How long a tool approval waits for the user before defaulting to deny. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/** Build the `approval` content block for a tool the agent wants to run. */
function approvalContent(
  approvalId: string,
  toolName: string,
  input: Record<string, unknown>,
): ApprovalRequestBlock {
  const detail = approvalDetail(input);
  const action = detail ? `Allow ${toolName}: ${detail}` : `Allow ${toolName}`;
  const t = toolName.toLowerCase();
  const risk =
    t === 'bash' || t === 'write' || t === 'edit' || t.includes('delete') ? 'high' : 'medium';
  return approvalBlock(approvalId, action, { risk, ...(detail ? { detail } : {}) });
}

/** Short human description of a tool's input (command / path) for the card. */
function approvalDetail(input: Record<string, unknown>): string {
  if (!input || typeof input !== 'object') return '';
  for (const key of ['command', 'file_path', 'path', 'url', 'pattern']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 200 ? `${value.slice(0, 200)}…` : value;
    }
  }
  return '';
}

/** Display metadata + availability for a registered adapter, surfaced by `agent/list`. */
export interface AgentMeta {
  displayName: string;
  available: boolean;
  defaultModel?: string;
}

export interface TurnEndInfo {
  threadId: string;
  turnId: string;
  status: 'completed' | 'error';
  text?: string;
}

export interface AgentManagerOptions {
  store: ThreadStore;
  /** Broadcast a JSON-RPC notification to connected phones. */
  notify: (message: unknown) => void;
  now: () => number;
  logger: Logger;
  defaultAgent: AgentId;
  /** Optional hook fired when a turn completes or errors (e.g. push notifications). */
  onTurnEnd?: (info: TurnEndInfo) => void;
  /**
   * Whether at least one phone currently has a live channel. The approval
   * auto-reject countdown ({@link APPROVAL_TIMEOUT_MS}) only runs while this is
   * true, so an approval requested while the phone is backgrounded/offline
   * WAITS (its card is replayed from the outbound log on reconnect) instead of
   * defaulting to reject on a prompt the user never saw — which would make the
   * agent take an unauthorized default action and the turn appear "cut".
   * Defaults to always-connected when omitted (preserves the prior timeout
   * behavior, e.g. in tests).
   */
  isPhoneConnected?: () => boolean;
  /**
   * Override the approval auto-reject window in ms (defaults to
   * {@link APPROVAL_TIMEOUT_MS}). Injected so tests can exercise the timeout
   * without waiting minutes.
   */
  approvalTimeoutMs?: number;
}

export interface SendTurnOptions {
  agentId?: AgentId;
  service?: string;
  effort?: string;
  /** Chosen per-model run-option values keyed by `AgentModelOption.key`. */
  options?: Record<string, string | boolean>;
  /** Inline image attachments delivered to the agent for this turn. */
  attachments?: TurnAttachment[];
  cwd?: string;
  /** The thread's persisted access (approval) mode, applied to this turn. */
  accessMode?: AccessMode;
  /**
   * Invoke an advertised agent command instead of free-form text. Resolved here
   * to the final prompt (expanded custom template, or the CLI's native
   * `/name args` form) before the adapter runs; the command form is what's
   * persisted to history. See {@link AgentCommandInvocation}.
   */
  command?: AgentCommandInvocation;
}

export class AgentManager {
  readonly #adapters = new Map<AgentId, IAgentAdapter>();
  readonly #meta = new Map<AgentId, AgentMeta>();
  readonly #started = new Set<AgentId>();
  readonly #assistantByTurn = new Map<string, string>();
  /** threadId → agent driving it, so we can read its native session id on completion. */
  readonly #agentByThread = new Map<string, AgentId>();
  /** threadId → in-flight turn id, so an approval reply can name the turn it answers. */
  readonly #activeTurnByThread = new Map<string, string>();
  /** turnId → temp attachment dir to remove once the turn ends (best-effort). */
  readonly #attachmentDirByTurn = new Map<string, string>();
  /** approvalId → resolver for a pending approval (covers the Claude `PreToolUse`
   * hook round-trip AND the Codex app-server approval elicitations; the pending
   * map is shared so a single `respondApproval` call resolves both). The
   * resolver takes the user's `ApprovalDecision`; the caller (the hook server
   * or the Codex adapter) translates that into the wire shape its protocol
   * expects (`'allow' | 'deny'` for the Claude hook, `ReviewDecision` for
   * Codex). */
  readonly #pendingHookApprovals = new Map<
    string,
    {
      resolve: (decision: ApprovalDecision) => void;
      timer: ReturnType<typeof setTimeout> | undefined;
    }
  >();
  #approvalSeq = 0;
  /** questionId → resolver for a pending question (the agent's `question` tool);
   * resolves with the chosen answers per question, or `[]` on timeout/skip. Same
   * shape as the approval pending map so `respondQuestion` mirrors `respondApproval`. */
  readonly #pendingQuestions = new Map<
    string,
    {
      resolve: (answers: string[][]) => void;
      timer: ReturnType<typeof setTimeout> | undefined;
    }
  >();
  #questionSeq = 0;
  readonly #options: AgentManagerOptions;
  /** Whether a phone is connected to see/answer approvals (see options). */
  readonly #isPhoneConnected: () => boolean;
  /** Approval auto-reject window in ms (see options). */
  readonly #approvalTimeoutMs: number;

  constructor(options: AgentManagerOptions) {
    this.#options = options;
    this.#isPhoneConnected = options.isPhoneConnected ?? (() => true);
    this.#approvalTimeoutMs = options.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS;
  }

  register(adapter: IAgentAdapter, meta?: Partial<AgentMeta>): void {
    this.#adapters.set(adapter.agentId, adapter);
    this.#meta.set(adapter.agentId, {
      displayName: meta?.displayName ?? adapter.agentId,
      available: meta?.available ?? true,
      ...(meta?.defaultModel !== undefined ? { defaultModel: meta.defaultModel } : {}),
    });
    adapter.onEvent((event) => {
      void this.#onEvent(event);
    });
  }

  hasAdapter(agentId: AgentId): boolean {
    return this.#adapters.has(agentId);
  }

  /** Whether the agent's binary resolved (its CLI is installed/usable). */
  isAvailable(agentId: AgentId): boolean {
    return this.#meta.get(agentId)?.available ?? false;
  }

  /** Registered agents the phone can pick, with capabilities + availability. */
  listAgents(): AgentDescriptor[] {
    return [...this.#adapters.values()].map((adapter) => {
      const meta = this.#meta.get(adapter.agentId);
      return {
        agentId: adapter.agentId,
        displayName: meta?.displayName ?? adapter.agentId,
        available: meta?.available ?? true,
        capabilities: adapter.capabilities,
        ...(meta?.defaultModel !== undefined ? { defaultModel: meta.defaultModel } : {}),
      };
    });
  }

  /** The bridge's configured default agent. */
  get defaultAgent(): AgentId {
    return this.#options.defaultAgent;
  }

  /** Models the given agent's CLI reports (empty if it can't enumerate them). */
  async getModels(agentId: AgentId): Promise<AgentModel[]> {
    const adapter = this.#adapters.get(agentId);
    if (!adapter?.listModels) return [];
    try {
      return await adapter.listModels();
    } catch {
      return [];
    }
  }

  /**
   * Special ("slash") commands the given agent exposes — control commands it can
   * run headless plus custom prompt-template commands scanned from `cwd`/user
   * config (empty when the agent advertises none). Never throws: discovery is
   * best-effort so a failing scan degrades to no commands, not a broken palette.
   */
  async getCommands(agentId: AgentId, cwd?: string): Promise<AgentCommand[]> {
    const adapter = this.#adapters.get(agentId);
    if (!adapter?.listCommands) return [];
    try {
      return await adapter.listCommands(cwd);
    } catch {
      return [];
    }
  }

  /**
   * Resolve an {@link AgentCommandInvocation} to the prompt text the agent runs:
   * a custom prompt-template command is expanded by the adapter; a native
   * control command becomes the CLI's `/name args` form (Claude Code / ACP
   * agents interpret it directly). Falls back to the native form when expansion
   * is unavailable or fails, so a command never hard-fails a turn.
   */
  async #resolveCommandText(
    adapter: IAgentAdapter,
    command: AgentCommandInvocation,
    cwd?: string,
  ): Promise<string> {
    const args = command.args?.trim();
    if (adapter.expandCommand) {
      try {
        return await adapter.expandCommand(command.name, args || undefined, cwd);
      } catch (err) {
        this.#options.logger.warn(
          `command expansion failed for '${command.name}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return args && args.length > 0 ? `/${command.name} ${args}` : `/${command.name}`;
  }

  /** The `/name args` form of a command, shown in history instead of its expansion. */
  #commandDisplay(command: AgentCommandInvocation): string {
    const args = command.args?.trim();
    return args && args.length > 0 ? `/${command.name} ${args}` : `/${command.name}`;
  }

  /** Start a turn: persist the user message, drive the adapter, return the turn id. */
  async sendTurn(
    threadId: string,
    userText: string,
    options: SendTurnOptions = {},
  ): Promise<{ turnId: string }> {
    const agentId = options.agentId ?? this.#options.defaultAgent;
    const adapter = this.#adapters.get(agentId);
    if (!adapter) {
      throw new RpcError(
        JsonRpcErrorCode.AgentNotRunning,
        `no adapter registered for agent '${agentId}'`,
      );
    }

    const attachments = options.attachments ?? [];
    // A command invocation carries no free-form text: show the command (`/name
    // args`), not its expansion, in history — the expanded prompt can be large.
    const commandDisplay = options.command ? this.#commandDisplay(options.command) : undefined;
    // Persist a faithful user message (no temp paths): the command form, the
    // original text, or a short placeholder for an image-only turn so history
    // isn't a blank bubble.
    const persistBase = commandDisplay ?? userText;
    const persistText =
      persistBase.length > 0
        ? persistBase
        : attachments.length > 0
          ? `[${attachments.length} image attachment${attachments.length > 1 ? 's' : ''}]`
          : persistBase;
    const started = await this.#options.store.startTurn(threadId, persistText, this.#options.now());
    this.#assistantByTurn.set(started.turnId, started.assistantMessageId);
    this.#agentByThread.set(threadId, agentId);
    this.#activeTurnByThread.set(threadId, started.turnId);

    if (!this.#started.has(agentId)) {
      await adapter.start({ agentId, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
      this.#started.add(agentId);
    }

    // Resolve a command invocation to the prompt the agent actually runs (an
    // expanded custom template, or the CLI's native `/name args` form). A plain
    // turn keeps its text verbatim.
    let agentText = options.command
      ? await this.#resolveCommandText(adapter, options.command, options.cwd)
      : userText;

    // Materialize image attachments to temp files and reference them in the
    // prompt so any file/vision-capable agent CLI can open them. Best-effort:
    // a failure to write degrades to a text-only turn, never aborts it.
    if (attachments.length > 0) {
      try {
        const materialized = await materializeAttachments(attachments, started.turnId, {
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        });
        if (materialized.note) {
          agentText =
            agentText.length > 0 ? `${agentText}\n\n${materialized.note}` : materialized.note;
        }
        if (materialized.dir) this.#attachmentDirByTurn.set(started.turnId, materialized.dir);
      } catch (err) {
        this.#options.logger.warn(`attachment materialization failed: ${String(err)}`);
      }
    }

    await adapter.sendTurn({
      threadId,
      turnId: started.turnId,
      text: agentText,
      ...(options.service !== undefined ? { service: options.service } : {}),
      ...(options.effort !== undefined ? { effort: options.effort } : {}),
      ...(options.options !== undefined ? { options: options.options } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.accessMode !== undefined ? { accessMode: options.accessMode } : {}),
      ...(options.command !== undefined ? { command: options.command } : {}),
    });
    return { turnId: started.turnId };
  }

  /**
   * Ask the user (via the phone) whether an agent tool may run. Emits an
   * `approval` content block on the thread's in-flight turn and resolves once
   * {@link respondApproval} arrives (or after {@link APPROVAL_TIMEOUT_MS} →
   * `reject`).
   *
   * The return type is the full {@link ApprovalDecision}: callers translate it
   * into the wire shape their protocol expects — the Claude `PreToolUse` hook
   * uses `allow`/`deny`, the Codex app-server uses the `ReviewDecision` oneOf
   * (`approved` / `approved_for_session` / `denied` / `abort` / `timed_out`).
   * A common pending map + common resolver keeps the phone's reply path
   * (`turn/send { approvalResponse }`) uniform for both backends.
   */
  async requestApproval(
    threadId: string,
    info: { toolName: string; input: Record<string, unknown> },
  ): Promise<ApprovalDecision> {
    const turnId = this.#activeTurnByThread.get(threadId);
    if (!turnId) return 'reject'; // no in-flight turn to attach the approval to
    const approvalId = `appr-${turnId}-${(this.#approvalSeq += 1)}`;
    const messageId = this.#assistantByTurn.get(turnId) ?? '';
    const content = approvalContent(approvalId, info.toolName, info.input);
    try {
      await this.#options.store.appendBlock(threadId, turnId, content, this.#options.now());
    } catch {
      /* best-effort persistence */
    }
    this.#options.notify(
      makeNotification(StreamNotification.ContentBlock, { threadId, turnId, messageId, content }),
    );
    return new Promise<ApprovalDecision>((resolve) => {
      this.#pendingHookApprovals.set(approvalId, { resolve, timer: undefined });
      // Only start the auto-reject countdown while a phone is connected to see
      // and answer the card. While offline the approval WAITS (the card replays
      // from the outbound log on reconnect), so the agent never takes an
      // unauthorized default the user never saw. The countdown (re)starts when a
      // phone (re)connects — see onPhoneConnected.
      if (this.#isPhoneConnected()) this.#armApprovalTimeout(approvalId);
    });
  }

  /**
   * (Re)arms the auto-reject countdown for a pending approval. Idempotent —
   * clears any existing timer first, so a phone reconnect grants a fresh window.
   */
  #armApprovalTimeout(approvalId: string): void {
    const pending = this.#pendingHookApprovals.get(approvalId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.#pendingHookApprovals.delete(approvalId);
      pending.resolve('reject');
    }, this.#approvalTimeoutMs);
  }

  /**
   * A phone (re)connected: grant a fresh auto-reject window to every approval
   * that was waiting while the user was away (its card is replayed on
   * reconnect), so the user actually gets time to answer it.
   */
  onPhoneConnected(): void {
    for (const approvalId of this.#pendingHookApprovals.keys()) {
      this.#armApprovalTimeout(approvalId);
    }
    for (const questionId of this.#pendingQuestions.keys()) {
      this.#armQuestionTimeout(questionId);
    }
  }

  /**
   * The last phone disconnected: stop every approval/question auto-resolve
   * countdown so a pending elicitation waits for the user to return instead of
   * defaulting on a card they never saw. No-op while any phone is still connected.
   */
  onPhoneDisconnected(): void {
    if (this.#isPhoneConnected()) return;
    for (const pending of this.#pendingHookApprovals.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = undefined;
    }
    for (const pending of this.#pendingQuestions.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = undefined;
    }
  }

  /**
   * Route a user's approval decision. Resolves a pending approval (shared by
   * the Claude `PreToolUse` hook round-trip AND the Codex app-server
   * elicitations) with the user's {@link ApprovalDecision}; the caller that
   * started the request translates that into its protocol's wire shape.
   * Otherwise, when no hook/app-server approval is pending, forwards to the
   * agent adapter's `respondApproval` (e.g. the Echo demo) — no new turn is
   * created. Returns the in-flight turn id (or `''`) so the `turn/send` reply
   * still carries a `turnId`.
   */
  async respondApproval(
    threadId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<{ turnId: string }> {
    const pending = this.#pendingHookApprovals.get(approvalId);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pendingHookApprovals.delete(approvalId);
      pending.resolve(decision);
      return { turnId: this.#activeTurnByThread.get(threadId) ?? '' };
    }
    const agentId = this.#agentByThread.get(threadId);
    const adapter = agentId ? this.#adapters.get(agentId) : undefined;
    if (!adapter) {
      throw new RpcError(
        JsonRpcErrorCode.AgentNotRunning,
        `no active agent for thread '${threadId}'`,
      );
    }
    if (!adapter.respondApproval) {
      throw new RpcError(
        JsonRpcErrorCode.InvalidParams,
        `agent '${agentId}' does not support approvals`,
      );
    }
    await adapter.respondApproval(threadId, approvalId, decision);
    return { turnId: this.#activeTurnByThread.get(threadId) ?? '' };
  }

  /**
   * Ask the user (via the phone) to answer the agent's multiple-choice
   * {@link QuestionItem}s. Emits a `question` content block on the thread's
   * in-flight turn and resolves once {@link respondQuestion} arrives with the
   * chosen answers (or after {@link APPROVAL_TIMEOUT_MS} → `[]`, i.e. no answer,
   * so the adapter can skip/reject and unblock the turn). Mirrors
   * {@link requestApproval}; the caller (the OpenCode adapter) translates the
   * returned answers into its CLI's reply shape.
   */
  async requestQuestion(threadId: string, questions: QuestionItem[]): Promise<string[][]> {
    const turnId = this.#activeTurnByThread.get(threadId);
    if (!turnId) return []; // no in-flight turn to attach the question to
    const questionId = `qst-${turnId}-${(this.#questionSeq += 1)}`;
    const messageId = this.#assistantByTurn.get(turnId) ?? '';
    const content = questionBlock(questionId, questions);
    try {
      await this.#options.store.appendBlock(threadId, turnId, content, this.#options.now());
    } catch {
      /* best-effort persistence */
    }
    this.#options.notify(
      makeNotification(StreamNotification.ContentBlock, { threadId, turnId, messageId, content }),
    );
    return new Promise<string[][]>((resolve) => {
      this.#pendingQuestions.set(questionId, { resolve, timer: undefined });
      // Same offline posture as approvals: only run the auto-skip countdown while
      // a phone is connected to see and answer the card (see onPhoneConnected).
      if (this.#isPhoneConnected()) this.#armQuestionTimeout(questionId);
    });
  }

  /** (Re)arms the auto-skip countdown for a pending question. Idempotent. */
  #armQuestionTimeout(questionId: string): void {
    const pending = this.#pendingQuestions.get(questionId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.#pendingQuestions.delete(questionId);
      pending.resolve([]);
    }, this.#approvalTimeoutMs);
  }

  /**
   * Route a user's answer to a pending question (resolves the `requestQuestion`
   * promise). No new turn is created. Returns the in-flight turn id (or `''`) so
   * the `turn/send` reply still carries a `turnId`.
   */
  respondQuestion(
    threadId: string,
    questionId: string,
    answers: string[][],
  ): Promise<{ turnId: string }> {
    const pending = this.#pendingQuestions.get(questionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pendingQuestions.delete(questionId);
      pending.resolve(answers);
    }
    return Promise.resolve({ turnId: this.#activeTurnByThread.get(threadId) ?? '' });
  }

  /**
   * The turn currently in-flight for [threadId] (an agent is actively producing
   * it in THIS bridge process), or `undefined` when the thread is idle. Reflects
   * LIVE state: set on `sendTurn`, cleared on turn completion/error/abort, and
   * never persisted — so after a bridge restart it is `undefined` even though a
   * turn's stored `status` may still read `streaming`. Authoritative for "is a
   * turn running now?"; the phone re-attaches its streaming view to it on
   * resync (surfaced via `turn/list` → `activeTurnId`).
   */
  activeTurnId(threadId: string): string | undefined {
    return this.#activeTurnByThread.get(threadId);
  }

  async cancelTurn(threadId: string, turnId: string, agentId?: AgentId): Promise<void> {
    // Resolve the thread's OWN agent (as respondApproval/respondQuestion do), not
    // the default: a cancel for a thread running on a non-default agent must reach
    // that agent's adapter, otherwise the wrong adapter no-ops and the turn keeps
    // running. Explicit agentId wins; then the per-thread agent; then the default.
    const resolved = agentId ?? this.#agentByThread.get(threadId) ?? this.#options.defaultAgent;
    const adapter = this.#adapters.get(resolved);
    if (adapter) {
      await adapter.cancelTurn(threadId, turnId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [agentId, adapter] of this.#adapters) {
      if (this.#started.has(agentId)) {
        await adapter.stop().catch(() => undefined);
      }
    }
    this.#started.clear();
  }

  async #onEvent(event: AgentStreamEvent): Promise<void> {
    const { threadId, turnId } = event;
    const messageId = this.#assistantByTurn.get(turnId) ?? '';
    const now = this.#options.now();
    try {
      switch (event.type) {
        case 'turn_started':
          this.#options.notify(
            makeNotification(StreamNotification.TurnStarted, { threadId, turnId }),
          );
          break;
        case 'model_resolved': {
          const model = readText(event.data);
          if (model) {
            this.#options.notify(
              makeNotification(StreamNotification.ModelResolved, { threadId, turnId, model }),
            );
          }
          break;
        }
        case 'delta': {
          const delta = readText(event.data);
          await this.#options.store.appendDelta(threadId, turnId, delta, now);
          this.#options.notify(
            makeNotification(StreamNotification.MessageDelta, {
              threadId,
              turnId,
              messageId,
              delta,
            }),
          );
          break;
        }
        case 'thinking': {
          const delta = readText(event.data);
          await this.#options.store.appendThinking(threadId, turnId, delta, now);
          this.#options.notify(
            makeNotification(StreamNotification.ThinkingDelta, {
              threadId,
              turnId,
              messageId,
              delta,
            }),
          );
          break;
        }
        case 'block': {
          const content = readContent(event.data);
          if (content !== undefined) {
            // A block flagged `beforeText` came from a parallel/background
            // activity while the main text was still streaming: the store slots
            // it before the open text run (never severing it), and the flag
            // rides on the notification so the phone's live buffer applies the
            // identical placement — live view and re-sync render the same order.
            const beforeText = readBeforeText(event.data);
            await this.#options.store.appendBlock(threadId, turnId, content, now, beforeText);
            this.#options.notify(
              makeNotification(StreamNotification.ContentBlock, {
                threadId,
                turnId,
                messageId,
                content,
                ...(beforeText ? { beforeText } : {}),
              }),
            );
          }
          break;
        }
        case 'turn_completed': {
          const provided = readOptionalText(event.data);
          // Clear the in-flight marker BEFORE persisting the terminal status.
          // `store.completeTurn` flips the turn's status to `completed` INSIDE
          // its mutation — observable via `getTurn` before the promise even
          // resolves — and `turn/list` derives `activeTurnId` from this map.
          // Clearing it first guarantees no observer (a racing `turn/list`, the
          // phone's "responding…" indicator) ever sees a turn reported as
          // `completed` yet still active; the two flip together.
          this.#activeTurnByThread.delete(threadId);
          await this.#options.store.completeTurn(threadId, turnId, provided, now);
          const text = await this.#assistantText(turnId, provided);
          const usage = readUsage(event.data);
          if (usage) await this.#options.store.setUsage(threadId, turnId, usage, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnCompleted, {
              threadId,
              turnId,
              messageId,
              text,
              ...(usage !== undefined ? { usage } : {}),
            }),
          );
          this.#assistantByTurn.delete(turnId);
          void this.#cleanupAttachments(turnId);
          await this.#persistAgentSession(threadId, now);
          this.#options.onTurnEnd?.({ threadId, turnId, status: 'completed', text });
          break;
        }
        case 'turn_error': {
          const message = readOptionalText(event.data) ?? 'agent error';
          // Clear the in-flight marker before persisting the terminal status
          // (same race as turn_completed — the status is observable via
          // `getTurn` before `failTurn` resolves).
          this.#activeTurnByThread.delete(threadId);
          // Persist the reason as an error content block in the turn's history so
          // a `turn/list` re-sync (e.g. after a bridge restart) still shows *why*
          // the turn failed. NOT broadcast as a `stream/content/block` — the phone
          // renders the failure live from the `turn/error` notification below, so
          // notifying here too would double the banner. Best-effort.
          try {
            await this.#options.store.appendBlock(threadId, turnId, errorBlock(message), now);
          } catch {
            /* best-effort persistence */
          }
          await this.#options.store.failTurn(threadId, turnId, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnError, {
              threadId,
              turnId,
              error: { code: JsonRpcErrorCode.BridgeError, message },
            }),
          );
          this.#assistantByTurn.delete(turnId);
          void this.#cleanupAttachments(turnId);
          await this.#persistAgentSession(threadId, now);
          this.#options.onTurnEnd?.({ threadId, turnId, status: 'error', text: message });
          break;
        }
        case 'turn_aborted':
          // Clear the in-flight marker before persisting the terminal status
          // (same race as turn_completed).
          this.#activeTurnByThread.delete(threadId);
          await this.#options.store.abortTurn(threadId, turnId, now);
          this.#options.notify(
            makeNotification(StreamNotification.TurnAborted, { threadId, turnId }),
          );
          this.#assistantByTurn.delete(turnId);
          void this.#cleanupAttachments(turnId);
          break;
      }
    } catch (err) {
      this.#options.logger.warn(
        `agent event handling failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Remove a turn's temp attachment directory once the turn ends. Best-effort:
   * the agent has already read the files by completion, and a failure to delete
   * (e.g. the dir vanished) is non-fatal.
   */
  async #cleanupAttachments(turnId: string): Promise<void> {
    const dir = this.#attachmentDirByTurn.get(turnId);
    if (!dir) return;
    this.#attachmentDirByTurn.delete(turnId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  /**
   * Persist the agent's native session id for a thread so the on-disk history
   * fallback can locate its session log after a restart. Best-effort + idempotent.
   */
  async #persistAgentSession(threadId: string, now: number): Promise<void> {
    const agentId = this.#agentByThread.get(threadId);
    if (!agentId) return;
    // `nativeSessionId` is an optional adapter capability (not in the shared
    // interface), so read it through a structural type rather than a hard dep.
    const adapter = this.#adapters.get(agentId) as
      | { nativeSessionId?(threadId: string): string | undefined }
      | undefined;
    const sessionId = adapter?.nativeSessionId?.(threadId);
    if (!sessionId) return;
    try {
      await this.#options.store.setAgentSession(threadId, sessionId, now);
    } catch (err) {
      this.#options.logger.warn(
        `persist agent session failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async #assistantText(turnId: string, provided: string | undefined): Promise<string> {
    if (provided !== undefined) return provided;
    try {
      const turn = await this.#options.store.getTurn(turnId);
      const assistant = turn.messages.find((m) => m.role === 'assistant');
      return typeof assistant?.content === 'string' ? assistant.content : '';
    } catch {
      return '';
    }
  }
}

function readText(data: unknown): string {
  if (data && typeof data === 'object' && 'text' in data) {
    const text = (data as { text: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

/** Extract a structured `content` block (MessageContent JSON) from a block event. */
function readContent(data: unknown): unknown {
  if (data && typeof data === 'object' && 'content' in data) {
    return (data as { content: unknown }).content;
  }
  return undefined;
}

/**
 * Extract a block event's `beforeText` marker: `true` when the adapter emitted
 * the block while the assistant's main text was still streaming (a parallel/
 * background activity), so it must be ordered before the open text run.
 */
function readBeforeText(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === 'object' &&
    'beforeText' in data &&
    (data as { beforeText: unknown }).beforeText === true
  );
}

function readOptionalText(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'text' in data) {
    const text = (data as { text: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return undefined;
}

/** Extract `{ tokens, contextWindow? }` from a turn_completed event's data. */
function readUsage(data: unknown): { tokens: number; contextWindow?: number } | undefined {
  if (!data || typeof data !== 'object' || !('usage' in data)) return undefined;
  const usage = (data as { usage: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const tokens = (usage as { tokens?: unknown }).tokens;
  if (typeof tokens !== 'number') return undefined;
  const window = (usage as { contextWindow?: unknown }).contextWindow;
  return {
    tokens,
    ...(typeof window === 'number' ? { contextWindow: window } : {}),
  };
}
