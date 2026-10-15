/**
 * What an adapter may ask the person while a turn runs — the one shape every
 * adapter hands to the bridge's round-trips (`AgentManager.requestApproval` /
 * `requestQuestion`), whichever surface its CLI asked on (a hook, an ACP
 * request, an app-server request, a stream-json control request, a form).
 */
import type { ApprovalDecision, QuestionItem } from '@uxnan/shared';

/** An action the agent wants the person to allow. */
export interface ApprovalRequestInfo {
  /** The tool as the agent names it (`Bash`, `shell`, `ExitPlanMode`, …). */
  toolName: string;
  /** The tool's input; its command / path becomes the card's detail. */
  input: Record<string, unknown>;
  /**
   * The card's text when "Allow <tool>: <detail>" would not say what is being
   * decided — e.g. "Start implementing this plan" for a plan the agent wants
   * to leave plan mode with. The card then carries no detail line.
   */
  action?: string;
}

/**
 * Routes an approval to the person; resolves with their decision. Aborting
 * [signal] withdraws it (the agent settled it itself, or its turn is gone): it
 * resolves `reject` and every client retires the card.
 */
export type ApprovalRequester = (
  threadId: string,
  info: ApprovalRequestInfo,
  signal?: AbortSignal,
) => Promise<ApprovalDecision>;

/**
 * Routes questions to the person; resolves with one array of answers per
 * question (chosen labels, or the text they typed on a `custom` question),
 * empty when they skipped it — or when [signal] withdraws the questions.
 */
export type QuestionRequester = (
  threadId: string,
  questions: QuestionItem[],
  signal?: AbortSignal,
) => Promise<string[][]>;

/**
 * Answers keyed by their question's text, several labels joined with `, ` — the
 * shape both Claude Code (`AskUserQuestion`'s `answers`) and Grok
 * (`_x.ai/ask_user_question`) take. A question nothing was chosen for is left
 * out; `undefined` when none was answered, so the caller can decline instead
 * of passing nothing.
 */
export function answersByQuestion(
  questions: QuestionItem[],
  answers: string[][],
): Record<string, string> | undefined {
  const byQuestion: Record<string, string> = {};
  questions.forEach((question, index) => {
    const chosen = (answers[index] ?? []).filter((label) => label.length > 0);
    if (chosen.length > 0) byQuestion[question.question] = chosen.join(', ');
  });
  return Object.keys(byQuestion).length > 0 ? byQuestion : undefined;
}
