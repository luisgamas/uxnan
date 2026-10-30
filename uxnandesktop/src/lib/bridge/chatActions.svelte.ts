// What can be done to a chat, from anywhere it is listed — the sidebar row's
// menu, the chat's header menu — so every surface offers the same actions in
// the same order, and the dialogs they need (a new name, a confirmed delete)
// are mounted once (`ChatActionDialogs.svelte`) instead of per menu.
//
// The lifecycle, the same on every client because the bridge owns it:
// closing a chat's tab only closes the view (the conversation goes on, on the
// bridge and the phone); **archive** takes it out of every list, restorable;
// **delete** removes it for every device, after a confirmation that says so.
// **fork** and **continue with another agent** make a NEW conversation that
// carries this one's context (architecture/02a §5.8.21); this one stays as it
// is and names its continuation.

import type { Thread } from '$shared/models/thread';
import { chatOfThread } from './chat.svelte';
import { toastError } from '$lib/toast';
import { terminals } from '$lib/state/terminals.svelte';

export type ChatActionId =
  | 'open'
  | 'rename'
  | 'fork'
  | 'transfer'
  | 'info'
  | 'archive'
  | 'unarchive'
  | 'delete';

/** The actions a chat offers, in menu order. `fork` and `transfer` continue it
 *  as a new conversation (architecture/02a §5.8.21); `info` shows its session. */
export function chatActionsFor(thread: Pick<Thread, 'status'>): ChatActionId[] {
  return thread.status === 'archived'
    ? ['open', 'info', 'unarchive', 'delete']
    : ['open', 'rename', 'fork', 'transfer', 'info', 'archive', 'delete'];
}


class ChatActionUi {
  /** The chat being renamed (the dialog is open while set). */
  renaming = $state<Thread | null>(null);
  /** The chat whose deletion waits for confirmation. */
  deleting = $state<Thread | null>(null);
  /** The chat being continued with another agent (the dialog is open while set). */
  transferring = $state<Thread | null>(null);
  /** The chat whose session details are shown. */
  inspecting = $state<Thread | null>(null);
  /** Open a continuation the bridge just made (a fork, the transfer dialog):
   *  a chat tab showing it, in its folder, on the machine that holds it. */
  openContinuation(thread: Thread): void {
    terminals.openChat({
      cwd: thread.cwd ?? '',
      target: chatOfThread(thread.id).target,
      threadId: thread.id,
    });
  }

  /**
   * Reopen a continuation in a terminal once its context reached the agent
   * (the transfer dialog's "In a terminal"): the bridge delivers it with the
   * first message, after which the agent's own session holds it and resumes
   * there (`agentResume.ts`). Watches the replica — no extra request — and
   * gives up after [timeoutMs] or once the turn ended without delivering.
   */
  async openInTerminalOnceDelivered(
    threadId: string,
    sessions: { openInTerminal(thread: Thread): boolean },
    timeoutMs = 15 * 60_000,
  ): Promise<boolean> {
    const chat = chatOfThread(threadId);
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const thread = chat.threads.get(threadId);
      if (!thread) return false;
      const status = thread.transfer?.status;
      if (status === 'delivered' && thread.agentSessionId && chat.activity.of(threadId) !== 'working') {
        return sessions.openInTerminal(thread);
      }
      // Back to waiting: the turn ended before the agent answered.
      if (status === 'pending' && thread.transfer?.turnId === undefined && thread.turnCount > 0) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  /** Run an action; `open` is the caller's (it knows where to open). */
  run(id: ChatActionId, thread: Thread, open: () => void): void {
    switch (id) {
      case 'open':
        open();
        return;
      case 'rename':
        this.renaming = thread;
        return;
      case 'fork':
        void chatOfThread(thread.id)
          .fork(thread.id)
          .then((fork) => this.openContinuation(fork))
          .catch(toastError);
        return;
      case 'transfer':
        this.transferring = thread;
        return;
      case 'info':
        this.inspecting = thread;
        return;
      case 'archive':
        void chatOfThread(thread.id).archive(thread.id).catch(toastError);
        return;
      case 'unarchive':
        void chatOfThread(thread.id).unarchive(thread.id).catch(toastError);
        return;
      case 'delete':
        this.deleting = thread;
        return;
    }
  }
}

export const chatActionUi = new ChatActionUi();
