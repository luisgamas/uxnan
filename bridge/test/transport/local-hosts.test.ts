import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHostPorts, type InterfaceMap } from '../../src/index.js';

const IFACES = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  eth0: [
    { address: '192.168.1.20', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
  ],
  // Tailscale interface — a normal non-internal IPv4 (100.x), so it is included.
  tailscale0: [{ address: '100.64.0.5', family: 'IPv4', internal: false }],
} as unknown as InterfaceMap;

test('localHostPorts lists non-internal IPv4 addresses with the port, sorted', () => {
  assert.deepEqual(localHostPorts(7777, IFACES), ['100.64.0.5:7777', '192.168.1.20:7777']);
});

test('localHostPorts excludes loopback and IPv6', () => {
  const hosts = localHostPorts(7777, IFACES);
  assert.ok(!hosts.some((h) => h.startsWith('127.')));
  assert.ok(!hosts.some((h) => h.includes('fe80')));
});

test('localHostPorts accepts the numeric family form (Node may report 4)', () => {
  const numeric = {
    eth0: [{ address: '10.0.0.2', family: 4, internal: false }],
  } as unknown as InterfaceMap;
  assert.deepEqual(localHostPorts(8080, numeric), ['10.0.0.2:8080']);
});

test('localHostPorts returns an empty list when there are no usable addresses', () => {
  const onlyLoopback = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  } as unknown as InterfaceMap;
  assert.deepEqual(localHostPorts(7777, onlyLoopback), []);
});
