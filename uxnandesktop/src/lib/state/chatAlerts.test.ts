/**
 * "An agent needs you" for bridge chats: when it is announced, and how.
 */

import { describe, expect, it } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import type { Thread } from '$shared/models/thread';
import type { AgentDescriptor } from '$shared/agents/agent-capabilities';
import type { ChatRequestRaised, ChatStore } from '$lib/bridge/chat.svelte';
import { alertFor, startChatAlerts, type ChatAlertDeps } from './chatAlerts';

const raised: ChatRequestRaised = {
  threadId: 't1',
  requestId: 'ap',
  kind: 'approval',
  text: 'Allow Bash: ls',
};

function store(): Pick<ChatStore, 'threads' | 'agents'> {
  const threads = new SvelteMap<string, Thread>();
  threads.set('t1', { id: 't1', title: 'Fix the build', agentId: 'codex' } as Thread);
  return { threads, agents: [{ agentId: 'codex', displayName: 'Codex' } as AgentDescriptor] };
}

function deps(over: Partial<ChatAlertDeps> = {}): ChatAlertDeps {
  return {
    enabled: () => true,
    focused: () => false,
    viewingThread: () => null,
    toast: () => {},
    notify: () => {},
    t: (key, params) => `${key}${params ? JSON.stringify(params) : ''}`,
    ...over,
  };
}

describe('alertFor', () => {
  it('raises an OS notification naming the agent and what it asks, when the window is away', () => {
    expect(alertFor(store(), raised, deps())).toEqual({
      kind: 'notify',
      title: 'notify.chatApprovalTitle{"agent":"Codex"}',
      body: 'Allow Bash: ls',
    });
    expect(alertFor(store(), { ...raised, kind: 'question', text: '' }, deps())).toEqual({
      kind: 'notify',
      title: 'notify.chatQuestionTitle{"agent":"Codex"}',
      body: 'Fix the build',
    });
  });

  it('only toasts while the window is up, and says nothing about the chat on screen', () => {
    expect(alertFor(store(), raised, deps({ focused: () => true }))).toEqual({
      kind: 'toast',
      message: 'toast.chatNeedsYou{"name":"Codex"}',
    });
    expect(
      alertFor(store(), raised, deps({ focused: () => true, viewingThread: () => 't1' })),
    ).toBeNull();
    // Looking at it in a window that lost the focus is not looking at it.
    expect(alertFor(store(), raised, deps({ viewingThread: () => 't1' }))?.kind).toBe('notify');
  });

  it('respects the agent notifications switch', () => {
    expect(alertFor(store(), raised, deps({ enabled: () => false }))).toBeNull();
  });
});

describe('startChatAlerts', () => {
  it('follows every replica and stops with its handle', () => {
    const listeners: ((r: ChatRequestRaised) => void)[] = [];
    const fake = {
      ...store(),
      onRequest: (l: (r: ChatRequestRaised) => void) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      },
    } as unknown as ChatStore;
    const sent: string[] = [];
    const stop = startChatAlerts(
      (listener) => {
        listener(fake);
        return () => {};
      },
      deps({ notify: (title) => sent.push(title) }),
    );
    listeners[0]?.(raised);
    expect(sent).toEqual(['notify.chatApprovalTitle{"agent":"Codex"}']);
    stop();
    expect(listeners).toHaveLength(0);
  });
});
