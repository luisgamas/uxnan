import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { COMPONENTS, RELEASE_ORDER, component, isNonShipping } from './components.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the registry', () => {
  it('describes every component the repo releases', () => {
    assert.deepEqual(COMPONENTS.map((c) => c.id).sort(), [
      'bridge',
      'desktop',
      'mobile',
      'relay',
      'shared',
    ]);
  });

  it('points every version file at something that exists', () => {
    // A path typo here is invisible until a release half-bumps the tree.
    for (const meta of COMPONENTS) {
      for (const entry of meta.versionFiles) {
        assert.ok(existsSync(join(repo, entry.file)), `${meta.id}: missing ${entry.file}`);
      }
    }
  });

  it('gives the desktop both channels, since one numeric line feeds both', () => {
    assert.deepEqual(component('desktop').tagPrefixes, ['desktop-stable-v', 'desktop-nightly-v']);
  });

  it('bumps the lockfile alongside every manifest', () => {
    // The rule docs/releases.md states in prose: a manifest without its lock is the
    // drift that `--allow-same-version` hides at build time.
    for (const meta of COMPONENTS) {
      const files = meta.versionFiles.map((e) => e.file);
      const manifests = files.filter((f) => f.endsWith('package.json'));
      for (const manifest of manifests) {
        const hasLock = files.some((f) => f.endsWith('package-lock.json'));
        assert.ok(hasLock, `${meta.id}: ${manifest} has no lockfile in the bump list`);
      }
      if (files.some((f) => f.endsWith('Cargo.toml'))) {
        assert.ok(
          files.some((f) => f.endsWith('Cargo.lock')),
          `${meta.id}: Cargo.toml has no Cargo.lock in the bump list`,
        );
      }
    }
  });

  it('orders shared before the packages that resolve it from npm', () => {
    // The bridge pins @uxnan/shared by reading npm at build time, so tagging
    // them together publishes a bridge against the previous shared.
    assert.deepEqual(component('shared').releaseBefore, ['bridge', 'relay']);
    assert.ok(RELEASE_ORDER.indexOf('shared') < RELEASE_ORDER.indexOf('bridge'));
    assert.ok(RELEASE_ORDER.indexOf('shared') < RELEASE_ORDER.indexOf('relay'));
  });

  it('covers every component in the release order', () => {
    assert.deepEqual([...RELEASE_ORDER].sort(), COMPONENTS.map((c) => c.id).sort());
  });

  it('rejects an unknown id instead of returning undefined', () => {
    assert.throws(() => component('web'), /unknown component/);
  });
});

describe('isNonShipping', () => {
  it('treats prose and specs as unable to change a build', () => {
    for (const file of [
      'relay/FOR-DEV.md',
      'bridge/README.md',
      'uxnandesktop/docs/agent-launch.md',
      'uxnandesktop/architecture/02b-terminal-engine.md',
      'architecture.old/whitepaper.md',
      '.github/workflows/ci-node.yml',
    ]) {
      assert.equal(isNonShipping(file), true, file);
    }
  });

  it('treats tests and their helpers as unable to change a build', () => {
    // A test proves something about code that already shipped. Cutting a
    // nightly for one means four installers and an updater roll for a build
    // nobody can tell apart — which is exactly what happened the day
    // `setup.dom.ts` was fixed.
    for (const file of [
      'uxnandesktop/src/test/setup.dom.ts',
      'uxnandesktop/src/lib/components/FileTreePanel.svelte.test.ts',
      'uxnandesktop/src/lib/agentModel.test.ts',
      'bridge/test/handlers/threads.test.ts',
      'scripts/release/changes.test.mjs',
      'uxnandesktop/tests/platform-support.json',
      'shared/src/__tests__/validators.spec.ts',
    ]) {
      assert.equal(isNonShipping(file), true, file);
    }
  });

  it('treats anything that ships as release-worthy', () => {
    for (const file of [
      'bridge/src/adapters/zero-adapter.ts',
      'uxnandesktop/src/lib/agentCatalog.ts',
      'uxnandesktop/static/agents/codex.svg',
      'uxnanmobile/lib/main.dart',
      'shared/package.json',
      'uxnandesktop/src-tauri/Cargo.toml',
      // Rust keeps its unit tests inline under `#[cfg(test)]`, so a file with
      // tests in it is still a source file. Erring toward releasing is correct.
      'uxnandesktop/src-tauri/src/agentcli.rs',
      // "latest" is not "test": the rule must match a path segment, not a
      // substring of a longer word.
      'uxnandesktop/src/lib/latest/index.ts',
      'bridge/src/protest-banner.ts',
    ]) {
      assert.equal(isNonShipping(file), false, file);
    }
  });
});
