/**
 * Resolves the Zero CLI to something `child_process.spawn` can run directly with
 * `shell:false` (so nothing is interpolated into a shell — no command injection).
 *
 * The npm package `@gitlawb/zero` exposes a `bin/zero.js` Node entry behind a
 * `.cmd`/`.ps1` shim that cannot be spawned with `shell:false`. The entry locates
 * the right native binary for the platform itself, so we spawn `node <zero.js>`
 * — robust without hard-coding the arch-specific vendor path. A configured path
 * (e.g. a source-built `zero`/`zero.exe`) always wins and is spawned directly.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ResolvedZero {
  /** Executable to spawn (`shell:false`). For the npm entry this is `process.execPath` (node). */
  binaryPath: string;
  /** Args prepended before the adapter args (e.g. `[zero.js]` when running via node). */
  prependArgs: string[];
  /** Whether the resolved target is known to exist on disk. */
  available: boolean;
}

/** Candidate npm-global `bin/zero.js` locations for `@gitlawb/zero`. */
function npmEntryCandidates(): string[] {
  const candidates: string[] = [];
  const rel = join('@gitlawb', 'zero', 'bin', 'zero.js');
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) candidates.push(join(appData, 'npm', 'node_modules', rel));
  } else {
    candidates.push(join('/usr', 'local', 'lib', 'node_modules', rel));
    candidates.push(join(homedir(), '.npm-global', 'lib', 'node_modules', rel));
  }
  return candidates;
}

/**
 * Resolve the Zero binary. An explicit `configured` path always wins (spawned
 * directly); otherwise we auto-detect the npm-global `bin/zero.js` and run it via
 * node, falling back to the `zero` launcher on PATH.
 */
export function resolveZeroBinary(configured?: string): ResolvedZero {
  if (configured && configured.length > 0) {
    return { binaryPath: configured, prependArgs: [], available: existsSync(configured) };
  }
  for (const entry of npmEntryCandidates()) {
    if (existsSync(entry)) {
      return { binaryPath: process.execPath, prependArgs: [entry], available: true };
    }
  }
  // Fall back to the launcher name; availability unknown (PATH lookup at spawn).
  // On POSIX the `zero` npm bin spawns directly (node shebang); on Windows the
  // shim would need a shell, so we report it as not available until configured.
  return { binaryPath: 'zero', prependArgs: [], available: process.platform !== 'win32' };
}
