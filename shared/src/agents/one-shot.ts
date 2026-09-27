/**
 * Uxnan's own one-shot prompts: the short headless runs it makes through an
 * agent's CLI to name a conversation or write a commit message or a pull
 * request body. They are errands, not conversations — but a CLI that cannot
 * run without keeping a session (OpenCode, Grok, Zero, Antigravity; Claude
 * Code, Codex and pi run them without one) keeps them in its history like any
 * other session. The session catalog (`agent/sessions`) leaves them out by
 * how they open.
 *
 * Every producer's test checks its prompt opens with one of these, so a
 * reworded prompt cannot leak back into the list: the bridge's
 * (`agents/thread-title.ts`) and the desktop's (`convtitle.rs`, `aicommit.rs`).
 */
export const ONE_SHOT_PROMPT_OPENERS = [
  // Naming a chat (the bridge).
  'Name this conversation in 3 to 6 words',
  // Naming a terminal session (the desktop).
  'Below is an excerpt of a terminal session with a coding agent.',
  // A commit message (the desktop).
  'Write a git commit message for the following staged changes.',
  // A pull request body (the desktop).
  'Write a GitHub pull request description in Markdown',
] as const;

/** Whether a session's first prompt is one of Uxnan's own one-shots. */
export function isOneShotPrompt(prompt: string): boolean {
  const text = prompt.trimStart();
  return ONE_SHOT_PROMPT_OPENERS.some((opener) => text.startsWith(opener));
}
