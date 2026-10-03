import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PAIRING_AGE_MS, PAIRING_QR_VERSION, validatePairingPayload } from '@uxnan/shared';
import { generatePairingPayload } from '../src/index.js';

const NOW = 1_700_000_000_000;

test('generatePairingPayload produces a valid payload', () => {
  const payload = generatePairingPayload({
    relay: { url: 'wss://uxnan-relay.example.workers.dev', routingId: 'a'.repeat(32) },
    macDeviceId: 'mac-1',
    macIdentityPublicKey: 'a'.repeat(64),
    displayName: 'Test PC',
    now: NOW,
  });
  assert.equal(payload.v, PAIRING_QR_VERSION);
  assert.equal(payload.expiresAt, NOW + MAX_PAIRING_AGE_MS);
  const result = validatePairingPayload(payload, NOW);
  assert.ok(result.valid);
});

test('generatePairingPayload assigns a session id when none is given', () => {
  const a = generatePairingPayload({
    relay: { url: 'wss://uxnan-relay.example.workers.dev', routingId: 'a'.repeat(32) },
    macDeviceId: 'm',
    macIdentityPublicKey: 'k',
    displayName: 'd',
    now: NOW,
  });
  const b = generatePairingPayload({
    relay: { url: 'wss://uxnan-relay.example.workers.dev', routingId: 'a'.repeat(32) },
    macDeviceId: 'm',
    macIdentityPublicKey: 'k',
    displayName: 'd',
    now: NOW,
  });
  assert.notEqual(a.sessionId, b.sessionId);
});

test('generatePairingPayload honors an explicit session id', () => {
  const payload = generatePairingPayload({
    relay: { url: 'wss://uxnan-relay.example.workers.dev', routingId: 'a'.repeat(32) },
    macDeviceId: 'm',
    macIdentityPublicKey: 'k',
    displayName: 'd',
    now: NOW,
    sessionId: 'fixed-session',
  });
  assert.equal(payload.sessionId, 'fixed-session');
});

test('generatePairingPayload includes direct hosts when provided', () => {
  const payload = generatePairingPayload({
    relay: { url: 'wss://uxnan-relay.example.workers.dev', routingId: 'a'.repeat(32) },
    hosts: ['192.168.1.20:7777', '100.64.0.5:7777'],
    macDeviceId: 'm',
    macIdentityPublicKey: 'k',
    displayName: 'd',
    now: NOW,
  });
  assert.deepEqual(payload.hosts, ['192.168.1.20:7777', '100.64.0.5:7777']);
  assert.equal(payload.relay?.url, 'wss://uxnan-relay.example.workers.dev');
});

test('generatePairingPayload omits relay for a LAN/Tailscale-only QR', () => {
  const payload = generatePairingPayload({
    hosts: ['100.64.0.5:7777'],
    macDeviceId: 'm',
    macIdentityPublicKey: 'k',
    displayName: 'd',
    now: NOW,
  });
  assert.equal(payload.relay, undefined);
  const result = validatePairingPayload(payload, NOW);
  assert.ok(result.valid); // hosts alone is a valid transport
});
