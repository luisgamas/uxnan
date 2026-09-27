#!/usr/bin/env node
// Drives the bridge a CI runner installed as its user service, through the
// installed package's own local-control client — the path `uxnan-bridge update`
// takes — so a platform check exercises the real code, not a copy of it.
//
//   node scripts/smoke/bridge-service.mjs wait <version> [seconds]
//       until the running bridge reports <version> with no update under way
//   node scripts/smoke/bridge-service.mjs update
//       ask the running bridge to check for and install the newest version
//   node scripts/smoke/bridge-service.mjs wait-failed [seconds]
//       until the running bridge reports its last update as failed
//
// Used by .github/workflows/smoke-platforms.yml. Prints one JSON line per
// observation; exits non-zero when the expected state never comes.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'uxnan-bridge');
const load = (file) => import(pathToFileURL(join(root, 'dist', 'src', file)).href);
const { DaemonState } = await load('index.js');
const { callRunningBridge } = await load('local-control-client.js');
const state = new DaemonState();

async function call(method, params) {
  try {
    return (await callRunningBridge(state, method, params))?.result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function poll(seconds, done) {
  const deadline = Date.now() + seconds * 1000;
  let last;
  while (Date.now() < deadline) {
    last = await call('bridge/status');
    if (last && !last.error && done(last)) {
      console.log(JSON.stringify({ ok: true, version: last.version, update: last.update }));
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(JSON.stringify({ ok: false, last: last ?? null }));
  process.exit(1);
}

const [command, arg, secondsArg] = process.argv.slice(2);
switch (command) {
  case 'wait':
    await poll(
      Number(secondsArg ?? 120),
      (s) => s.version === arg && s.update?.phase !== 'updating',
    );
    break;
  case 'wait-failed':
    await poll(Number(arg ?? 180), (s) => s.update?.phase === 'failed');
    break;
  case 'update': {
    const check = await call('bridge/checkForUpdate');
    console.log(JSON.stringify({ checked: check ?? null }));
    const update = await call('bridge/update');
    console.log(JSON.stringify({ update: update ?? null }));
    if (!update || update.error || update.phase !== 'updating') process.exit(1);
    break;
  }
  default:
    console.error(
      'usage: bridge-service.mjs wait <version> [seconds] | update | wait-failed [seconds]',
    );
    process.exit(2);
}
