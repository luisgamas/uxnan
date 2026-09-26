// What can be done to a chat, from anywhere it is listed — the sidebar row's
// menu, the chat's header menu — so every surface offers the same actions in
// the same order, and the dialogs they need (a new name, a confirmed delete)
// are mounted once (`ChatActionDialogs.svelte`) instead of per menu.
//
// The lifecycle, the same on every client because the bridge owns it:
// closing a chat's tab only closes the view (the conversation goes on, on the
// bridge and the phone); **archive** takes it out of every list, restorable;
// **delete** removes it for every device, after a confirmation that says so.

import type { Thread } from '$shared/models/thread';
import { chat } from './chat.svelte';
import { toastError } from '$lib/toast';

export type ChatActionId = 'open' | 'rename' | 'archive' | 'unarchive' | 'delete';

/** The actions a chat offers, in menu order. */
export function chatActionsFor(thread: Pick<Thread, 'status'>): ChatActionId[] {
  return thread.status === 'archived'
    ? ['open', 'unarchive', 'delete']
    : ['open', 'rename', 'archive', 'delete'];
}

class ChatActionUi {
  /** The chat being renamed (the dialog is open while set). */
  renaming = $state<Thread | null>(null);
  /** The chat whose deletion waits for confirmation. */
  deleting = $state<Thread | null>(null);

  /** Run an action; `open` is the caller's (it knows where to open). */
  run(id: ChatActionId, thread: Thread, open: () => void): void {
    switch (id) {
      case 'open':
        open();
        return;
      case 'rename':
        this.renaming = thread;
        return;
      case 'archive':
        void chat.archive(thread.id).catch(toastError);
        return;
      case 'unarchive':
        void chat.unarchive(thread.id).catch(toastError);
        return;
      case 'delete':
        this.deleting = thread;
        return;
    }
  }
}

export const chatActionUi = new ChatActionUi();
