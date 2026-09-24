/**
 * One bridge thread as the chat tab shows it, kept in step by the bridge's
 * notifications — including everything another client (the phone) does.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Turn, TurnList } from '$shared/models/thread';
import { Conversation, assistantOf, isTimelineMethod, threadIdOf, userText } from './conversation.svelte';

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
    c.addPending({ clientTurnId: 'bubble', text: 'mine' });
    c.apply(note('stream/turn/created', { turn: turn('x', 'from the phone', 'pending') }));
    expect(c.turns.map((t) => t.id)).toEqual(['x']);
    expect(c.pending).toHaveLength(1);
    c.apply(note('stream/turn/created', { turn: turn('y', 'mine', 'pending'), clientTurnId: 'bubble' }));
    expect(c.pending).toHaveLength(0);
    expect(c.turns.map((t) => userText(t))).toEqual(['from the phone', 'mine']);
    // A replayed announcement is not a second turn.
    c.apply(note('stream/turn/created', { turn: turn('y', 'mine', 'pending') }));
    expect(c.turns).toHaveLength(2);
  });

  it('streams prose and blocks in order, a parallel block before the open run', () => {
    const { c } = conversation();
    c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'Hello ' }));
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'wor' }));
    c.apply(
      note('stream/content/block', {
        turnId: 'x',
        messageId: 'x-a',
        content: { type: 'tool', toolName: 'Task' },
        beforeText: true,
      }),
    );
    c.apply(note('stream/message/delta', { turnId: 'x', messageId: 'x-a', delta: 'ld' }));
    c.apply(
      note('stream/content/block', {
        turnId: 'x',
        messageId: 'x-a',
        content: { type: 'command_execution', command: 'ls' },
      }),
    );
    const answer = assistantOf(c.turns[0]);
    expect(answer?.content).toBe('Hello world');
    expect(answer?.segments).toEqual([
      { type: 'tool', toolName: 'Task' },
      { type: 'text', text: 'Hello world' },
      { type: 'command_execution', command: 'ls' },
    ]);
    expect(c.running).toBe(true);
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
    const { c, call } = conversation(vi.fn(async () => turn('z', 'typed elsewhere', 'streaming', '') as never));
    c.apply(note('stream/message/delta', { turnId: 'z', messageId: 'z-a', delta: 'partial' }));
    expect(c.turns.map((t) => t.id)).toEqual(['z']);
    expect(c.running).toBe(true);
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    // The stored copy is behind what already streamed, so the live text stays.
    expect(assistantOf(c.turns[0])?.content).toBe('partial');
  });

  it('marks cancelled and delivered queue turns, and follows the queue', () => {
    const { c } = conversation();
    c.adoptPage({ turns: [turn('a', 'q1', 'queued'), turn('b', 'q2', 'queued')], total: 2 });
    c.apply(note('stream/turn/cancelled', { turnId: 'a' }));
    c.apply(note('stream/turn/delivered', { turnId: 'b', intoTurnId: 'run' }));
    expect(c.turns.map((t) => t.status)).toEqual(['cancelled', 'delivered']);
    expect(c.turns[1].deliveredIntoTurnId).toBe('run');
    c.apply(note('stream/queue/updated', { queuedTurnIds: ['k'], paused: false }));
    expect(c.queue).toEqual({ turnIds: ['k'], paused: false });
  });

  it('retires approvals and questions answered anywhere', () => {
    const { c } = conversation();
    c.apply(note('stream/approval/resolved', { approvalId: 'ap', decision: 'approveSession' }));
    c.apply(
      note('stream/question/resolved', { questionId: 'q', answers: [['B']], skipped: false, timedOut: true }),
    );
    expect(c.approvals.ap).toEqual({ decision: 'approveSession', timedOut: false });
    expect(c.questions.q).toEqual({ answers: [['B']], skipped: false, timedOut: true });
    c.settleApprovalLocally('ap2', 'reject');
    expect(c.approvals.ap2?.decision).toBe('reject');
  });

  it('reports working, then blocked on an open approval, then idle', () => {
    const { c } = conversation();
    expect(c.displayStatus).toBe('idle');
    c.apply(note('stream/turn/created', { turn: turn('x', 'go', 'pending') }));
    c.apply(note('stream/turn/started', { turnId: 'x' }));
    expect(c.displayStatus).toBe('working');
    c.apply(
      note('stream/content/block', {
        turnId: 'x',
        messageId: 'x-a',
        content: { type: 'approval', approvalId: 'ap', action: 'Allow Bash' },
      }),
    );
    expect(c.pendingInput).toBe(1);
    expect(c.displayStatus).toBe('blocked');
    c.apply(note('stream/approval/resolved', { approvalId: 'ap', decision: 'approve' }));
    expect(c.displayStatus).toBe('working');
    c.apply(note('stream/turn/aborted', { turnId: 'x' }));
    expect(c.displayStatus).toBe('idle');
  });

  it('pages back with an offset cursor and never duplicates a turn', async () => {
    const call = vi.fn(async () => ({ turns: [turn('o1', 'old'), turn('a', 'dup')], total: 40 }) as never);
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
    c.addPending({ clientTurnId: 'p', text: 'hi' });
    c.failPending('p', 'thread not found');
    expect(c.pending).toEqual([{ clientTurnId: 'p', text: 'hi', error: 'thread not found' }]);
    c.dropPending('p');
    expect(c.pending).toEqual([]);
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
