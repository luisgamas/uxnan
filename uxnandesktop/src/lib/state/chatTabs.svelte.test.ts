/**
 * Chat tabs in the tab model: a chat is a pointer to a bridge thread, so what
 * the layout keeps across a restart is that pointer — and one thread is shown
 * in one tab, not a pile of twins.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeBackend } from '../../test/tauri';
import { terminals, tabDisplayTitle, GLOBAL_WORKSPACE, type ChatTab } from '$lib/state/terminals.svelte';
import { chat } from '$lib/bridge/chat.svelte';

function chatTabs(): ChatTab[] {
  return [...terminals.tabsWithWorkspace()]
    .map(({ tab }) => tab)
    .filter((tab): tab is ChatTab => tab.kind === 'chat');
}

beforeEach(() => {
  installFakeBackend();
  terminals.root = null;
  terminals.setWorkspace(GLOBAL_WORKSPACE);
});

describe('chat tabs', () => {
  it('opens a new chat in a folder, with the launcher’s agent preselected', () => {
    const id = terminals.openChat({ cwd: '/repo', agentId: 'codex' });
    const tab = chatTabs().find((t) => t.id === id);
    expect(tab).toMatchObject({ kind: 'chat', cwd: '/repo', agentId: 'codex' });
    expect(tab?.threadId).toBeUndefined();
  });

  it('focuses the tab already showing a thread instead of opening a twin', () => {
    const first = terminals.openChat({ cwd: '/repo', threadId: 'th-1' });
    terminals.openFile('/repo/README.md', '/repo');
    const again = terminals.openChat({ cwd: '/repo', threadId: 'th-1' });
    expect(again).toBe(first);
    expect(chatTabs().filter((t) => t.threadId === 'th-1')).toHaveLength(1);
  });

  it('binds the thread its first message started, and keeps it across a restart', () => {
    const id = terminals.openChat({ cwd: '/repo' });
    terminals.bindChatThread(id, 'th-2');
    const saved = terminals.serialize();
    expect(JSON.stringify(saved)).toContain('"kind":"chat"');
    terminals.root = null;
    terminals.restore(saved, {});
    const restored = chatTabs();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ kind: 'chat', cwd: '/repo', threadId: 'th-2' });
  });

  it('is titled by its bridge thread, which every client renames alike', () => {
    const id = terminals.openChat({ cwd: '/repo', threadId: 'th-3' });
    const tab = chatTabs().find((t) => t.id === id)!;
    chat.apply({
      method: 'stream/thread/updated',
      params: {
        thread: {
          id: 'th-3',
          projectId: 'p',
          title: 'Renamed on the phone',
          status: 'active',
          turnCount: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    });
    expect(tabDisplayTitle(tab)).toBe('Renamed on the phone');
  });
});
