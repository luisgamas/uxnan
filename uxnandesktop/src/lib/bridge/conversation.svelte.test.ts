/**
 * One bridge thread as the chat tab shows it, kept in step by the bridge's
 * notifications — including everything another client (the phone) does.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Turn, TurnList } from '$shared/models/thread';
import type { WorkRunSegment } from '$shared/models/history';
import {
  Conversation,
  assistantOf,
  isTimelineMethod,
  placeBlock,
  threadIdOf,
  userText,
} from './conversation.svelte';

function turn(id: string, text: string, status: Turn['status'] = 'completed', answer = ''): Turn {
  return {
    id,
    threadId: 't1',
    status,
    createdAt: 1,
    messages: [
      { id: `${id}-u`, turnId: id, role: 'user', content: text, createdAt: 1 },
      { id: `${id}-a`, turnId: id, role: 'assistant', content: answer, createdAt: 2 },
    ],
  };
}

function note(method: string, params: Record<string, unknown>) {
  return { method, params: { threadId: 't1', ...params } };
}

function conversation(call = vi.fn(async () => ({}) as never)) {
  return { c: new Conversation('t1', call as never), call };
}

/** A settled run of steps as a page serves it (shared/src/models/history.ts). */
function run(from: number, to: number, extra: Partial<WorkRunSegment> = {}): WorkRunSegment {
  return {
    type: 'work',
    from,
    to,
    commands: to - from + 1,
    edits: 0,
    tools: 0,
    thoughts: 0,
    failed: 0,
    running: 0,
    files: [],
    last: { type: 'command_execution', index: to, command: 'ls', status: 'completed' },
    ...extra,
  };
}

/** A command step as a preview: where it is stored, and what it ran. */
function step(index: number, extra: Record<string, unknown> = {}) {
  return {
    type: 'command_execution',
    index,
    command: `step ${index}`,
    status: 'completed',
    ...extra,
  };
}

/** A settled turn whose answer is [segments], as a page serves it. */
function turnWith(id: string, segments: unknown[], extra: Record<string, unknown> = {}): Turn {
  const base = turn(id, 'go');
  return {
    ...base,
    messages: [base.messages[0]!, { ...base.messages[1]!, segments, ...extra }],
  };
}

/** A bridge that answers each method from [answers] (a value, or a function of the params). */
function bridgeWith(answers: Record<string, unknown>) {
  return vi.fn(async (method: string, params?: unknown) => {
    const answer = answers[method];
    if (answer instanceof Error) throw answer;
    return (
      typeof answer === 'function' ? (answer as (p: unknown) => unknown)(params) : answer
    ) as never;
  });
}

describe('Conversation', () => {
  it('adopts a newest page with the live state the bridge reports', () => {
    const { c } = conversation();
    const page: TurnList = {
      turns: [turn('a', 'one'), turn('b', 'two', 'streaming')],
      total: 12,
      activeTurnId: 'b',
      queuedTurnIds: ['c'],
      queuePaused: true,
      queuePausedReason: 'turnError',
    };
    c.adoptPage(page);
    expect(c.turns.map((t) => t.id)).toEqual(['a', 'b']);
    expect(c.oldestOffset).toBe(10);
    expect(c.hasOlder).toBe(true);
    expect(c.running).toBe(true);
    expect(c.queue).toEqual({ turnIds: ['c'], paused: true, reason: 'turnError' });
  });

  it('places a turn another client created, and confirms our own echo', () => {
    const { c } = conversation();
    c.addPending({ clientTurnId: 'bubble', text: 'mine', request: { text: 'mine' } });
    c.apply(note('stream/turn/created', { turn: turn('x', 'from the phone', 'pending') }));
    expect(c.turns.map((t) => t.id)).toEqual(['x']);
    expect(c.pending).toHaveLength(1);
    c.apply(
      note('stream/turn/created', { turn: turn('y', 'mine', 'pending'), clientTurnId: 'bubble' }),
    );
    expect(c.pending).toHaveLength(0);
    expect(c.turns.map((t) => userText(t))).toEqual(['from the phone', 'mine']);
    // A replayed announcement is not a second turn.
    c.apply(note('stream/turn/created', { turn: turn('y', 'mine', 'pending') }));
    expect(c.turns).toHaveLength(2);
  });

  it('streams prose and blocks in order, each block where the bridge stored it', () => {
    const { c } = conversation();
    c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'Hello ' }));
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'wor' }));
    // A parallel activity is stored before the text run still being written.
    const task = { type: 'tool', toolName: 'Task', index: 0, input: {} };
    c.apply(
      note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: task, index: 0 }),
    );
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'ld' }));
    const ls = step(2);
    c.apply(note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: ls, index: 2 }));
    const answer = assistantOf(c.turns[0]);
    expect(answer?.content).toBe('Hello world');
    expect(answer?.segments).toEqual([task, { type: 'text', text: 'Hello world' }, ls]);
    expect(c.running).toBe(true);
  });

  it('replaces a running step with its result, in place', () => {
    const { c } = conversation();
    c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    const running = step(0, { status: 'running', blockId: 'c1' });
    c.apply(
      note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: running, index: 0 }),
    );
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'Done.' }));
    const done = { ...running, status: 'completed', output: 'a.txt' };
    c.apply(
      note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: done, index: 0 }),
    );
    expect(assistantOf(c.turns[0])?.segments).toEqual([done, { type: 'text', text: 'Done.' }]);
  });

  it('goes on after a summarized run as one group, and settles a step inside it', () => {
    // A window that read the turn mid-way: the bridge folded steps 1..3 into a
    // run, the third still running.
    const { c } = conversation();
    const page = run(1, 3, {
      running: 1,
      last: step(3, { status: 'running', blockId: 'b3' }) as never,
    });
    c.adoptPage({
      turns: [turnWith('x', [{ type: 'text', text: 'Looking.' }, page], { content: 'Looking.' })],
      total: 1,
      activeTurnId: 'x',
    });
    // Step 3 settles (failed), then step 4 starts: still one group.
    const settled = step(3, { status: 'completed', exitCode: 1, blockId: 'b3' });
    c.apply(
      note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: settled, index: 3 }),
    );
    const next = step(4, { status: 'running', blockId: 'b4' });
    c.apply(
      note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: next, index: 4 }),
    );
    expect(assistantOf(c.turns[0])?.segments).toEqual([
      { type: 'text', text: 'Looking.' },
      { ...page, running: 0, failed: 1, last: settled },
      next,
    ]);
  });

  it('places a block by its stored index across summarized runs', () => {
    const segments = [{ type: 'text', text: 'a' }, run(1, 40), { type: 'text', text: 'b' }];
    // Index 42 is right after the text that follows the run: the end.
    expect(placeBlock(segments, step(42), 42)).toEqual([...segments, step(42)]);
    // Index 41 is that text's place: a parallel activity lands before it.
    expect(placeBlock(segments, step(41), 41)).toEqual([
      segments[0],
      segments[1],
      step(41),
      segments[2],
    ]);
    // Without an index, at the end.
    expect(placeBlock(segments, { type: 'plan' }, undefined)).toEqual([
      ...segments,
      { type: 'plan' },
    ]);
  });

  it('lands streamed text in one render per window, never out of order', () => {
    vi.useFakeTimers();
    try {
      const { c } = conversation();
      c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
      c.apply(note('stream/turn/started', { turnId: 'x' }));
      c.apply(note('stream/thinking/delta', { turnId: 'x', messageId: 'x-a', delta: 'hmm' }));
      c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'Hel' }));
      c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'lo' }));
      // Nothing rendered yet: the deltas wait for the window.
      expect(assistantOf(c.turns[0])?.content ?? '').toBe('');
      vi.advanceTimersByTime(16);
      expect(assistantOf(c.turns[0])?.content).toBe('Hello');
      // Any other event lands the buffer first.
      c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: '!' }));
      const read = { type: 'tool', toolName: 'Read', index: 2, input: {} };
      c.apply(
        note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: read, index: 2 }),
      );
      expect(assistantOf(c.turns[0])?.segments).toEqual([
        { type: 'thinking', text: 'hmm' },
        { type: 'text', text: 'Hello!' },
        read,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adopts the stored turn when one ends, and keeps the usage', async () => {
    const stored = turn('x', 'go', 'completed', 'final answer');
    const { c, call } = conversation(vi.fn(async () => stored as never));
    c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'fin' }));
    c.apply(
      note('stream/turn/completed', {
        turnId: 'x',
        messageId: 'x-a',
        text: 'final answer',
        usage: { tokens: 500, contextWindow: 1000 },
      }),
    );
    expect(c.running).toBe(false);
    expect(c.usage).toEqual({ tokens: 500, contextWindow: 1000 });
    await vi.waitFor(() => expect(assistantOf(c.turns[0])?.content).toBe('final answer'));
    expect(call).toHaveBeenCalledWith('turn/read', { turnId: 'x' });
  });

  it('joins a turn already streaming when it was never told it started', async () => {
    const { c, call } = conversation(
      vi.fn(async () => turn('z', 'typed elsewhere', 'streaming', '') as never),
    );
    c.apply(note('stream/message/delta', { turnId: 'z', messageId: 'z-a', delta: 'partial' }));
    c.flush();
    expect(c.turns.map((t) => t.id)).toEqual(['z']);
    expect(c.running).toBe(true);
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    // The stored copy is behind what already streamed, so the live text stays.
    expect(assistantOf(c.turns[0])?.content).toBe('partial');
  });

  it('marks cancelled queue turns, and follows the queue', () => {
    const { c } = conversation();
    c.adoptPage({ turns: [turn('a', 'q1', 'queued'), turn('b', 'q2', 'queued')], total: 2 });
    c.apply(note('stream/turn/cancelled', { turnId: 'a' }));
    expect(c.turns.map((t) => t.status)).toEqual(['cancelled', 'queued']);
    c.apply(note('stream/queue/updated', { queuedTurnIds: ['k'], paused: false }));
    expect(c.queue).toEqual({ turnIds: ['k'], paused: false });
  });

  it('retires approvals and questions answered anywhere', () => {
    const { c } = conversation();
    c.apply(note('stream/approval/resolved', { approvalId: 'ap', decision: 'approveSession' }));
    c.apply(
      note('stream/question/resolved', {
        questionId: 'q',
        answers: [['B']],
        skipped: false,
        timedOut: true,
      }),
    );
    expect(c.approvals.ap).toEqual({ decision: 'approveSession', timedOut: false });
    expect(c.questions.q).toEqual({ answers: [['B']], skipped: false, timedOut: true });
    c.settleApprovalLocally('ap2', 'reject');
    expect(c.approvals.ap2?.decision).toBe('reject');
  });

  it('lists the open approvals of the running turn until they are answered', () => {
    const { c } = conversation();
    c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    c.apply(
      note('stream/content/block', {
        turnId: 'x',
        messageId: 'x-a',
        content: { type: 'approval', approvalId: 'ap', action: 'Allow Bash' },
      }),
    );
    expect(c.openRequests).toEqual([{ type: 'approval', approvalId: 'ap', action: 'Allow Bash' }]);
    c.apply(note('stream/approval/resolved', { approvalId: 'ap', decision: 'approve' }));
    expect(c.openRequests).toEqual([]);
  });

  it("never lets a page that left before the first message's turn take it away", async () => {
    // A brand-new conversation reads its first page as the first message is
    // sent; the bridge creates the turn and says so before that page arrives.
    const first = turn('x', 'hello', 'streaming');
    let answerFirst!: (page: TurnList) => void;
    const call = vi
      .fn()
      .mockImplementationOnce(() => new Promise<TurnList>((r) => (answerFirst = r)))
      .mockResolvedValueOnce({ turns: [first], total: 1, activeTurnId: 'x' } satisfies TurnList);
    const c = new Conversation('t1', call as never);
    const loading = c.load();
    c.apply(note('stream/turn/created', { turn: first }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    answerFirst({ turns: [], total: 0 }); // the bridge as it was before the turn
    await loading;
    expect(call).toHaveBeenCalledTimes(2);
    expect(c.turns.map((t) => t.id)).toEqual(['x']);
    expect(c.activeTurnId).toBe('x');
  });

  it('reloads its newest page when the bridge says the history changed outside a turn', async () => {
    const page = {
      turns: [turn('x', 'hi', 'completed'), turn('y', 'from the terminal', 'completed')],
      total: 2,
    } satisfies TurnList;
    const call = vi.fn(async () => page as never);
    const c = new Conversation('t1', call as never);
    c.apply(note('stream/history/changed', { rev: 7 }));
    await vi.waitFor(() => expect(c.turns.map((t) => t.id)).toEqual(['x', 'y']));
    expect(call).toHaveBeenCalledWith(
      'turn/list',
      expect.objectContaining({ threadId: 't1', fromEnd: true }),
    );
  });

  it('keeps an approval delivered twice as one open request', () => {
    const { c } = conversation();
    c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    // A bridge older than `blockId` on requests, then one that sends it: the
    // second copy of each (a reload racing the live block) replaces the first.
    const old = { type: 'approval', approvalId: 'ap', action: 'Allow external_directory: /tmp/*' };
    const now = { ...old, approvalId: 'ap2', blockId: 'ap2' };
    for (const content of [old, old, now, now]) {
      c.apply(note('stream/content/block', { turnId: 'x', messageId: 'x-a', content }));
    }
    expect(c.openRequests.map((r) => r.approvalId)).toEqual(['ap', 'ap2']);
  });

  it('starts where a page trimmed to its byte budget starts', async () => {
    // The bridge served only the newest 2 of the 30 turns asked for.
    const call = vi.fn(
      async () => ({ turns: [turn('o1', 'old')], total: 40, offset: 20 }) as never,
    );
    const { c } = conversation(call);
    c.adoptPage({ turns: [turn('a', 'one'), turn('b', 'two')], total: 40, offset: 38 });
    expect(c.oldestOffset).toBe(38);
    await c.loadOlder();
    expect(call).toHaveBeenCalledWith('turn/list', { threadId: 't1', cursor: '8', limit: 30 });
    // The older page was trimmed too: what is before it is still to read.
    expect(c.oldestOffset).toBe(20);
    expect(c.hasOlder).toBe(true);
  });

  it('shows an answer too large for the connection as its error, and does not ask again', async () => {
    const call = vi.fn(async () => {
      throw new Error('Response too large (-32011)');
    });
    const { c } = conversation(call as never);
    await c.load();
    expect(c.error).toBe('Response too large (-32011)');
    expect(call).toHaveBeenCalledTimes(1);
    expect(c.loading).toBe(false);
  });

  it('pages back with an offset cursor and never duplicates a turn', async () => {
    const call = vi.fn(
      async () => ({ turns: [turn('o1', 'old'), turn('a', 'dup')], total: 40 }) as never,
    );
    const { c } = conversation(call);
    c.adoptPage({ turns: [turn('a', 'one')], total: 40 });
    expect(c.oldestOffset).toBe(39);
    await c.loadOlder();
    expect(call).toHaveBeenCalledWith('turn/list', { threadId: 't1', cursor: '9', limit: 30 });
    expect(c.turns.map((t) => t.id)).toEqual(['o1', 'a']);
    expect(c.oldestOffset).toBe(9);
  });

  it('keeps a failed send visible with its error', () => {
    const { c } = conversation();
    c.addPending({ clientTurnId: 'p', text: 'hi', request: { text: 'hi' } });
    c.failPending('p', 'thread not found');
    expect(c.pending).toEqual([
      { clientTurnId: 'p', text: 'hi', request: { text: 'hi' }, error: 'thread not found' },
    ]);
    expect(c.retryPending('p')).toEqual({ clientTurnId: 'p', text: 'hi', request: { text: 'hi' } });
    expect(c.pending[0]?.error).toBeUndefined();
    c.dropPending('p');
    expect(c.pending).toEqual([]);
  });

  it('keeps an unconfirmed send across a restart, and lets it go once the bridge has it', () => {
    const { c } = conversation();
    c.addPending({
      clientTurnId: 'lost',
      text: 'never answered',
      request: { text: 'never answered' },
    });
    c.addPending({ clientTurnId: 'sent', text: 'made it', request: { text: 'made it' } });
    c.failPending('sent', 'socket closed');

    // The app closes and opens again: both come back as failed bubbles, the
    // one that got no answer at all without a reason.
    const { c: again } = conversation();
    expect(again.pending.map((p) => [p.clientTurnId, p.error])).toEqual([
      ['lost', ''],
      ['sent', 'socket closed'],
    ]);

    // The bridge did store one of them: it is no longer waiting, here or on disk.
    again.adoptPage({ turns: [turn('a', 'made it')], total: 1 });
    expect(again.pending.map((p) => p.clientTurnId)).toEqual(['lost']);
    expect(conversation().c.pending.map((p) => p.clientTurnId)).toEqual(['lost']);

    again.forgetPending();
    expect(conversation().c.pending).toEqual([]);
  });
});

describe('notification routing helpers', () => {
  it('knows which methods belong to a timeline and which thread they name', () => {
    expect(isTimelineMethod('stream/turn/created')).toBe(true);
    expect(isTimelineMethod('stream/thread/updated')).toBe(false);
    expect(threadIdOf({ method: 'x', params: { threadId: 't9' } })).toBe('t9');
    expect(threadIdOf({ method: 'x', params: { threadId: '' } })).toBeUndefined();
    expect(threadIdOf({ method: 'x' })).toBeUndefined();
  });
});

describe('orderBySeq', () => {
  it('orders by the bridge position, keeping unnumbered placeholders last', async () => {
    const { orderBySeq } = await import('./conversation.svelte');
    const numbered = (id: string, seq: number): Turn => ({ ...turn(id, id), seq });
    const placeholder = turn('live', 'live', 'streaming');
    expect(
      orderBySeq([numbered('c', 3), placeholder, numbered('a', 1), numbered('b', 2)]).map(
        (t) => t.id,
      ),
    ).toEqual(['a', 'b', 'c', 'live']);
    // Without any numbers (an older bridge) the order is left alone.
    const legacy = [turn('x', 'x'), turn('y', 'y')];
    expect(orderBySeq(legacy)).toBe(legacy);
  });

  it('places a turn this window missed where it belongs, not at the bottom', () => {
    const conversation = new Conversation('t1', vi.fn() as never);
    conversation.adoptPage({
      turns: [
        { ...turn('t1-1', 'one'), seq: 1 },
        { ...turn('t1-3', 'three'), seq: 3 },
      ],
      total: 2,
    } as TurnList);
    conversation.apply({
      method: 'stream/turn/created',
      params: { threadId: 't1', turn: { ...turn('t1-2', 'two', 'completed'), seq: 2 } },
    });
    expect(conversation.turns.map((t) => t.id)).toEqual(['t1-1', 't1-2', 't1-3']);
  });
});

describe('what the timeline opens', () => {
  it("reads a run's steps page by page, keeps them, and lets them go with the turn", async () => {
    const pages: Record<number, unknown> = {
      1: { steps: [step(1), step(2)], next: 3 },
      3: { steps: [step(3)] },
    };
    const call = bridgeWith({ 'turn/steps': (p: { from: number }) => pages[p.from] });
    const { c } = conversation(call);
    const settled = run(1, 3);
    c.adoptPage({ turns: [turnWith('x', [settled])], total: 1 });

    await c.loadSteps('x', settled);
    expect(call).toHaveBeenCalledWith('turn/steps', {
      threadId: 't1',
      turnId: 'x',
      from: 1,
      to: 3,
    });
    expect(c.stepRun('x', settled)).toEqual({ steps: [step(1), step(2)], next: 3, loading: false });
    await c.loadSteps('x', settled);
    expect(call).toHaveBeenLastCalledWith('turn/steps', {
      threadId: 't1',
      turnId: 'x',
      from: 3,
      to: 3,
    });
    expect(c.stepRun('x', settled)?.steps.map((s) => s.index)).toEqual([1, 2, 3]);
    // Every step is here: nothing more to ask.
    await c.loadSteps('x', settled);
    expect(call).toHaveBeenCalledTimes(2);

    // A page without the turn: what was opened in it goes.
    c.adoptPage({ turns: [turn('y', 'other')], total: 2 });
    expect(c.stepRun('x', settled)).toBeUndefined();
  });

  it('keeps a failed read failed until the user asks again', async () => {
    const call = bridgeWith({ 'turn/steps': new Error('Response too large (-32011)') });
    const { c } = conversation(call);
    const settled = run(0, 1);
    await c.loadSteps('x', settled);
    expect(c.stepRun('x', settled)).toEqual({
      steps: [],
      loading: false,
      error: 'Response too large (-32011)',
    });
    await c.loadSteps('x', settled);
    expect(call).toHaveBeenCalledTimes(1);
    await c.loadSteps('x', settled, true);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('updates a step read earlier when it settles live', async () => {
    const call = bridgeWith({
      'turn/steps': { steps: [step(1), step(2, { status: 'running', blockId: 'b2' })] },
    });
    const { c } = conversation(call);
    const live = run(1, 3, { running: 1 });
    c.adoptPage({ turns: [turnWith('x', [live])], total: 1, activeTurnId: 'x' });
    await c.loadSteps('x', live);
    const settled = step(2, { status: 'completed', blockId: 'b2' });
    c.apply(
      note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: settled, index: 2 }),
    );
    expect(c.stepRun('x', live)?.steps[1]).toEqual(settled);
    // The run's copy: the step it knew as running is not any more.
    expect(assistantOf(c.turns[0])?.segments?.[0]).toMatchObject({ running: 0 });
  });

  it('reads one step whole, once', async () => {
    const whole = { type: 'command_execution', command: 'cat <<EOF\n…', output: 'x'.repeat(5000) };
    const call = bridgeWith({ 'turn/step': { block: whole } });
    const { c } = conversation(call);
    await c.loadFullStep('x', 7);
    await c.loadFullStep('x', 7);
    expect(call).toHaveBeenCalledWith('turn/step', { threadId: 't1', turnId: 'x', index: 7 });
    expect(c.fullStep('x', 7)).toEqual({ value: whole, loading: false });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('builds the reasoning where it happened, by the rule the bridge stores it by', () => {
    const { c } = conversation();
    c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    const think = (delta: string) => note('stream/thinking/delta', { turnId: 'x', messageId: 'x-a', delta });
    c.apply(think('Read the '));
    c.apply(think('config.'));
    const ls = step(1);
    c.apply(note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: ls, index: 1 }));
    c.apply(think('Now test.'));
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'Done.' }));
    c.flush();
    expect(assistantOf(c.turns[0])?.segments).toEqual([
      { type: 'thinking', text: 'Read the config.' },
      ls,
      { type: 'thinking', text: 'Now test.' },
      { type: 'text', text: 'Done.' },
    ]);
  });

  it('goes on with a thought a page folded into a run in that same row', async () => {
    const call = bridgeWith({
      'turn/steps': { steps: [step(0), step(1), { type: 'thinking', index: 2, text: 'First I' }] },
    });
    const { c } = conversation(call);
    const page = run(0, 2, {
      commands: 2,
      thoughts: 1,
      last: { type: 'thinking', index: 2, text: 'First I' } as never,
    });
    c.adoptPage({ turns: [turnWith('x', [page])], total: 1, activeTurnId: 'x' });
    await c.loadSteps('x', page);
    c.apply(note('stream/thinking/delta', { turnId: 'x', messageId: 'x-a', delta: ' check CI.' }));
    c.flush();
    // The bridge grows the stored thought (index 2): the same row grows, here
    // and in the steps read earlier, and the next block is 3.
    const grown = { type: 'thinking', index: 2, text: 'First I check CI.' };
    expect(c.stepRun('x', page)?.steps[2]).toEqual(grown);
    c.apply(note('stream/content/block', { turnId: 'x', messageId: 'x-a', content: step(3), index: 3 }));
    expect(assistantOf(c.turns[0])?.segments).toEqual([{ ...page, last: grown }, step(3)]);
  });

  it('grows a cut thought by its size, leaving its preview as the bridge cut it', () => {
    const { c } = conversation();
    const cut = { type: 'thinking', index: 0, text: 'a'.repeat(600), textChars: 900 };
    const page = run(0, 0, { commands: 0, thoughts: 1, last: cut as never });
    c.adoptPage({ turns: [turnWith('x', [page])], total: 1, activeTurnId: 'x' });
    c.apply(note('stream/thinking/delta', { turnId: 'x', messageId: 'x-a', delta: 'more' }));
    c.flush();
    expect(assistantOf(c.turns[0])?.segments).toEqual([{ ...page, last: { ...cut, textChars: 904 } }]);
  });
});
