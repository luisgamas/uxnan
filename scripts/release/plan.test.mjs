import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planCuts, tagPrefixFor } from './plan.mjs';

/** A stand-in for the git-backed inspector, so the rules are testable. */
function inspectorFor(state) {
  return (id, { channel } = {}) => {
    const entry = state[id] ?? { worthy: false, files: [], nonShipping: [] };
    return {
      id,
      since: entry.since ?? `${id}-v0.0.1`,
      files: entry.files ?? [],
      nonShipping: entry.nonShipping ?? [],
      substantive: entry.worthy ? ['src/x.ts'] : [],
      worthy: entry.worthy,
      next:
        entry.next ??
        (id === 'desktop' && channel === 'nightly' ? '0.0.29-nightly.20260807.1' : '0.0.2'),
    };
  };
}

describe('tagPrefixFor', () => {
  it('picks the desktop channel from the request', () => {
    assert.equal(tagPrefixFor('desktop', 'nightly'), 'desktop-nightly-v');
    assert.equal(tagPrefixFor('desktop', 'stable'), 'desktop-stable-v');
  });

  it('ignores the channel for everything else', () => {
    assert.equal(tagPrefixFor('shared', 'nightly'), 'shared-v');
    assert.equal(tagPrefixFor('mobile', 'stable'), 'mobile-v');
  });
});

describe('planCuts', () => {
  it('cuts shared before the packages that resolve it from npm', () => {
    // Order is the whole point: tagging them together published bridge 0.0.14
    // against the previous shared.
    const plan = planCuts({
      components: ['bridge', 'shared'],
      inspector: inspectorFor({ shared: { worthy: true }, bridge: { worthy: true } }),
    });
    assert.deepEqual(
      plan.cuts.map((c) => c.id),
      ['shared', 'bridge'],
    );
    assert.equal(plan.cuts[0].waitFor, '@uxnan/shared');
    assert.deepEqual(plan.cuts[0].blocks, ['bridge', 'relay']);
    assert.equal(plan.cuts[1].waitFor, null);
  });

  it('drops a component whose only changes cannot reach a build', () => {
    const plan = planCuts({
      components: ['relay', 'desktop'],
      channel: 'nightly',
      inspector: inspectorFor({
        relay: {
          worthy: false,
          files: ['relay/FOR-DEV.md', 'relay/test/ws.test.ts'],
          nonShipping: ['relay/FOR-DEV.md', 'relay/test/ws.test.ts'],
        },
        desktop: { worthy: true },
      }),
    });
    assert.deepEqual(
      plan.cuts.map((c) => c.id),
      ['desktop'],
    );
    assert.equal(plan.skipped[0].id, 'relay');
    assert.equal(plan.skipped[0].reason, 'nothing that ships changed');
    assert.deepEqual(plan.skipped[0].files, ['relay/FOR-DEV.md', 'relay/test/ws.test.ts']);
  });

  it('reports an untouched component as having no changes at all', () => {
    const plan = planCuts({ components: ['shared'], inspector: inspectorFor({}) });
    assert.deepEqual(plan.cuts, []);
    assert.equal(plan.skipped[0].reason, 'no changes');
  });

  it('cuts anyway under --force', () => {
    const plan = planCuts({ components: ['shared'], force: true, inspector: inspectorFor({}) });
    assert.equal(plan.cuts.length, 1);
    assert.deepEqual(plan.skipped, []);
  });

  it('builds the desktop tag from the channel', () => {
    const plan = planCuts({
      components: ['desktop'],
      channel: 'nightly',
      inspector: inspectorFor({ desktop: { worthy: true } }),
    });
    assert.equal(plan.cuts[0].tag, 'desktop-nightly-v0.0.29-nightly.20260807.1');
  });

  it('refuses a component it does not know instead of ignoring it', () => {
    assert.throws(
      () => planCuts({ components: ['web'], inspector: inspectorFor({}) }),
      /unknown component/,
    );
  });
});
