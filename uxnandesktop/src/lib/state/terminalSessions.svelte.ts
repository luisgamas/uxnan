// The desktop's terminals as the writers of their agents' sessions
// (architecture/02a §5.8.19).
//
// A CLI's session has one writer. When a terminal tab runs an agent, the tab is
// it — so this tells the bridge which sessions the tabs hold (and whether each
// agent is working), which keeps every other client, this window's chats and
// the phone included, from writing into them. It is also where a session
// changes hands:
//
// - **Terminal → chat.** "Continue as chat" on a tab, or someone asking for the
//   session from elsewhere (`stream/agent/handoffRequested`): the agent
//   is closed in its terminal — never while it works, never by typing into it
//   (`pty_stop_agent`) — the hold is let go, and a conversation continues the
//   session (the bridge resumes it and brings its history in).
// - **Chat → terminal.** "Open in terminal": the agent reopens the session in a
//   new tab (`app.launchAgent` with `resume`), which then holds it.
//
// The bridge is the owner; the tabs' state (`terminals`, `agentStatus`) is the
// only input here, and the bridge the only thing written to.

import { invoke } from '@tauri-apps/api/core';
import { untrack } from 'svelte';
import type { Thread } from '$shared/models/thread';
import type {
  AgentSessionHandoffAnswerParams,
  AgentSessionHandoffRequestedParams,
  AgentSessionHoldsResult,
} from '$shared/models/agent-session';
import { bridge, bridges, type BridgeClientStore } from '$lib/bridge/client.svelte';
import { chat, chatFor, sessionKey, type ChatStore } from '$lib/bridge/chat.svelte';
import { bridgeAgentForCommand, hookAgentForBridgeAgent } from '$lib/bridge/agents';
import { resumeInvocation } from '$lib/agentResume';
import { toast } from '$lib/toast';
import { i18n } from '$lib/i18n';
import { terminals, type GroupTab, type TerminalTab } from './terminals.svelte';
import { resolveAgentDisplay } from './agentDisplay';
import { ptyRunning } from '$lib/terminal/instances';
import { app } from './app.svelte';
import { isLocalTarget, LOCAL_TARGET, type TargetId } from '$lib/target';

/** A session one of the tabs holds, as the bridge is told. */
export interface HeldSession {
  agentId: string;
  sessionId: string;
  cwd?: string;
  /** Whether its agent is working right now (a hand-off waits for it). */
  busy: boolean;
  tabId: string;
}

/** How `pty_stop_agent` ended. */
type StopOutcome = 'notRunning' | 'exited' | 'killed';

/**
 * The session a tab holds, or `null`: a live local terminal, its shell
 * running, whose agent — one the bridge drives — reported a session it has
 * written (a `pending` id is one nothing was said to yet, so there is nothing
 * to protect). A tab restored from the saved layout keeps its session's `live`
 * flag but runs nothing until its workspace is shown, so it holds nothing
 * until then. Only a terminal on `machine` counts: a host's terminals hold
 * sessions on that host's own bridge, never this machine's (`02g` §5.18).
 */
export function heldSessionOf(
  tab: GroupTab,
  running: (tabId: string) => boolean = ptyRunning,
  machine: TargetId = LOCAL_TARGET,
): HeldSession | null {
  if (tab.kind !== 'terminal' || tab.exited || tab.asleep || !onMachine(tab, machine)) return null;
  if (!running(tab.id)) return null;
  const session = tab.agentSession;
  if (!session || session.pending || session.live === false) return null;
  const agentId = bridgeAgentForCommand(session.agent);
  if (!agentId) return null;
  return {
    agentId,
    sessionId: session.id,
    ...(tab.cwd ? { cwd: tab.cwd } : {}),
    busy: resolveAgentDisplay(tab)?.status === 'working',
    tabId: tab.id,
  };
}

/** Whether a terminal runs on `machine` (absent target = this machine). */
function onMachine(tab: TerminalTab, machine: TargetId): boolean {
  return ((tab.target as TargetId | undefined) ?? LOCAL_TARGET) === machine;
}

/** What `hold` sends, compared to know whether to send it again. */
function signature(held: HeldSession): string {
  return `${held.cwd ?? ''}|${held.busy}`;
}

/** What the terminals' side needs from the rest of the app — injected so a
 *  test can drive it without a bridge or a PTY. */
export interface TerminalSessionsDeps {
  client?: BridgeClientStore;
  chatStore?: ChatStore;
  /** Close the agent a terminal runs (`pty_stop_agent`). */
  stopAgent?: (tabId: string) => Promise<unknown>;
  /** Whether a terminal's shell is running. */
  ptyRunning?: (tabId: string) => boolean;
  /** The machine whose terminals and bridge these are; this one by default. */
  machine?: TargetId;
}

export class TerminalSessions {
  /** What the bridge was last told, by session key. */
  readonly #sent = new Map<string, HeldSession>();
  readonly #client: BridgeClientStore;
  readonly #chat: ChatStore;
  readonly #stopAgent: (tabId: string) => Promise<unknown>;
  readonly #ptyRunning: (tabId: string) => boolean;
  /** The machine whose terminals these are (`02g` §5.18). */
  readonly machine: TargetId;
  #started = false;

  constructor(deps: TerminalSessionsDeps = {}) {
    this.machine = deps.machine ?? LOCAL_TARGET;
    this.#client = deps.client ?? bridge;
    this.#chat = deps.chatStore ?? chat;
    this.#stopAgent = deps.stopAgent ?? ((id) => invoke<StopOutcome>('pty_stop_agent', { id }));
    this.#ptyRunning = deps.ptyRunning ?? ptyRunning;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    $effect.root(() => {
      $effect(() => {
        const wanted = this.held();
        untrack(() => void this.#report(wanted));
      });
    });
    // The bridge drops a desktop's holds with its connection: say them again.
    this.#client.onConnected(() => {
      this.#sent.clear();
      void this.#report(this.held());
      void this.#converge();
    });
    void this.#converge();
    this.#client.onNotification((n) => {
      if (n.method === 'stream/agent/handoffRequested') {
        void this.#onHandoffRequested(n.params as AgentSessionHandoffRequestedParams);
      }
    });
    // This machine's instance also stands one up for each host bridge as it
    // appears, so a host's terminals tell their own bridge what they hold.
    if (isLocalTarget(this.machine)) {
      bridges.onHostStore((client) => {
        if (hostSessions.has(client.target)) return;
        const sessions = new TerminalSessions({
          client,
          chatStore: chatFor(client.target),
          machine: client.target,
          stopAgent: this.#stopAgent,
          ptyRunning: this.#ptyRunning,
        });
        hostSessions.set(client.target, sessions);
        sessions.start();
      });
    }
  }

  /** Every session the tabs hold now, by session key. Reactive. */
  held(): Map<string, HeldSession> {
    const out = new Map<string, HeldSession>();
    for (const { tab } of terminals.tabsWithWorkspace()) {
      const held = heldSessionOf(tab, this.#ptyRunning, this.machine);
      if (held) out.set(sessionKey(held.agentId, held.sessionId), held);
    }
    return out;
  }

  /** Tell the bridge what changed since it was last told. */
  async #report(wanted: Map<string, HeldSession>): Promise<void> {
    if (!this.#client.connected) return;
    for (const [key, held] of wanted) {
      const sent = this.#sent.get(key);
      if (sent && signature(sent) === signature(held)) continue;
      this.#sent.set(key, held);
      try {
        await this.#client.call('agent/hold', {
          agentId: held.agentId,
          sessionId: held.sessionId,
          ...(held.cwd ? { cwd: held.cwd } : {}),
          busy: held.busy,
        });
      } catch {
        // Said again on the next change or reconnect.
        this.#sent.delete(key);
      }
    }
    for (const [key, sent] of [...this.#sent]) {
      if (wanted.has(key)) continue;
      this.#sent.delete(key);
      await this.#release(sent);
    }
  }

  /**
   * Let go of what the bridge still keeps for this desktop that no tab holds
   * now. The bridge keeps a desktop's holds for as long as its connection
   * lives, and that connection outlives a reload of this window, which forgets
   * what it had said. A release only ever ends the caller's own hold, so the
   * holds of another desktop are left alone.
   */
  async #converge(): Promise<void> {
    if (!this.#client.connected) return;
    let holds: AgentSessionHoldsResult['holds'];
    try {
      ({ holds } = await this.#client.call<AgentSessionHoldsResult>('agent/holds', {}));
    } catch {
      return;
    }
    const wanted = untrack(() => this.held());
    for (const hold of holds) {
      const key = sessionKey(hold.agentId, hold.sessionId);
      if (hold.holder.kind !== 'terminal' || wanted.has(key) || this.#sent.has(key)) continue;
      await this.#release(hold);
    }
  }

  async #release(held: { agentId: string; sessionId: string }): Promise<void> {
    try {
      await this.#client.call('agent/release', {
        agentId: held.agentId,
        sessionId: held.sessionId,
      });
    } catch {
      /* the bridge drops it with the connection anyway */
    }
  }

  /** Close a tab's agent and let its session go. Resolves once both are done. */
  async #letGo(held: HeldSession): Promise<void> {
    await this.#stopAgent(held.tabId);
    // An observed exit: the tab keeps its session, but no longer holds it.
    terminals.noteAgentLiveness(held.tabId, false);
    this.#sent.delete(sessionKey(held.agentId, held.sessionId));
    await this.#release(held);
  }

  /** Whether "Continue as chat" is on offer for a tab, and why not otherwise. */
  continueAsChatState(tab: GroupTab): 'ready' | 'busy' | 'unavailable' {
    if (!this.#client.connected) return 'unavailable';
    const held = heldSessionOf(tab, this.#ptyRunning, this.machine);
    if (held) return held.busy ? 'busy' : 'ready';
    // An agent nothing runs any more still left its session to continue.
    return this.#exitedSession(tab) ? 'ready' : 'unavailable';
  }

  /** The session a tab's agent left there, when nothing runs it: the agent
   *  exited, or the tab was restored and its shell is not running yet. */
  #exitedSession(tab: GroupTab): { agentId: string; sessionId: string; cwd: string } | null {
    if (tab.kind !== 'terminal' || !onMachine(tab, this.machine) || !tab.cwd) return null;
    const session = tab.agentSession;
    if (!session || session.pending) return null;
    if (session.live !== false && this.#ptyRunning(tab.id)) return null;
    const agentId = bridgeAgentForCommand(session.agent);
    return agentId ? { agentId, sessionId: session.id, cwd: tab.cwd } : null;
  }

  /**
   * Continue a tab's agent session as a chat: close the agent there (once it
   * is not working), then open the conversation that continues the session —
   * here, and on the phone.
   */
  async continueAsChat(tabId: string): Promise<void> {
    const tab = terminals.findTab(tabId);
    if (!tab || tab.kind !== 'terminal') return;
    const held = heldSessionOf(tab, this.#ptyRunning, this.machine);
    const session = held ?? this.#exitedSession(tab);
    if (!session || !tab.cwd) return;
    if (held?.busy) {
      toast(i18n.t('sessions.stillWorking'));
      return;
    }
    if (held) await this.#letGo(held);
    const thread = await this.#chat.startThread({
      cwd: tab.cwd,
      agentId: session.agentId,
      agentSessionId: session.sessionId,
      title: tabTitle(tab),
    });
    terminals.openChat({
      cwd: tab.cwd,
      target: this.machine,
      threadId: thread.id,
      workspace: terminals.workspaceOfTab(tabId),
    });
  }

  /** Someone asked for a session one of the tabs holds. */
  async #onHandoffRequested(request: AgentSessionHandoffRequestedParams): Promise<void> {
    const held = untrack(() => this.held()).get(sessionKey(request.agentId, request.sessionId));
    const answer = async (outcome: AgentSessionHandoffAnswerParams['outcome']): Promise<void> => {
      await this.#client
        .call('agent/handoffAnswer', { requestId: request.requestId, outcome })
        .catch(() => undefined);
    };
    // Not held here any more: it is free, which is what was asked.
    if (!held) return answer('released');
    if (held.busy) return answer('busy');
    try {
      await this.#letGo(held);
    } catch {
      // The agent could not be closed and still runs there: the terminal keeps
      // the session, and the asker may try again.
      return answer('busy');
    }
    await answer('released');
    toast(i18n.t('sessions.continuedOn', { name: request.from }));
  }

  /** Whether a chat can reopen its session in a terminal, and why not otherwise. */
  openInTerminalState(thread: Thread | undefined): 'ready' | 'working' | 'unavailable' {
    if (!thread?.agentSessionId || !thread.cwd) return 'unavailable';
    const agent = hookAgentForBridgeAgent(thread.agentId);
    if (!agent || !resumeInvocation({ agent, id: thread.agentSessionId, capturedAt: 0 })) {
      return 'unavailable';
    }
    if (this.#chat.holdOf(thread)) return 'unavailable';
    const activity = this.#chat.activity.of(thread.id);
    return activity === 'working' || activity === 'waiting' ? 'working' : 'ready';
  }

  /**
   * Reopen a chat's session in a terminal, with the agent's own profile (its
   * shell, arguments and environment). The new tab holds the session from its
   * first report; the chat shows it as open in that terminal until it exits,
   * and what happened there comes back into the conversation.
   */
  openInTerminal(thread: Thread): boolean {
    const agent = hookAgentForBridgeAgent(thread.agentId);
    if (!agent || !thread.agentSessionId || !thread.cwd) return false;
    const session = { agent, id: thread.agentSessionId, capturedAt: Math.floor(Date.now() / 1000) };
    const invocation = resumeInvocation(session);
    // The agent as it is launched on this machine — a host's own CLI there.
    const command = invocation?.command.trim().toLowerCase();
    const profile = command
      ? app.launchableAgentsOn(this.machine).find((a) => a.command.trim().toLowerCase() === command)
      : undefined;
    if (!profile) {
      toast(i18n.t('sessions.noProfile', { command: invocation?.command ?? agent }));
      return false;
    }
    const cwd = thread.cwd;
    const workspace = [...terminals.tabsWithWorkspace()].find(
      ({ tab }) => tab.kind === 'chat' && tab.threadId === thread.id,
    )?.workspace;
    return (
      app.launchAgent(profile, {
        cwd,
        ...(workspace !== undefined ? { workspace } : {}),
        ...(isLocalTarget(this.machine) ? {} : { target: this.machine }),
        title: thread.title,
        resume: session,
      }) !== null
    );
  }
}

/** A name for the conversation from the tab: what the person named it, else
 *  what the agent's session is called on the tab. */
function tabTitle(tab: TerminalTab): string | undefined {
  return tab.customTitle?.trim() || tab.title?.trim() || undefined;
}

export const terminalSessions = new TerminalSessions();

/** One per host bridge, stood up by this machine's instance. */
const hostSessions = new Map<string, TerminalSessions>();

/** The sessions of the machine `target` names — this one's by default. */
export function terminalSessionsFor(target: TargetId | string | null | undefined): TerminalSessions {
  const t = (target ?? LOCAL_TARGET) as TargetId;
  return isLocalTarget(t) ? terminalSessions : (hostSessions.get(t) ?? terminalSessions);
}
