import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  buildServicePlan,
  buildWindowsStartupPlan,
  isServicePlatformSupported,
  type ServiceEnv,
} from '../src/index.js';

const NODE = '/usr/bin/node';
const CLI = '/opt/uxnan/cli.js';
const HOME = '/home/dev';

function envFor(platform: ServiceEnv['platform'], extra: Partial<ServiceEnv> = {}): ServiceEnv {
  return { platform, execPath: NODE, cliPath: CLI, home: HOME, ...extra };
}

test('isServicePlatformSupported recognizes the three desktop platforms', () => {
  assert.equal(isServicePlatformSupported('win32'), true);
  assert.equal(isServicePlatformSupported('darwin'), true);
  assert.equal(isServicePlatformSupported('linux'), true);
  assert.equal(isServicePlatformSupported('aix'), false);
});

test('windows plan registers a logon Task Scheduler task at LIMITED run level', () => {
  const plan = buildServicePlan(envFor('win32'));
  assert.equal(plan.file, undefined);
  const argv = plan.install[0]!.argv;
  assert.equal(argv[0], 'schtasks');
  assert.ok(argv.includes('/Create'));
  assert.equal(argv[argv.indexOf('/SC') + 1], 'ONLOGON');
  assert.equal(argv[argv.indexOf('/RL') + 1], 'LIMITED');
  // /TR is one quoted command string: "<node>" "<cli>" start
  assert.equal(argv[argv.indexOf('/TR') + 1], `"${NODE}" "${CLI}" start`);
  // uninstall deletes the same task
  assert.deepEqual(plan.uninstall[0]!.argv, ['schtasks', '/Delete', '/TN', plan.label, '/F']);
});

test('macOS plan writes a LaunchAgent plist and loads it', () => {
  const plan = buildServicePlan(envFor('darwin'));
  const plist = join(HOME, 'Library', 'LaunchAgents', 'dev.luisgamas.bridge.plist');
  assert.equal(plan.file?.path, plist);
  assert.equal(plan.removeFile, plist);
  assert.ok(plan.file!.content.includes(`<string>${NODE}</string>`));
  assert.ok(plan.file!.content.includes(`<string>${CLI}</string>`));
  assert.ok(plan.file!.content.includes('<key>RunAtLoad</key><true/>'));
  assert.ok(plan.file!.content.includes('<key>KeepAlive</key><true/>'));
  // unload-before-load is best-effort; load is required
  assert.equal(plan.install[0]!.ignoreFailure, true);
  assert.deepEqual(plan.install[1]!.argv, ['launchctl', 'load', plist]);
  // log dir is ensured
  assert.ok(plan.dirs.includes(join(HOME, '.uxnan', 'logs')));
});

test('linux plan writes a systemd --user unit and enables it', () => {
  const plan = buildServicePlan(envFor('linux'));
  const unit = join(HOME, '.config', 'systemd', 'user', 'uxnan-bridge.service');
  assert.equal(plan.file?.path, unit);
  assert.ok(plan.file!.content.includes(`ExecStart=${NODE} ${CLI} start`));
  assert.ok(plan.file!.content.includes('WantedBy=default.target'));
  assert.deepEqual(plan.install[0]!.argv, ['systemctl', '--user', 'daemon-reload']);
  assert.deepEqual(plan.install[1]!.argv, ['systemctl', '--user', 'enable', '--now', plan.label]);
});

test('linux plan honors XDG_CONFIG_HOME', () => {
  const plan = buildServicePlan(envFor('linux', { xdgConfigHome: '/cfg' }));
  assert.equal(plan.file?.path, join('/cfg', 'systemd', 'user', 'uxnan-bridge.service'));
});

test('windows Startup fallback writes a hidden .vbs launcher with quoted paths', () => {
  const APPDATA = 'C:\\Users\\dev\\AppData\\Roaming';
  const plan = buildWindowsStartupPlan(envFor('win32', { appData: APPDATA }));
  const vbs = join(
    APPDATA,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'uxnan-bridge.vbs',
  );
  assert.equal(plan.file?.path, vbs);
  assert.equal(plan.removeFile, vbs);
  // hidden launch (window style 0, no wait) with the doubled-quote VBScript escaping
  assert.ok(plan.file!.content.includes('CreateObject("WScript.Shell")'));
  const literal = `"${`"${NODE}" "${CLI}" start`.replace(/"/g, '""')}"`;
  assert.ok(plan.file!.content.includes(`sh.Run ${literal}, 0, False`));
});
