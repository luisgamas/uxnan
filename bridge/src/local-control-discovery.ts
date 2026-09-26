/**
 * The discovery file of the local control channel (architecture/02a §5.8.15):
 * `~/.uxnan/local-control.json`, telling a client on this machine which
 * loopback port the bridge listens on and which token opens it.
 *
 * The file is the credential, so it is written **owner-only** (`0600`) and
 * atomically (temp sibling + rename, the temp file created with the same mode
 * so the token is never readable by others even for an instant). A fresh token
 * is minted every time the listener starts, and the file is removed when it
 * stops — a stale file from a crashed run names a port nobody listens on and a
 * token nothing accepts.
 *
 * On Windows the mode bits are not enforced; the file lives under the user's
 * profile directory, whose ACL already limits it to that user.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LOCAL_CONTROL_PROTOCOL, type LocalControlDiscovery } from '@uxnan/shared';
import { renameWithRetry } from './daemon-state.js';

/** A new random bearer token (256 bits, URL-safe). */
export function mintLocalControlToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Builds the discovery record for a listener that just bound `port`. */
export function buildDiscovery(input: {
  port: number;
  token: string;
  pid: number;
  bridgeVersion: string;
  instanceId: string;
}): LocalControlDiscovery {
  return { protocol: LOCAL_CONTROL_PROTOCOL, ...input };
}

/** Atomically writes the discovery file with owner-only permissions. */
export async function writeDiscoveryFile(
  path: string,
  discovery: LocalControlDiscovery,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(discovery, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try {
    // `mode` on writeFile is masked by the umask; set it explicitly so a
    // permissive umask cannot widen it.
    await chmod(tmp, 0o600).catch(() => undefined);
    await renameWithRetry(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Reads and validates the discovery file; `undefined` when absent or malformed. */
export async function readDiscoveryFile(path: string): Promise<LocalControlDiscovery | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
  return parseDiscovery(raw);
}

/** Validates the shape of a discovery record (untrusted file contents). */
export function parseDiscovery(raw: string): LocalControlDiscovery | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const port = v['port'];
  const token = v['token'];
  const pid = v['pid'];
  const protocol = v['protocol'];
  const bridgeVersion = v['bridgeVersion'];
  const instanceId = v['instanceId'];
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65535 ||
    typeof token !== 'string' ||
    token.length === 0 ||
    typeof pid !== 'number' ||
    typeof protocol !== 'number' ||
    typeof bridgeVersion !== 'string' ||
    typeof instanceId !== 'string'
  ) {
    return undefined;
  }
  return { protocol, port, token, pid, bridgeVersion, instanceId };
}

/**
 * Removes the discovery file, but only if it is still **ours** (same token): a
 * second bridge that started later and rewrote it must keep its own.
 */
export async function removeDiscoveryFile(path: string, token: string): Promise<void> {
  const current = await readDiscoveryFile(path);
  if (current && current.token !== token) return;
  await rm(path, { force: true }).catch(() => undefined);
}
