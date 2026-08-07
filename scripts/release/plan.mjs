#!/usr/bin/env node
/**
 * What a release run should cut, in what order — decided here so the workflow
 * YAML only has to execute it.
 *
 * Two rules it exists to enforce, both learned the hard way:
 *
 *  - **Nothing empty.** A component whose only change since its tag is a
 *    checklist gets skipped, not published.
 *  - **Order.** `shared` is cut first and the consumers wait for npm to serve
 *    it, because `release-npm.yml` resolves `@uxnan/shared` at build time.
 *    Tagging them together published bridge 0.0.14 against the previous shared.
 *
 * Usage:
 *   node scripts/release/plan.mjs --components=shared,bridge [--channel=nightly] [--force]
 *   node scripts/release/plan.mjs --scheduled     # the nightly cron's plan
 */

import { inspect } from './changes.mjs';
import { component, RELEASE_ORDER } from './components.mjs';
import { tagsFor } from './git.mjs';
import { assertMovesForward } from './version.mjs';

/** The tag prefix a cut writes, which for the desktop depends on the channel. */
export function tagPrefixFor(id, channel) {
  const meta = component(id);
  if (meta.kind !== 'desktop') return meta.tagPrefixes[0];
  return channel === 'nightly' ? 'desktop-nightly-v' : 'desktop-stable-v';
}

/**
 * Orders the requested components and drops the ones with nothing to ship.
 *
 * @param {object} input
 * @param {string[]} input.components ids the operator asked for
 * @param {'stable'|'nightly'} [input.channel] desktop channel
 * @param {boolean} [input.force] cut even without release-worthy changes
 * @param {(id: string) => object} [input.inspector] injected for tests
 * @returns {{cuts: object[], skipped: object[]}}
 */
export function planCuts({ components, channel = 'stable', force = false, inspector = inspect }) {
  const wanted = RELEASE_ORDER.filter((id) => components.includes(id));
  const unknown = components.filter((id) => !RELEASE_ORDER.includes(id));
  if (unknown.length > 0) throw new Error(`unknown component(s): ${unknown.join(', ')}`);

  const cuts = [];
  const skipped = [];

  for (const id of wanted) {
    const report = inspector(id, { channel });
    if (!report.worthy && !force) {
      skipped.push({
        id,
        since: report.since,
        reason: report.files.length > 0 ? 'only docs changed' : 'no changes',
        files: report.docsOnly,
      });
      continue;
    }
    cuts.push({
      id,
      version: report.next,
      tag: `${tagPrefixFor(id, channel)}${report.next}`,
      // Consumers that resolve this from npm must wait for it to be visible.
      waitFor: component(id).releaseBefore.length > 0 ? component(id).name : null,
      blocks: component(id).releaseBefore,
    });
  }

  return { cuts, skipped };
}

if (process.argv[1] && process.argv[1].endsWith('plan.mjs')) {
  const args = process.argv.slice(2);
  const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const scheduled = args.includes('--scheduled');

  const channel = scheduled ? 'nightly' : (flag('channel') ?? 'stable');
  const components = scheduled
    ? ['desktop']
    : (flag('components') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  if (components.length === 0) {
    console.error('nothing requested — pass --components=… or --scheduled');
    process.exit(2);
  }

  const plan = planCuts({ components, channel, force: args.includes('--force') });

  // Refusing a version that cannot move forward belongs here, before anything
  // is written: a reused desktop base does not fail, it ships invisibly.
  for (const cut of plan.cuts) {
    assertMovesForward({ version: cut.version, tags: tagsFor(component(cut.id).tagPrefixes) });
  }

  process.stdout.write(JSON.stringify({ ...plan, channel }, null, 2) + '\n');
}
