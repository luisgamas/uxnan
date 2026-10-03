import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

/**
 * `prepare.mjs` end to end, in a throwaway repository: the behaviour this pins
 * is the cut itself — a bridge release whose changes include the relay Worker
 * writes the Worker's own version in the same tree, and one that does not
 * leaves it alone.
 */
const PREPARE = join(dirname(fileURLToPath(import.meta.url)), 'prepare.mjs');
let cwd;

function git(...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function put(file, contents) {
  const path = join(cwd, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function read(file) {
  return readFileSync(join(cwd, file), 'utf8');
}

function commit(message) {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

function prepare(...args) {
  return execFileSync(process.execPath, [PREPARE, ...args], { cwd, encoding: 'utf8' });
}

const changelog = (entry) =>
  `# Changelog\n\n## [Unreleased]\n\n### Changed\n\n- ${entry}\n\n## [0.0.1] - 2026-06-21\n`;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'uxnan-prepare-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  put('bridge/src/index.ts', 'export const bridge = 1;\n');
  put('relay/src/worker.ts', 'export default {};\n');
  put(
    'bridge/package.json',
    JSON.stringify({ name: 'uxnan-bridge', version: '0.0.43-alpha.20261002' }, null, 2) + '\n',
  );
  put(
    'relay/package.json',
    JSON.stringify({ name: 'uxnan-relay', version: '0.0.2-alpha.20260720' }, null, 2) + '\n',
  );
  put(
    'package-lock.json',
    JSON.stringify(
      {
        name: 'uxnan-monorepo',
        packages: {
          bridge: { name: 'uxnan-bridge', version: '0.0.43-alpha.20261002' },
          relay: { name: 'uxnan-relay', version: '0.0.2-alpha.20260720' },
        },
      },
      null,
      2,
    ) + '\n',
  );
  put('bridge/CHANGELOG.md', changelog('Bridge change.'));
  put('relay/CHANGELOG.md', changelog('Worker change.'));
  commit('feat: bridge and relay');
  git('tag', 'relay-v0.0.2-alpha.20260720');
  git('tag', 'bridge-v0.0.43-alpha.20261002');
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('prepare bridge', () => {
  it('moves the relay Worker version with a bridge cut that carries a Worker change', () => {
    put('relay/src/worker.ts', 'export default { fetch() {} };\n');
    commit('feat(relay): answer fetch');

    prepare('bridge');

    const bridge = JSON.parse(read('bridge/package.json')).version;
    const relay = JSON.parse(read('relay/package.json')).version;
    const lock = JSON.parse(read('package-lock.json'));
    assert.match(bridge, /^0\.0\.44-alpha\.\d{8}$/);
    assert.match(relay, /^0\.0\.3-alpha\.\d{8}$/);
    assert.equal(lock.packages.bridge.version, bridge);
    assert.equal(lock.packages.relay.version, relay);
    // The Worker keeps its own history under its own version.
    assert.match(read('bridge/CHANGELOG.md'), new RegExp(`## \\[${bridge}\\]`));
    assert.match(read('relay/CHANGELOG.md'), new RegExp(`## \\[${relay}\\]`));
  });

  it('leaves the Worker version and its CHANGELOG alone when only the bridge changed', () => {
    put('bridge/src/index.ts', 'export const bridge = 2;\n');
    commit('feat(bridge): more bridge');

    const out = prepare('bridge');

    assert.match(JSON.parse(read('bridge/package.json')).version, /^0\.0\.44-alpha\.\d{8}$/);
    assert.equal(JSON.parse(read('relay/package.json')).version, '0.0.2-alpha.20260720');
    assert.equal(
      JSON.parse(read('package-lock.json')).packages.relay.version,
      '0.0.2-alpha.20260720',
    );
    assert.equal(read('relay/CHANGELOG.md'), changelog('Worker change.'));
    assert.match(out, /carries uxnan-relay unchanged — stays 0\.0\.2-alpha\.20260720/);
  });

  it('writes nothing on a dry run', () => {
    put('relay/src/worker.ts', 'export default { fetch() {} };\n');
    commit('feat(relay): answer fetch');

    const out = prepare('bridge', '--dry-run');

    assert.match(out, /carries uxnan-relay → 0\.0\.3-alpha\.\d{8}/);
    assert.equal(git('status', '--porcelain'), '');
  });

  it('refuses the relay as a component of its own', () => {
    assert.throws(
      () => execFileSync(process.execPath, [PREPARE, 'relay'], { cwd, stdio: 'pipe' }),
      /ships inside uxnan-bridge/,
    );
  });
});
