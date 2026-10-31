// "An agent needs you" for bridge conversations: the moment an agent in a chat
// asks for an approval or a question, say so — once per request — unless the
// person is already looking at that conversation. The same rule the terminal
// agents' hook alerts follow (`agentStatus.notifyChange`), behind the same
// setting: a toast while the window is up, an OS notification when it is not.
//
// A request never closes on a clock (architecture/02a §5.8.16), so this is the
// person's cue that an agent is blocked until they answer — on this desktop or
// on the phone, whichever they reach first. The phone raises its own.

import type { ChatRequestRaised, ChatStore } from '$lib/bridge/chat.svelte';
import type { MessageKey } from '$lib/i18n/locales/en';

/** What deciding an alert needs to know about the app, injected for tests. */
export interface ChatAlertDeps {
  /** The user's switch for agent notifications (`agentNotifications`). */
  enabled(): boolean;
  /** Whether this window has the focus. */
  focused(): boolean;
  /** The thread of the chat tab on screen, if one is. */
  viewingThread(): string | null;
  toast(message: string): void;
  notify(title: string, body: string): void;
  t(key: MessageKey, params?: Record<string, string>): string;
}

/** How one raised request is announced: `null` when it is not. */
export function alertFor(
  store: Pick<ChatStore, 'threads' | 'agents'>,
  raised: ChatRequestRaised,
  deps: ChatAlertDeps,
): { kind: 'toast'; message: string } | { kind: 'notify'; title: string; body: string } | null {
  if (!deps.enabled()) return null;
  const focused = deps.focused();
  // Already looking right at this conversation: the card is in front of them.
  if (focused && deps.viewingThread() === raised.threadId) return null;
  const thread = store.threads.get(raised.threadId);
  const agent =
    store.agents.find((a) => a.agentId === thread?.agentId)?.displayName ?? deps.t('toast.agent');
  if (focused) return { kind: 'toast', message: deps.t('toast.chatNeedsYou', { name: agent }) };
  const title = deps.t(
    raised.kind === 'approval' ? 'notify.chatApprovalTitle' : 'notify.chatQuestionTitle',
    { agent },
  );
  const body = raised.text.trim() || thread?.title || deps.t('notify.agentWaitingBody');
  return { kind: 'notify', title, body };
}

/** Follow every bridge replica (this machine's and each host's) and announce
 *  each request it raises. */
export function startChatAlerts(
  onChatStore: (listener: (store: ChatStore) => void) => () => void,
  deps: ChatAlertDeps,
): () => void {
  const stops: (() => void)[] = [];
  const stopStores = onChatStore((store) => {
    stops.push(
      store.onRequest((raised) => {
        const alert = alertFor(store, raised, deps);
        if (alert?.kind === 'toast') deps.toast(alert.message);
        else if (alert?.kind === 'notify') deps.notify(alert.title, alert.body);
      }),
    );
  });
  return () => {
    stopStores();
    for (const stop of stops) stop();
  };
}
