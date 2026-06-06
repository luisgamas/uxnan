import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIRING_QR_VERSION,
  defaultPairingExpiry,
  encodePairingQr,
  parsePairingQr,
  validatePairingPayload,
  type PairingPayload,
} from '../src/index.js';

const NOW = 1_000_000;

function freshPayload(overrides: Partial<PairingPayload> = {}): PairingPayload {
  return {
    v: PAIRING_QR_VERSION,
    relay: 'wss://relay.uxnan.io',
    sessionId: 'sess-1',
    macDeviceId: 'mac-1',
    macIdentityPublicKey: 'a'.repeat(64),
    expiresAt: defaultPairingExpiry(NOW),
    displayName: "Jorge's PC",
    ...overrides,
  };
}

test('validatePairingPayload accepts a fresh payload', () => {
  const result = validatePairingPayload(freshPayload(), NOW);
  assert.ok(result.valid);
});

test('validatePairingPayload rejects an expired payload', () => {
  const result = validatePairingPayload(freshPayload({ expiresAt: NOW - 1 }), NOW);
  assert.ok(!result.valid);
  assert.equal(result.valid === false && result.error, 'expired');
});

test('validatePairingPayload rejects an unsupported version', () => {
  const result = validatePairingPayload(freshPayload({ v: 1 }), NOW);
  assert.ok(!result.valid);
  assert.equal(result.valid === false && result.error, 'unsupported_version');
});

test('validatePairingPayload rejects a missing field', () => {
  const broken = freshPayload();
  delete (broken as Partial<PairingPayload>).sessionId;
  const result = validatePairingPayload(broken, NOW);
  assert.ok(!result.valid);
  assert.equal(result.valid === false && result.error, 'missing_field');
});

test('encode/parse round-trips a valid payload', () => {
  const payload = freshPayload();
  const qr = encodePairingQr(payload);
  const result = parsePairingQr(qr, NOW);
  assert.ok(result.valid);
  assert.deepEqual(result.valid === true && result.payload, payload);
});

test('parsePairingQr reports invalid JSON', () => {
  const result = parsePairingQr('not json {', NOW);
  assert.ok(!result.valid);
  assert.equal(result.valid === false && result.error, 'invalid_json');
});
