// Per-worktree cache of each live Zero agent's current conversation (title +
// coarse status), polled from the backend `zero_session` command.
//
// Zero reports no hook and sets no terminal-title OSC, so — unlike the other
// agents whose state flows through `agentStatus` — the only way to learn its
// conversation title is to read its on-disk session (keyed by the worktree cwd).
// The poll runs only while at least one Zero agent is open and pauses itself
// otherwise; the agent view calls `ensurePolling()` when it detects a Zero agent.

import { zeroSession } from '$lib/api';
import { terminals, type TerminalTab } from './terminals.svelte';
import type { ZeroSession } from '$lib/types';
import { conversationTitles } from './conversationTitles.svelte';
import { readInstanceText } from '$lib/terminal/instances';

const POLL_MS = 4000;

/** Whether a terminal tab is the Zero agent (by command or logo key). */
export function isZeroAgent(tab: TerminalTab): boolean {
  return tab.agentCommand === 'zero' || tab.agentIcon === 'zero';
}

class ZeroSessionStore {
  /** Cached session per worktree cwd (workspace key). */
  private byCwd = $state<Record<string, ZeroSession | null>>({});
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  /** The cached Zero session for a worktree cwd, or null. Reactive. */
  get(cwd: string): ZeroSession | null {
    return this.byCwd[cwd] ?? null;
  }

  /** Start the poll loop if it isn't running. Idempotent; the loop stops itself
   *  once no Zero agents remain, so the agent view can call this freely. */
  ensurePolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollOnce(), POLL_MS);
    void this.pollOnce();
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Worktree cwds (workspace keys) that currently host a Zero agent. */
  private zeroCwds(): string[] {
    const out: string[] = [];
    for (const key of terminals.openWorkspaceKeys) {
      if (!key) continue; // skip the Global scratch space
      if (terminals.agentTabs(key).some(isZeroAgent)) out.push(key);
    }
    return out;
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return;
    const cwds = this.zeroCwds();
    if (cwds.length === 0) {
      this.stop(); // nothing to watch — idle until a Zero agent reappears
      return;
    }
    this.polling = true;
    try {
      const next: Record<string, ZeroSession | null> = {};
      for (const cwd of cwds) {
        try {
          next[cwd] = await zeroSession(cwd);
        } catch {
          next[cwd] = this.byCwd[cwd] ?? null; // keep the last good value on error
        }
      }
      this.byCwd = next;
      this.nameFinishedSessions(next);
    } finally {
      this.polling = false;
    }
  }

  /**
   * Name a Zero conversation once its session goes quiet.
   *
   * Zero has no hook, so the status-driven naming path never sees it — and its
   * on-disk title is the literal placeholder `"ACP session"` that Zero writes
   * itself (`internal/acp/agent.go`), which is why the card kept snapping back
   * to it. Naming from the terminal here gives Zero the same treatment every
   * other agent gets; `conversationTitles` still only ever tries once per tab.
   */
  private nameFinishedSessions(sessions: Record<string, ZeroSession | null>): void {
    for (const [cwd, session] of Object.entries(sessions)) {
      if (!session || session.status === 'working') continue;
      for (const tab of terminals.agentTabs(cwd)) {
        if (!isZeroAgent(tab) || tab.kind !== 'terminal') continue;
        const transcript = readInstanceText(tab.id);
        if (!transcript || transcript.trim().length < 80) continue;
        void conversationTitles.ensure({
          tabId: tab.id,
          agentId: 'zero',
          transcript,
          cwd,
        });
      }
    }
  }
}

/** Singleton Zero-session cache shared by the agent view. */
export const zeroSessions = new ZeroSessionStore();
