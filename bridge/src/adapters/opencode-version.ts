/**
 * Which OpenCode is installed, and the protocol client that speaks it.
 *
 * The version is read from `opencode --version` — `1.18.32` on OpenCode 1,
 * `opencode v2.0.16` on OpenCode 2 — each time the adapter starts a server
 * (rare: once per working directory), so an OpenCode upgraded while the bridge
 * runs is spoken to correctly from its next server on.
 */
import { OpenCodeV1Server } from './opencode-v1.js';
import { OpenCodeV2Server } from './opencode-v2.js';
import type { IOpenCodeServer, OpenCodeProtocolVersion } from './opencode-protocol.js';
import type { SpawnFn, SpawnedProcess } from './spawn.js';

/** How long `opencode --version` may take before the answer counts as unknown. */
const VERSION_TIMEOUT_MS = 10_000;

/**
 * The major version `--version` output names: the first token shaped like
 * `X.Y…` (a leading `v` allowed). A bare number is not taken for a version.
 */
export function parseOpenCodeMajor(output: string): number | undefined {
  for (const token of output.split(/\s+/)) {
    const match = /^[vV]?(\d+)\.(\d)/.exec(token);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** The protocol a major version speaks. Anything from 2 on speaks V2. */
export function protocolFor(major: number | undefined): OpenCodeProtocolVersion {
  return major !== undefined && major >= 2 ? 2 : 1;
}

/**
 * Ask the binary its version. Resolves `undefined` when it cannot say (it failed
 * to run, timed out, or printed nothing version-shaped); the caller then speaks
 * V1, the protocol every OpenCode before 2 shares.
 */
export function detectOpenCodeMajor(
  spawnFn: SpawnFn,
  binaryPath: string,
  cwd: string,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    let child: SpawnedProcess;
    try {
      child = spawnFn(binaryPath, ['--version'], cwd);
    } catch {
      resolve(undefined);
      return;
    }
    let out = '';
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseOpenCodeMajor(out));
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish();
    }, VERSION_TIMEOUT_MS);
    child.stdout.on('data', (chunk: unknown) => {
      out += String(chunk);
    });
    child.on('error', finish);
    child.on('close', finish);
  });
}

/** The protocol client for `protocol`, serving `cwd`. */
export function createOpenCodeServer(
  protocol: OpenCodeProtocolVersion,
  opts: { binaryPath: string; cwd: string; spawnFn?: SpawnFn; env?: Record<string, string> },
): IOpenCodeServer {
  return protocol === 2 ? new OpenCodeV2Server(opts) : new OpenCodeV1Server(opts);
}

/**
 * The arguments of a one-shot `opencode run` (conversation titles). OpenCode 2's
 * `run` would otherwise go through — and start, if none runs — the background
 * service shared by every OpenCode on the machine, a daemon a title must not
 * leave behind; `--standalone` keeps the run self-contained. OpenCode 1 has no
 * such service and rejects the flag.
 */
export function openCodeRunArgs(protocol: OpenCodeProtocolVersion, prompt: string): string[] {
  return protocol === 2 ? ['run', '--standalone', prompt] : ['run', prompt];
}
