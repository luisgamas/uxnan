import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METHOD_NAMES, isKnownMethod } from '../src/index.js';

test('isKnownMethod recognizes registered methods', () => {
  assert.ok(isKnownMethod('git/status'));
  assert.ok(isKnownMethod('bridge/generatePairingQr'));
  assert.ok(isKnownMethod('workspace/resolveFileLink'));
});

test('isKnownMethod rejects unknown methods', () => {
  assert.ok(!isKnownMethod('does/notExist'));
  assert.ok(!isKnownMethod(''));
});

test('METHOD_NAMES has no duplicates', () => {
  assert.equal(new Set(METHOD_NAMES).size, METHOD_NAMES.length);
});

// architecture/02b §1.2: `domain/action`, the domain in lowercase. Uxnan
// Desktop's bridge client refuses any other shape before it reaches the wire
// (`bridgeclient::is_method_name`), so a method named otherwise works for the
// phone and silently never for the desktop.
test('every method is named domain/action with a lowercase domain', () => {
  for (const method of METHOD_NAMES) {
    assert.match(method, /^[a-z]+\/[A-Za-z0-9]+$/, method);
    assert.ok(method.length <= 64, method);
  }
});
