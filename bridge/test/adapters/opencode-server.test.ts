import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseRecord, parseServeUrl } from '../../src/index.js';

test('parseServeUrl extracts the http URL from a serve startup line', () => {
  assert.equal(
    parseServeUrl('opencode server listening on http://127.0.0.1:53421'),
    'http://127.0.0.1:53421',
  );
  assert.equal(parseServeUrl('LISTENING ON https://localhost:8080/'), 'https://localhost:8080/');
  assert.equal(parseServeUrl('Warning: OPENCODE_SERVER_PASSWORD is not set'), undefined);
  assert.equal(parseServeUrl(''), undefined);
});

test('parseSseRecord parses a single-line data event', () => {
  assert.deepEqual(
    parseSseRecord('data: {"type":"session.idle","properties":{"sessionID":"ses_1"}}'),
    { type: 'session.idle', properties: { sessionID: 'ses_1' } },
  );
});

test('parseSseRecord joins multi-line data fields per the SSE spec', () => {
  const rec = ['event: message', 'data: {"type":"todo.updated",', 'data: "properties":{}}'].join(
    '\n',
  );
  // The two data lines join with a newline into one JSON string.
  const joined = '{"type":"todo.updated",\n"properties":{}}';
  assert.deepEqual(parseSseRecord(rec), JSON.parse(joined) as unknown);
});

test('parseSseRecord returns null for comments, empty, or non-JSON records', () => {
  assert.equal(parseSseRecord(': keep-alive'), null);
  assert.equal(parseSseRecord('event: ping'), null);
  assert.equal(parseSseRecord(''), null);
  assert.equal(parseSseRecord('data: not-json'), null);
});

test('parseSseRecord returns null when the event carries no type', () => {
  assert.equal(parseSseRecord('data: {"properties":{"sessionID":"ses_1"}}'), null);
  assert.equal(parseSseRecord('data: 42'), null);
});

test('parseSseRecord defaults missing properties to an empty object', () => {
  assert.deepEqual(parseSseRecord('data: {"type":"session.idle"}'), {
    type: 'session.idle',
    properties: {},
  });
});
