import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adapterFor,
  cargoLock,
  cargoToml,
  json,
  lockRoot,
  lockWorkspace,
  pubspec,
} from './adapters.mjs';

describe('json', () => {
  const text = '{\n  "name": "uxnan-bridge",\n  "version": "0.0.18-alpha.20260805"\n}\n';

  it('reads and writes the version, keeping the trailing newline', () => {
    assert.equal(json.read(text), '0.0.18-alpha.20260805');
    const next = json.write(text, '0.0.19-alpha.20260806');
    assert.equal(json.read(next), '0.0.19-alpha.20260806');
    assert.ok(next.endsWith('}\n'));
  });

  it('leaves the rest of the document intact', () => {
    assert.equal(JSON.parse(json.write(text, '1.2.3')).name, 'uxnan-bridge');
  });
});

describe('json — formatting', () => {
  // The bug this exists to prevent: the first real release cut reformatted a
  // one-line array in tauri.conf.json, inside its CSP block.
  const tauri = [
    '{',
    '  "$schema": "https://schema.tauri.app/config/2",',
    '  "productName": "Uxnan Desktop",',
    '  "version": "0.0.28",',
    '  "app": {',
    '    "security": {',
    '      "dangerousDisableAssetCspModification": ["style-src"]',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');

  it('changes the version line and nothing else', () => {
    const next = json.write(tauri, '0.0.29');
    assert.equal(json.read(next), '0.0.29');
    assert.equal(next, tauri.replace('"version": "0.0.28"', '"version": "0.0.29"'));
    assert.match(next, /"dangerousDisableAssetCspModification": \["style-src"\]/);
  });

  it('never mistakes a nested version for the top-level one', () => {
    const nested = '{\n  "version": "0.0.28",\n  "deps": {\n    "version": "9.9.9"\n  }\n}\n';
    const next = json.write(nested, '0.0.29');
    assert.equal(json.read(next), '0.0.29');
    assert.match(next, /"version": "9\.9\.9"/);
  });

  it('still works on a file it cannot edit surgically', () => {
    // Minified: no indentation to anchor to, so it falls back to re-serialising.
    const minified = '{"name":"x","version":"0.0.28"}';
    assert.equal(json.read(json.write(minified, '0.0.29')), '0.0.29');
  });
});

describe('lockWorkspace', () => {
  // The root lock is the file that silently drifts: `npm version -w` updates it,
  // a hand edit of package.json does not.
  const text = JSON.stringify(
    {
      name: 'uxnan-monorepo',
      packages: { '': { name: 'uxnan-monorepo' }, shared: { version: '0.0.13' } },
    },
    null,
    2,
  );

  it('reads and writes the workspace entry', () => {
    assert.equal(lockWorkspace.read(text, { pkgPath: 'shared' }), '0.0.13');
    const next = lockWorkspace.write(text, '0.0.14', { pkgPath: 'shared' });
    assert.equal(lockWorkspace.read(next, { pkgPath: 'shared' }), '0.0.14');
  });

  it('refuses a workspace the lock does not know', () => {
    assert.throws(() => lockWorkspace.write(text, '1.0.0', { pkgPath: 'nope' }), /no entry/);
  });
});

describe('lockRoot', () => {
  const text = JSON.stringify(
    {
      name: 'uxnan-desktop',
      version: '0.0.28',
      packages: { '': { name: 'uxnan-desktop', version: '0.0.28' } },
    },
    null,
    2,
  );

  it('writes both the root version and packages[""]', () => {
    // Missing the second one is exactly how the desktop lock sat at 0.0.2.
    const next = JSON.parse(lockRoot.write(text, '0.0.29'));
    assert.equal(next.version, '0.0.29');
    assert.equal(next.packages[''].version, '0.0.29');
  });
});

describe('cargoToml', () => {
  const text = `[package]\nname = "uxnan-desktop"\nversion = "0.0.28"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1.0" }\n`;

  it('reads the crate version', () => {
    assert.equal(cargoToml.read(text), '0.0.28');
  });

  it('writes only the crate version, never a dependency', () => {
    const next = cargoToml.write(text, '0.0.29');
    assert.match(next, /name = "uxnan-desktop"\nversion = "0\.0\.29"/);
    assert.match(next, /serde = \{ version = "1\.0" \}/);
  });
});

describe('cargoLock', () => {
  const text = `# auto-generated\nversion = 3\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\n\n[[package]]\nname = "uxnan-desktop"\nversion = "0.0.28"\ndependencies = [\n "serde",\n]\n\n[[package]]\nname = "tauri"\nversion = "2.0.0"\n`;

  it('finds the named crate among many', () => {
    assert.equal(cargoLock.read(text, { crate: 'uxnan-desktop' }), '0.0.28');
  });

  it('writes that crate and leaves its neighbours alone', () => {
    const next = cargoLock.write(text, '0.0.29', { crate: 'uxnan-desktop' });
    assert.equal(cargoLock.read(next, { crate: 'uxnan-desktop' }), '0.0.29');
    assert.equal(cargoLock.read(next, { crate: 'serde' }), '1.0.200');
    assert.equal(cargoLock.read(next, { crate: 'tauri' }), '2.0.0');
  });

  it('refuses a crate that is not there', () => {
    assert.throws(() => cargoLock.write(text, '1.0.0', { crate: 'ghost' }), /no \[\[package\]\]/);
  });
});

describe('pubspec', () => {
  const text = `name: uxnanmobile\ndescription: Uxnan Mobile\npublish_to: 'none'\nversion: 0.0.18-alpha.20260805+20260805\n\nenvironment:\n  sdk: '>=3.4.0 <3.7.0'\n`;

  it('reads and writes the app version', () => {
    assert.equal(pubspec.read(text), '0.0.18-alpha.20260805+20260805');
    const next = pubspec.write(text, '0.0.19-alpha.20260806+20260806');
    assert.equal(pubspec.read(next), '0.0.19-alpha.20260806+20260806');
  });

  it('does not touch the sdk constraint', () => {
    assert.match(pubspec.write(text, '1.0.0'), /sdk: '>=3\.4\.0 <3\.7\.0'/);
  });
});

describe('adapterFor', () => {
  it('resolves every name the registry uses', () => {
    for (const name of [
      'json',
      'lock-workspace',
      'lock-root',
      'cargo-toml',
      'cargo-lock',
      'pubspec',
    ]) {
      assert.equal(typeof adapterFor(name).read, 'function');
    }
  });

  it('fails loudly on an unknown one', () => {
    assert.throws(() => adapterFor('nope'), /unknown version-file adapter/);
  });
});
