/**
 * Enumerate the bridge's directly-reachable `host:port` addresses so they can be
 * advertised in the pairing QR. The phone tries these FIRST (direct LAN/Tailscale)
 * and falls back to the relay.
 *
 * Includes every non-internal IPv4 the machine has — the LAN address(es) and, when
 * present, a Tailscale `100.x` address (its interface is a normal non-internal
 * IPv4, so a phone on the same tailnet connects directly with no hosted relay) —
 * EXCEPT addresses on host-only virtual adapters (Hyper-V/WSL switches, Docker,
 * VirtualBox, VMware). Those report as non-internal IPv4 too but are unreachable
 * from a phone, so advertising them just makes the phone burn a full connect
 * timeout per dead address on every (re)connect (Bug A relink latency).
 *
 * Pure over an injected `networkInterfaces()` result so it can be unit-tested.
 */
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * Interface-name fragments that denote a host-only virtual adapter whose IPv4 the
 * OS reports as non-internal but which is NOT reachable from another device on the
 * network. Matched case-insensitively as a substring of the OS interface name.
 *
 * Deliberately conservative: it must never match a real LAN NIC ("Ethernet",
 * "Wi-Fi") or a Tailscale interface (Windows "Tailscale", Linux "tailscale0",
 * macOS "utunN") — those stay advertised so direct LAN/Tailscale keeps working.
 */
const VIRTUAL_INTERFACE_PATTERNS = [
  'vethernet', // Windows Hyper-V / WSL virtual switch, e.g. "vEthernet (WSL)"
  'default switch', // Windows Hyper-V "Default Switch"
  'hyper-v',
  'wsl',
  'virtualbox',
  'vboxnet', // VirtualBox host-only
  'vmware',
  'vmnet', // VMware host-only
  'docker',
  'br-', // Docker bridge networks (Linux)
  'veth', // Linux container veth pair
  'loopback', // pseudo loopback adapters
];

/** Whether [name] is a host-only virtual adapter we should not advertise. */
export function isVirtualInterfaceName(name: string): boolean {
  const lower = name.toLowerCase();
  return VIRTUAL_INTERFACE_PATTERNS.some((fragment) => lower.includes(fragment));
}

/** The non-internal IPv4 addresses (no port) — e.g. for mDNS A records. */
export function localIPv4s(ifaces: InterfaceMap = networkInterfaces()): string[] {
  const addrs = new Set<string>();
  for (const [name, infos] of Object.entries(ifaces)) {
    if (isVirtualInterfaceName(name)) continue;
    for (const info of infos ?? []) {
      // Node 18+ may report `family` as the string 'IPv4' or the number 4.
      const isIPv4 = info.family === 'IPv4' || (info.family as unknown) === 4;
      if (isIPv4 && !info.internal && info.address) addrs.add(info.address);
    }
  }
  return [...addrs].sort();
}

/** Build `host:port` strings from the non-internal IPv4 addresses in `ifaces`. */
export function localHostPorts(port: number, ifaces: InterfaceMap = networkInterfaces()): string[] {
  return localIPv4s(ifaces).map((address) => `${address}:${port}`);
}
