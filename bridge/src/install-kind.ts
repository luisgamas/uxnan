/**
 * How this bridge was installed (`BridgeStatus.host.install`), which decides
 * who updates it (architecture/02a §5.8.18):
 *
 * - `bundled` — it came inside Uxnan Desktop: a private Node runtime the app
 *   copied, verified, to a per-user folder. Its tree is
 *   `<runtime>/node/…` + `<runtime>/app/node_modules/uxnan-bridge/…`, with
 *   the runtime's manifest ({@link RUNTIME_MANIFEST}) at `<runtime>/`. The
 *   desktop updates it — a new desktop carries the new bridge.
 * - `npm` — a global `npm install -g uxnan-bridge`; it updates itself.
 * - `source` — anything else (a checkout); nobody updates it.
 *
 * Read from the path of this bridge's own `cli.js` and the files beside it,
 * never from an environment variable a launcher could forget to set.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BridgeInstallKind } from '@uxnan/shared';
import { BRIDGE_PACKAGE_NAME } from './version.js';

/** The manifest Uxnan Desktop's build writes at the root of a bundled runtime. */
export const RUNTIME_MANIFEST = 'uxnan-runtime.json';

/** What a bundled runtime's manifest says about itself (the part read here). */
export interface RuntimeManifest {
  kind: 'bundled';
  bridgeVersion: string;
  nodeVersion: string;
  /** The Rust target triple the runtime was built for. */
  triple: string;
}

export interface InstallKindProbe {
  platform: NodeJS.Platform;
  exists?: (file: string) => boolean;
  read?: (file: string) => string;
}

/**
 * The runtime root a bundled bridge's `cli.js` sits in, or `undefined` when the
 * path has another shape. Pure.
 */
export function bundledRuntimeRoot(cliPath: string, platform: NodeJS.Platform): string | undefined {
  const { basename, dirname } = platform === 'win32' ? path.win32 : path.posix;
  // <root>/app/node_modules/uxnan-bridge/dist/src/cli.js
  const packageRoot = dirname(dirname(dirname(cliPath)));
  const modules = dirname(packageRoot);
  const app = dirname(modules);
  if (
    basename(packageRoot) !== BRIDGE_PACKAGE_NAME ||
    basename(modules) !== 'node_modules' ||
    basename(app) !== 'app'
  ) {
    return undefined;
  }
  return dirname(app);
}

/** The manifest of the bundled runtime `cliPath` belongs to, if it is one. */
export function readRuntimeManifest(
  cliPath: string,
  probe: InstallKindProbe,
): RuntimeManifest | undefined {
  const root = bundledRuntimeRoot(cliPath, probe.platform);
  if (root === undefined) return undefined;
  const { join } = probe.platform === 'win32' ? path.win32 : path.posix;
  const file = join(root, RUNTIME_MANIFEST);
  const exists = probe.exists ?? existsSync;
  if (!exists(file)) return undefined;
  try {
    const raw = JSON.parse(
      (probe.read ?? ((f) => readFileSync(f, 'utf-8')))(file),
    ) as Partial<RuntimeManifest>;
    if (
      raw.kind !== 'bundled' ||
      typeof raw.bridgeVersion !== 'string' ||
      typeof raw.nodeVersion !== 'string' ||
      typeof raw.triple !== 'string'
    ) {
      return undefined;
    }
    return {
      kind: 'bundled',
      bridgeVersion: raw.bridgeVersion,
      nodeVersion: raw.nodeVersion,
      triple: raw.triple,
    };
  } catch {
    return undefined;
  }
}

/** How the bridge whose CLI is at `cliPath` was installed. */
export function installKind(cliPath: string, probe: InstallKindProbe): BridgeInstallKind {
  if (readRuntimeManifest(cliPath, probe) !== undefined) return 'bundled';
  const { basename, dirname } = probe.platform === 'win32' ? path.win32 : path.posix;
  const packageRoot = dirname(dirname(dirname(cliPath)));
  return basename(packageRoot) === BRIDGE_PACKAGE_NAME &&
    basename(dirname(packageRoot)) === 'node_modules'
    ? 'npm'
    : 'source';
}
