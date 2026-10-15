import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { onLines, readLines } from '../src/json-lines.js';

/** A stream that yields [chunks] in order, then ends. */
function streamOf(chunks: (string | Buffer)[]): PassThrough {
  const stream = new PassThrough();
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  return stream;
}

const separators = JSON.stringify({ text: 'a b c' });
const euro = Buffer.from('{"v":"€"}\n', 'utf-8');
const chunks = [
  `${separators}\n`,
  'crlf\r\n',
  euro.subarray(0, 7), // splits the 3-byte "€"
  euro.subarray(7),
  'last without newline',
];
const expected = [separators, 'crlf', '{"v":"€"}', 'last without newline'];

test('onLines splits on \\n only: U+2028/U+2029 stay inside their JSON line', async () => {
  const got: string[] = [];
  const stream = streamOf(chunks);
  onLines(stream, (line) => got.push(line));
  await new Promise((resolve) => stream.on('end', resolve));
  assert.deepEqual(got, expected);
  assert.deepEqual(JSON.parse(got[0]!), { text: 'a b c' });
});

test('readLines yields the same lines as an async iterable', async () => {
  const got: string[] = [];
  for await (const line of readLines(streamOf(chunks))) got.push(line);
  assert.deepEqual(got, expected);
});

test('a closed reader delivers nothing more', async () => {
  const stream = new PassThrough();
  const got: string[] = [];
  const reader = onLines(stream, (line) => got.push(line));
  stream.write('one\n');
  await new Promise((resolve) => setImmediate(resolve));
  reader.close();
  stream.end('two\n');
  await new Promise((resolve) => stream.on('end', resolve));
  assert.deepEqual(got, ['one']);
});
