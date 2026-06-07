import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeSecureChannel, ReplayError, randomHex } from '../../src/index.js';

function pairOfChannels(): { server: BridgeSecureChannel; peer: BridgeSecureChannel } {
  const key = Buffer.from(randomHex(32), 'hex');
  // The "peer" mirrors the phone: same key, same session id.
  return {
    server: new BridgeSecureChannel(key, 'sess-1'),
    peer: new BridgeSecureChannel(key, 'sess-1'),
  };
}

test('a channel decrypts envelopes produced with the shared key', () => {
  const { server, peer } = pairOfChannels();
  const envelope = peer.encrypt(Buffer.from('ping'));
  assert.equal(server.decrypt(envelope).toString(), 'ping');
});

test('replayed or out-of-order envelopes are rejected', () => {
  const { server, peer } = pairOfChannels();
  const first = peer.encrypt(Buffer.from('one'));
  server.decrypt(first);
  assert.throws(() => server.decrypt(first), ReplayError);
});

test('envelopes from a different session are rejected', () => {
  const key = Buffer.from(randomHex(32), 'hex');
  const server = new BridgeSecureChannel(key, 'sess-A');
  const other = new BridgeSecureChannel(key, 'sess-B');
  assert.throws(() => server.decrypt(other.encrypt(Buffer.from('x'))), /sessionId mismatch/);
});

test('outbound sequence numbers are 1-based and monotonic', () => {
  const { peer } = pairOfChannels();
  assert.equal(peer.encrypt(Buffer.from('a')).seq, 1);
  assert.equal(peer.encrypt(Buffer.from('b')).seq, 2);
});
