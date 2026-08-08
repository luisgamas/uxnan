import { beforeEach, describe, expect, it, vi } from 'vitest';

// The monitor only ever touches a tab through the terminals store, so a stub of
// `findTab` is the whole surface it needs — no layout, no PTY.
const tab = { id: 'tab-1', kind: 'terminal' as const, exited: false, working: false };

vi.mock('./terminals.svelte', () => ({
  terminals: {
    findTab: (id: string) => (id === tab.id ? tab : undefined),
    tabsWithWorkspace: () => [{ tab, workspace: '/repo' }],
  },
}));
vi.mock('./app.svelte', () => ({ app: { resolveAgent: () => ({ name: 'x', icon: null }) } }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

const { agentMonitor } = await import('./agentMonitor.svelte');

describe('agentMonitor output inference', () => {
  beforeEach(() => {
    tab.working = false;
    tab.exited = false;
    vi.useRealTimers();
  });

  it('does not call a single burst of output "working"', () => {
    // What a click inside a TUI produces: the terminal answers the mouse event
    // by redrawing, in one burst, and then goes quiet. Treating that as work lit
    // the working dot every time the user so much as looked at the terminal.
    vi.useFakeTimers();
    agentMonitor.noteOutput(tab.id);
    vi.advanceTimersByTime(50);
    agentMonitor.noteOutput(tab.id); // same redraw, a few chunks
    expect(tab.working).toBe(false);
  });

  it('calls output that keeps coming "working"', () => {
    // What a thinking agent produces: a spinner/stream that is still arriving
    // well after it started.
    vi.useFakeTimers();
    agentMonitor.noteOutput(tab.id);
    vi.advanceTimersByTime(600);
    agentMonitor.noteOutput(tab.id);
    expect(tab.working).toBe(true);
  });

  it('judges a later burst on its own, not on an old run', () => {
    // A click now and another click a minute later must not add up to "work"
    // just because the first one started the clock.
    vi.useFakeTimers();
    agentMonitor.noteOutput(tab.id);
    vi.advanceTimersByTime(60_000);
    agentMonitor.noteOutput(tab.id);
    expect(tab.working).toBe(false);
  });
});
