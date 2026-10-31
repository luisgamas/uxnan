// What the Conversations tab lists — pure, so the rules are tested without a
// DOM (architecture/02a §5.8.21). Every conversation the bridge has is in the
// replica; this narrows it by scope and filters, matches titles at once (the
// bridge answers what was SAID, `thread/search`), and groups it by age.

import type { Thread } from '$shared/models/thread';
import type { ThreadSearchHit } from '$shared/models/thread';
import type { ChatActivity } from './activity.svelte';

/** What the tab lists: the bridge's conversations, or the agents' own sessions
 *  in the folder that no conversation continues (§5.8.19). */
export type ConversationsView = 'chats' | 'sessions';

/** Which conversations: the folder's project, or every one the bridge has. */
export type ConversationScope = 'project' | 'all';

/** The state filter: a conversation's activity, folded to what a person asks. */
export type ConversationStateFilter = 'any' | 'working' | 'needsYou' | 'failed' | 'idle';

export type ConversationOriginFilter = 'any' | 'phone' | 'desktop';

export interface ConversationFilters {
  scope: ConversationScope;
  /** The scope's project, when known (`project/resolve` of the folder). */
  projectId?: string;
  /** The folder the tab was opened from: the scope until its project is known. */
  cwd: string;
  agentId?: string;
  state: ConversationStateFilter;
  origin: ConversationOriginFilter;
  archived: boolean;
  /** Text typed in the search field. */
  query: string;
}

/** Age bands the list groups by, newest first. */
export type AgeGroup = 'today' | 'week' | 'earlier';

export interface ConversationRow {
  thread: Thread;
  /** The bridge's match for it in what was said, when there is one. */
  hit?: ThreadSearchHit;
}

/** Lower case, accents dropped, whitespace folded — as the bridge folds a search. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Whether every word of [query] is in [title]. */
export function titleMatches(title: string, query: string): boolean {
  const words = foldText(query).split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return true;
  const folded = foldText(title);
  return words.every((w) => folded.includes(w));
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function stateOf(activity: ChatActivity): ConversationStateFilter {
  switch (activity) {
    case 'working':
      return 'working';
    case 'waiting':
      return 'needsYou';
    case 'blocked':
      return 'failed';
    default:
      return 'idle';
  }
}

/**
 * The rows the tab lists, newest first: in scope, past every filter, and —
 * with a query — whose title matches or that the bridge found by content.
 */
export function conversationRows(
  threads: readonly Thread[],
  filters: ConversationFilters,
  opts: {
    activityOf: (threadId: string) => ChatActivity;
    /** The bridge's content hits for the current query, by thread. */
    hits?: ReadonlyMap<string, ThreadSearchHit>;
  },
): ConversationRow[] {
  const folder = normalize(filters.cwd);
  const query = filters.query.trim();
  const rows: ConversationRow[] = [];
  for (const thread of threads) {
    if ((thread.status === 'archived') !== filters.archived) continue;
    if (filters.scope === 'project') {
      const inProject =
        filters.projectId !== undefined
          ? thread.projectId === filters.projectId
          : thread.cwd !== undefined && normalize(thread.cwd) === folder;
      if (!inProject) continue;
    }
    if (filters.agentId !== undefined && thread.agentId !== filters.agentId) continue;
    if (filters.origin !== 'any' && thread.origin?.kind !== filters.origin) continue;
    if (filters.state !== 'any' && stateOf(opts.activityOf(thread.id)) !== filters.state) continue;
    const hit = opts.hits?.get(thread.id);
    if (query.length > 0 && !titleMatches(thread.title, query) && hit === undefined) continue;
    rows.push(hit ? { thread, hit } : { thread });
  }
  return rows.sort((a, b) => b.thread.updatedAt - a.thread.updatedAt);
}

/** Which age band [at] falls in, against [now] (local midnight; the week = 7 days). */
export function ageGroupOf(at: number, now: number): AgeGroup {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (at >= midnight.getTime()) return 'today';
  if (at >= midnight.getTime() - 6 * 24 * 60 * 60 * 1000) return 'week';
  return 'earlier';
}

/** [rows] grouped by age, bands in order, empty ones left out. */
export function groupByAge(
  rows: readonly ConversationRow[],
  now: number,
): { group: AgeGroup; rows: ConversationRow[] }[] {
  const order: AgeGroup[] = ['today', 'week', 'earlier'];
  const bands = new Map<AgeGroup, ConversationRow[]>();
  for (const row of rows) {
    const group = ageGroupOf(row.thread.updatedAt, now);
    let band = bands.get(group);
    if (!band) bands.set(group, (band = []));
    band.push(row);
  }
  return order.filter((g) => bands.has(g)).map((group) => ({ group, rows: bands.get(group)! }));
}

/**
 * The agent sessions the tab lists, newest first: an agent's when one is
 * picked, and — with a query — those whose title matches. A session with no
 * title (its CLI keeps none and nothing was asked yet) is never matched by a
 * query: there is nothing to match.
 */
export function sessionRows<T extends { agentId: string; title?: string; updatedAt: number }>(
  sessions: readonly T[],
  filters: { agentId?: string; query: string },
): T[] {
  const query = filters.query.trim();
  return sessions
    .filter((s) => filters.agentId === undefined || s.agentId === filters.agentId)
    .filter((s) => query.length === 0 || (s.title !== undefined && titleMatches(s.title, query)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
