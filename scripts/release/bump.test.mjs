import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { applyVersion, assertConsistent, readCurrent, versionForFiles } from './bump.mjs';
import { component } from './components.mjs';

/** A throwaway tree shaped like the repo, so the writers run for real. */
let cwd;

function put(file, contents) {
  const path = join(cwd, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** Every file the desktop carries a version in, all agreeing at 0.0.28. */
function seedDesktop(version = '0.0.28') {
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
    `version = 3\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\n\n[[package]]\nname = "uxnan-desktop"\nversion = "${version}"\n`,
  );
  put(
    'uxnandesktop/package.json',
    JSON.stringify({ name: 'uxnan-desktop', version }, null, 2) + '\n',
  );
  put(
    'uxnandesktop/package-lock.json',
    JSON.stringify({ name: 'uxnan-desktop', version, packages: { '': { version } } }, null, 2) +
      '\n',
  );
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'uxnan-bump-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('versionForFiles', () => {
  it('strips the pre-release id for the desktop', () => {
    // The Windows MSI rejects a non-numeric version; the full one rides the tag.
    assert.equal(versionForFiles('desktop', '0.0.29-nightly.20260806.1'), '0.0.29');
    assert.equal(versionForFiles('desktop', '0.0.29'), '0.0.29');
  });

  it('leaves every other component version exactly as tagged', () => {
    assert.equal(versionForFiles('shared', '0.0.14-alpha.20260806'), '0.0.14-alpha.20260806');
    assert.equal(
      versionForFiles('mobile', '0.0.19-alpha.20260806+20260806'),
      '0.0.19-alpha.20260806+20260806',
    );
  });
});

describe('applyVersion', () => {
  it('writes the base into all five desktop files', () => {
    seedDesktop();
    const changes = applyVersion('desktop', '0.0.29-nightly.20260806.1', { cwd });

    assert.equal(changes.length, component('desktop').versionFiles.length);
    for (const change of changes) {
      assert.equal(change.from, '0.0.28');
      assert.equal(change.to, '0.0.29');
    }
    for (const entry of readCurrent('desktop', { cwd })) {
      assert.equal(entry.version, '0.0.29', entry.file);
    }
  });

  it('leaves neighbouring crates and the lock root in agreement', () => {
    seedDesktop();
    applyVersion('desktop', '0.0.29', { cwd });
    const lock = JSON.parse(readFileSync(join(cwd, 'uxnandesktop/package-lock.json'), 'utf8'));
    assert.equal(lock.version, '0.0.29');
    assert.equal(lock.packages[''].version, '0.0.29');
    assert.match(
      readFileSync(join(cwd, 'uxnandesktop/src-tauri/Cargo.lock'), 'utf8'),
      /name = "serde"\nversion = "1\.0\.200"/,
    );
  });

  it('changes nothing on a dry run', () => {
    seedDesktop();
    applyVersion('desktop', '0.0.29', { cwd, dryRun: true });
    for (const entry of readCurrent('desktop', { cwd })) {
      assert.equal(entry.version, '0.0.28', entry.file);
    }
  });
});

describe('assertConsistent', () => {
  it('passes when every file agrees', () => {
    seedDesktop();
    assert.doesNotThrow(() => assertConsistent('desktop', '0.0.28', { cwd }));
  });

  it('names the file that drifted', () => {
    // This is the check that would have caught the lock sitting at 0.0.2 while
    // the app shipped 0.0.4.
    seedDesktop();
    put(
      'uxnandesktop/package-lock.json',
      JSON.stringify(
        { name: 'uxnan-desktop', version: '0.0.2', packages: { '': { version: '0.0.2' } } },
        null,
        2,
      ),
    );
    assert.throws(
      () => assertConsistent('desktop', '0.0.28', { cwd }),
      /package-lock\.json: 0\.0\.2/,
    );
  });
});
