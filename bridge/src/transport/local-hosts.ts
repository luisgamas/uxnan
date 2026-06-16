/**
 * Enumerate the bridge's directly-reachable `host:port` addresses so they can be
 * advertised in the pairing QR. The phone tries these FIRST (direct LAN/Tailscale)
 * and falls back to the relay.
 *
 * Includes every non-internal IPv4 the machine has — the LAN address(es) and, when
 * present, a Tailscale `100.x` address (its interface is a normal non-internal
 * IPv4, so a phone on the same tailnet connects directly with no hosted relay).
 *
 * Pure over an injected `networkInterfaces()` result so it can be unit-tested.
 */
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** The non-internal IPv4 addresses (no port) — e.g. for mDNS A records. */
export function localIPv4s(ifaces: InterfaceMap = networkInterfaces()): string[] {
  const addrs = new Set<string>();
  for (const infos of Object.values(ifaces)) {
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
