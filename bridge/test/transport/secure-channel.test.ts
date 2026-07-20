import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BridgeSecureChannel,
  DIRECTION_BRIDGE_TO_PHONE,
  DIRECTION_PHONE_TO_BRIDGE,
  OutboundLog,
  ReplayError,
  buildEnvelopeAad,
  randomHex,
} from '../../src/index.js';

function pairOfChannels(): { server: BridgeSecureChannel; peer: BridgeSecureChannel } {
  const key = Buffer.from(randomHex(32), 'hex');
  // The "peer" mirrors the phone: same key, same session id, but the OPPOSITE
  // AAD direction role, since the AAD now binds sender direction — see
  // buildEnvelopeAad.
  return {
    server: new BridgeSecureChannel(key, 'sess-1'),
    peer: new BridgeSecureChannel(key, 'sess-1', undefined, 'phone'),
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
  // advance that peer's inbound counter beyond seq 2). 'phone' role: it must
  // expect the bridge→phone direction 'second' (bridge role) encrypted with.
  const peer = new BridgeSecureChannel(key2, 'sess-1', undefined, 'phone');
  assert.equal(peer.decrypt(replayed).toString(), 'two');
  // encryptReplay must not advance the live counter.
  assert.equal(second.nextOutboundSeq, 3);
});

// --- AES-GCM AAD: authenticate sessionId/seq/direction (architecture/02a §5.9.1) ---

test('buildEnvelopeAad matches the canonical byte layout for the reference vector', () => {
  // sessionId="abc", seq=1, direction=phone->bridge (0x01):
  //   "abc" = 61 62 63; sep 00; u64_be(1) = 00*7 01; sep 00; direction 01.
  const expected = Buffer.from(
    [0x61, 0x62, 0x63, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01],
  );
  const aad = buildEnvelopeAad('abc', 1, DIRECTION_PHONE_TO_BRIDGE);
  assert.equal(aad.length, 14);
  assert.deepEqual([...aad], [...expected]);
  assert.equal(aad.toString('hex'), expected.toString('hex'));
});

test('a round-trip with AAD succeeds (sessionId/seq/direction authenticated)', () => {
  const { server, peer } = pairOfChannels();
  const envelope = peer.encrypt(Buffer.from('authenticated payload'));
  assert.equal(server.decrypt(envelope).toString(), 'authenticated payload');
});

test('tampering the seq field without re-tagging now fails decryption', () => {
  const { server, peer } = pairOfChannels();
  const envelope = peer.encrypt(Buffer.from('hello'));
  // Bump seq without re-encrypting: the replay check (seq > lastInboundSeq)
  // would previously let this through; now the AAD (built from the tampered
  // seq) no longer matches the tag computed at encrypt time (seq=1).
  const tampered = { ...envelope, seq: envelope.seq + 1 };
  assert.throws(() => server.decrypt(tampered));
});

test('tampering the sessionId field without re-tagging fails the session check first', () => {
  const { server, peer } = pairOfChannels();
  const envelope = peer.encrypt(Buffer.from('hello'));
  // sessionId mismatch is still checked before decryption (defense in depth);
  // it is ALSO now covered by the AAD, so even if the sessionId happened to
  // match a differently-keyed channel, decryption would still fail the tag.
  const tampered = { ...envelope, sessionId: 'sess-other' };
  assert.throws(() => server.decrypt(tampered), /sessionId mismatch/);
});

test('a bridge-outbound envelope fed back as inbound (direction reflection) fails the tag', () => {
  const key = Buffer.from(randomHex(32), 'hex');
  // Two channels both in the real 'bridge' role: bridgeA's encrypt() tags
  // AAD direction=BRIDGE_TO_PHONE (as if sent to a phone); bridgeB's
  // decrypt() expects inbound direction=PHONE_TO_BRIDGE. A malicious relay
  // (or attacker) reflecting bridgeA's own outbound envelope back as if it
  // were inbound phone traffic must not be accepted.
  const bridgeA = new BridgeSecureChannel(key, 'sess-1');
  const bridgeB = new BridgeSecureChannel(key, 'sess-1');
  const envelope = bridgeA.encrypt(Buffer.from('reflect me'));
  assert.throws(() => bridgeB.decrypt(envelope));
});

test('direction constants are distinct (sanity)', () => {
  assert.notEqual(DIRECTION_PHONE_TO_BRIDGE, DIRECTION_BRIDGE_TO_PHONE);
  assert.equal(DIRECTION_PHONE_TO_BRIDGE, 0x01);
  assert.equal(DIRECTION_BRIDGE_TO_PHONE, 0x02);
});
