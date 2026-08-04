/**
 * Naming a conversation.
 *
 * Every agent CLI leaves this to its client — Codex Desktop, the OpenCode TUI
 * and Claude Code's own picker all title conversations themselves; the headless
 * protocols uxnan drives expose no title of their own (verified: threads uxnan
 * creates come back from `codex thread/list` with `name: null`, a fresh
 * OpenCode session stays `"New session - <timestamp>"`, and Claude's session
 * `name` is derived from the folder, not the content). uxnan is the client, so
 * uxnan names them.
 *
 * Two stages, so a conversation is never nameless and never stuck with a weak
 * name:
 *  1. {@link provisionalTitle} — instant, from the opening message. This is the
 *     old behaviour, kept only until something better exists.
 *  2. the agent writes a real one (`IAgentAdapter.generateTitle`) once the first
 *     turn has an answer to summarize.
 *
 * The prompt and the sanitizer live here rather than in each adapter so all
 * seven agents produce titles of the same shape.
 */

/** Longest title we keep. Past this a card just truncates, so it is wasted text. */
export const TITLE_MAX_LENGTH = 72;

/**
 * The title a thread gets the moment it is created: the opening message,
 * collapsed and clipped.
 *
 * Deliberately weak — two conversations that open with the same phrase get the
 * same name, which is exactly why stage 2 exists. It is here so a thread is
 * never blank while the agent works on a turn that may run for minutes.
 */
export function provisionalTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= TITLE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * The instruction handed to the cheap model. Kept short on purpose: it is sent
 * once per conversation and the whole point is that it costs almost nothing.
 *
 * The reply language is the user's, not English — a Spanish conversation with
 * an English title reads like someone else's.
 */
export function buildTitlePrompt(userText: string, assistantText?: string): string {
  const exchange = assistantText?.trim()
    ? `User: ${clip(userText, 600)}\n\nAssistant: ${clip(assistantText, 600)}`
    : `User: ${clip(userText, 900)}`;
  return (
    'Name this conversation in 3 to 6 words, as a short title.\n' +
    'Reply with ONLY the title: no quotes, no trailing period, no preamble, ' +
    'no markdown. Write it in the same language the user used. Name what the ' +
    'conversation is ABOUT, so it stays recognizable next to conversations ' +
    'that opened with a similar phrase.\n\n' +
    `${exchange}`
  );
}

/**
 * Reduce whatever the CLI printed to a bare title, or `undefined` if there is
 * nothing usable in it.
 *
 * A CLI answers with more than the title more often than not — a preamble, the
 * title in quotes, a markdown heading, several lines. Rather than trusting the
 * model to obey, take the first line with content and strip the decoration.
 */
export function sanitizeTitle(raw: string): string | undefined {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;

  let title = firstLine
    // Markdown heading / list marker / block quote.
    .replace(/^[#>\-*\s]+/, '')
    // A wrapping pair of quotes or backticks (straight or curly).
    .replace(/^["'`“”‘’]+/, '')
    .replace(/["'`“”‘’]+$/, '')
    // "Title:" / "Título:" style lead-ins the model adds despite being told not to.
    .replace(/^(?:title|titulo|título)\s*[:\-–]\s*/i, '')
    .trim()
    // A single trailing sentence-ending mark; keep "?" and "!" only if the
    // title really is a question/exclamation, which a period never is.
    .replace(/\.+$/, '')
    .trim();

  if (!title) return undefined;
  // A model that ignored the instruction and wrote a paragraph is not a title.
  // Better to keep the provisional name than to show a wall of text.
  if (title.length > TITLE_MAX_LENGTH * 2) return undefined;
  if (title.length > TITLE_MAX_LENGTH) {
    title = `${title.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
  }
  return title;
}

function clip(text: string, max: number): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}
