import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  COMPONENTS,
  RELEASE_ORDER,
  allVersionFiles,
  component,
  isNonShipping,
  pathsOf,
  within,
} from './components.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the registry', () => {
  it('describes every component the repo releases', () => {
    assert.deepEqual(COMPONENTS.map((c) => c.id).sort(), ['bridge', 'desktop', 'mobile', 'shared']);
  });

  it('points every version file at something that exists', () => {
    // A path typo here is invisible until a release half-bumps the tree.
    for (const meta of COMPONENTS) {
      for (const entry of allVersionFiles(meta)) {
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
      const files = allVersionFiles(meta).map((e) => e.file);
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
    assert.deepEqual(component('shared').releaseBefore, ['bridge']);
    assert.ok(RELEASE_ORDER.indexOf('shared') < RELEASE_ORDER.indexOf('bridge'));
  });

  it('covers every component in the release order', () => {
    assert.deepEqual([...RELEASE_ORDER].sort(), COMPONENTS.map((c) => c.id).sort());
  });

  it('rejects an unknown id instead of returning undefined', () => {
    assert.throws(() => component('web'), /unknown component/);
  });
});

describe('the relay — shipped inside the bridge, never released on its own', () => {
  it('is not a component, and says where it went when asked for', () => {
    assert.ok(!RELEASE_ORDER.includes('relay'));
    assert.throws(() => component('relay'), /ships inside uxnan-bridge/);
  });

  it('is a part the bridge carries, measured over the Worker and the protocol it inlines', () => {
    const [relay] = component('bridge').carries;
    assert.equal(relay.id, 'relay');
    // esbuild inlines `@uxnan/shared/relay` into the bundle, so that file is
    // Worker source as much as `relay/src/` is.
    assert.deepEqual(relay.paths, ['relay', 'shared/src/relay']);
    assert.deepEqual(pathsOf(component('bridge')), ['bridge', 'relay', 'shared/src/relay']);
  });

  it('keeps the historical relay-v tags as the floor of the Worker version line', () => {
    assert.deepEqual(component('bridge').carries[0].tagPrefixes, ['relay-v']);
  });

  it('moves the Worker version in relay/package.json and its root lock entry', () => {
    assert.deepEqual(
      component('bridge').carries[0].versionFiles.map((e) => [e.file, e.pkgPath]),
      [
        ['relay/package.json', undefined],
        ['package-lock.json', 'relay'],
      ],
    );
  });

  it("treats the Miniflare test harness as the bridge's tests, not its package", () => {
    // `uxnan-relay/local` starts the Worker for the bridge's e2e tests; the
    // bridge takes `uxnan-relay` as a devDependency only.
    const bridge = component('bridge');
    assert.equal(isNonShipping('relay/src/local/start-local-relay.ts', bridge), true);
    assert.equal(isNonShipping('relay/src/worker.ts', bridge), false);
    assert.equal(isNonShipping('relay/src/room.ts', bridge), false);
    assert.equal(isNonShipping('relay/scripts/build.mjs', bridge), false);
    assert.equal(isNonShipping('shared/src/relay/protocol.ts', bridge), false);
  });
});

describe('within', () => {
  it('matches a path segment, never a longer name that starts the same', () => {
    assert.equal(within('relay/src/worker.ts', 'relay'), true);
    assert.equal(within('relay', 'relay'), true);
    assert.equal(within('relay-old/x.ts', 'relay'), false);
    assert.equal(within('shared/src/relay/protocol.ts', 'shared/src/relay'), true);
    assert.equal(within('shared/src/relay.ts', 'shared/src/relay'), false);
  });
});

describe('isNonShipping — a component that says what does not ship', () => {
  it("excludes the desktop's own tooling, and only the desktop's", () => {
    // Tauri bundles no resources from there and its beforeBuildCommand is the
    // Vite build, so a change under `uxnandesktop/scripts/` cannot reach an
    // installer. The bridge's identically-named folder is published to npm.
    const desktop = component('desktop');
    const bridge = component('bridge');
    const file = 'uxnandesktop/scripts/check-version-sync.mjs';

    assert.equal(isNonShipping(file, desktop), true);
    assert.equal(isNonShipping(file), false, 'not a global rule');
    assert.equal(isNonShipping('bridge/scripts/install-service-linux.sh', bridge), false);
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
      'uxnandesktop/src-tauri/crates/workspace-engine/src/agentcli.rs',
      // `bridge/package.json` lists `scripts` in its `files`, so these are
      // published to npm. A blanket `scripts/` rule would drop real shipped
      // content — which is why the desktop's exception is per-component.
      'bridge/scripts/install-service-linux.sh',
      // "latest" is not "test": the rule must match a path segment, not a
      // substring of a longer word.
      'uxnandesktop/src/lib/latest/index.ts',
      'bridge/src/protest-banner.ts',
    ]) {
      assert.equal(isNonShipping(file), false, file);
    }
  });
});
