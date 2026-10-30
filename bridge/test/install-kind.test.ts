import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledRuntimeRoot, installKind, readRuntimeManifest } from '../src/index.js';

const MANIFEST = JSON.stringify({
  kind: 'bundled',
  bridgeVersion: '0.0.54',
  nodeVersion: '24.22.2',
  triple: 'aarch64-apple-darwin',
  files: [],
});

const BUNDLED =
  '/Users/u/Library/Application Support/Uxnan/bridge-runtime/versions/0.0.54+node24.22.2/app/node_modules/uxnan-bridge/dist/src/cli.js';
const ROOT =
  '/Users/u/Library/Application Support/Uxnan/bridge-runtime/versions/0.0.54+node24.22.2';

test('a bundled runtime is found from where its CLI sits', () => {
  assert.equal(bundledRuntimeRoot(BUNDLED, 'darwin'), ROOT);
  const probe = {
    platform: 'darwin' as const,
    exists: (f: string) => f === `${ROOT}/uxnan-runtime.json`,
    read: () => MANIFEST,
  };
  assert.deepEqual(readRuntimeManifest(BUNDLED, probe), {
    kind: 'bundled',
    bridgeVersion: '0.0.54',
    nodeVersion: '24.22.2',
    triple: 'aarch64-apple-darwin',
  });
  assert.equal(installKind(BUNDLED, probe), 'bundled');
});

test('the same shape on Windows, with its own path rules', () => {
  const cli =
    'C:\\Users\\u\\AppData\\Local\\Uxnan\\bridge-runtime\\versions\\0.0.54+node24.22.2\\app\\node_modules\\uxnan-bridge\\dist\\src\\cli.js';
  const root = 'C:\\Users\\u\\AppData\\Local\\Uxnan\\bridge-runtime\\versions\\0.0.54+node24.22.2';
  assert.equal(bundledRuntimeRoot(cli, 'win32'), root);
  const probe = { platform: 'win32' as const, exists: () => true, read: () => MANIFEST };
  assert.equal(installKind(cli, probe), 'bundled');
});

test('a global npm install, a checkout, and a runtime with a bad manifest are told apart', () => {
  const none = { platform: 'darwin' as const, exists: () => false };
  assert.equal(
    installKind('/usr/local/lib/node_modules/uxnan-bridge/dist/src/cli.js', none),
    'npm',
  );
  assert.equal(installKind('/src/uxnan/bridge/dist/src/cli.js', none), 'source');
  assert.equal(bundledRuntimeRoot('/src/uxnan/bridge/dist/src/cli.js', 'darwin'), undefined);
  // The bundled shape without a manifest that says so is not trusted as one.
  const bad = { platform: 'darwin' as const, exists: () => true, read: () => '{"kind":"npm"}' };
  assert.equal(readRuntimeManifest(BUNDLED, bad), undefined);
  const broken = { platform: 'darwin' as const, exists: () => true, read: () => 'not json' };
  assert.equal(readRuntimeManifest(BUNDLED, broken), undefined);
  assert.equal(installKind(BUNDLED, broken), 'npm');
});
