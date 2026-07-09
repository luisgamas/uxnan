/**
 * Interactive question contracts.
 *
 * An agent that needs the user to CHOOSE among options (not just approve/reject
 * an action) emits a `question` content block (on `stream/content/block`); the
 * phone renders an interactive picker and replies via `turn/send { questionResponse }`.
 * The bridge routes the chosen answers back to the agent adapter. This mirrors
 * the {@link ApprovalResponse} flow but carries multiple-choice answers instead
 * of a binary decision.
 *
 * Source: architecture/02a-system-architecture.md §6.2.
 */

/** One selectable option of a {@link QuestionItem}. */
export interface QuestionOption {
  /** Display text the user picks (also the value echoed back as the answer). */
  label: string;
  /** Optional one-line explanation of what choosing this option means. */
  description?: string;
}

/** A single question with its options. */
export interface QuestionItem {
  /** The full question text. */
  question: string;
  /** Optional short label/category for the question. */
  header?: string;
  /** The choices the user may pick from. */
  options: QuestionOption[];
  /** Whether more than one option may be selected (defaults to single-select). */
  multiple?: boolean;
}

/**
 * Payload of a `question` content block. The phone decodes this into its
 * interactive question card. `questionId` is the bridge handle the user echoes
 * back in {@link QuestionResponse.questionId}.
 */
export interface QuestionRequestBlock {
  type: 'question';
  /** Bridge id the phone echoes back in `questionResponse.questionId`. */
  questionId: string;
  /** The questions to ask (usually one; an agent may batch a few). */
  questions: QuestionItem[];
}

/**
 * The user's reply to a pending question, carried on `turn/send`. `answers` is
 * one entry per question (in order), each an array of the chosen option
 * `label`s (one for single-select, several for a `multiple` question, empty when
 * the user skipped that question).
 */
export interface QuestionResponse {
  /** The id from the question request the user is answering. */
  questionId: string;
  /** Chosen option labels, per question, in question order. */
  answers: string[][];
}
