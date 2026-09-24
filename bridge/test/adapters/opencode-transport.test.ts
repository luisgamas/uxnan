import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeLoopbackPort, parseSseData, parseServeUrl } from '../../src/index.js';

test('parseServeUrl extracts the http URL from a serve startup line', () => {
  assert.equal(
    parseServeUrl('opencode server listening on http://127.0.0.1:53421'),
    'http://127.0.0.1:53421',
  );
  // OpenCode 2 prints the same line, followed by the password line.
  assert.equal(
    parseServeUrl('server listening on http://127.0.0.1:49584\n'),
    'http://127.0.0.1:49584',
  );
  assert.equal(parseServeUrl('LISTENING ON https://localhost:8080/'), 'https://localhost:8080/');
  assert.equal(parseServeUrl('Warning: OPENCODE_SERVER_PASSWORD is not set'), undefined);
  assert.equal(parseServeUrl(''), undefined);
});

test('parseSseData parses a single-line data event', () => {
  assert.deepEqual(
    parseSseData('data: {"type":"session.idle","properties":{"sessionID":"ses_1"}}'),
    {
      type: 'session.idle',
      properties: { sessionID: 'ses_1' },
    },
  );
});

test('parseSseData reads an OpenCode 2 event (`{ id, type, data }`)', () => {
  const rec =
    'data: {"id":"evt_1","created":1,"type":"session.execution.succeeded","data":{"sessionID":"ses_1"}}';
  assert.deepEqual(parseSseData(rec), {
    id: 'evt_1',
    created: 1,
    type: 'session.execution.succeeded',
    data: { sessionID: 'ses_1' },
  });
});

test('parseSseData decodes a payload sent as a JSON string holding the object', () => {
  const inner = JSON.stringify({ type: 'server.connected', data: {} });
  assert.deepEqual(parseSseData(`data: ${JSON.stringify(inner)}`), {
    type: 'server.connected',
    data: {},
  });
});

test('parseSseData joins multi-line data fields per the SSE spec', () => {
  const rec = ['event: message', 'data: {"type":"todo.updated",', 'data: "properties":{}}'].join(
    '\n',
  );
  const joined = '{"type":"todo.updated",\n"properties":{}}';
  assert.deepEqual(parseSseData(rec), JSON.parse(joined) as unknown);
});

test('parseSseData returns null for comments, empty, non-JSON or non-object records', () => {
  assert.equal(parseSseData(': keep-alive'), null);
  assert.equal(parseSseData('event: ping'), null);
  assert.equal(parseSseData(''), null);
  assert.equal(parseSseData('data: not-json'), null);
  assert.equal(parseSseData('data: 42'), null);
  assert.equal(parseSseData('data: [1,2]'), null);
});

test('freeLoopbackPort hands out a loopback port nothing holds', async () => {
  const { createServer } = await import('node:net');
  const port = await freeLoopbackPort();
  assert.ok(port > 0 && port < 65536);
  // It is really free: something can bind it right after.
  await new Promise<void>((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(port, '127.0.0.1', () => s.close(() => resolve()));
  });
});
