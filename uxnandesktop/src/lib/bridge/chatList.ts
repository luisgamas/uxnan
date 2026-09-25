// Which of a folder's bridge conversations the sidebar lists under it — pure,
// so the rule is tested without a DOM.
//
// A folder can hold a long history (the phone's included), and the sidebar is
// for what matters now: every conversation open in a tab or doing something
// (working, waiting on you, finished unseen) is always listed, then the most
// recent others fill up to a small cap. Archived ones are never listed.

import type { Thread } from '$shared/models/thread';
import type { ChatActivity } from './activity.svelte';

/** Most rows a folder lists (conversations that are open or active count, and
 *  are shown even past it). */
export const SIDEBAR_CHAT_LIMIT = 4;

export function sidebarChats(
  threads: readonly Thread[],
  opts: {
    /** Threads open in a tab. */
    open: ReadonlySet<string>;
    activityOf: (threadId: string) => ChatActivity;
    limit?: number;
  },
): Thread[] {
  const limit = opts.limit ?? SIDEBAR_CHAT_LIMIT;
  const live = threads
    .filter((t) => t.status !== 'archived')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = live.filter((t) => opts.open.has(t.id) || opts.activityOf(t.id) !== 'idle');
  const rest = live.filter((t) => !pinned.includes(t));
  const fill = rest.slice(0, Math.max(0, limit - pinned.length));
  const shown = new Set([...pinned, ...fill]);
  // Keep one recency order across both kinds.
  return live.filter((t) => shown.has(t));
}
