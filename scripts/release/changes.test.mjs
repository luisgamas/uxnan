import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { inspect } from './changes.mjs';

/**
 * These run against a real git repository rather than a stub, because the bug
 * they exist for was entirely about git's shape: a tag that lives on a branch
 * `main` never absorbed. Nothing stubbed can reproduce that.
 *
 * The story they replay is the one that happened on 2026-08-10. 0.0.33's release
 * pull request was left open, so its tag was not an ancestor of `main`; the next
 * cut diffed `main` against that tag, saw five version files "changed", and cut
 * 0.0.34 — same code, empty release body, one wasted version number. It would
 * have repeated every night.
 */
let cwd;

function git(...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function put(file, contents) {
  const path = join(cwd, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function commit(message) {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

/** Every file the desktop carries a version in, all agreeing. */
function writeVersion(version) {
  put(
    'uxnandesktop/src-tauri/tauri.conf.json',
    JSON.stringify({ productName: 'Uxnan Desktop', version }, null, 2) + '\n',
  );
  put(
    'uxnandesktop/src-tauri/Cargo.toml',
    `[workspace.package]\nversion = "${version}"\n\n[package]\nname = "uxnan-desktop"\nversion.workspace = true\n`,
  );
  put(
    'uxnandesktop/src-tauri/Cargo.lock',
    `[[package]]\nname = "uxnan-cli"\nversion = "${version}"\n\n[[package]]\nname = "uxnan-control-protocol"\nversion = "${version}"\n\n[[package]]\nname = "uxnan-desktop"\nversion = "${version}"\n`,
  );
  put('uxnandesktop/package.json', JSON.stringify({ name: 'uxnan-desktop', version }, null, 2));
  put(
    'uxnandesktop/package-lock.json',
    JSON.stringify({ name: 'uxnan-desktop', version, packages: {} }, null, 2),
  );
}

/** Cuts a release the way the workflow does: a branch, a bump, a tag — no merge. */
function cutOnBranch(version, tag) {
  const branch = `release/${version}`;
  git('checkout', '-q', '-b', branch);
  writeVersion(version);
  commit(`build: prepare desktop ${version}`);
  git('tag', tag);
  git('checkout', '-q', 'main');
  return branch;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'uxnan-changes-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  put('uxnandesktop/src/lib/app.ts', 'export const app = 1;\n');
  writeVersion('0.0.32');
  commit('feat: the app');
  git('tag', 'desktop-nightly-v0.0.32-nightly.20260808.1');
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('inspect — a release pull request left open', () => {
  it('does not invent work when the only difference is the unmerged bump', () => {
    // 0.0.33 cut, its pull request still open, nothing else has happened. The
    // plain tag→HEAD diff reports five changed version files here; that is what
    // cut 0.0.34 out of nothing.
    cutOnBranch('0.0.33', 'desktop-nightly-v0.0.33-nightly.20260809.1');

    const report = inspect('desktop', { cwd, channel: 'nightly' });
    assert.equal(report.landed, false, 'the tag is not an ancestor of main');
    assert.equal(report.worthy, false, 'nothing shipped since — there is nothing to cut');
    assert.deepEqual(report.substantive, []);
  });

  it('still sees real work that landed while the pull request sat open', () => {
    cutOnBranch('0.0.33', 'desktop-nightly-v0.0.33-nightly.20260809.1');
    put('uxnandesktop/src/lib/app.ts', 'export const app = 2;\n');
    commit('feat: more app');

    const report = inspect('desktop', { cwd, channel: 'nightly' });
    assert.equal(report.landed, false);
    assert.equal(report.worthy, true);
    assert.deepEqual(report.substantive, ['uxnandesktop/src/lib/app.ts']);
  });

  it('reports the release as landed once its pull request merges', () => {
    const branch = cutOnBranch('0.0.33', 'desktop-nightly-v0.0.33-nightly.20260809.1');
    git('merge', '-q', '--no-ff', '-m', 'Merge the release', branch);

    const report = inspect('desktop', { cwd, channel: 'nightly' });
    assert.equal(report.landed, true);
    assert.equal(report.worthy, false, 'the merged bump is bookkeeping, not work');
  });
});

describe('inspect — version files', () => {
  it('counts a version file that changed for any other reason', () => {
    // The same `package.json`, this time gaining a dependency. Bookkeeping is
    // about *what* changed in the file, never about the file's name.
    put(
      'uxnandesktop/package.json',
      JSON.stringify(
        { name: 'uxnan-desktop', version: '0.0.32', dependencies: { runed: '^0.23.0' } },
        null,
        2,
      ),
    );
    commit('build: add a dependency');

    const report = inspect('desktop', { cwd, channel: 'nightly' });
    assert.equal(report.worthy, true);
    assert.deepEqual(report.substantive, ['uxnandesktop/package.json']);
  });

  it('does not count a bump that only moved the version line', () => {
    writeVersion('0.0.33');
    commit('build: prepare desktop 0.0.33');

    const report = inspect('desktop', { cwd, channel: 'nightly' });
    assert.equal(report.worthy, false);
    assert.equal(report.nonShipping.length, 5);
  });
});

/**
 * The bridge carries the relay Worker: `uxnan-relay` is private and never
 * published, and its bundle reaches users only inside `uxnan-bridge`. So the
 * bridge is measured over `relay/` and `shared/src/relay/` as well as its own
 * folder, and the cut moves the Worker's own version only when it changed.
 */
const DATE = new Date('2026-10-03T12:00:00Z');

function writeNodeVersions({ bridge, relay }) {
  put('bridge/package.json', JSON.stringify({ name: 'uxnan-bridge', version: bridge }, null, 2));
  put('relay/package.json', JSON.stringify({ name: 'uxnan-relay', version: relay }, null, 2));
  put(
    'package-lock.json',
    JSON.stringify(
      {
        name: 'uxnan-monorepo',
        packages: { bridge: { version: bridge }, relay: { version: relay } },
      },
      null,
      2,
    ) + '\n',
  );
}

/** A bridge release already shipped, carrying relay Worker 0.0.2. */
function seedBridge() {
  put('bridge/src/index.ts', 'export const bridge = 1;\n');
  put('relay/src/worker.ts', 'export default {};\n');
  put('relay/src/local/start-local-relay.ts', 'export const local = 1;\n');
  put('shared/src/relay/protocol.ts', 'export const RELAY_PROTOCOL_VERSION = 1;\n');
  put('shared/src/index.ts', 'export const shared = 1;\n');
  writeNodeVersions({ bridge: '0.0.43-alpha.20261002', relay: '0.0.2-alpha.20260720' });
  commit('feat: bridge and relay');
  git('tag', 'bridge-v0.0.43-alpha.20261002');
}

describe('inspect — the bridge carries the relay Worker', () => {
  it('needs a bridge release when only the Worker changed, and moves the Worker version', () => {
    seedBridge();
    put('relay/src/worker.ts', 'export default { fetch() {} };\n');
    commit('feat(relay): answer fetch');

    const report = inspect('bridge', { cwd, date: DATE });
    assert.equal(report.worthy, true);
    assert.deepEqual(report.substantive, ['relay/src/worker.ts']);
    assert.deepEqual(report.carried, [
      {
        id: 'relay',
        substantive: ['relay/src/worker.ts'],
        worthy: true,
        current: '0.0.2-alpha.20260720',
        next: '0.0.3-alpha.20261003',
      },
    ]);
  });

  it('treats a protocol change in shared/src/relay as a Worker change', () => {
    // esbuild inlines `@uxnan/shared/relay` into the bundle.
    seedBridge();
    put('shared/src/relay/protocol.ts', 'export const RELAY_PROTOCOL_VERSION = 2;\n');
    commit('feat(contracts): relay protocol 2');

    const report = inspect('bridge', { cwd, date: DATE });
    assert.equal(report.worthy, true);
    assert.equal(report.carried[0].worthy, true);
  });

  it('ignores the rest of shared — that is shared release, not a Worker change', () => {
    seedBridge();
    put('shared/src/index.ts', 'export const shared = 2;\n');
    commit('feat(contracts): more shared');

    const report = inspect('bridge', { cwd, date: DATE });
    assert.equal(report.worthy, false);
    assert.deepEqual(report.files, []);
  });

  it('does not count relay prose, tests or the Miniflare harness', () => {
    seedBridge();
    put('relay/FOR-DEV.md', '# FOR-DEV\n');
    put('relay/docs/deploy.md', '# Deploy\n');
    put('relay/test/worker.test.ts', 'test();\n');
    put('relay/src/local/start-local-relay.ts', 'export const local = 2;\n');
    commit('docs(relay): notes, tests and the harness');

    const report = inspect('bridge', { cwd, date: DATE });
    assert.equal(report.worthy, false);
    assert.equal(report.carried[0].worthy, false);
    assert.deepEqual(report.nonShipping.sort(), [
      'relay/FOR-DEV.md',
      'relay/docs/deploy.md',
      'relay/src/local/start-local-relay.ts',
      'relay/test/worker.test.ts',
    ]);
  });

  it('leaves the Worker version alone when only the bridge changed', () => {
    // Moving it would tell every user their deployed relay is out of date.
    seedBridge();
    put('bridge/src/index.ts', 'export const bridge = 2;\n');
    commit('feat(bridge): more bridge');

    const report = inspect('bridge', { cwd, date: DATE });
    assert.equal(report.worthy, true);
    assert.deepEqual(report.substantive, ['bridge/src/index.ts']);
    assert.equal(report.carried[0].worthy, false);
  });

  it("counts the cut's own Worker version bump as bookkeeping", () => {
    seedBridge();
    writeNodeVersions({ bridge: '0.0.44-alpha.20261003', relay: '0.0.3-alpha.20261003' });
    commit('build: prepare bridge 0.0.44-alpha.20261003');

    const report = inspect('bridge', { cwd, date: DATE });
    assert.equal(report.worthy, false);
    assert.deepEqual(report.nonShipping.sort(), ['bridge/package.json', 'relay/package.json']);
  });

  it('never undercuts a historical relay-v tag', () => {
    // Tags from when the relay was a published Node server stay in git and set
    // the floor, whatever the file says.
    seedBridge();
    git('tag', 'relay-v0.0.7-alpha.20260801');
    put('relay/src/worker.ts', 'export default { fetch() {} };\n');
    commit('feat(relay): answer fetch');

    assert.equal(inspect('bridge', { cwd, date: DATE }).carried[0].next, '0.0.8-alpha.20261003');
  });
});
