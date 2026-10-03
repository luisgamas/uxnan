import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { RELAY_CLOSE, RELAY_PROTOCOL_VERSION, RELAY_WORKER_NAME } from '@uxnan/shared/relay';
import { startLocalRelay, type LocalRelayHandle } from '../src/local/start-local-relay.js';
import {
  Client,
  connectAndAuth,
  identityFromPem,
  newIdentity,
  newRelayId,
  type Identity,
} from './helpers.js';

// Every test runs against the real Workers runtime with the bundle the bridge
// deploys — locally by default, or against a relay deployed to Cloudflare when
// UXNAN_RELAY_TEST_URL is set (with UXNAN_RELAY_TEST_HOST_KEYS: a JSON array of
// the two PKCS#8 PEMs whose public keys that relay was deployed with). Each
// test uses its own routing id, so each gets a fresh room.
const deployed = process.env['UXNAN_RELAY_TEST_URL'];
const deployedKeys = deployed
  ? (JSON.parse(process.env['UXNAN_RELAY_TEST_HOST_KEYS'] ?? '[]') as string[])
  : [];
const bridge = deployedKeys[0] ? identityFromPem(deployedKeys[0]) : newIdentity();
const otherBridge = deployedKeys[1] ? identityFromPem(deployedKeys[1]) : newIdentity();
let relay: LocalRelayHandle;
let httpBase: string;

before(async () => {
  relay = deployed
    ? { url: deployed, close: async () => {} }
    : await startLocalRelay({ hostKeys: [bridge.publicKeyHex, otherBridge.publicKeyHex] });
  httpBase = relay.url.replace(/^ws/, 'http');
});

after(async () => {
  await relay.close();
});

async function host(routingId: string, identity: Identity = bridge): Promise<Client> {
  const client = await connectAndAuth({ relayUrl: relay.url, route: 'host', routingId, identity });
  assert.deepEqual(await client.nextControl(), { t: 'ready' });
  return client;
}

/** A trusted phone dials; the bridge opens its channel; both are ready. */
async function pairedPhone(
  routingId: string,
  hostClient: Client,
  phone: Identity,
  ticket?: string,
): Promise<{ phone: Client; channel: Client }> {
  const phoneClient = await connectAndAuth({
    relayUrl: relay.url,
    route: 'phone',
    routingId,
    identity: phone,
    ...(ticket ? { ticket } : {}),
  });
  const dial = await hostClient.nextControl();
  assert.equal(dial?.t, 'dial');
  const channelId = dial?.t === 'dial' ? dial.channel : '';
  const channel = await connectAndAuth({
    relayUrl: relay.url,
    route: 'channel',
    routingId,
    channelId,
    identity: bridge,
  });
  assert.deepEqual(await channel.nextControl(), { t: 'ready' });
  assert.deepEqual(await phoneClient.nextControl(), { t: 'ready' });
  return { phone: phoneClient, channel };
}

function ticketPair(): { ticket: string; hash: string } {
  const ticket = randomBytes(32).toString('base64url');
  return { ticket, hash: createHash('sha256').update(ticket, 'ascii').digest('hex') };
}

test('GET /v1/version names the relay and its protocol', async () => {
  const res = await fetch(`${httpBase}/v1/version`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body['name'], RELAY_WORKER_NAME);
  assert.equal(body['protocol'], RELAY_PROTOCOL_VERSION);
  assert.equal(typeof body['version'], 'string');
});

test('anything that is not a relay route is 404, and a route without upgrade is 426', async () => {
  assert.equal((await fetch(`${httpBase}/`)).status, 404);
  assert.equal((await fetch(`${httpBase}/push/register`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${httpBase}/v1/host/not-an-id`)).status, 404);
  assert.equal((await fetch(`${httpBase}/v1/host/${newRelayId()}`)).status, 426);
});

test('a phone and its bridge exchange frames verbatim, both ways', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  const phone = newIdentity();
  hostClient.sendJson({ t: 'allow', keys: [phone.publicKeyHex] });
  const { phone: p, channel } = await pairedPhone(routingId, hostClient, phone);

  const binary = randomBytes(256 * 1024);
  p.ws.send(binary);
  const atBridge = await channel.next();
  assert.equal(atBridge.kind, 'frame');
  assert.ok(atBridge.kind === 'frame' && atBridge.isBinary && atBridge.data.equals(binary));

  channel.ws.send('{"kind":"encryptedEnvelope"}');
  const atPhone = await p.next();
  assert.ok(atPhone.kind === 'frame' && !atPhone.isBinary);
  assert.equal(atPhone.kind === 'frame' && atPhone.data.toString(), '{"kind":"encryptedEnvelope"}');

  p.close();
  await channel.expectClose(RELAY_CLOSE.peerClosed);
  hostClient.close();
});

test('several phones are served at once, each on its own channel', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  const a = newIdentity();
  const b = newIdentity();
  hostClient.sendJson({ t: 'allow', keys: [a.publicKeyHex, b.publicKeyHex] });
  const first = await pairedPhone(routingId, hostClient, a);
  const second = await pairedPhone(routingId, hostClient, b);

  first.phone.ws.send('from-a');
  second.phone.ws.send('from-b');
  const atA = await first.channel.next();
  const atB = await second.channel.next();
  assert.equal(atA.kind === 'frame' && atA.data.toString(), 'from-a');
  assert.equal(atB.kind === 'frame' && atB.data.toString(), 'from-b');

  for (const c of [first.phone, second.phone, hostClient]) c.close();
});

test('a host key the relay was not deployed with is refused', async () => {
  const stranger = newIdentity();
  const client = await connectAndAuth({
    relayUrl: relay.url,
    route: 'host',
    routingId: newRelayId(),
    identity: stranger,
  });
  await client.expectClose(RELAY_CLOSE.notAllowed);
});

test('a forged host signature is refused', async () => {
  const client = await connectAndAuth({
    relayUrl: relay.url,
    route: 'host',
    routingId: newRelayId(),
    identity: bridge,
    signWith: newIdentity(),
  });
  await client.expectClose(RELAY_CLOSE.authFailed);
});

test('a routing id stays bound to the first host that claimed it', async () => {
  const routingId = newRelayId();
  const first = await host(routingId);
  const intruder = await connectAndAuth({
    relayUrl: relay.url,
    route: 'host',
    routingId,
    identity: otherBridge,
  });
  await intruder.expectClose(RELAY_CLOSE.notAllowed);
  first.close();
});

test('a newer control socket of the same bridge replaces the old one', async () => {
  const routingId = newRelayId();
  const old = await host(routingId);
  const fresh = await host(routingId);
  await old.expectClose(RELAY_CLOSE.replaced);
  fresh.close();
});

test('a phone that is not on the allow list and has no ticket is refused', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  const phone = await connectAndAuth({
    relayUrl: relay.url,
    route: 'phone',
    routingId,
    identity: newIdentity(),
  });
  await phone.expectClose(RELAY_CLOSE.notAllowed);
  hostClient.close();
});

test('a trusted phone is told when its bridge is not connected', async () => {
  const routingId = newRelayId();
  const phone = newIdentity();
  const hostClient = await host(routingId);
  hostClient.sendJson({ t: 'allow', keys: [phone.publicKeyHex] });
  hostClient.close();
  await hostClient.expectClose(1000);
  const client = await connectAndAuth({
    relayUrl: relay.url,
    route: 'phone',
    routingId,
    identity: phone,
  });
  await client.expectClose(RELAY_CLOSE.bridgeOffline);
});

test('a pairing ticket admits one new phone, once', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  const { ticket, hash } = ticketPair();
  hostClient.sendJson({ t: 'ticket', hash, ttlMs: 60_000 });

  const newcomer = newIdentity();
  const { phone, channel } = await pairedPhone(routingId, hostClient, newcomer, ticket);
  phone.ws.send('hello');
  const got = await channel.next();
  assert.equal(got.kind === 'frame' && got.data.toString(), 'hello');

  const replay = await connectAndAuth({
    relayUrl: relay.url,
    route: 'phone',
    routingId,
    identity: newIdentity(),
    ticket,
  });
  await replay.expectClose(RELAY_CLOSE.notAllowed);
  phone.close();
  hostClient.close();
});

test('an expired pairing ticket is refused', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  const { ticket, hash } = ticketPair();
  hostClient.sendJson({ t: 'ticket', hash, ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 50));
  const phone = await connectAndAuth({
    relayUrl: relay.url,
    route: 'phone',
    routingId,
    identity: newIdentity(),
    ticket,
  });
  await phone.expectClose(RELAY_CLOSE.notAllowed);
  hostClient.close();
});

test('removing a phone from the allow list cuts its live channel', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  const phone = newIdentity();
  hostClient.sendJson({ t: 'allow', keys: [phone.publicKeyHex] });
  const pair = await pairedPhone(routingId, hostClient, phone);
  hostClient.sendJson({ t: 'allow', keys: [] });
  await pair.phone.expectClose(RELAY_CLOSE.revoked);
  await pair.channel.expectClose(RELAY_CLOSE.revoked);
  hostClient.close();
});

test('a channel must be signed by the bound host and match a waiting phone', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  const forged = await connectAndAuth({
    relayUrl: relay.url,
    route: 'channel',
    routingId,
    channelId: newRelayId(),
    identity: bridge,
    signWith: otherBridge,
  });
  await forged.expectClose(RELAY_CLOSE.authFailed);
  const orphan = await connectAndAuth({
    relayUrl: relay.url,
    route: 'channel',
    routingId,
    channelId: newRelayId(),
    identity: bridge,
  });
  await orphan.expectClose(RELAY_CLOSE.peerClosed);
  hostClient.close();
});

test('keepalive pings are answered with pong', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  hostClient.ws.send('ping');
  const pong = await hostClient.next();
  assert.equal(pong.kind === 'frame' && pong.data.toString(), 'pong');
  hostClient.close();
});

test('a control frame that is not valid JSON closes the socket', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  hostClient.ws.send('{not json');
  await hostClient.expectClose(RELAY_CLOSE.badFrame);
});

test('a socket that never answers the challenge is closed', async () => {
  const client = await Client.open(`${relay.url}/v1/host/${newRelayId()}`);
  const challenge = await client.nextControl();
  assert.equal(challenge?.t, 'challenge');
  await client.expectClose(RELAY_CLOSE.authTimeout);
});

test('a phone the bridge never dials back is closed', async () => {
  const routingId = newRelayId();
  const hostClient = await host(routingId);
  const phone = newIdentity();
  hostClient.sendJson({ t: 'allow', keys: [phone.publicKeyHex] });
  const client = await connectAndAuth({
    relayUrl: relay.url,
    route: 'phone',
    routingId,
    identity: phone,
  });
  assert.equal((await hostClient.nextControl())?.t, 'dial');
  await client.expectClose(RELAY_CLOSE.bridgeTimeout);
  hostClient.close();
});
