/**
 * Lines of a stream, split on `\n` only — the one reader for every
 * newline-delimited JSON the bridge consumes (an agent's stdout, a JSON-RPC
 * peer, a transcript on disk).
 *
 * Not `node:readline`: it also ends a line at U+2028 / U+2029, characters
 * `JSON.stringify` leaves unescaped, so a model's text carrying one splits a
 * single JSON line in two and both halves fail to parse (pi's RPC documentation
 * warns about exactly this). A trailing `\r` is dropped, so CRLF input reads the
 * same; a last line without a newline is delivered when the stream ends.
 */
import { StringDecoder } from 'node:string_decoder';

/** Stops a {@link onLines} reader: no line is delivered after it. */
export interface LineReader {
  close(): void;
}

/** Calls [onLine] for each line of [stream] as it arrives. */
export function onLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): LineReader {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let closed = false;
  const deliver = (raw: string): void => {
    if (!closed) onLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
  };
  stream.on('data', (chunk: unknown) => {
    pending += typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
    let start = 0;
    let end = pending.indexOf('\n');
    while (end >= 0) {
      deliver(pending.slice(start, end));
      start = end + 1;
      end = pending.indexOf('\n', start);
    }
    pending = pending.slice(start);
  });
  stream.on('end', () => {
    pending += decoder.end();
    if (pending.length > 0) deliver(pending);
    pending = '';
  });
  return {
    close: () => {
      closed = true;
    },
  };
}

/** The lines of [stream], in order, as an async iterable (see {@link onLines}). */
export async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of stream as AsyncIterable<string | Buffer>) {
    pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let start = 0;
    let end = pending.indexOf('\n');
    while (end >= 0) {
      const line = pending.slice(start, end);
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
      start = end + 1;
      end = pending.indexOf('\n', start);
    }
    pending = pending.slice(start);
  }
  pending += decoder.end();
  if (pending.length > 0) yield pending.endsWith('\r') ? pending.slice(0, -1) : pending;
}
