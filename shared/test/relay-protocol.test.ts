import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RELAY_MAX_ALLOWED_PHONES,
  RELAY_MAX_CONTROL_FRAME_BYTES,
  RELAY_MAX_TICKET_TTL_MS,
  isEd25519PublicKeyHex,
  isPairingTicket,
  isRelayId,
  parseRelayClientFrame,
  parseRelayPath,
  parseRelayServerFrame,
  relayRoutePath,
  relaySigningMessage,
} from '../src/relay/protocol.js';

const ID = 'a'.repeat(32);
const ID2 = 'b'.repeat(32);
const KEY = 'c'.repeat(64);
const SIG = 'd'.repeat(128);
const TICKET = 'A'.repeat(43);

test('isRelayId, isEd25519PublicKeyHex and isPairingTicket accept only their exact shapes', () => {
  assert.ok(isRelayId(ID));
  assert.ok(!isRelayId(ID.toUpperCase()));
  assert.ok(!isRelayId(ID.slice(1)));
  assert.ok(isEd25519PublicKeyHex(KEY));
  assert.ok(!isEd25519PublicKeyHex(`${KEY}0`));
  assert.ok(isPairingTicket(TICKET));
  assert.ok(isPairingTicket('a-_'.repeat(14) + 'z'));
  assert.ok(!isPairingTicket(`${TICKET}=`));
  assert.ok(!isPairingTicket(42));
});

test('relayRoutePath and parseRelayPath round-trip every route', () => {
  assert.equal(relayRoutePath('host', ID), `/v1/host/${ID}`);
  assert.equal(relayRoutePath('phone', ID), `/v1/connect/${ID}`);
  assert.equal(relayRoutePath('channel', ID, ID2), `/v1/channel/${ID}/${ID2}`);
  assert.deepEqual(parseRelayPath(relayRoutePath('host', ID)), { route: 'host', routingId: ID });
  assert.deepEqual(parseRelayPath(relayRoutePath('phone', ID)), { route: 'phone', routingId: ID });
  assert.deepEqual(parseRelayPath(relayRoutePath('channel', ID, ID2)), {
    route: 'channel',
    routingId: ID,
    channelId: ID2,
  });
});

test('parseRelayPath rejects anything else', () => {
  for (const path of [
    '/',
    '/v1/version',
    `/v2/host/${ID}`,
    `/v1/host/${ID}/extra`,
    `/v1/connect/${ID}/${ID2}`,
    `/v1/channel/${ID}`,
    `/v1/host/not-an-id`,
    `/v1/push/${ID}`,
    `v1/host/${ID}`,
  ]) {
    assert.equal(parseRelayPath(path), null, path);
  }
});

test('relaySigningMessage binds version, route, host, routing id, channel and nonce', () => {
  const base = { route: 'channel' as const, host: 'r.example', routingId: ID, nonce: 'n' };
  assert.equal(
    relaySigningMessage({ ...base, channelId: ID2 }),
    `uxnan-relay-v1|channel|r.example|${ID}|${ID2}|n`,
  );
  assert.equal(
    relaySigningMessage({ route: 'host', host: 'r.example', routingId: ID, nonce: 'n' }),
    `uxnan-relay-v1|host|r.example|${ID}||n`,
  );
  assert.notEqual(
    relaySigningMessage({ ...base, host: 'other.example' }),
    relaySigningMessage(base),
  );
});

test('parseRelayClientFrame accepts each client frame', () => {
  assert.deepEqual(parseRelayClientFrame(JSON.stringify({ t: 'host-auth', key: KEY, sig: SIG })), {
    t: 'host-auth',
    key: KEY,
    sig: SIG,
  });
  assert.deepEqual(parseRelayClientFrame(JSON.stringify({ t: 'channel-auth', sig: SIG })), {
    t: 'channel-auth',
    sig: SIG,
  });
  assert.deepEqual(parseRelayClientFrame(JSON.stringify({ t: 'phone-auth', key: KEY, sig: SIG })), {
    t: 'phone-auth',
    key: KEY,
    sig: SIG,
  });
  assert.deepEqual(
    parseRelayClientFrame(JSON.stringify({ t: 'phone-auth', key: KEY, sig: SIG, ticket: TICKET })),
    { t: 'phone-auth', key: KEY, sig: SIG, ticket: TICKET },
  );
  assert.deepEqual(parseRelayClientFrame(JSON.stringify({ t: 'allow', keys: [KEY, KEY] })), {
    t: 'allow',
    keys: [KEY],
  });
  assert.deepEqual(
    parseRelayClientFrame(JSON.stringify({ t: 'ticket', hash: KEY, ttlMs: 60_000 })),
    { t: 'ticket', hash: KEY, ttlMs: 60_000 },
  );
});

test('parseRelayClientFrame rejects malformed, oversized and over-specified frames', () => {
  const tooManyKeys = Array.from({ length: RELAY_MAX_ALLOWED_PHONES + 1 }, (_, i) =>
    i.toString(16).padStart(64, '0'),
  );
  for (const raw of [
    '{not json',
    '[]',
    'null',
    JSON.stringify({ t: 'unknown' }),
    JSON.stringify({ t: 'host-auth', key: KEY }),
    JSON.stringify({ t: 'host-auth', key: KEY, sig: SIG, extra: 1 }),
    JSON.stringify({ t: 'phone-auth', key: KEY, sig: SIG, ticket: 'short' }),
    JSON.stringify({ t: 'allow', keys: ['nope'] }),
    JSON.stringify({ t: 'allow', keys: tooManyKeys }),
    JSON.stringify({ t: 'ticket', hash: KEY, ttlMs: 0 }),
    JSON.stringify({ t: 'ticket', hash: KEY, ttlMs: RELAY_MAX_TICKET_TTL_MS + 1 }),
    JSON.stringify({ t: 'ticket', hash: KEY, ttlMs: 1.5 }),
    ' '.repeat(RELAY_MAX_CONTROL_FRAME_BYTES + 1),
  ]) {
    assert.equal(parseRelayClientFrame(raw), null, raw.slice(0, 60));
  }
});

test('parseRelayServerFrame accepts challenge, ready and dial and nothing else', () => {
  assert.deepEqual(parseRelayServerFrame(JSON.stringify({ t: 'challenge', v: 1, nonce: KEY })), {
    t: 'challenge',
    v: 1,
    nonce: KEY,
  });
  assert.deepEqual(parseRelayServerFrame('{"t":"ready"}'), { t: 'ready' });
  assert.deepEqual(parseRelayServerFrame(JSON.stringify({ t: 'dial', channel: ID })), {
    t: 'dial',
    channel: ID,
  });
  for (const raw of [
    'pong',
    JSON.stringify({ t: 'challenge', v: 1, nonce: 'short' }),
    JSON.stringify({ t: 'dial', channel: 'x' }),
    JSON.stringify({ t: 'host-auth', key: KEY, sig: SIG }),
  ]) {
    assert.equal(parseRelayServerFrame(raw), null, raw);
  }
});
