import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHostPorts, type InterfaceMap } from '../../src/index.js';
import { isVirtualInterfaceName } from '../../src/transport/local-hosts.js';

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

test('localHostPorts excludes host-only virtual adapters (Hyper-V/WSL/Docker/etc.)', () => {
  // These report as non-internal IPv4 but are unreachable from a phone, so
  // advertising them just wastes a connect timeout per dead address (Bug A).
  const withVirtual = {
    Ethernet: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
    Tailscale: [{ address: '100.64.0.5', family: 'IPv4', internal: false }],
    'vEthernet (Default Switch)': [{ address: '172.27.192.1', family: 'IPv4', internal: false }],
    'vEthernet (WSL (Hyper-V firewall))': [
      { address: '172.30.0.1', family: 'IPv4', internal: false },
    ],
    'VirtualBox Host-Only Network': [{ address: '192.168.56.1', family: 'IPv4', internal: false }],
    'VMware Network Adapter VMnet8': [{ address: '192.168.92.1', family: 'IPv4', internal: false }],
    docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
  } as unknown as InterfaceMap;
  // Only the real LAN NIC and Tailscale survive; every virtual adapter is dropped.
  assert.deepEqual(localHostPorts(7777, withVirtual), ['100.64.0.5:7777', '192.168.1.20:7777']);
});

test('isVirtualInterfaceName keeps real LAN and Tailscale interfaces', () => {
  for (const real of [
    'Ethernet',
    'Ethernet 2',
    'Wi-Fi',
    'Tailscale',
    'tailscale0',
    'utun3',
    'eth0',
    'en0',
  ]) {
    assert.equal(isVirtualInterfaceName(real), false, `${real} must be advertised`);
  }
  for (const virtual of [
    'vEthernet (WSL)',
    'Default Switch',
    'docker0',
    'br-1a2b3c',
    'VirtualBox Host-Only Network',
    'VMware Network Adapter VMnet1',
  ]) {
    assert.equal(isVirtualInterfaceName(virtual), true, `${virtual} must be filtered`);
  }
});
