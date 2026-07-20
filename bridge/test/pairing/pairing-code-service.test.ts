import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PairingPayload } from '@uxnan/shared';
import { PAIRING_WINDOW_MS, PairingCodeService } from '../../src/index.js';

const PAYLOAD = {
  v: 1,
  sessionId: 's',
  macDeviceId: 'd',
  macIdentityPublicKey: 'k',
  expiresAt: 0,
  displayName: 'PC',
} as unknown as PairingPayload;

function svc(opts: { codes?: string[]; ttlMs?: number; rateMax?: number } = {}) {
  let clock = 1000;
  let i = 0;
  const codes = opts.codes ?? ['0123ABCD'];
  const service = new PairingCodeService({
    buildPayload: () => PAYLOAD,
    now: () => clock,
    ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}),
    ...(opts.rateMax !== undefined ? { rateMax: opts.rateMax } : {}),
    generateCode: () => codes[i++ % codes.length]!,
  });
  return { service, advance: (ms: number) => (clock += ms) };
}

test('issues a grouped code and resolves it (case/grouping/look-alike tolerant)', () => {
  const { service } = svc({ codes: ['0123ABCD'] });
  assert.equal(service.currentCode(), '0123-ABCD');
  // exact, lowercased+ungrouped, and a look-alike (O→0) all resolve
  assert.equal(service.resolve('0123-ABCD'), PAYLOAD);
  assert.equal(service.resolve('0123abcd'), PAYLOAD);
  assert.equal(service.resolve('O123 ABCD'), PAYLOAD);
  assert.equal(service.resolve('9999-9999'), undefined);
});

test('a code stops resolving after it expires; currentCode rotates', () => {
  const { service, advance } = svc({ codes: ['0123ABCD', 'ZZZZZZZZ'], ttlMs: 1000 });
  assert.equal(service.currentCode(), '0123-ABCD');
  advance(1500); // past TTL
  assert.equal(service.resolve('0123-ABCD'), undefined);
  assert.equal(service.currentCode(), 'ZZZZ-ZZZZ'); // a fresh code issued
});

test('rotate forces a new code immediately', () => {
  const { service } = svc({ codes: ['0123ABCD', 'WXYZ7890'] });
  assert.equal(service.currentCode(), '0123-ABCD');
  assert.equal(service.rotate(), 'WXYZ-7890');
  assert.equal(service.resolve('0123-ABCD'), undefined);
  assert.equal(service.resolve('WXYZ-7890'), PAYLOAD);
});

test('rate limiting trips after the per-IP cap', () => {
  const { service } = svc({ rateMax: 3 });
  assert.equal(service.rateLimited('1.2.3.4'), false); // 1
  assert.equal(service.rateLimited('1.2.3.4'), false); // 2
  assert.equal(service.rateLimited('1.2.3.4'), false); // 3
  assert.equal(service.rateLimited('1.2.3.4'), true); // 4 > cap
  // a different IP is independent
  assert.equal(service.rateLimited('5.6.7.8'), false);
});

test('the default code generator yields an 8-char unambiguous code', () => {
  const real = new PairingCodeService({ buildPayload: () => PAYLOAD });
  const code = real.currentCode().replace('-', '');
  assert.equal(code.length, 8);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]+$/); // Crockford base32 (no I, L, O, U)
});

test('the pairing window is closed until armed, then opens for PAIRING_WINDOW_MS', () => {
  const { service, advance } = svc();
  assert.equal(service.isArmed(), false); // never armed
  service.arm();
  assert.equal(service.isArmed(), true);
  advance(PAIRING_WINDOW_MS - 1);
  assert.equal(service.isArmed(), true); // still inside the window
  advance(2); // now past PAIRING_WINDOW_MS from arm()
  assert.equal(service.isArmed(), false);
});

test('arm() re-extends the window from the new now', () => {
  const { service, advance } = svc();
  service.arm();
  advance(PAIRING_WINDOW_MS - 1);
  assert.equal(service.isArmed(), true);
  service.arm(); // re-arm right before expiry
  advance(PAIRING_WINDOW_MS - 1);
  assert.equal(service.isArmed(), true); // window pushed out again
});

test('two instances sharing a statePath agree on the code (cross-process)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uxnan-paircode-'));
  const statePath = join(dir, 'pairing-code.json');
  try {
    // The `qr`/`code` command issues + persists the code.
    const issuer = new PairingCodeService({ buildPayload: () => PAYLOAD, statePath });
    const code = issuer.currentCode();

    // The running daemon (a separate instance) serves `/pair/resolve` and must
    // accept the SAME code, and report it as its current code.
    const daemon = new PairingCodeService({ buildPayload: () => PAYLOAD, statePath });
    assert.equal(daemon.resolve(code), PAYLOAD);
    assert.equal(daemon.currentCode(), code);

    // A wrong code still fails.
    assert.equal(daemon.resolve('9999-9999'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
