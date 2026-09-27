/**
 * Agent sessions: the conversations an agent CLI keeps on the PC, whoever
 * started them — a terminal, the bridge, the agent's own app — and whether one
 * is open in a terminal right now (architecture/02a §5.8.19).
 *
 * The bridge owns both: it lists each agent's sessions through that agent's
 * own surface (`agent/sessions`), and it knows which ones a desktop
 * terminal holds (`agent/hold`), so every client — phone, desktop — can
 * pick a session up, and none of them ever writes into a session a terminal is
 * running.
 *
 * Across devices every time is an age (`…AgoMs`), never a timestamp.
 */
import type { AgentId } from '../agents/agent-capabilities.js';

/** One of an agent's sessions in a folder, as `agent/sessions` returns it. */
export interface AgentSessionSummary {
  agentId: AgentId;
  /** The agent's own session id — the one its CLI resumes. */
  sessionId: string;
  /** The folder the session runs in. */
  cwd: string;
  /**
   * The session's name: the CLI's own title when it keeps one, else the
   * first thing the person asked, trimmed. Absent when neither is known.
   */
  title?: string;
  /** How long ago the session last changed. */
  updatedAgoMs: number;
  /** The conversation that continues this session, when one does. */
  threadId?: string;
  /** Where the session is open right now, when a terminal holds it. */
  hold?: AgentSessionHold;
}

/** Who holds a session: a terminal of Uxnan Desktop, on the named PC. */
export interface AgentSessionHolder {
  kind: 'terminal';
  /** The PC's name, as the bridge's shared settings call it. */
  name: string;
}

/**
 * A session open in a desktop terminal. While it is held, the bridge runs no
 * turn in it: a CLI's session has one writer, and the terminal is it.
 */
export interface AgentSessionHold {
  agentId: AgentId;
  sessionId: string;
  cwd?: string;
  holder: AgentSessionHolder;
  /** How long ago the terminal took it. */
  heldAgoMs: number;
  /** Whether the agent is working right now; a hand-off waits until it is not. */
  busy: boolean;
  /** The conversation that continues this session, when one does. */
  threadId?: string;
}

/** Which session: an agent and its session id. */
export interface AgentSessionKey {
  agentId: AgentId;
  sessionId: string;
}

export interface AgentSessionListParams {
  /** The folder whose sessions to list. */
  cwd: string;
  /** Only this agent's sessions; every agent's when absent. */
  agentId?: AgentId;
}

export interface AgentSessionListResult {
  /** Most recently changed first. */
  sessions: AgentSessionSummary[];
  /**
   * Agents installed here whose CLI cannot list its sessions (Antigravity):
   * one of their sessions can still be continued from the terminal it runs in.
   */
  unlisted: AgentId[];
}

/**
 * `agent/hold` — Uxnan Desktop says one of its terminals has this
 * session open (or that its agent started or stopped working). Idempotent:
 * the latest call wins. Accepted only over the local control channel, and
 * dropped when that connection closes (the terminals close with the app).
 */
export interface AgentSessionHoldParams extends AgentSessionKey {
  cwd?: string;
  busy?: boolean;
}

export interface AgentSessionHoldsResult {
  holds: AgentSessionHold[];
}

/**
 * How asking a terminal to let go of a session ended:
 * - `released`: the agent was closed in its terminal; the session is free.
 * - `busy`: the agent is working; ask again when it is done.
 * - `declined`: the person at the PC kept it.
 * - `unreachable`: the desktop did not answer in time.
 * - `notHeld`: no terminal holds it; it is free already.
 */
export type AgentSessionHandoffOutcome =
  | 'released'
  | 'busy'
  | 'declined'
  | 'unreachable'
  | 'notHeld';

export interface AgentSessionHandoffResult {
  outcome: AgentSessionHandoffOutcome;
}

/** `stream/agent/handoffRequested` — sent only to the holding desktop. */
export interface AgentSessionHandoffRequestedParams extends AgentSessionKey {
  /** Answer with `agent/handoffAnswer` quoting this id. */
  requestId: string;
  /** Who asks: the client's name (a phone's, or the PC's). */
  from: string;
}

/** `agent/handoffAnswer` — the holding desktop's answer. */
export interface AgentSessionHandoffAnswerParams {
  requestId: string;
  outcome: Extract<AgentSessionHandoffOutcome, 'released' | 'busy' | 'declined'>;
}

/**
 * `stream/agent/held` — a session's hold changed: taken, busy or idle,
 * or let go (`hold` absent). Every client follows it; one that missed some
 * asks `agent/holds`.
 */
export interface AgentSessionHeldParams extends AgentSessionKey {
  hold?: AgentSessionHold;
}
