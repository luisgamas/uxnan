import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateConversationTitle = vi.fn();
vi.mock('$lib/api', () => ({
  generateConversationTitle: (...args: unknown[]) => generateConversationTitle(...args),
}));

const { conversationTitles } = await import('./conversationTitles.svelte');

const base = {
  tabId: 'tab-1',
  agentId: 'claude',
  transcript: '> why is login failing\nagent: the token expired at 5 minutes',
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
    expect(generateConversationTitle).toHaveBeenCalledWith('claude', base.transcript, '/repo');
  });

  it('names a session once, even across repeated reports', async () => {
    generateConversationTitle.mockResolvedValue('Fix JWT expiry on login');
    await conversationTitles.ensure(base);
    await conversationTitles.ensure(base);
    await conversationTitles.ensure(base);
    // A hook reports `done` on every turn; naming is a first-turn job.
    expect(generateConversationTitle).toHaveBeenCalledTimes(1);
  });

  it('survives one transient failure, because a blip should not cost the name', async () => {
    generateConversationTitle.mockRejectedValueOnce(new Error('CLI busy'));
    await conversationTitles.ensure(base);
    expect(conversationTitles.get('tab-1')).toBeUndefined();

    // The next `done` gets one more go — a lock held by the interactive session
    // or a slow cold start used to cost the session its name permanently.
    generateConversationTitle.mockResolvedValue('Fix JWT expiry on login');
    await conversationTitles.ensure(base);
    expect(conversationTitles.get('tab-1')).toBe('Fix JWT expiry on login');
  });

  it('gives up after the second failure rather than burning quota', async () => {
    generateConversationTitle.mockRejectedValue(new Error('no credit'));
    await conversationTitles.ensure(base);
    await conversationTitles.ensure(base);
    await conversationTitles.ensure(base);
    await conversationTitles.ensure(base);
    expect(generateConversationTitle).toHaveBeenCalledTimes(2);
    expect(conversationTitles.get('tab-1')).toBeUndefined();
  });

  it('never re-names a session that already has a name', async () => {
    generateConversationTitle.mockResolvedValue('First name');
    await conversationTitles.ensure(base);
    generateConversationTitle.mockResolvedValue('Second name');
    await conversationTitles.ensure(base);
    expect(conversationTitles.get('tab-1')).toBe('First name');
    expect(generateConversationTitle).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty or whitespace-only title', async () => {
    generateConversationTitle.mockResolvedValue('   ');
    await conversationTitles.ensure(base);
    expect(conversationTitles.get('tab-1')).toBeUndefined();
  });

  it('does nothing without the pieces it needs', async () => {
    await conversationTitles.ensure({ ...base, transcript: '  ' });
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
