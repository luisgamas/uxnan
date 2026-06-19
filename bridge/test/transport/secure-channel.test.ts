import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeSecureChannel, OutboundLog, ReplayError, randomHex } from '../../src/index.js';

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

test('a channel backed by an outbound log draws its seq from (and records into) the log', () => {
  const key = Buffer.from(randomHex(32), 'hex');
  const log = new OutboundLog();
  const channel = new BridgeSecureChannel(key, 'sess-1', log);
  assert.equal(channel.encrypt(Buffer.from('a')).seq, 1);
  assert.equal(channel.encrypt(Buffer.from('b')).seq, 2);
  // Both plaintexts were retained for catch-up.
  assert.deepEqual(
    log.entriesAfter(0).map((e) => [e.seq, e.plaintext.toString()]),
    [
      [1, 'a'],
      [2, 'b'],
    ],
  );
});

test('seq continues across a reconnect (new key, same log) via encryptReplay', () => {
  const log = new OutboundLog();
  // First connection: key #1 encrypts seq 1 and 2, both retained in the log.
  const key1 = Buffer.from(randomHex(32), 'hex');
  const first = new BridgeSecureChannel(key1, 'sess-1', log);
  first.encrypt(Buffer.from('one'));
  first.encrypt(Buffer.from('two'));

  // Reconnect: a FRESH key derives a new channel over the SAME log; new live
  // traffic continues at seq 3.
  const key2 = Buffer.from(randomHex(32), 'hex');
  const second = new BridgeSecureChannel(key2, 'sess-1', log);
  assert.equal(second.nextOutboundSeq, 3);

  // The phone applied seq 1 only → replay seq 2 under the new key.
  const missing = log.entriesAfter(1);
  assert.deepEqual(
    missing.map((e) => e.seq),
    [2],
  );
  const replayed = second.encryptReplay(missing[0]!.seq, missing[0]!.plaintext);
  assert.equal(replayed.seq, 2);
  // A peer holding the NEW key decrypts the replayed envelope (replay does not
  // advance that peer's inbound counter beyond seq 2).
  const peer = new BridgeSecureChannel(key2, 'sess-1');
  assert.equal(peer.decrypt(replayed).toString(), 'two');
  // encryptReplay must not advance the live counter.
  assert.equal(second.nextOutboundSeq, 3);
});
