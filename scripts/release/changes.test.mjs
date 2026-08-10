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
    `[package]\nname = "uxnan-desktop"\nversion = "${version}"\n`,
  );
  put(
    'uxnandesktop/src-tauri/Cargo.lock',
    `[[package]]\nname = "uxnan-desktop"\nversion = "${version}"\n`,
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
