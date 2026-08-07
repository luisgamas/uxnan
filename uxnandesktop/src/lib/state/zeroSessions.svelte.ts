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

/**
 * How far before a Zero tab was first seen a session may still be its own.
 *
 * Covers the gap between the TUI starting and the tab being recognized as
 * Zero's, and the case of the ADE restarting around a live session. Anything
 * older is a previous conversation in that folder, not this one.
 */
const SESSION_GRACE_MS = 60_000;

class ZeroSessionStore {
  /** Cached session per worktree cwd (workspace key). */
  private byCwd = $state<Record<string, ZeroSession | null>>({});
  /** When each Zero tab was first seen (epoch ms), so a session that predates it
   *  is not mistaken for its own. Non-reactive; read only alongside `byCwd`. */
  private tabSince = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  /** The cached Zero session for a worktree cwd, or null. Reactive. */
  get(cwd: string): ZeroSession | null {
    return this.byCwd[cwd] ?? null;
  }

  /**
   * The Zero session that belongs to **this tab**, or null.
   *
   * Zero keeps every past conversation of a folder, and the reader picks the
   * newest one there — which, the moment you open Zero, is normally the last
   * turn you finished in that worktree. Showing it put a "Done" check on a
   * session that had not been asked anything yet. A session older than the tab
   * is therefore not this tab's: the card stays neutral until the agent writes
   * something of its own (which a live session does within seconds).
   */
  forTab(tabId: string, cwd: string): ZeroSession | null {
    const session = this.byCwd[cwd] ?? null;
    if (!session) return null;
    const since = this.tabSince.get(tabId);
    if (since === undefined) return session;
    const updated = Date.parse(session.updatedAt);
    if (Number.isNaN(updated)) return session;
    return updated >= since - SESSION_GRACE_MS ? session : null;
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

  /** Worktree cwds (workspace keys) that currently host a Zero agent. Also
   *  stamps each Zero tab the first time it is seen (see [`forTab`]) and forgets
   *  the ones that closed, so the map can't grow with the session. */
  private zeroCwds(): string[] {
    const out: string[] = [];
    const live = new Set<string>();
    for (const key of terminals.openWorkspaceKeys) {
      if (!key) continue; // skip the Global scratch space
      const zeroTabs = terminals.agentTabs(key).filter(isZeroAgent);
      for (const tab of zeroTabs) {
        live.add(tab.id);
        if (!this.tabSince.has(tab.id)) this.tabSince.set(tab.id, Date.now());
      }
      if (zeroTabs.length > 0) out.push(key);
    }
    for (const id of this.tabSince.keys()) {
      if (!live.has(id)) this.tabSince.delete(id);
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
