/**
 * OpenCode 2.x — `opencode serve` behind a password, the `/api/*` routes and
 * the V2 event stream, translated into the neutral contract of
 * `opencode-protocol.ts`.
 *
 * What changed from V1, all measured against a running 2.0.16 server (its
 * OpenAPI document is served at `/openapi.json`):
 *  - the server refuses to run without a password; `OPENCODE_SERVER_PASSWORD`
 *    sets one, sent as Basic auth (`opencode:<password>`);
 *  - the routes live under `/api` (`/api/event`, `/api/session`,
 *    `/api/session/:id/prompt`, `…/interrupt`, `…/permission/:id/reply`,
 *    `…/form/:id/reply`, `…/message`, `/api/model`);
 *  - a session is created with its model, its directory and its permission
 *    rules (`{ action, resource, effect }`); a prompt carries only text, and a
 *    model change is its own call;
 *  - the stream is `{ type, data }` with `session.text.*` / `session.reasoning.*`
 *    (assistant only — no role bookkeeping), `session.tool.*`,
 *    `session.step.ended` (usage), `session.execution.succeeded` /
 *    `interrupted` / `failed` (the turn's end), `permission.asked`, and a
 *    question as a **form** (`form.created`, answered per field key);
 *  - steering is a delivery mode of the prompt (`delivery: "steer"`);
 *  - history is typed messages (`user`, `assistant` with `content[]`, `idle`),
 *    paginated, newest first unless `order=asc`;
 *  - models come from the server, loaded a moment after it boots.
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
import type { SpawnFn } from './spawn.js';

/**
 * V2 permission actions with a real side effect, gated when the session asks —
 * the same set as V1's (`bash` is `shell` now; a file write asks as `edit`).
 * Reads, the plan tool, questions and sub-agents run freely.
 */
const GATED_ACTIONS = ['shell', 'edit', 'webfetch', 'external_directory'] as const;

/** How long `models()` waits for a freshly booted server to load its catalog. */
const MODELS_WAIT_MS = 10_000;
const MODELS_POLL_MS = 400;
/**
 * How long `commands()` waits for a freshly booted server's command catalog,
 * which loads in stages: empty, then the built-ins, then the config and the
 * command folders (measured on 2.0.16, about a second in all).
 */
const COMMANDS_WAIT_MS = 6_000;
const COMMANDS_POLL_MS = 400;
/** Upper bound on history pages read for one session. */
const MAX_HISTORY_PAGES = 50;

/** A form field, as `form.created` announces it and a reply must key it. */
interface FormField {
  key: string;
  multiple: boolean;
}

/** Turns V2 events into neutral {@link OpenCodeEvent}s. Pure but stateful. */
export class OpenCodeV2Translator {
  /** `messageID:ordinal` → text delivered so far. */
  readonly #texts = new Map<string, string>();
  readonly #reasoning = new Map<string, string>();
  /** tool call id → its name and input, which arrive before its result. */
  readonly #toolNames = new Map<string, string>();
  readonly #toolInputs = new Map<string, Record<string, unknown>>();
  /** form id → its fields, so an answer can be keyed the way the form asked. */
  readonly #forms = new Map<string, FormField[]>();

  /** The fields of a form announced earlier (undefined once answered or unknown). */
  formFields(formId: string): FormField[] | undefined {
    return this.#forms.get(formId);
  }

  translate(type: string, d: Record<string, unknown>): OpenCodeEvent[] {
    const sessionId = str(d['sessionID']);
    switch (type) {
      case 'session.text.delta':
      case 'session.reasoning.delta': {
        const delta = str(d['delta']);
        if (!sessionId || !delta) return [];
        const kind = type === 'session.text.delta' ? 'text' : 'reasoning';
        const map = kind === 'text' ? this.#texts : this.#reasoning;
        const key = `${str(d['assistantMessageID'])}:${String(d['ordinal'])}`;
        map.set(key, (map.get(key) ?? '') + delta);
        return [{ kind, sessionId, delta }];
      }
      case 'session.text.ended':
      case 'session.reasoning.ended': {
        if (!sessionId) return [];
        const kind = type === 'session.text.ended' ? 'text' : 'reasoning';
        const map = kind === 'text' ? this.#texts : this.#reasoning;
        const key = `${str(d['assistantMessageID'])}:${String(d['ordinal'])}`;
        // Only what the deltas did not already deliver.
        const delta = reconcileSuffix(map, key, str(d['text']));
        map.delete(key);
        return delta ? [{ kind, sessionId, delta }] : [];
      }
      case 'session.tool.input.started':
        this.#toolNames.set(str(d['id']), str(d['name']));
        return [];
      case 'session.tool.called': {
        const id = str(d['id']);
        const input = isRecord(d['input']) ? d['input'] : {};
        this.#toolInputs.set(id, input);
        const name = this.#toolNames.get(id) ?? '';
        return sessionId && id && name && !isPlanTool(name)
          ? [{ kind: 'tool_started', sessionId, id, name, input }]
          : [];
      }
      case 'session.tool.success':
      case 'session.tool.failed':
        return this.#toolEnded(type === 'session.tool.failed', sessionId, d);
      case 'session.step.ended': {
        const tokens = openCodeUsageTokens(d['tokens']);
        return sessionId && tokens !== undefined ? [{ kind: 'usage', sessionId, tokens }] : [];
      }
      case 'session.compaction.ended':
        return sessionId ? [{ kind: 'compacted', sessionId }] : [];
      case 'permission.asked':
        return this.#permission(sessionId, d);
      case 'form.created':
        return this.#form(d);
      case 'form.replied':
      case 'form.cancelled':
        this.#forms.delete(str(d['id']));
        return [];
      case 'session.execution.succeeded':
        return sessionId ? [{ kind: 'idle', sessionId }] : [];
      case 'session.execution.interrupted':
        return sessionId ? [{ kind: 'interrupted', sessionId }] : [];
      case 'session.execution.failed':
        return sessionId
          ? [{ kind: 'error', sessionId, message: readErrorMessage(d['error']) }]
          : [];
      default:
        // Starts, inbox moves, catalog updates, retries, … carry nothing the turn needs.
        return [];
    }
  }

  #toolEnded(failed: boolean, sessionId: string, d: Record<string, unknown>): OpenCodeEvent[] {
    const id = str(d['id']);
    const name = this.#toolNames.get(id) ?? '';
    const input = this.#toolInputs.get(id) ?? {};
    this.#toolNames.delete(id);
    this.#toolInputs.delete(id);
    if (!sessionId || !id) return [];
    if (isPlanTool(name)) {
      if (failed) return [];
      const steps = extractPlanSteps({ todos: input['todos'] });
      return steps.length > 0 ? [{ kind: 'plan', sessionId, steps }] : [];
    }
    const output = failed ? readErrorMessage(d['error']) : contentText(d['content']);
    return [{ kind: 'tool', sessionId, id, name, input, output, error: failed }];
  }

  /**
   * `{ id, sessionID, action, resources, metadata }` — for an edit, `metadata.files`
   * holds each file's path and patch (a write asks as an edit too).
   */
  #permission(sessionId: string, d: Record<string, unknown>): OpenCodeEvent[] {
    const requestId = str(d['id']);
    if (!sessionId || !requestId) return [];
    const action = str(d['action']) || 'tool';
    const resources = Array.isArray(d['resources'])
      ? d['resources'].filter((x): x is string => typeof x === 'string')
      : [];
    const metadata = isRecord(d['metadata']) ? d['metadata'] : {};
    const files = Array.isArray(metadata['files']) ? metadata['files'].filter(isRecord) : [];
    const first = resources[0] ?? '';
    return [
      {
        kind: 'permission',
        sessionId,
        requestId,
        toolName: action,
        input: approvalInput(action, resources, {
          command: action === 'shell' ? first : '',
          filePath: str(files[0]?.['file']) || (action === 'edit' ? first : ''),
          url: action === 'webfetch' ? first : '',
          diff: files
            .map((f) => str(f['patch']))
            .filter(Boolean)
            .join('\n'),
        }),
      },
    ];
  }

  /** A form is how V2 asks: one field per question, the options as its choices. */
  #form(d: Record<string, unknown>): OpenCodeEvent[] {
    const form = isRecord(d['form']) ? d['form'] : undefined;
    const sessionId = str(form?.['sessionID']);
    const requestId = str(form?.['id']);
    if (!form || !sessionId || !requestId) return [];
    const fields: FormField[] = [];
    const questions: QuestionItem[] = [];
    for (const field of Array.isArray(form['fields']) ? form['fields'] : []) {
      if (!isRecord(field)) continue;
      const key = str(field['key']);
      if (!key) continue;
      const multiple = field['type'] === 'array' || field['multiple'] === true;
      fields.push({ key, multiple });
      const options: QuestionOption[] = [];
      for (const o of Array.isArray(field['options']) ? field['options'] : []) {
        if (!isRecord(o)) continue;
        const label = str(o['label']) || str(o['value']);
        if (!label) continue;
        const description = str(o['description']);
        options.push({ label, ...(description ? { description } : {}) });
      }
      const title = str(field['title']);
      questions.push({
        question: str(field['description']) || title || str(form['title']),
        ...(title ? { header: title } : {}),
        options,
        ...(multiple ? { multiple: true } : {}),
      });
    }
    this.#forms.set(requestId, fields);
    return [{ kind: 'question', sessionId, requestId, questions }];
  }
}

/** The text of a V2 `content` array (`[{ type: "text", text }]`). */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(isRecord)
    .map((c) => (c['type'] === 'text' ? str(c['text']) : ''))
    .join('');
}

/** Normalize V2 history (`user` / `assistant` / `idle` / … messages, oldest first). */
export function openCodeV2History(messages: unknown[]): OpenCodeHistoryMessage[] {
  const out: OpenCodeHistoryMessage[] = [];
  for (const m of messages) {
    if (!isRecord(m)) continue;
    const time = isRecord(m['time']) ? m['time'] : {};
    const createdAt = typeof time['created'] === 'number' ? time['created'] : 0;
    if (m['type'] === 'user') {
      const text = str(m['text']).trim();
      if (text) out.push({ role: 'user', text, createdAt });
      continue;
    }
    if (m['type'] !== 'assistant') continue;
    // Still being written: take it only once it completed, or a polling phone
    // would freeze partial prose as a finished turn.
    if (time['completed'] === undefined) continue;
    const texts: string[] = [];
    const thoughts: string[] = [];
    const blocks: unknown[] = [];
    for (const c of Array.isArray(m['content']) ? m['content'] : []) {
      if (!isRecord(c)) continue;
      if (c['type'] === 'text') texts.push(str(c['text']));
      else if (c['type'] === 'reasoning') thoughts.push(str(c['text']));
      else if (c['type'] === 'tool') {
        const name = str(c['name']);
        const state = isRecord(c['state']) ? c['state'] : {};
        const status = str(state['status']);
        if ((status !== 'completed' && status !== 'error') || isPlanTool(name)) continue;
        const output =
          status === 'error' ? readErrorMessage(state['error']) : contentText(state['content']);
        blocks.push(
          opencodeToolBlock(
            name,
            str(c['id']),
            isRecord(state['input']) ? state['input'] : {},
            output,
            status === 'error',
          ),
        );
      }
    }
    const message: OpenCodeHistoryMessage = {
      role: 'assistant',
      text: texts.join('').trim(),
      createdAt,
    };
    const thinking = thoughts.join('').trim();
    if (thinking) message.thinking = thinking;
    if (blocks.length > 0) message.blocks = blocks;
    if (message.text || message.thinking || message.blocks?.length) out.push(message);
  }
  return out;
}

/**
 * `GET /api/command` and `GET /api/skill` onto one list: the commands, then the
 * skills (by id, which is what a prompt attaches), a skill never shadowing a
 * command of the same name.
 */
export function openCodeV2Commands(commands: unknown, skills: unknown): OpenCodeCommand[] {
  const out: OpenCodeCommand[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(commands) ? commands : []) {
    if (!isRecord(c)) continue;
    const name = str(c['name']);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = str(c['description']);
    out.push({ name, ...(description ? { description } : {}), skill: false });
  }
  for (const k of Array.isArray(skills) ? skills : []) {
    if (!isRecord(k)) continue;
    const name = str(k['id']);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = str(k['description']);
    out.push({ name, ...(description ? { description } : {}), skill: true });
  }
  return out;
}

/** `GET /api/model` entries onto `provider/model` ids with their context window. */
export function openCodeV2Models(data: unknown): OpenCodeModel[] {
  if (!Array.isArray(data)) return [];
  const out: OpenCodeModel[] = [];
  const seen = new Set<string>();
  for (const m of data) {
    if (!isRecord(m) || m['enabled'] === false) continue;
    const providerID = str(m['providerID']);
    const modelID = str(m['id']);
    if (!providerID || !modelID) continue;
    const id = `${providerID}/${modelID}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const limit = isRecord(m['limit']) ? m['limit'] : {};
    const context = typeof limit['context'] === 'number' ? limit['context'] : 0;
    out.push(context > 0 ? { id, contextWindow: context } : { id });
  }
  return out;
}

/** The form reply body: each answered question under its field's key. */
export function formAnswer(
  fields: readonly FormField[],
  answers: readonly string[][],
): Record<string, string | string[]> {
  const answer: Record<string, string | string[]> = {};
  fields.forEach((field, i) => {
    const chosen = answers[i] ?? [];
    if (chosen.length === 0) return;
    answer[field.key] = field.multiple ? [...chosen] : (chosen[0] as string);
  });
  return answer;
}

export interface OpenCodeV2ServerOptions {
  binaryPath: string;
  cwd: string;
  /** Spawns `opencode serve` (injected in tests). */
  spawnFn?: SpawnFn;
  /** Extra environment for `opencode serve` (Uxnan Desktop's tools). */
  env?: Record<string, string>;
}

/** An OpenCode 2.x `opencode serve`, behind the neutral contract. */
export class OpenCodeV2Server implements IOpenCodeServer {
  readonly protocol = 2 as const;
  readonly #serve: ServeProcess;
  readonly #translator = new OpenCodeV2Translator();
  readonly #listeners = new Set<(event: OpenCodeEvent) => void>();
  readonly #cwd: string;
  /** sessionID → the model it runs, so a turn switches only when it differs. */
  readonly #sessionModel = new Map<string, string>();

  constructor(opts: OpenCodeV2ServerOptions) {
    this.#cwd = opts.cwd;
    this.#serve = new ServeProcess({
      binaryPath: opts.binaryPath,
      cwd: opts.cwd,
      eventPath: '/api/event',
      password: true,
      ...(opts.spawnFn ? { spawnFn: opts.spawnFn } : {}),
      ...(opts.env ? { env: opts.env } : {}),
    });
    this.#serve.onData((data) => {
      const type = str(data['type']);
      if (!type) return;
      const payload = isRecord(data['data']) ? data['data'] : {};
      for (const event of this.#translator.translate(type, payload)) {
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
    model?: OpenCodeModelRef;
    variant?: string;
  }): Promise<string> {
    const res = await this.#serve.request<{ data?: { id?: string } }>('POST', '/api/session', {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      location: { directory: this.#cwd },
      ...(opts.model ? { model: modelRef(opts.model, opts.variant) } : {}),
      permissions: GATED_ACTIONS.map((action) => ({
        action,
        resource: '*',
        effect: opts.permission,
      })),
    });
    const id = res.data?.id;
    if (!id) throw new Error('opencode did not return a session id');
    if (opts.model) this.#sessionModel.set(id, modelKey(opts.model, opts.variant));
    return id;
  }

  async prompt(sessionId: string, prompt: OpenCodePrompt): Promise<void> {
    await this.#useModel(sessionId, prompt.model, prompt.variant);
    await this.#serve.request('POST', `/api/session/${encodeURIComponent(sessionId)}/prompt`, {
      text: prompt.text,
    });
  }

  /** The server's commands and skills for this directory, once it has loaded them. */
  async commands(): Promise<OpenCodeCommand[]> {
    await this.start();
    const location = `location%5Bdirectory%5D=${encodeURIComponent(this.#cwd)}`;
    const deadline = Date.now() + COMMANDS_WAIT_MS;
    let previous = -1;
    for (;;) {
      const [commands, skills] = await Promise.all([
        this.#serve.request<{ data?: unknown }>('GET', `/api/command?${location}`),
        this.#serve.request<{ data?: unknown }>('GET', `/api/skill?${location}`),
      ]);
      const count = Array.isArray(commands.data) ? commands.data.length : 0;
      // Settled once two reads in a row agree on a non-empty catalog.
      if ((count > 0 && count === previous) || Date.now() >= deadline) {
        return openCodeV2Commands(commands.data, skills.data);
      }
      previous = count;
      await new Promise((resolve) => setTimeout(resolve, COMMANDS_POLL_MS));
    }
  }

  /**
   * A command goes to `/command` (the server expands its template into the
   * user message); a skill is attached to a prompt whose text is the
   * arguments. Both answer at once and stream like any prompt (verified on
   * 2.0.16).
   */
  async runCommand(sessionId: string, run: OpenCodeCommandRun): Promise<void> {
    await this.#useModel(sessionId, run.model, run.variant);
    const id = encodeURIComponent(sessionId);
    if (run.skill) {
      await this.#serve.request('POST', `/api/session/${id}/prompt`, {
        text: run.args,
        skills: [{ id: run.name }],
      });
    } else {
      await this.#serve.request('POST', `/api/session/${id}/command`, {
        name: run.name,
        text: run.args,
      });
    }
  }

  /** Switch the session's model when a turn asks for another one. */
  async #useModel(sessionId: string, model?: OpenCodeModelRef, variant?: string): Promise<void> {
    if (!model) return;
    const key = modelKey(model, variant);
    if (this.#sessionModel.get(sessionId) === key) return;
    await this.#serve.request('POST', `/api/session/${encodeURIComponent(sessionId)}/model`, {
      model: modelRef(model, variant),
    });
    this.#sessionModel.set(sessionId, key);
  }

  async steer(sessionId: string, text: string): Promise<void> {
    await this.#serve.request('POST', `/api/session/${encodeURIComponent(sessionId)}/prompt`, {
      text,
      delivery: 'steer',
    });
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.#serve.request('POST', `/api/session/${encodeURIComponent(sessionId)}/interrupt`);
  }

  async replyPermission(
    sessionId: string,
    requestId: string,
    reply: PermissionReply,
  ): Promise<void> {
    await this.#serve.request(
      'POST',
      `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
      { decision: reply },
    );
  }

  async answerQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<void> {
    const path = `/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(requestId)}`;
    const answer = formAnswer(this.#translator.formFields(requestId) ?? [], answers);
    if (Object.keys(answer).length > 0) {
      await this.#serve.request('POST', `${path}/reply`, { answer });
    } else {
      await this.#serve.request('DELETE', path);
    }
  }

  async messages(sessionId: string): Promise<OpenCodeHistoryMessage[]> {
    await this.start();
    const base = `/api/session/${encodeURIComponent(sessionId)}/message`;
    const all: unknown[] = [];
    let query = '?order=asc&limit=200';
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const res = await this.#serve.request<{
        data?: unknown[];
        cursor?: { next?: string | null };
      }>('GET', `${base}${query}`);
      all.push(...(res.data ?? []));
      const next = res.cursor?.next;
      if (!next) break;
      query = `?limit=200&cursor=${encodeURIComponent(next)}`;
    }
    return openCodeV2History(all);
  }

  /** The server's catalog for this directory, waiting for a fresh server to load it. */
  async models(): Promise<OpenCodeModel[]> {
    await this.start();
    const path = `/api/model?location%5Bdirectory%5D=${encodeURIComponent(this.#cwd)}`;
    const deadline = Date.now() + MODELS_WAIT_MS;
    for (;;) {
      const res = await this.#serve.request<{ data?: unknown }>('GET', path);
      const models = openCodeV2Models(res.data);
      if (models.length > 0 || Date.now() >= deadline) return models;
      await new Promise((resolve) => setTimeout(resolve, MODELS_POLL_MS));
    }
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

function modelRef(model: OpenCodeModelRef, variant?: string): Record<string, string> {
  return { id: model.modelID, providerID: model.providerID, ...(variant ? { variant } : {}) };
}

function modelKey(model: OpenCodeModelRef, variant?: string): string {
  return `${model.providerID}/${model.modelID}#${variant ?? ''}`;
}
