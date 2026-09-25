// Which of a folder's bridge conversations the sidebar lists under it — pure,
// so the rule is tested without a DOM.
//
// A folder can hold a long history (the phone's included), and the sidebar is
// for what matters now — like a terminal agent, a chat is listed while it is
// open in a tab, or while it needs attention (working, waiting on you, failed,
// finished and not yet seen). Closing its tab takes it off the list until then;
// the history lives in the new-chat screen's "Continue a conversation" and in
// the launcher. Archived ones are never listed.

import type { Thread } from '$shared/models/thread';
import type { ChatActivity } from './activity.svelte';

export function sidebarChats(
  threads: readonly Thread[],
  opts: {
    /** Threads open in a tab. */
    open: ReadonlySet<string>;
    activityOf: (threadId: string) => ChatActivity;
  },
): Thread[] {
  return threads
    .filter((t) => t.status !== 'archived')
    .filter((t) => opts.open.has(t.id) || opts.activityOf(t.id) !== 'idle')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
