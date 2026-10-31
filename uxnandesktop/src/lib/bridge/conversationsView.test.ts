// What the Conversations tab lists (architecture/02a §5.8.21): scope, filters,
// title matching and the bridge's content hits, grouped by age.
import { describe, expect, it } from 'vitest';
import type { Thread, ThreadSearchHit } from '$shared/models/thread';
import { ageGroupOf, conversationRows, groupByAge, sessionRows, titleMatches, type ConversationFilters } from './conversationsView';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 29, 15, 0, 0).getTime();

function thread(id: string, extra: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: 'p1',
    title: `Thread ${id}`,
    status: 'idle',
    turnCount: 1,
    createdAt: NOW - DAY,
    updatedAt: NOW,
    agentId: 'codex',
    cwd: '/w/app',
    ...extra,
  };
}

const base: ConversationFilters = {
  scope: 'project',
  projectId: 'p1',
  cwd: '/w/app',
  state: 'any',
  origin: 'any',
  archived: false,
  query: '',
};
const idle = { activityOf: () => 'idle' as const };

describe('conversationRows', () => {
  const threads = [
    thread('a', { title: 'Canción release', updatedAt: NOW - 10 }),
    thread('b', { projectId: 'p2', cwd: '/w/other', agentId: 'claude-code' }),
    thread('c', { status: 'archived' }),
    thread('d', { origin: { kind: 'phone', name: 'Pixel' }, updatedAt: NOW - 5 }),
    // A removed project's conversation: still listed under All.
    thread('e', { projectId: 'proj_removed', cwd: '/w/removed' }),
  ];

  it('scopes to the project, newest first, archived ones apart', () => {
    expect(conversationRows(threads, base, idle).map((r) => r.thread.id)).toEqual(['d', 'a']);
    expect(conversationRows(threads, { ...base, archived: true }, idle).map((r) => r.thread.id)).toEqual(['c']);
    expect(conversationRows(threads, { ...base, scope: 'all' }, idle).map((r) => r.thread.id).sort()).toEqual([
      'a',
      'b',
      'd',
      'e',
    ]);
  });

  it('falls back to the folder until the project is resolved', () => {
    const { projectId: _, ...unresolved } = base;
    expect(conversationRows(threads, unresolved, idle).map((r) => r.thread.id)).toEqual(['d', 'a']);
  });

  it('filters by agent, origin and state', () => {
    expect(conversationRows(threads, { ...base, scope: 'all', agentId: 'claude-code' }, idle).map((r) => r.thread.id)).toEqual(['b']);
    expect(conversationRows(threads, { ...base, origin: 'phone' }, idle).map((r) => r.thread.id)).toEqual(['d']);
    const working = { activityOf: (id: string) => (id === 'a' ? ('working' as const) : ('idle' as const)) };
    expect(conversationRows(threads, { ...base, state: 'working' }, working).map((r) => r.thread.id)).toEqual(['a']);
    const waiting = { activityOf: () => 'waiting' as const };
    expect(conversationRows(threads, { ...base, state: 'needsYou' }, waiting)).toHaveLength(2);
  });

  it('matches titles folding case and accents, and keeps the bridge content hits', () => {
    expect(conversationRows(threads, { ...base, query: 'CANCION' }, idle).map((r) => r.thread.id)).toEqual(['a']);
    const hit: ThreadSearchHit = {
      threadId: 'd',
      titleMatch: false,
      matchCount: 1,
      matches: [{ turnId: 't', role: 'user', snippet: 'about cancion', matchStart: 6, matchLength: 7 }],
    };
    const rows = conversationRows(threads, { ...base, query: 'cancion' }, { ...idle, hits: new Map([['d', hit]]) });
    expect(rows.map((r) => [r.thread.id, r.hit?.threadId])).toEqual([
      ['d', 'd'],
      ['a', undefined],
    ]);
  });
});

describe('ages', () => {
  it('bands by local day and week', () => {
    expect(ageGroupOf(NOW - 60_000, NOW)).toBe('today');
    expect(ageGroupOf(NOW - 2 * DAY, NOW)).toBe('week');
    expect(ageGroupOf(NOW - 20 * DAY, NOW)).toBe('earlier');
    const groups = groupByAge(
      [{ thread: thread('x', { updatedAt: NOW - 20 * DAY }) }, { thread: thread('y', { updatedAt: NOW }) }],
      NOW,
    );
    expect(groups.map((g) => g.group)).toEqual(['today', 'earlier']);
  });

  it('every word of the query must be in the title', () => {
    expect(titleMatches('Plan the release', 'release plan')).toBe(true);
    expect(titleMatches('Plan the release', 'release banana')).toBe(false);
    expect(titleMatches('anything', '   ')).toBe(true);
  });
});

describe('agent sessions', () => {
  const sessions = [
    { agentId: 'codex', sessionId: 'a', title: 'Fix the login', updatedAt: 10 },
    { agentId: 'opencode', sessionId: 'b', updatedAt: 30 },
    { agentId: 'codex', sessionId: 'c', title: 'Plan the release', updatedAt: 20 },
  ];

  it('lists newest first, whatever order they arrive in', () => {
    expect(sessionRows(sessions, { query: '' }).map((s) => s.sessionId)).toEqual(['b', 'c', 'a']);
  });

  it('narrows by agent and by title; an untitled one matches no query', () => {
    expect(sessionRows(sessions, { agentId: 'codex', query: '' }).map((s) => s.sessionId)).toEqual(['c', 'a']);
    expect(sessionRows(sessions, { query: 'release plan' }).map((s) => s.sessionId)).toEqual(['c']);
    expect(sessionRows(sessions, { query: 'untitled' })).toEqual([]);
  });
});
