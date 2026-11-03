/**
 * Reading an agent's JSONL transcript as it grows, without reading it again.
 *
 * A transcript is appended to and never rewritten, and the history of a
 * thread being driven somewhere else (a terminal, another app) is read again
 * each time it grows — a 90 MB Claude Code transcript cost ~270 ms and a few
 * hundred megabytes of heap per read, every two seconds. A {@link TranscriptTails}
 * keeps, per file, how far it got and the parser's own state at that point, so
 * the next read parses only the bytes written since. The answer is the same as
 * parsing the whole file again:
 *
 * - a parser carries across reads exactly what it carried across lines (a tool
 *   call waiting for its result, reasoning waiting for its reply);
 * - only whole lines are decoded, so a character split between two reads is
 *   never mangled; a last line without its newline counts once it is valid
 *   JSON — which a strict prefix of one JSON object never is;
 * - a file that is no longer the one that was read — another inode, shorter,
 *   or different where it was already read (its first bytes, and the bytes
 *   just before where reading stopped) — is read from the start;
 * - what a caller gets back is a copy: nothing it keeps, stores or mutates is
 *   the parser's own state;
 * - reads of one file are taken one at a time, and only the last few files are
 *   remembered.
 */

import { open, type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';

/** Folds a transcript's records, one line at a time, into messages. */
export interface TranscriptParser<M> {
  /** One parsed line. */
  feed(record: Record<string, unknown>): void;
  /** What the lines fed so far amount to, as if the file ended here. */
  messages(): M[];
}

/** Files whose read position is remembered; the least recently read go first. */
export const TAIL_CACHE_FILES = 8;
/** How much of a file's start is compared to tell it is the same file. */
const HEAD_CHECK_BYTES = 4096;
/** How much just before the read position is compared, likewise. */
const MARK_CHECK_BYTES = 256;
/** How much is read at a time. */
const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

interface Tail<M> {
  dev: number;
  ino: number;
  /** Bytes consumed: every whole line before it was fed. */
  offset: number;
  /** Bytes of a line not finished yet (no newline, not valid JSON). */
  partial: Buffer;
  /** The file's first bytes, and the bytes just before `offset`, when read. */
  head: Buffer;
  mark: Buffer;
  parser: TranscriptParser<M>;
}

export class TranscriptTails {
  readonly #tails = new Map<string, Tail<unknown>>();
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #capacity: number;

  constructor(capacity = TAIL_CACHE_FILES) {
    this.#capacity = capacity;
  }

  /**
   * The messages `file` holds, parsed by a parser `make` builds. `kind` names
   * the parser, so one file read two ways keeps two positions. `null` when the
   * file cannot be read.
   */
  read<M>(file: string, kind: string, make: () => TranscriptParser<M>): Promise<M[] | null> {
    const key = `${kind}\u0000${file}`;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const next = previous.then(
      () => this.#read(key, file, make),
      () => this.#read(key, file, make),
    );
    const settled = next.catch(() => undefined);
    this.#queues.set(key, settled);
    void settled.then(() => {
      if (this.#queues.get(key) === settled) this.#queues.delete(key);
    });
    return next;
  }

  async #read<M>(key: string, file: string, make: () => TranscriptParser<M>): Promise<M[] | null> {
    let fh: FileHandle;
    try {
      fh = await open(file, 'r');
    } catch {
      return null;
    }
    try {
      const info = await fh.stat();
      let tail = this.#tails.get(key) as Tail<M> | undefined;
      if (tail !== undefined && !(await sameFile(fh, tail, info))) tail = undefined;
      tail ??= {
        dev: info.dev,
        ino: info.ino,
        offset: 0,
        partial: Buffer.alloc(0),
        head: Buffer.alloc(0),
        mark: Buffer.alloc(0),
        parser: make(),
      };
      // Out of the cache while it is being advanced: a failure part-way must
      // not leave a half-fed parser behind for the next read.
      this.#tails.delete(key);
      await consume(fh, tail, info.size);
      this.#remember(key, tail as Tail<unknown>);
      return structuredClone(tail.parser.messages());
    } finally {
      await fh.close();
    }
  }

  #remember(key: string, tail: Tail<unknown>): void {
    this.#tails.set(key, tail);
    while (this.#tails.size > this.#capacity) {
      const oldest = this.#tails.keys().next().value;
      if (oldest === undefined) break;
      this.#tails.delete(oldest);
    }
  }
}

/** Whether the open file is still the one `tail` read, only longer (or equal). */
async function sameFile<M>(fh: FileHandle, tail: Tail<M>, info: Stats): Promise<boolean> {
  if (info.dev !== tail.dev || info.ino !== tail.ino || info.size < tail.offset) return false;
  const head = await readAt(fh, 0, tail.head.length);
  if (!head.equals(tail.head)) return false;
  const mark = await readAt(fh, tail.offset - tail.mark.length, tail.mark.length);
  return mark.equals(tail.mark);
}

/** Feed every whole line between `tail.offset` and `size`. */
async function consume<M>(fh: FileHandle, tail: Tail<M>, size: number): Promise<void> {
  let at = tail.offset;
  while (at < size) {
    const chunk = await readAt(fh, at, Math.min(READ_CHUNK_BYTES, size - at));
    if (chunk.length === 0) break;
    at += chunk.length;
    feedLines(tail, chunk);
  }
  // A last line without its newline counts once it is a whole record.
  if (tail.partial.length > 0 && feedLine(tail.parser, tail.partial))
    tail.partial = Buffer.alloc(0);
  tail.offset = at;
  tail.head = await readAt(fh, 0, Math.min(HEAD_CHECK_BYTES, at));
  tail.mark = await readAt(fh, Math.max(0, at - MARK_CHECK_BYTES), Math.min(MARK_CHECK_BYTES, at));
}

function feedLines<M>(tail: Tail<M>, chunk: Buffer): void {
  const data = tail.partial.length > 0 ? Buffer.concat([tail.partial, chunk]) : chunk;
  let start = 0;
  for (let end = data.indexOf(NEWLINE, start); end !== -1; end = data.indexOf(NEWLINE, start)) {
    feedLine(tail.parser, data.subarray(start, end));
    start = end + 1;
  }
  // A copy: a slice would keep the whole chunk alive.
  tail.partial = Buffer.from(data.subarray(start));
}

/** Parse one line and feed it; `false` when it is not a JSON record. */
function feedLine<M>(parser: TranscriptParser<M>, line: Buffer): boolean {
  const text = line.toString('utf-8').trim();
  if (!text) return true;
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    return false; // a malformed or half-written line
  }
  if (record && typeof record === 'object') parser.feed(record as Record<string, unknown>);
  return true;
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buffer, 0, length, position);
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}
