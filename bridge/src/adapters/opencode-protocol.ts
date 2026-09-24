/**
 * The contract between the OpenCode adapter and an `opencode serve` process —
 * the same for every OpenCode major version.
 *
 * OpenCode 1 and OpenCode 2 both run a local HTTP server, but they share
 * nothing on the wire: different routes (`/session/:id/prompt_async` vs
 * `/api/session/:id/prompt`), authentication (none vs a required password),
 * event vocabulary (`message.part.*` / `session.idle` vs `session.text.*` /
 * `session.execution.*`), permission and question shapes, history shape and
 * model discovery (`opencode models --verbose` vs `GET /api/model`). Each
 * version is therefore one {@link IOpenCodeServer} implementation
 * (`opencode-v1.ts`, `opencode-v2.ts`) that translates its protocol into what
 * is declared here, and the adapter (`opencode-adapter.ts`) only ever sees
 * this: sessions, turns, the neutral {@link OpenCodeEvent}s, and normalized
 * history. Nothing above this line knows which version it is talking to.
 */
import type { QuestionItem } from '@uxnan/shared';
import type { PlanStepBlock } from './content-blocks.js';

/** An OpenCode major version the bridge speaks. */
export type OpenCodeProtocolVersion = 1 | 2;

/** A reply to a permission request: allow once, always, or reject. */
export type PermissionReply = 'once' | 'always' | 'reject';

/**
 * Whether a session's side-effecting tools (edits, shell, web fetches, paths
 * outside the project) ask first or just run. Each protocol maps it onto its
 * own permission keys.
 */
export type OpenCodePermissionPolicy = 'ask' | 'allow';

/** A `provider/model` id, split the way both protocols want it. */
export interface OpenCodeModelRef {
  providerID: string;
  modelID: string;
}

/** What a turn asks for: the text, and optionally a model and its variant. */
export interface OpenCodePrompt {
  text: string;
  /** Split from a `provider/model` id; absent = the session's current model. */
  model?: OpenCodeModelRef;
  /** The model variant (OpenCode's reasoning knob). */
  variant?: string;
}

/** A model the CLI offers, with its context window when it reports one. */
export interface OpenCodeModel {
  /** `provider/model`. */
  id: string;
  contextWindow?: number;
}

/**
 * One persisted message, normalized — what `turn/list` renders for a session
 * the bridge did not run itself (or after a restart). Assistant messages are
 * included only once complete.
 */
export interface OpenCodeHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  /** Structured tool blocks the message produced (`opencodeToolBlock`). */
  blocks?: unknown[];
  /** Epoch ms. */
  createdAt: number;
}

/**
 * What a session did, in the adapter's terms. Every event names the OpenCode
 * session it belongs to; the adapter routes it to the turn running there (or
 * drops it — a sub-agent's child session has no turn of its own).
 */
export type OpenCodeEvent =
  /** Assistant text, as an increment. Already filtered to the assistant. */
  | { kind: 'text'; sessionId: string; delta: string }
  /** Assistant reasoning, as an increment. */
  | { kind: 'reasoning'; sessionId: string; delta: string }
  /** A tool call that reached a terminal state. */
  | {
      kind: 'tool';
      sessionId: string;
      id: string;
      name: string;
      input: Record<string, unknown>;
      output: string;
      error: boolean;
    }
  /** The context-occupying token count, as last reported. */
  | { kind: 'usage'; sessionId: string; tokens: number }
  /** The session's plan / to-do list changed (the whole list). */
  | { kind: 'plan'; sessionId: string; steps: PlanStepBlock[] }
  /** The session's context was compacted. */
  | { kind: 'compacted'; sessionId: string }
  /** A gated tool waits for the user. Answer with `replyPermission`. */
  | {
      kind: 'permission';
      sessionId: string;
      requestId: string;
      toolName: string;
      /** The approval card's input (`command` / `file_path` / `url` / `pattern` / `diff`). */
      input: Record<string, unknown>;
    }
  /** The agent asks the user to choose. Answer with `answerQuestion`. */
  | { kind: 'question'; sessionId: string; requestId: string; questions: QuestionItem[] }
  /** The turn finished. */
  | { kind: 'idle'; sessionId: string }
  /** The turn was stopped before it finished (by this bridge or another client). */
  | { kind: 'interrupted'; sessionId: string }
  /** The turn failed. `sessionId` is absent when the server did not say whose. */
  | { kind: 'error'; sessionId?: string; message: string };

/** The surface the adapter drives (faked in tests via `serverFactory`). */
export interface IOpenCodeServer {
  /** Which protocol this server speaks. */
  readonly protocol: OpenCodeProtocolVersion;
  /** Spawn (if needed) and wait until requests and the event stream are live. Idempotent. */
  start(): Promise<void>;
  /** Create a session, returning its `ses_…` id. */
  createSession(opts: {
    title?: string;
    permission: OpenCodePermissionPolicy;
    model?: OpenCodeModelRef;
    variant?: string;
  }): Promise<string>;
  /** Start a turn (returns once accepted; results arrive via `onEvent`). */
  prompt(sessionId: string, prompt: OpenCodePrompt): Promise<void>;
  /** Hand a message to the turn the session is already running. */
  steer(sessionId: string, text: string): Promise<void>;
  /** Stop the session's running turn. */
  interrupt(sessionId: string): Promise<void>;
  /** Answer a `permission` event. */
  replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void>;
  /**
   * Answer a `question` event: one array of chosen option labels per question.
   * An empty `answers` (or one with nothing chosen) dismisses the question, so
   * the turn goes on instead of waiting forever.
   */
  answerQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<void>;
  /** The session's persisted messages, oldest first. */
  messages(sessionId: string): Promise<OpenCodeHistoryMessage[]>;
  /** The models this OpenCode offers. May start the server, if the protocol needs it. */
  models(): Promise<OpenCodeModel[]>;
  /** Subscribe to events. Returns an unsubscribe function. */
  onEvent(listener: (event: OpenCodeEvent) => void): () => void;
  /** Register a callback for the server process exiting unexpectedly. */
  onClose(listener: () => void): void;
  /** Stop the process and the event stream. Idempotent. */
  close(): Promise<void>;
}

/** The session's permission policy for a thread's access mode. */
export function permissionPolicyFor(accessMode: string | undefined): OpenCodePermissionPolicy {
  // `approveForMe`/`fullAccess` run gated tools without asking; everything else
  // (the default and an explicit `requestApproval`) asks — surfacing an approval
  // card is why the bridge drives the server at all.
  return accessMode === 'approveForMe' || accessMode === 'fullAccess' ? 'allow' : 'ask';
}

/**
 * Split a `provider/model` id (e.g. `opencode/deepseek-v4-flash-free`) into its
 * provider and model. The provider is the segment before the first `/`; the
 * model keeps any further slashes (gateway ids have them —
 * `openrouter/fireworks/ember-1`). Undefined for a bare id, so the server keeps
 * its default model.
 */
export function splitOpenCodeModel(id: string): OpenCodeModelRef | undefined {
  const slash = id.indexOf('/');
  if (slash <= 0 || slash >= id.length - 1) return undefined;
  return { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) };
}

/**
 * Context-occupying token count from an OpenCode `tokens` object — the same
 * shape in both versions: `{ total?, input, output, reasoning, cache: { read,
 * write } }`. Prefers a reported `total`; otherwise sums the distinct buckets
 * (cache read/write are subsets of `input`, so not added), then any top-level
 * number. Undefined when there is nothing to report.
 */
export function openCodeUsageTokens(tokens: unknown): number | undefined {
  if (!isRecord(tokens)) return undefined;
  const num = (key: string): number =>
    typeof tokens[key] === 'number' ? (tokens[key] as number) : 0;
  if (num('total') > 0) return num('total');
  const known = num('input') + num('output') + num('reasoning');
  if (known > 0) return known;
  let sum = 0;
  for (const value of Object.values(tokens)) {
    if (typeof value === 'number') sum += value;
  }
  return sum > 0 ? sum : undefined;
}

/**
 * The approval card's `input` for a permission request, from its parts: the
 * permission key, the resources/patterns it covers, and the details each
 * version attaches (a command, a file path, a URL, a diff).
 */
export function approvalInput(
  permission: string,
  patterns: string[],
  details: { command?: string; filePath?: string; url?: string; diff?: string },
): Record<string, unknown> {
  const pattern = patterns.join(', ');
  return {
    permission,
    ...(details.command ? { command: details.command } : {}),
    ...(details.filePath ? { file_path: details.filePath } : {}),
    ...(details.url ? { url: details.url } : {}),
    ...(pattern ? { pattern } : {}),
    ...(details.diff ? { diff: details.diff } : {}),
  };
}

/** A tool that feeds the plan card rather than the work log. */
export function isPlanTool(name: string): boolean {
  const tool = name.toLowerCase();
  return tool === 'todowrite' || tool === 'todoread' || tool === 'todo';
}

/** An error's readable text: `{ data: { message } }`, `{ message }`, `{ name }`, a string. */
export function readErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error) return error;
  if (isRecord(error)) {
    const data = error['data'];
    if (isRecord(data) && typeof data['message'] === 'string') return data['message'];
    if (typeof error['message'] === 'string') return error['message'];
    if (typeof error['name'] === 'string') return error['name'];
    if (typeof error['type'] === 'string') return error['type'];
  }
  return 'opencode error';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Compute the newly-appended suffix of `full` relative to what `map[id]` already
 * holds, and store `full`. Empty when nothing is new; the whole `full` when it
 * diverges from the tracked prefix (a reset).
 */
export function reconcileSuffix(map: Map<string, string>, id: string, full: string): string {
  const previous = map.get(id) ?? '';
  const suffix = full.startsWith(previous) ? full.slice(previous.length) : full;
  map.set(id, full);
  return suffix;
}
