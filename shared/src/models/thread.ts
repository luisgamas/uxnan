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
}

export interface ThreadList {
  threads: Thread[];
}

export interface TurnList {
  turns: Turn[];
  nextCursor?: string;
}
