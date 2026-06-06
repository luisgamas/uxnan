import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHandshakeTranscript } from '../src/index.js';

test('buildHandshakeTranscript concatenates fields in the canonical order', () => {
  const transcript = buildHandshakeTranscript({
    clientNonce: 'aa',
    phoneEphemeralPublicKey: 'bb',
    macEphemeralPublicKey: 'cc',
    serverNonce: 'dd',
    sessionId: 'sess',
    keyEpoch: 3,
    expiresAtForTranscript: 42,
  });
  assert.equal(transcript, 'aabbccddsess342');
});

test('buildHandshakeTranscript is deterministic', () => {
  const fields = {
    clientNonce: '01',
    phoneEphemeralPublicKey: '02',
    macEphemeralPublicKey: '03',
    serverNonce: '04',
    sessionId: 's',
    keyEpoch: 1,
    expiresAtForTranscript: 1000,
  };
  assert.equal(buildHandshakeTranscript(fields), buildHandshakeTranscript(fields));
});
