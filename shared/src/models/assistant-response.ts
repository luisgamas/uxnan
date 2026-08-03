/** The role an assistant response item plays inside one agent turn. */
export type AssistantResponsePhase = 'commentary' | 'final_answer' | 'unknown';

/**
 * Durable boundary between assistant response items produced during one turn.
 *
 * Some agent protocols (notably Codex app-server) emit multiple distinct
 * assistant messages before the terminal answer. The prose remains ordinary
 * `text` segments; this zero-text metadata block preserves the item boundary so
 * clients can collapse earlier responses without deleting or flattening them.
 */
export interface AssistantResponseBoundaryBlock {
  type: 'assistant_response_boundary';
  phase?: AssistantResponsePhase;
  /** Native item/message id, when the agent protocol exposes one. */
  itemId?: string;
}
