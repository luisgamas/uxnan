/**
 * What a continuation carries over to its agent (architecture/02a §5.8.21):
 * built by the bridge — the owner of the history — from the source
 * conversation's digests ({@link TurnDigest}), deterministically and within a
 * budget. Never an agent-written summary: no model runs, nothing is invented,
 * and the person can read exactly what the agent got (`thread/transferContext`).
 *
 * - `selection` (also what a `fork`'s agent gets): the opening request, then
 *   from the newest exchange backwards each one whole while they fit in three
 *   quarters of the budget, every older one shortened to
 *   {@link TRANSFER_PIECE_MAX_CHARS} per message, until
 *   {@link TRANSFER_CONTEXT_MAX_BYTES}; the files the conversation's edits
 *   touched; and how many older turns were left out.
 * - `reference`: the source's title, its opening request and its last exchange,
 *   shortened — a pointer, for an agent that should start fresh.
 *
 * The message the person sends with it is never part of the budget and never
 * shortened: it follows the context whole ({@link withTransferContext}).
 */
import {
  TRANSFER_CONTEXT_MAX_BYTES,
  TRANSFER_PIECE_MAX_CHARS,
  utf8Length,
  type TransferContextSummary,
  type TransferStrategy,
} from '@uxnan/shared';
import type { TurnDigest } from './thread-digest.js';

/** Most file names the context lists. */
const CONTEXT_MAX_FILES = 40;

/** The share of a selection's budget its whole (unshortened) exchanges may take. */
const WHOLE_SHARE = 0.75;

/** Most characters of the opening request a selection keeps whole. */
const OPENING_MAX_CHARS = 2_000;

/** The marks that open and close the carried-over context in the first message. */
export const TRANSFER_CONTEXT_OPEN = '[Context carried over from another conversation]';
export const TRANSFER_CONTEXT_CLOSE = '[End of carried-over context]';

/** What the context is built from. */
export interface TransferSource {
  threadId: string;
  title: string;
  /** The source's agent, by name (e.g. `Codex`), when it had one. */
  agentName?: string;
  /** The folder it ran in. */
  cwd?: string;
  /** Its settled turns' digests, oldest first. */
  turns: readonly TurnDigest[];
}

export interface TransferContext {
  text: string;
  summary: TransferContextSummary;
}

/** The context [strategy] carries from [source]. `fork` carries a `selection`. */
export function buildTransferContext(
  source: TransferSource,
  strategy: TransferStrategy,
  maxBytes: number = TRANSFER_CONTEXT_MAX_BYTES,
): TransferContext {
  return strategy === 'reference' ? reference(source) : selection(source, maxBytes);
}

/** The first message's text: the context, then the person's words, whole. */
export function withTransferContext(context: string, message: string): string {
  return message.length > 0 ? `${context}\n\n${message}` : context;
}

function header(source: TransferSource, lead: string): string {
  const facts = [
    source.agentName ? `agent: ${source.agentName}` : undefined,
    source.cwd ? `folder: ${source.cwd}` : undefined,
    `${source.turns.length} ${source.turns.length === 1 ? 'turn' : 'turns'}`,
  ].filter((f): f is string => f !== undefined);
  return [
    TRANSFER_CONTEXT_OPEN,
    `This conversation continues the Uxnan conversation "${oneLine(source.title)}" (${facts.join(', ')}). ${lead}`,
  ].join('\n');
}

function reference(source: TransferSource): TransferContext {
  const first = source.turns[0];
  const last = source.turns[source.turns.length - 1];
  const lines = [
    header(
      source,
      'Only a pointer to it is included here, not its history: start from what the person asks next.',
    ),
  ];
  if (first && first.u.trim().length > 0) lines.push('', `It began with: ${shorten(first.u)}`);
  if (last && last !== first) {
    lines.push('', 'Its last exchange:');
    if (last.u.trim().length > 0) lines.push(`User: ${shorten(last.u)}`);
    if (last.a.trim().length > 0) lines.push(`Assistant: ${shorten(last.a)}`);
  }
  lines.push(TRANSFER_CONTEXT_CLOSE);
  const text = lines.join('\n');
  return { text, summary: summaryOf(text, last && last !== first ? 2 : first ? 1 : 0, source) };
}

function selection(source: TransferSource, maxBytes: number): TransferContext {
  const turns = source.turns;
  const head = header(
    source,
    'What follows is a selection of it made by Uxnan — the newest exchanges in full, older ones shortened, the oldest left out — not the whole conversation.',
  );
  const opening = turns[0];
  const openingBlock =
    opening && opening.u.trim().length > 0
      ? `\nThe conversation began with this request:\n${clip(opening.u.trim(), OPENING_MAX_CHARS)}\n`
      : '';
  const files = changedFiles(turns);
  const filesBlock = files.length > 0 ? `\nFiles its edits changed: ${files.join(', ')}\n` : '';
  // Reserve what always goes: the frame, the opening, the files, the footer.
  const footerFor = (omitted: number) =>
    omitted > 0
      ? `\n${omitted} earlier ${omitted === 1 ? 'turn was' : 'turns were'} left out; the whole conversation stays in Uxnan as "${oneLine(source.title)}".\n${TRANSFER_CONTEXT_CLOSE}`
      : `\n${TRANSFER_CONTEXT_CLOSE}`;
  const reserved =
    utf8Length(head) +
    utf8Length(openingBlock) +
    utf8Length(filesBlock) +
    utf8Length(footerFor(turns.length)) +
    utf8Length('\nThe exchanges, oldest first:\n');
  let budget = maxBytes - reserved;
  // Whole exchanges take at most this share of it, so older ones still show,
  // shortened, instead of a few long replies crowding every earlier turn out.
  let wholeBudget = Math.floor(budget * WHOLE_SHARE);
  let shortening = false;
  const taken: string[] = [];
  let index = turns.length - 1;
  for (; index >= 0; index--) {
    const turn = turns[index]!;
    const label = `### Turn ${turn.seq ?? index + 1}`;
    if (!shortening) {
      const whole = renderTurn(label, turn.u, turn.a, (t) => t.trim());
      const wholeBytes = utf8Length(whole) + 1;
      if (wholeBytes <= budget && wholeBytes <= wholeBudget) {
        taken.push(whole);
        budget -= wholeBytes;
        wholeBudget -= wholeBytes;
        continue;
      }
      // From here back, every exchange is shortened: newest whole, older short.
      shortening = true;
    }
    const short = renderTurn(label, turn.u, turn.a, shorten);
    const shortBytes = utf8Length(short) + 1;
    if (shortBytes > budget) break;
    taken.push(short);
    budget -= shortBytes;
  }
  const omitted = index + 1;
  taken.reverse();
  const text = [
    head,
    // The opening request is there for when its turn was left out.
    omitted > 0 ? openingBlock : '',
    taken.length > 0 ? `\nThe exchanges, oldest first:\n${taken.join('\n')}` : '',
    filesBlock,
    footerFor(omitted),
  ]
    .join('')
    .replace(/\n{3,}/gu, '\n\n');
  return { text, summary: summaryOf(text, taken.length, source, omitted) };
}

function renderTurn(
  label: string,
  user: string,
  reply: string,
  shape: (text: string) => string,
): string {
  const lines = [label];
  if (user.trim().length > 0) lines.push(`User: ${shape(user)}`);
  if (reply.trim().length > 0) lines.push(`Assistant: ${shape(reply)}`);
  return lines.join('\n');
}

/** Every file the conversation's edits touched, newest first, at most {@link CONTEXT_MAX_FILES}. */
function changedFiles(turns: readonly TurnDigest[]): string[] {
  const files: string[] = [];
  for (let i = turns.length - 1; i >= 0 && files.length < CONTEXT_MAX_FILES; i--) {
    for (const file of turns[i]!.files ?? []) {
      if (files.length >= CONTEXT_MAX_FILES) break;
      if (!files.includes(file)) files.push(file);
    }
  }
  return files;
}

function summaryOf(
  text: string,
  included: number,
  source: TransferSource,
  omitted = Math.max(0, source.turns.length - included),
): TransferContextSummary {
  const bytes = utf8Length(text);
  return { turns: included, omittedTurns: omitted, bytes, approxTokens: Math.ceil(bytes / 4) };
}

/** [text] on one line, at most {@link TRANSFER_PIECE_MAX_CHARS} characters. */
function shorten(text: string): string {
  return clip(oneLine(text).trim(), TRANSFER_PIECE_MAX_CHARS);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  // Never split a surrogate pair.
  let end = max - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ');
}
