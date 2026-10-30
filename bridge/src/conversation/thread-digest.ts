/**
 * The text-only digest of a conversation's settled turns, and the search that
 * runs over it (architecture/02a §5.8.21).
 *
 * A conversation's weight is in its steps — a real one holds 46 MB in 21 turns,
 * almost all of it commands, outputs and edits — while what a person searches
 * for, and what a continuation carries to another agent, is what was SAID: the
 * person's messages and the agent's replies. So beside each conversation the
 * store keeps `digest.json`: per settled turn, its prompt, its reply's text,
 * the files its edits touched and how many commands it ran — the prose of that
 * 46 MB conversation is a few hundred KB. The store writes a turn's digest
 * entry whenever it writes the turn's file (one writer); search and the
 * continuation's selection only ever read digests, never a turn.
 *
 * A conversation stored before digests existed gets its digest built the first
 * time one is needed, one turn at a time, and kept.
 */
import {
  THREAD_SEARCH_MAX_MATCHES,
  inlineAttachmentsPlainText,
  type ThreadSearchMatch,
} from '@uxnan/shared';

/** Most characters of one message a digest keeps (the start of it). */
export const DIGEST_TEXT_MAX_CHARS = 32_000;

/** Most file names one turn's digest keeps. */
export const DIGEST_MAX_FILES = 50;

/** One settled turn, as its digest keeps it. */
export interface TurnDigest {
  /** `Turn.seq`, when it has one. */
  seq?: number;
  /** When the turn started (epoch ms, the bridge's clock). */
  at: number;
  /** What the person said (the prompt as stored; at most {@link DIGEST_TEXT_MAX_CHARS}). */
  u: string;
  /** What the agent said: the reply's text runs (at most {@link DIGEST_TEXT_MAX_CHARS}). */
  a: string;
  /** Files the turn's edits touched, in first-touched order. */
  files?: string[];
  /** How many shell commands the turn ran. */
  commands?: number;
}

/** A turn's digest with the turn it belongs to. */
export interface DigestEntry extends TurnDigest {
  turnId: string;
}

/** What `digest.json` holds. */
export interface ThreadDigestFile {
  v: 1;
  turns: Record<string, TurnDigest>;
}

/** The stored message shape a digest is taken from. */
export interface DigestibleMessage {
  role: string;
  text: string;
  segments?: readonly unknown[];
  /** A user message's images and files, in the order of the markers in its text. */
  attachments?: readonly { name?: string }[];
}

/** The digest of one turn's messages. */
export function digestOfTurn(
  turn: { seq?: number; createdAt: number },
  messages: readonly DigestibleMessage[],
): TurnDigest {
  const user: string[] = [];
  const reply: string[] = [];
  const files: string[] = [];
  let commands = 0;
  for (const message of messages) {
    // Each attachment as `[name]` where it sat: a transferred conversation's
    // context and a search read words, never the raw U+FFFC marker.
    if (message.role === 'user') {
      user.push(
        inlineAttachmentsPlainText(
          message.text,
          (message.attachments ?? []).map((a) => a.name),
        ),
      );
    }
    if (message.role !== 'assistant') continue;
    reply.push(message.text);
    for (const segment of message.segments ?? []) {
      const block = segment as { type?: unknown; filename?: unknown } | null;
      if (block === null || typeof block !== 'object') continue;
      if (block.type === 'command_execution') commands += 1;
      if (
        block.type === 'diff' &&
        typeof block.filename === 'string' &&
        block.filename.length > 0 &&
        files.length < DIGEST_MAX_FILES &&
        !files.includes(block.filename)
      ) {
        files.push(block.filename);
      }
    }
  }
  return {
    ...(turn.seq !== undefined ? { seq: turn.seq } : {}),
    at: turn.createdAt,
    u: user.join('\n').slice(0, DIGEST_TEXT_MAX_CHARS),
    a: reply.join('').slice(0, DIGEST_TEXT_MAX_CHARS),
    ...(files.length > 0 ? { files } : {}),
    ...(commands > 0 ? { commands } : {}),
  };
}

/** Parses a `digest.json`; anything unreadable is no digest. */
export function parseDigest(text: string | null): ThreadDigestFile | undefined {
  if (text === null) return undefined;
  try {
    const parsed = JSON.parse(text) as Partial<ThreadDigestFile>;
    if (parsed?.v !== 1 || parsed.turns === null || typeof parsed.turns !== 'object') {
      return undefined;
    }
    return { v: 1, turns: parsed.turns as Record<string, TurnDigest> };
  } catch {
    return undefined;
  }
}

/**
 * Folds [text] for matching: lower case, accents dropped (`Canción` and
 * `cancion` match), every run of whitespace one space. Whole-string operations,
 * so folding a conversation's whole digest stays cheap.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ');
}

/**
 * [text] folded like {@link fold}, character by character, with, for each
 * folded character, the index of the original one it came from — so a match
 * found in folded text is cut out of the original for its snippet. Stops once
 * [limit] folded characters are made (a snippet needs only the start).
 */
export function foldedWithMap(text: string, limit = Infinity): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < text.length && folded.length < limit; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      if (code === 32 || (code >= 9 && code <= 13)) {
        if (!space) {
          folded += ' ';
          map.push(i);
        }
        space = true;
        continue;
      }
      space = false;
      folded += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i]!;
      map.push(i);
      continue;
    }
    const ch = text[i]!;
    if (/\s/u.test(ch)) {
      if (!space) {
        folded += ' ';
        map.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    for (const unit of fold(ch)) {
      folded += unit;
      map.push(i);
    }
  }
  return { folded, map };
}

/** The words of a query, folded; empty words dropped, duplicates once. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      fold(query)
        .split(' ')
        .filter((t) => t.length > 0),
    ),
  ];
}

/** Whether every term is in [folded]. */
export function matchesAll(folded: string, terms: readonly string[]): boolean {
  return terms.every((term) => folded.includes(term));
}

/** How far around a match a snippet reaches, in characters. */
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 100;

/**
 * The snippet of [text] around the first occurrence of [terms]'s first term
 * (whichever appears earliest), on one line, with where the match sits in it.
 */
export function snippetOf(
  text: string,
  terms: readonly string[],
): { snippet: string; matchStart: number; matchLength: number } {
  // A match far into a long reply is found by the full fold; the map is made
  // only as far as needed to place it.
  const whole = fold(text);
  let reach = 0;
  for (const t of terms) {
    const i = whole.indexOf(t);
    if (i >= 0) reach = Math.max(reach, i + t.length);
  }
  const { folded, map } = foldedWithMap(text, reach + 1);
  let at = -1;
  let term = '';
  for (const t of terms) {
    const i = folded.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      term = t;
    }
  }
  if (at < 0)
    return { snippet: oneLine(text.slice(0, SNIPPET_AFTER)), matchStart: 0, matchLength: 0 };
  const start = map[at]!;
  const end = (map[at + term.length - 1] ?? start) + 1;
  const from = Math.max(0, start - SNIPPET_BEFORE);
  const to = Math.min(text.length, end + SNIPPET_AFTER);
  const lead = from > 0 ? '…' : '';
  const before = oneLine(text.slice(from, start));
  const match = oneLine(text.slice(start, end));
  const after = oneLine(text.slice(end, to));
  return {
    snippet: `${lead}${before}${match}${after}${to < text.length ? '…' : ''}`,
    matchStart: lead.length + before.length,
    matchLength: match.length,
  };
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ');
}

/** One turn's digest ready to search: its text folded once. */
export interface SearchableTurn {
  turnId: string;
  digest: TurnDigest;
  user: string;
  reply: string;
}

/** A digest's turns ready to search, newest first. */
export function searchableTurns(entries: readonly DigestEntry[]): SearchableTurn[] {
  return entries
    .map((entry) => ({
      turnId: entry.turnId,
      digest: entry,
      user: fold(entry.u),
      reply: fold(entry.a),
    }))
    .sort((a, b) => (b.digest.seq ?? 0) - (a.digest.seq ?? 0) || b.digest.at - a.digest.at);
}

/** The messages of [turns] where every term appears, newest first. */
export function searchTurns(
  turns: readonly SearchableTurn[],
  terms: readonly string[],
): { matches: ThreadSearchMatch[]; matchCount: number } {
  const matches: ThreadSearchMatch[] = [];
  let matchCount = 0;
  for (const turn of turns) {
    for (const role of ['assistant', 'user'] as const) {
      const folded = role === 'user' ? turn.user : turn.reply;
      if (folded.length === 0 || !matchesAll(folded, terms)) continue;
      matchCount += 1;
      if (matches.length >= THREAD_SEARCH_MAX_MATCHES) continue;
      const text = role === 'user' ? turn.digest.u : turn.digest.a;
      matches.push({
        turnId: turn.turnId,
        ...(turn.digest.seq !== undefined ? { seq: turn.digest.seq } : {}),
        role,
        ...snippetOf(text, terms),
      });
    }
  }
  return { matches, matchCount };
}

/** Bytes a searchable conversation holds in memory, roughly (two copies of its text). */
export function searchableBytes(turns: readonly SearchableTurn[]): number {
  let bytes = 0;
  for (const turn of turns) bytes += 2 * (turn.digest.u.length + turn.digest.a.length) + 64;
  return bytes;
}
