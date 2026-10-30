/**
 * Conversations as a catalog, end to end on a real bridge (architecture/02a
 * §5.8.21): continuing one with another agent (`thread/transfer`), from the
 * new-conversation screen (`thread/start { continueFrom }`) or as a fork
 * (`thread/fork`); proving the context reached the agent; and searching what
 * was said (`thread/search`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type {
  AgentCapabilities,
  AgentId,
  SendTurnOptions,
  Thread,
  ThreadSearchResult,
  ThreadTransferContextResult,
  ThreadTransferResult,
  TurnList,
} from '@uxnan/shared';
import { JsonRpcErrorCode, makeRequest } from '@uxnan/shared';
import { BaseAgentAdapter, InMemorySecretStore, startBridge } from '../../src/index.js';
import { TRANSFER_CONTEXT_OPEN } from '../../src/conversation/transfer-context.js';
import { rmrf, seedProject } from '../helpers/fs.js';

const CAPS: AgentCapabilities = {
  streaming: true,
  approvals: false,
  forking: false,
  images: false,
  reportsContextUsage: false,
};

/** An agent that answers every turn with a fixed reply — or fails it, on demand. */
class ScriptedAdapter extends BaseAgentAdapter {
  readonly capabilities = CAPS;
  readonly received: string[] = [];
  failNext = false;
  constructor(readonly agentId: AgentId) {
    super();
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  sendTurn(options: SendTurnOptions): Promise<void> {
    this.received.push(options.text);
    const { threadId, turnId } = options;
    this.emit({ type: 'turn_started', threadId, turnId });
    setImmediate(() => {
      if (this.failNext) {
        this.failNext = false;
        this.emit({ type: 'turn_error', threadId, turnId, data: { text: 'no credits' } });
        return;
      }
      this.emit({ type: 'delta', threadId, turnId, data: { text: `ok from ${this.agentId}` } });
      this.emit({ type: 'turn_completed', threadId, turnId, data: {} });
    });
    return Promise.resolve();
  }
  cancelTurn(): Promise<void> {
    return Promise.resolve();
  }
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('waitFor timed out');
}

async function harness() {
  const baseDir = join(tmpdir(), `uxnan-conversations-${randomUUID()}`);
  const work = await seedProject(baseDir);
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  const echo = new ScriptedAdapter('echo');
  const codex = new ScriptedAdapter('codex');
  bridge.context.agentManager.register(echo);
  bridge.context.agentManager.register(codex);
  const call = async <T>(method: string, params: unknown): Promise<T> => {
    const res = await bridge.router.dispatch(makeRequest(randomUUID(), method as never, params));
    assert.ok('result' in res, JSON.stringify(res));
    return res.result as T;
  };
  const fails = async (method: string, params: unknown): Promise<number> => {
    const res = await bridge.router.dispatch(makeRequest(randomUUID(), method as never, params));
    assert.ok('error' in res, JSON.stringify(res));
    return (res as { error: { code: number } }).error.code;
  };
  const thread = (id: string) => call<Thread>('thread/read', { threadId: id });
  const ended = (id: string) =>
    waitFor(async () => {
      const page = await call<TurnList>('turn/list', { threadId: id });
      return page.activeTurnId === undefined && page.turns.every((t) => t.status !== 'streaming');
    });
  /** A conversation with [count] answered exchanges, on [agentId]. */
  const conversation = async (agentId: AgentId, prompts: string[]): Promise<Thread> => {
    const [project] = await call<{ id: string }[]>('project/list', undefined);
    const started = await call<Thread>('thread/start', { projectId: project?.id, agentId });
    for (const text of prompts) {
      await call('turn/send', { threadId: started.id, text });
      await ended(started.id);
    }
    return thread(started.id);
  };
  const close = async () => {
    await bridge.stop();
    await rmrf(baseDir);
  };
  return { bridge, baseDir, work, echo, codex, call, fails, thread, ended, conversation, close };
}

test('a conversation continues with another agent: new thread, both ends recorded, context delivered', async () => {
  const h = await harness();
  try {
    const source = await h.conversation('echo', [
      'The release codename is PELICAN-7342.',
      'And the files are src/retry/policy.ts.',
    ]);
    const made = await h.call<ThreadTransferResult>('thread/transfer', {
      sourceThreadId: source.id,
      agentId: 'codex',
    });
    assert.equal(made.created, true);
    assert.notEqual(made.thread.id, source.id);
    assert.equal(made.thread.agentId, 'codex');
    assert.equal(made.thread.cwd, source.cwd);
    assert.equal(made.thread.projectId, source.projectId);
    assert.equal(made.thread.turnCount, 0);
    assert.equal(made.thread.title, source.title);
    assert.equal(made.thread.titleSource, 'prompt');
    assert.equal(made.thread.transfer?.status, 'pending');
    assert.equal(made.thread.transfer?.strategy, 'selection');
    assert.equal(made.thread.transfer?.sourceThreadId, source.id);
    assert.equal(made.thread.transfer?.sourceAgentId, 'echo');
    assert.equal(made.thread.transfer?.createdBy, 'user');
    assert.equal(made.thread.transfer?.context.turns, 2);
    // The source is untouched but names its continuation.
    const after = await h.thread(source.id);
    assert.equal(after.agentId, 'echo');
    assert.equal(after.turnCount, 2);
    assert.deepEqual(after.continuations, [
      {
        threadId: made.thread.id,
        transferId: made.thread.transfer?.id,
        agentId: 'codex',
        strategy: 'selection',
      },
    ]);

    // What the agent will read is readable before it is sent.
    const prepared = await h.call<ThreadTransferContextResult>('thread/transferContext', {
      threadId: made.thread.id,
    });
    assert.ok(prepared.text.includes('PELICAN-7342'));
    assert.deepEqual(prepared.summary, made.thread.transfer?.context);

    await h.call('turn/send', { threadId: made.thread.id, text: 'What is the codename?' });
    await h.ended(made.thread.id);
    const [first] = h.codex.received;
    assert.ok(first?.startsWith(TRANSFER_CONTEXT_OPEN));
    assert.ok(first?.endsWith('\n\nWhat is the codename?'));
    assert.ok(first?.includes('PELICAN-7342'));
    const delivered = await h.thread(made.thread.id);
    assert.equal(delivered.transfer?.status, 'delivered');
    assert.ok(delivered.transfer?.turnId);
    // The conversation shows what the person typed, not the carried context.
    const page = await h.call<TurnList>('turn/list', { threadId: made.thread.id });
    assert.equal(page.turns[0]?.messages[0]?.content, 'What is the codename?');

    // Only the first message carries it.
    await h.call('turn/send', { threadId: made.thread.id, text: 'Thanks' });
    await h.ended(made.thread.id);
    assert.equal(h.codex.received[1], 'Thanks');
  } finally {
    await h.close();
  }
});

test('a turn that fails before the agent answers leaves the context for the next one', async () => {
  const h = await harness();
  try {
    const source = await h.conversation('echo', ['remember BANANA']);
    const { thread } = await h.call<ThreadTransferResult>('thread/transfer', {
      sourceThreadId: source.id,
      agentId: 'codex',
    });
    h.codex.failNext = true;
    await h.call('turn/send', { threadId: thread.id, text: 'go' });
    await h.ended(thread.id);
    assert.equal((await h.thread(thread.id)).transfer?.status, 'pending');
    await h.call('turn/send', { threadId: thread.id, text: 'again' });
    await h.ended(thread.id);
    assert.ok(h.codex.received[1]?.startsWith(TRANSFER_CONTEXT_OPEN));
    assert.equal((await h.thread(thread.id)).transfer?.status, 'delivered');
  } finally {
    await h.close();
  }
});

test('a transferred conversation carries each attachment as its name; its message takes no marker', async () => {
  const h = await harness();
  try {
    const [project] = await h.call<{ id: string }[]>('project/list', undefined);
    const source = await h.call<Thread>('thread/start', {
      projectId: project?.id,
      agentId: 'echo',
    });
    await h.call('turn/send', {
      threadId: source.id,
      text: 'The logo is \uFFFC, keep it.',
      attachments: [
        { type: 'image', name: 'logo.png', mimeType: 'image/png', base64Data: 'iVBORw0KGgo=' },
      ],
    });
    await h.ended(source.id);
    const prepared = await h.call<ThreadTransferContextResult>('thread/transferContext', {
      threadId: (
        await h.call<ThreadTransferResult>('thread/transfer', {
          sourceThreadId: source.id,
          agentId: 'codex',
        })
      ).thread.id,
    });
    assert.ok(prepared.text.includes('The logo is [logo.png], keep it.'));
    assert.ok(!prepared.text.includes('\uFFFC'));
    assert.equal(
      await h.fails('thread/transfer', {
        sourceThreadId: source.id,
        agentId: 'codex',
        message: 'see \uFFFC',
      }),
      JsonRpcErrorCode.InvalidParams,
    );
  } finally {
    await h.close();
  }
});

test('a message sent with the transfer goes at once; a retry under the same key makes and sends nothing', async () => {
  const h = await harness();
  try {
    const source = await h.conversation('echo', ['hello']);
    const params = {
      sourceThreadId: source.id,
      agentId: 'codex',
      message: 'Take it from here.',
      clientTransferId: 'key-1',
    };
    const made = await h.call<ThreadTransferResult>('thread/transfer', params);
    assert.ok(made.turnId);
    await h.ended(made.thread.id);
    const again = await h.call<ThreadTransferResult>('thread/transfer', params);
    assert.equal(again.created, false);
    assert.equal(again.thread.id, made.thread.id);
    assert.equal(again.turnId, undefined);
    assert.equal(h.codex.received.length, 1);
    assert.equal((await h.thread(source.id)).continuations?.length, 1);
  } finally {
    await h.close();
  }
});

test('thread/start continueFrom makes the same continuation in the folder and agent chosen there', async () => {
  const h = await harness();
  try {
    const source = await h.conversation('echo', ['a fact: OWL-9']);
    const started = await h.call<Thread>('thread/start', {
      projectId: source.projectId,
      cwd: h.work,
      agentId: 'codex',
      model: 'gpt-x',
      continueFrom: { threadId: source.id, strategy: 'reference' },
    });
    assert.equal(started.agentId, 'codex');
    assert.equal(started.model, 'gpt-x');
    assert.equal(started.transfer?.strategy, 'reference');
    assert.equal((await h.thread(source.id)).continuations?.[0]?.threadId, started.id);
    assert.equal(
      await h.fails('thread/start', {
        projectId: source.projectId,
        agentId: 'codex',
        agentSessionId: 's',
        continueFrom: { threadId: source.id },
      }),
      -32602,
    );
  } finally {
    await h.close();
  }
});

test('a fork copies the history, keeps the agent, and its agent still gets the context', async () => {
  const h = await harness();
  try {
    const source = await h.conversation('echo', ['one', 'two']);
    const fork = await h.call<Thread>('thread/fork', { threadId: source.id });
    assert.equal(fork.agentId, 'echo');
    assert.equal(fork.turnCount, 2);
    assert.equal(fork.title, `${source.title} (fork)`);
    assert.equal(fork.transfer?.strategy, 'fork');
    assert.equal(fork.agentSessionId, undefined);
    await h.call('turn/send', { threadId: fork.id, text: 'three' });
    await h.ended(fork.id);
    assert.ok(h.echo.received.at(-1)?.startsWith(TRANSFER_CONTEXT_OPEN));
    // Deleting the fork takes it off its source.
    await h.call('thread/delete', { threadId: fork.id });
    assert.equal((await h.thread(source.id)).continuations, undefined);
  } finally {
    await h.close();
  }
});

test('continuing a conversation of a removed project does not bring the project back', async () => {
  const h = await harness();
  try {
    const source = await h.conversation('echo', ['x']);
    await h.call('project/remove', { projectId: source.projectId });
    const { thread } = await h.call<ThreadTransferResult>('thread/transfer', {
      sourceThreadId: source.id,
      agentId: 'codex',
    });
    assert.equal(thread.projectId, source.projectId);
    const projects = await h.call<{ id: string }[]>('project/list', undefined);
    assert.ok(!projects.some((p) => p.id === source.projectId));
  } finally {
    await h.close();
  }
});

test('unknown sources, agents and strategies are refused', async () => {
  const h = await harness();
  try {
    const source = await h.conversation('echo', ['x']);
    assert.equal(
      await h.fails('thread/transfer', { sourceThreadId: 'nope' }),
      JsonRpcErrorCode.ResourceNotFound,
    );
    assert.equal(
      await h.fails('thread/transfer', { sourceThreadId: source.id, agentId: 'nobody' }),
      -32602,
    );
    assert.equal(
      await h.fails('thread/transfer', { sourceThreadId: source.id, strategy: 'magic' }),
      -32602,
    );
    assert.equal(
      await h.fails('thread/transferContext', { threadId: source.id }),
      JsonRpcErrorCode.ResourceNotFound,
    );
  } finally {
    await h.close();
  }
});

test('search finds what was said, by title and content, scoped and paged; never reads a turn', async () => {
  const h = await harness();
  try {
    const a = await h.conversation('echo', ['Plan the Canción release', 'what about retries?']);
    await h.call('thread/rename', { threadId: a.id, title: 'Release planning' });
    const b = await h.conversation('codex', ['nothing to see here']);
    await h.call('thread/archive', { threadId: b.id });

    const byContent = await h.call<ThreadSearchResult>('thread/search', { query: 'cancion' });
    assert.deepEqual(
      byContent.hits.map((hit) => [hit.threadId, hit.titleMatch, hit.matchCount]),
      [[a.id, false, 1]],
    );
    const match = byContent.hits[0]?.matches[0];
    assert.equal(match?.role, 'user');
    assert.equal(
      match?.snippet.slice(match.matchStart, match.matchStart + match.matchLength),
      'Canción',
    );
    // The agents' replies are searched too.
    const replies = await h.call<ThreadSearchResult>('thread/search', { query: 'ok from echo' });
    assert.equal(replies.hits[0]?.matchCount, 2);
    // Titles match on the bridge too.
    const byTitle = await h.call<ThreadSearchResult>('thread/search', { query: 'planning' });
    assert.equal(byTitle.hits[0]?.titleMatch, true);
    // Archived ones only when asked.
    const hidden = await h.call<ThreadSearchResult>('thread/search', { query: 'nothing' });
    assert.equal(hidden.hits.length, 0);
    const shown = await h.call<ThreadSearchResult>('thread/search', {
      query: 'nothing',
      includeArchived: true,
    });
    assert.equal(shown.hits[0]?.threadId, b.id);
    // Scoped to a project that has none of them.
    const scoped = await h.call<ThreadSearchResult>('thread/search', {
      query: 'cancion',
      projectId: 'proj_nobody',
    });
    assert.deepEqual(scoped, { hits: [], searched: 0, total: 0 });
    // One per page.
    const paged = await h.call<ThreadSearchResult>('thread/search', {
      query: 'ok',
      limit: 1,
      includeArchived: true,
    });
    assert.equal(paged.hits.length, 1);
    assert.equal(paged.nextCursor, '1');
    const rest = await h.call<ThreadSearchResult>('thread/search', {
      query: 'ok',
      cursor: paged.nextCursor,
      includeArchived: true,
    });
    assert.equal(rest.hits.length, 1);
    assert.equal(rest.nextCursor, undefined);
    assert.equal(await h.fails('thread/search', { query: 'a' }), -32602);
    // The digest is on disk beside the conversation.
    const digest = JSON.parse(
      await readFile(join(h.baseDir, 'threads', a.id, 'digest.json'), 'utf-8'),
    ) as { turns: Record<string, { u: string }> };
    assert.equal(Object.keys(digest.turns).length, 2);
  } finally {
    await h.close();
  }
});
