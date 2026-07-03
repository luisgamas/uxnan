import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, isNewerVersion } from '../src/index.js';

test('compareVersions orders numeric core parts', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('0.0.3', '0.0.2'), 1);
});

test('compareVersions treats a stable release as newer than a prerelease', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0-alpha.1'), 1);
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0'), -1);
});

test('compareVersions orders date-stamped alpha prereleases numerically', () => {
  assert.equal(compareVersions('0.0.3-alpha.20260702', '0.0.3-alpha.20260805'), -1);
  assert.equal(compareVersions('0.0.3-alpha.20260805', '0.0.3-alpha.20260702'), 1);
  assert.equal(compareVersions('0.0.3-alpha.20260702', '0.0.3-alpha.20260702'), 0);
});

test('compareVersions ignores build metadata', () => {
  assert.equal(compareVersions('0.0.1-alpha.20260621+5', '0.0.1-alpha.20260621+9'), 0);
  assert.equal(compareVersions('0.0.1-alpha.20260621+5', '0.0.1-alpha.20260621'), 0);
});

test('compareVersions follows SemVer prerelease precedence rules', () => {
  // Numeric identifiers rank below alphanumeric ones.
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1);
  // A longer set of prerelease fields wins when the prefix is equal.
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
});

test('compareVersions sorts unparseable versions as lower', () => {
  assert.equal(compareVersions('not-a-version', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', 'garbage'), 1);
  assert.equal(compareVersions('garbage', 'also-garbage'), 0);
});

test('isNewerVersion detects strictly newer candidates only', () => {
  assert.equal(isNewerVersion('0.0.3-alpha.20260805', '0.0.3-alpha.20260702'), true);
  assert.equal(isNewerVersion('0.0.3-alpha.20260702', '0.0.3-alpha.20260702'), false);
  assert.equal(isNewerVersion('0.0.3-alpha.20260601', '0.0.3-alpha.20260702'), false);
  assert.equal(isNewerVersion(undefined, '0.0.3-alpha.20260702'), false);
  assert.equal(isNewerVersion(null, '0.0.3-alpha.20260702'), false);
  assert.equal(isNewerVersion('garbage', '0.0.3-alpha.20260702'), false);
});
