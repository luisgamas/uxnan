/**
 * Conversation models: Thread, Turn, Message.
 *
 * The Dart equivalents live in `uxnanmobile/lib/domain/entities/{thread,turn,message}.dart`
 * and are kept in sync manually (see 02e-bridge-integration.md §4.2).
 */

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type TurnStatus = 'pending' | 'streaming' | 'completed' | 'error' | 'aborted';

export type ThreadStatus = 'active' | 'idle' | 'archived';

export interface Message {
  id: string;
  turnId: string;
  role: MessageRole;
  /** Serialized MessageContent blocks (text/code/image/tool/diff/...). */
  content: unknown;
  /** The agent's reasoning ("thinking") for this message, when it emitted any. */
  thinking?: string;
  /** Structured content blocks (command_execution/diff/tool) produced this turn. */
  blocks?: unknown[];
  /** Token usage for this turn, so the phone restores the context meter on re-sync. */
  usage?: { tokens: number; contextWindow?: number };
  createdAt: number;
}

export interface Turn {
  id: string;
  threadId: string;
  status: TurnStatus;
  messages: Message[];
  createdAt: number;
  completedAt?: number;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
  /** Agent driving this thread (e.g. `opencode`, `echo`). */
  agentId?: string;
  /** Model the agent uses for this thread (e.g. `provider/model`). */
  model?: string;
  /** Absolute working directory the agent and git operations run in. */
  cwd?: string;
}

export interface ThreadList {
  threads: Thread[];
}

export interface TurnList {
  turns: Turn[];
  nextCursor?: string;
  /**
   * Total number of turns available for the thread, regardless of the page
   * returned. Lets a client page from the end (newest-first) by computing
   * offsets without first pulling the whole thread.
   */
  total?: number;
}
