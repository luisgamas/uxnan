/**
 * OpenCode 1.x — `opencode serve` without a password, the V1 routes
 * (`/session`, `/session/:id/prompt_async`, `/event`, `/permission/:id/reply`,
 * `/question/:id/reply`) and the V1 event bus, translated into the neutral
 * contract of `opencode-protocol.ts`.
 *
 * The V1 bus streams **message parts**: `message.updated` announces a message
 * and its role, `message.part.updated` a part and its type, and
 * `message.part.delta` increments a part's text — the same `field: "text"` for
 * assistant text, reasoning and the echoed user message alike. So the
 * translator keeps, per session, each message's role and each part's type, and
 * turns them into assistant-only `text` / `reasoning` increments, reconciling
 * streamed deltas against whole-part snapshots. Verified against opencode
 * 1.17.20 – 1.18.32.
 */
import type { QuestionItem, QuestionOption } from '@uxnan/shared';
import { extractPlanSteps } from './content-blocks.js';
import { opencodeToolBlock } from './opencode-tools.js';
import {
  approvalInput,
  isPlanTool,
  isRecord,
  openCodeUsageTokens,
  readErrorMessage,
  reconcileSuffix,
  str,
  type IOpenCodeServer,
  type OpenCodeCommand,
  type OpenCodeCommandRun,
  type OpenCodeEvent,
  type OpenCodeHistoryMessage,
  type OpenCodeModel,
  type OpenCodeModelRef,
  type OpenCodePermissionPolicy,
  type OpenCodePrompt,
  type PermissionReply,
} from './opencode-protocol.js';
import { ServeProcess } from './opencode-transport.js';
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from './spawn.js';

/**
 * V1 permission keys with a real side effect, gated when the session asks.
 * Read-only keys (`read`/`glob`/`grep`/`list`/`lsp`) and the plan tool run
 * freely, so plan mode and inspection don't flood the phone with cards.
 */
const GATED_PERMISSIONS = ['edit', 'bash', 'webfetch', 'external_directory'] as const;

/** Per-session bookkeeping the V1 bus needs to tell text from reasoning. */
interface SessionState {
  /** messageID → role, from `message.updated`. */
  roleByMessage: Map<string, string>;
  /** partID → part type, from `message.part.updated` (announced before its deltas). */
  partTypes: Map<string, string>;
  /** partID → text delivered so far (text parts). */
  partTexts: Map<string, string>;
  /** partID → text delivered so far (reasoning parts). */
  reasoningTexts: Map<string, string>;
  /** Tool part ids already reported (a part updates many times). */
  emittedTools: Set<string>;
  /** Tool parts already announced as running. */
  startedTools: Set<string>;
}

/** Turns V1 bus events into neutral {@link OpenCodeEvent}s. Pure but stateful. */
export class OpenCodeV1Translator {
  readonly #sessions = new Map<string, SessionState>();

  translate(type: string, p: Record<string, unknown>): OpenCodeEvent[] {
    switch (type) {
      case 'message.updated':
        return this.#messageUpdated(p);
      case 'message.part.updated':
        return this.#partUpdated(p);
      case 'message.part.delta':
        return this.#partDelta(p);
      case 'todo.updated': {
        const sessionId = str(p['sessionID']);
        const steps = extractPlanSteps({ todos: p['todos'] });
        return sessionId && steps.length > 0 ? [{ kind: 'plan', sessionId, steps }] : [];
      }
      case 'permission.asked':
        return this.#permission(p, false);
      case 'permission.v2.asked':
        return this.#permission(p, true);
      case 'question.asked':
      case 'question.v2.asked': {
        const sessionId = str(p['sessionID']);
        const requestId = str(p['id']);
        if (!sessionId || !requestId) return [];
        return [
          { kind: 'question', sessionId, requestId, questions: parseV1Questions(p['questions']) },
        ];
      }
      case 'session.error': {
        const sessionId = str(p['sessionID']);
        return [
          {
            kind: 'error',
            ...(sessionId ? { sessionId } : {}),
            message: readErrorMessage(p['error']),
          },
        ];
      }
      case 'session.compacted': {
        const sessionId = str(p['sessionID']);
        return sessionId ? [{ kind: 'compacted', sessionId }] : [];
      }
      case 'session.idle': {
        const sessionId = str(p['sessionID']);
        if (!sessionId) return [];
        this.#sessions.delete(sessionId);
        return [{ kind: 'idle', sessionId }];
      }
      default:
        // Heartbeats, plugin.added, session.status, … carry nothing the turn needs.
        return [];
    }
  }

  #state(sessionId: string): SessionState {
    let state = this.#sessions.get(sessionId);
    if (!state) {
      state = {
        roleByMessage: new Map(),
        partTypes: new Map(),
        partTexts: new Map(),
        reasoningTexts: new Map(),
        emittedTools: new Set(),
        startedTools: new Set(),
      };
      this.#sessions.set(sessionId, state);
    }
    return state;
  }

  /** A message's metadata (`{ info }`): its role, and for the assistant its usage and error. */
  #messageUpdated(p: Record<string, unknown>): OpenCodeEvent[] {
    const info = isRecord(p['info']) ? p['info'] : undefined;
    const sessionId = str(info?.['sessionID']);
    if (!info || !sessionId) return [];
    const id = str(info['id']);
    const role = str(info['role']);
    if (id && role) this.#state(sessionId).roleByMessage.set(id, role);
    if (role !== 'assistant') return [];
    const out: OpenCodeEvent[] = [];
    const tokens = openCodeUsageTokens(info['tokens']);
    if (tokens !== undefined) out.push({ kind: 'usage', sessionId, tokens });
    if (isRecord(info['error'])) {
      out.push({ kind: 'error', sessionId, message: readErrorMessage(info['error']) });
    }
    return out;
  }

  /**
   * An increment (`{ messageID, partID, field, delta }`). Text and reasoning both
   * stream as `field: "text"`, so the part's announced type routes it, and the
   * user message's echoed text is skipped by its message's role.
   */
  #partDelta(p: Record<string, unknown>): OpenCodeEvent[] {
    const sessionId = str(p['sessionID']);
    if (!sessionId || str(p['field']) !== 'text') return [];
    const state = this.#state(sessionId);
    if (state.roleByMessage.get(str(p['messageID'])) !== 'assistant') return [];
    const partId = str(p['partID']);
    const delta = str(p['delta']);
    if (!delta) return [];
    if (state.partTypes.get(partId) === 'reasoning') {
      state.reasoningTexts.set(partId, (state.reasoningTexts.get(partId) ?? '') + delta);
      return [{ kind: 'reasoning', sessionId, delta }];
    }
    state.partTexts.set(partId, (state.partTexts.get(partId) ?? '') + delta);
    return [{ kind: 'text', sessionId, delta }];
  }

  /** A whole part changed (`{ part }`): text, reasoning, a tool, or a step's usage. */
  #partUpdated(p: Record<string, unknown>): OpenCodeEvent[] {
    const part = isRecord(p['part']) ? p['part'] : undefined;
    const sessionId = str(part?.['sessionID']);
    if (!part || !sessionId) return [];
    const state = this.#state(sessionId);
    const id = str(part['id']);
    const type = str(part['type']);
    state.partTypes.set(id, type);
    const isAssistant = state.roleByMessage.get(str(part['messageID'])) === 'assistant';
    switch (type) {
      case 'text': {
        if (!isAssistant) return [];
        // Only what the delta stream has not already delivered.
        const delta = reconcileSuffix(state.partTexts, id, str(part['text']));
        return delta ? [{ kind: 'text', sessionId, delta }] : [];
      }
      case 'reasoning': {
        if (!isAssistant) return [];
        const delta = reconcileSuffix(state.reasoningTexts, id, str(part['text']));
        return delta ? [{ kind: 'reasoning', sessionId, delta }] : [];
      }
      case 'tool': {
        const name = str(part['tool']);
        // The plan tool surfaces through `todo.updated`; its part would double it.
        if (isPlanTool(name)) return [];
        const toolState = isRecord(part['state']) ? part['state'] : {};
        const status = str(toolState['status']);
        const input = isRecord(toolState['input']) ? toolState['input'] : {};
        if (status === 'running' && !state.startedTools.has(id)) {
          state.startedTools.add(id);
          return [{ kind: 'tool_started', sessionId, id, name, input }];
        }
        if ((status !== 'completed' && status !== 'error') || state.emittedTools.has(id)) return [];
        state.emittedTools.add(id);
        return [
          {
            kind: 'tool',
            sessionId,
            id,
            name,
            input: isRecord(toolState['input']) ? toolState['input'] : {},
            output: str(toolState['output']) || str(toolState['error']),
            error: status === 'error',
          },
        ];
      }
      case 'step-finish': {
        const tokens = openCodeUsageTokens(part['tokens']);
        return tokens !== undefined ? [{ kind: 'usage', sessionId, tokens }] : [];
      }
      default:
        return [];
    }
  }

  /**
   * `permission.asked` carries `{ permission, patterns, metadata }`; the later
   * `permission.v2.asked` carries `{ action, resources }`. Both reply on
   * `/permission/:id/reply`.
   */
  #permission(p: Record<string, unknown>, isV2Shape: boolean): OpenCodeEvent[] {
    const sessionId = str(p['sessionID']);
    const requestId = str(p['id']);
    if (!sessionId || !requestId) return [];
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    if (isV2Shape) {
      const toolName = str(p['action']) || 'tool';
      return [
        {
          kind: 'permission',
          sessionId,
          requestId,
          toolName,
          input: approvalInput(toolName, strings(p['resources']), {}),
        },
      ];
    }
    const toolName = str(p['permission']) || 'tool';
    const metadata = isRecord(p['metadata']) ? p['metadata'] : {};
    return [
      {
        kind: 'permission',
        sessionId,
        requestId,
        toolName,
        input: approvalInput(toolName, strings(p['patterns']), {
          command: str(metadata['command']),
          filePath: str(metadata['filepath']),
          url: str(metadata['url']),
          diff: str(metadata['diff']),
        }),
      },
    ];
  }
}

/**
 * A V1 `questions` array onto the shared {@link QuestionItem}s. OpenCode's shape
 * (`{ question, header, options:[{label,description}], multiple }`) already
 * matches; questions without a usable option are dropped.
 */
export function parseV1Questions(raw: unknown): QuestionItem[] {
  if (!Array.isArray(raw)) return [];
  const items: QuestionItem[] = [];
  for (const q of raw) {
    if (!isRecord(q)) continue;
    const question = str(q['question']);
    if (!question) continue;
    const options: QuestionOption[] = [];
    for (const o of Array.isArray(q['options']) ? q['options'] : []) {
      if (!isRecord(o)) continue;
      const label = str(o['label']);
      if (!label) continue;
      const description = str(o['description']);
      options.push({ label, ...(description ? { description } : {}) });
    }
    if (options.length === 0) continue;
    const header = str(q['header']);
    items.push({
      question,
      ...(header ? { header } : {}),
      options,
      ...(q['multiple'] === true ? { multiple: true } : {}),
    });
  }
  return items;
}

/** Normalize V1 `GET /session/:id/message` (`{ info, parts }[]`). */
export function openCodeV1History(messages: unknown[]): OpenCodeHistoryMessage[] {
  const out: OpenCodeHistoryMessage[] = [];
  for (const value of messages) {
    if (!isRecord(value)) continue;
    const info = isRecord(value['info']) ? value['info'] : undefined;
    const role = info?.['role'];
    if (!info || (role !== 'user' && role !== 'assistant')) continue;
    const time = isRecord(info['time']) ? info['time'] : {};
    // A live assistant record is visible before it finishes. Take it only once
    // OpenCode stamps `finish` (current) or a completion time (older 1.x), or a
    // polling phone would freeze partial prose as a completed turn.
    if (role === 'assistant' && !info['finish'] && time['completed'] === undefined) continue;
    const texts: string[] = [];
    const thoughts: string[] = [];
    const blocks: unknown[] = [];
    for (const part of Array.isArray(value['parts']) ? value['parts'] : []) {
      if (!isRecord(part)) continue;
      if (part['type'] === 'text' && typeof part['text'] === 'string') texts.push(part['text']);
      else if (part['type'] === 'reasoning' && typeof part['text'] === 'string') {
        thoughts.push(part['text']);
      } else if (part['type'] === 'tool') {
        const state = isRecord(part['state']) ? part['state'] : {};
        const status = str(state['status']);
        if (status !== 'completed' && status !== 'error') continue;
        blocks.push(
          opencodeToolBlock(
            str(part['tool']),
            str(part['id']),
            isRecord(state['input']) ? state['input'] : {},
            str(state['output']) || str(state['error']),
            status === 'error',
          ),
        );
      }
    }
    const message: OpenCodeHistoryMessage = {
      role,
      text: texts.join('').trim(),
      createdAt: epochMs(time['created']),
    };
    const thinking = thoughts.join('').trim();
    if (thinking) message.thinking = thinking;
    if (blocks.length > 0) message.blocks = blocks;
    if (message.text || message.thinking || message.blocks?.length) out.push(message);
  }
  return out;
}

/** An ISO-8601 or epoch-ms timestamp; 0 when absent or unreadable. */
export function epochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Parse `opencode models` output into a unique list of `provider/model` ids. */
export function parseModelList(stdout: string): string[] {
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(ANSI_PATTERN, '').trim();
    // Model ids look like `provider/model`; skip headers and blank lines.
    if (line.includes('/') && !line.includes(' ')) seen.add(line);
  }
  return [...seen];
}

/**
 * Parse `opencode models --verbose` into a `provider/model` → context-window map.
 * The output is a `provider/model` header line per model followed by its
 * pretty-printed JSON; the first `"context": N` after a header is its
 * `limit.context` (capabilities spell `"type": "context"`, a string).
 */
export function parseOpenCodeModelWindows(verboseStdout: string): Map<string, number> {
  const windows = new Map<string, number>();
  let currentId: string | undefined;
  for (const raw of verboseStdout.split(/\r?\n/)) {
    const line = raw.replace(ANSI_PATTERN, '').trim();
    if (line.includes('/') && !/[\s{}":]/.test(line)) {
      currentId = line;
      continue;
    }
    const match = line.match(/^"context":\s*(\d+)/);
    if (match && currentId && !windows.has(currentId)) {
      const value = Number(match[1]);
      if (value > 0) windows.set(currentId, value);
    }
  }
  return windows;
}

/** Run a short-lived CLI command and collect everything it prints. */
function collect(
  spawnFn: SpawnFn,
  binaryPath: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise((resolve) => {
    let child: SpawnedProcess;
    try {
      child = spawnFn(binaryPath, args, cwd);
    } catch {
      resolve('');
      return;
    }
    let out = '';
    const add = (chunk: unknown): void => {
      out += String(chunk);
    };
    child.stdout.on('data', add);
    child.stderr?.on('data', add);
    child.on('error', () => resolve(out));
    child.on('close', () => resolve(out));
  });
}

export interface OpenCodeV1ServerOptions {
  binaryPath: string;
  cwd: string;
  /** Spawns the short-lived `opencode models` runs (injected in tests). */
  spawnFn?: SpawnFn;
  /** Extra environment for `opencode serve` (Uxnan Desktop's tools). */
  env?: Record<string, string>;
}

/**
 * `GET /command` entries onto commands. V1 lists skills there too
 * (`source: "skill"`), and runs them through the same route.
 */
export function openCodeV1Commands(data: unknown[]): OpenCodeCommand[] {
  const out: OpenCodeCommand[] = [];
  const seen = new Set<string>();
  for (const c of data) {
    if (!isRecord(c)) continue;
    const name = str(c['name']);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = str(c['description']);
    out.push({ name, ...(description ? { description } : {}), skill: c['source'] === 'skill' });
  }
  return out;
}

/** An OpenCode 1.x `opencode serve`, behind the neutral contract. */
export class OpenCodeV1Server implements IOpenCodeServer {
  readonly protocol = 1 as const;
  readonly #serve: ServeProcess;
  readonly #translator = new OpenCodeV1Translator();
  readonly #listeners = new Set<(event: OpenCodeEvent) => void>();
  readonly #opts: OpenCodeV1ServerOptions;

  constructor(opts: OpenCodeV1ServerOptions) {
    this.#opts = opts;
    this.#serve = new ServeProcess({
      binaryPath: opts.binaryPath,
      cwd: opts.cwd,
      eventPath: '/event',
      password: false,
      extraArgs: ['--print-logs'],
      ...(opts.spawnFn ? { spawnFn: opts.spawnFn } : {}),
      ...(opts.env ? { env: opts.env } : {}),
    });
    this.#serve.onData((data) => {
      const type = str(data['type']);
      if (!type) return;
      const properties = isRecord(data['properties']) ? data['properties'] : {};
      for (const event of this.#translator.translate(type, properties)) {
        for (const listener of this.#listeners) listener(event);
      }
    });
  }

  start(): Promise<void> {
    return this.#serve.start();
  }

  async createSession(opts: {
    title?: string;
    permission: OpenCodePermissionPolicy;
  }): Promise<string> {
    const res = await this.#serve.request<{ id?: string }>('POST', '/session', {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      permission: GATED_PERMISSIONS.map((permission) => ({
        permission,
        pattern: '**',
        action: opts.permission,
      })),
    });
    if (!res.id) throw new Error('opencode did not return a session id');
    return res.id;
  }

  async prompt(sessionId: string, prompt: OpenCodePrompt): Promise<void> {
    await this.#promptAsync(sessionId, prompt.text, prompt.model, prompt.variant);
  }

  /**
   * V1 has no steer verb: another `prompt_async` on a busy session is folded
   * into the running work at the next tool boundary, closing with one
   * `session.idle` (verified against 1.18.11).
   */
  async steer(sessionId: string, text: string): Promise<void> {
    await this.#promptAsync(sessionId, text);
  }

  async #promptAsync(
    sessionId: string,
    text: string,
    model?: OpenCodeModelRef,
    variant?: string,
  ): Promise<void> {
    await this.#serve.request('POST', `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      ...(model !== undefined ? { model } : {}),
      ...(variant !== undefined ? { variant } : {}),
      parts: [{ type: 'text', text }],
    });
  }

  /** The server's commands and skills for its directory (loaded at boot). */
  async commands(): Promise<OpenCodeCommand[]> {
    await this.start();
    const value = await this.#serve.request<unknown>(
      'GET',
      `/command?directory=${encodeURIComponent(this.#opts.cwd)}`,
    );
    return openCodeV1Commands(Array.isArray(value) ? value : []);
  }

  /**
   * `POST /session/:id/command` answers only once the turn is over — its reply
   * is the finished assistant message (verified on 1.18.32) — while the turn's
   * events stream exactly as a prompt's do. So it is not awaited: the turn runs
   * on the events, and a refusal (an unknown command, a failure) arrives as the
   * session's `error` event.
   */
  runCommand(sessionId: string, run: OpenCodeCommandRun): Promise<void> {
    const body = {
      command: run.name,
      arguments: run.args,
      ...(run.model ? { model: `${run.model.providerID}/${run.model.modelID}` } : {}),
      ...(run.variant !== undefined ? { variant: run.variant } : {}),
    };
    void this.#serve
      .request('POST', `/session/${encodeURIComponent(sessionId)}/command`, body)
      .catch((err: unknown) => {
        const message = `opencode command /${run.name} failed: ${err instanceof Error ? err.message : String(err)}`;
        for (const listener of this.#listeners) listener({ kind: 'error', sessionId, message });
      });
    return Promise.resolve();
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.#serve.request('POST', `/session/${encodeURIComponent(sessionId)}/abort`);
  }

  async replyPermission(
    _sessionId: string,
    requestId: string,
    reply: PermissionReply,
  ): Promise<void> {
    await this.#serve.request('POST', `/permission/${encodeURIComponent(requestId)}/reply`, {
      reply,
    });
  }

  async answerQuestion(_sessionId: string, requestId: string, answers: string[][]): Promise<void> {
    const id = encodeURIComponent(requestId);
    if (answers.some((a) => a.length > 0)) {
      await this.#serve.request('POST', `/question/${id}/reply`, { answers });
    } else {
      await this.#serve.request('POST', `/question/${id}/reject`);
    }
  }

  async messages(sessionId: string): Promise<OpenCodeHistoryMessage[]> {
    await this.start();
    const value = await this.#serve.request<unknown>(
      'GET',
      `/session/${encodeURIComponent(sessionId)}/message`,
    );
    return openCodeV1History(Array.isArray(value) ? value : []);
  }

  /**
   * `opencode models` for the ids, `opencode models --verbose` for their
   * context windows — short-lived runs, so no server is needed.
   */
  async models(): Promise<OpenCodeModel[]> {
    const spawnFn = this.#opts.spawnFn ?? defaultSpawn;
    const { binaryPath, cwd } = this.#opts;
    const [list, verbose] = await Promise.all([
      collect(spawnFn, binaryPath, ['models'], cwd),
      collect(spawnFn, binaryPath, ['models', '--verbose'], cwd),
    ]);
    const windows = parseOpenCodeModelWindows(verbose);
    return parseModelList(list).map((id) => {
      const contextWindow = windows.get(id);
      return contextWindow !== undefined ? { id, contextWindow } : { id };
    });
  }

  onEvent(listener: (event: OpenCodeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  onClose(listener: () => void): void {
    this.#serve.onClose(listener);
  }

  close(): Promise<void> {
    this.#serve.close();
    return Promise.resolve();
  }
}
