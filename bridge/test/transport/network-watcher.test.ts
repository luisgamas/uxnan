import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkWatcher, type InterfaceMap } from '../../src/index.js';

const iface = (address: string): InterfaceMap[string] => [
  {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:01',
    internal: false,
    cidr: `${address}/24`,
  },
];

test('NetworkWatcher reports a new address set once, and stays quiet when nothing changed', () => {
  let current: InterfaceMap = { en0: iface('192.168.18.22') };
  const seen: string[][] = [];
  const watcher = new NetworkWatcher({ interfaces: () => current, onChange: (a) => seen.push(a) });
  assert.deepEqual(watcher.addresses, ['192.168.18.22']);

  assert.equal(watcher.check(), false);
  current = { en0: iface('192.168.100.140'), utun4: iface('100.76.97.16') };
  assert.equal(watcher.check(), true);
  assert.equal(watcher.check(), false);
  assert.deepEqual(seen, [['100.76.97.16', '192.168.100.140']]);
  assert.deepEqual(watcher.addresses, ['100.76.97.16', '192.168.100.140']);
});

test('NetworkWatcher ignores a virtual adapter coming and going', () => {
  let current: InterfaceMap = { en0: iface('192.168.1.5') };
  const seen: string[][] = [];
  const watcher = new NetworkWatcher({ interfaces: () => current, onChange: (a) => seen.push(a) });
  current = {
    en0: iface('192.168.1.5'),
    docker0: iface('172.17.0.1'),
    vmnet8: iface('192.168.56.1'),
  };
  assert.equal(watcher.check(), false);
  assert.deepEqual(seen, []);
});

test('NetworkWatcher start and stop are idempotent and never keep the process alive', () => {
  const watcher = new NetworkWatcher({
    interfaces: () => ({}),
    onChange: () => undefined,
    pollMs: 5,
  });
  watcher.start();
  watcher.start();
  watcher.stop();
  watcher.stop();
});
