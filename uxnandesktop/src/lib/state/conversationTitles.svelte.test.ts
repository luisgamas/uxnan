import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateConversationTitle = vi.fn();
vi.mock('$lib/api', () => ({
  generateConversationTitle: (...args: unknown[]) => generateConversationTitle(...args),
}));

const { conversationTitles } = await import('./conversationTitles.svelte');

const base = {
  tabId: 'tab-1',
  agentId: 'claude',
  userText: 'why is login failing',
  assistantText: 'the token expired',
  cwd: '/repo',
};

describe('conversationTitles', () => {
  beforeEach(() => {
    conversationTitles.reset();
    generateConversationTitle.mockReset();
  });

  it('names a session from its opening exchange', async () => {
    generateConversationTitle.mockResolvedValue('Fix JWT expiry on login');
    await conversationTitles.ensure(base);
    expect(conversationTitles.get('tab-1')).toBe('Fix JWT expiry on login');
    expect(generateConversationTitle).toHaveBeenCalledWith(
      'claude',
      'why is login failing',
      'the token expired',
      '/repo',
    );
  });

  it('names a session once, even across repeated reports', async () => {
    generateConversationTitle.mockResolvedValue('Fix JWT expiry on login');
    await conversationTitles.ensure(base);
    await conversationTitles.ensure(base);
    await conversationTitles.ensure(base);
    // A hook reports `done` on every turn; naming is a first-turn job.
    expect(generateConversationTitle).toHaveBeenCalledTimes(1);
  });

  it('keeps the old label when the agent fails, and does not retry', async () => {
    generateConversationTitle.mockRejectedValue(new Error('no credit'));
    await conversationTitles.ensure(base);
    expect(conversationTitles.get('tab-1')).toBeUndefined();

    generateConversationTitle.mockResolvedValue('Now it works');
    await conversationTitles.ensure(base);
    // Naming is cosmetic — retrying it in a loop would spend real quota.
    expect(generateConversationTitle).toHaveBeenCalledTimes(1);
    expect(conversationTitles.get('tab-1')).toBeUndefined();
  });

  it('ignores an empty or whitespace-only title', async () => {
    generateConversationTitle.mockResolvedValue('   ');
    await conversationTitles.ensure(base);
    expect(conversationTitles.get('tab-1')).toBeUndefined();
  });

  it('does nothing without the pieces it needs', async () => {
    await conversationTitles.ensure({ ...base, userText: '  ' });
    await conversationTitles.ensure({ ...base, tabId: 't2', agentId: '' });
    await conversationTitles.ensure({ ...base, tabId: 't3', cwd: '' });
    expect(generateConversationTitle).not.toHaveBeenCalled();
  });

  it('forgets a closed session so a future one can be named again', async () => {
    generateConversationTitle.mockResolvedValue('First name');
    await conversationTitles.ensure(base);
    conversationTitles.forget('tab-1');
    expect(conversationTitles.get('tab-1')).toBeUndefined();

    generateConversationTitle.mockResolvedValue('Second name');
    await conversationTitles.ensure(base);
    expect(conversationTitles.get('tab-1')).toBe('Second name');
  });
});
