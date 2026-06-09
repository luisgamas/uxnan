/**
 * Resolves the Codex CLI to something `child_process.spawn` can run directly with
 * `shell:false` (so the user prompt is never interpolated into a shell — no
 * command injection).
 *
 * The npm package `@openai/codex` exposes a `bin/codex.js` Node entry behind a
 * `.cmd`/`.ps1` shim that cannot be spawned with `shell:false`. The entry locates
 * the right native binary for the platform itself, so we spawn `node <codex.js>`
 * — robust across platforms without hard-coding the deep, arch-specific vendor
 * path (`@openai/codex-win32-x64/.../bin/codex.exe`, etc.).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ResolvedCodex {
  /** Executable to spawn (`shell:false`). For the npm entry this is `process.execPath` (node). */
  binaryPath: string;
  /** Args prepended before the adapter args (e.g. `[codex.js]` when running via node). */
  prependArgs: string[];
  /** Whether the resolved target is known to exist on disk. */
  available: boolean;
}

/** Candidate npm-global `bin/codex.js` locations for `@openai/codex`. */
function npmEntryCandidates(): string[] {
  const candidates: string[] = [];
  const rel = join('@openai', 'codex', 'bin', 'codex.js');
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
 * Resolve the Codex binary. An explicit `configured` path always wins; we only
 * report availability for it. Otherwise we auto-detect a runnable target.
 */
export function resolveCodexBinary(configured?: string): ResolvedCodex {
  if (configured && configured.length > 0) {
    return { binaryPath: configured, prependArgs: [], available: existsSync(configured) };
  }
  for (const entry of npmEntryCandidates()) {
    if (existsSync(entry)) {
      return { binaryPath: process.execPath, prependArgs: [entry], available: true };
    }
  }
  // Fall back to the launcher name; availability unknown (PATH lookup at spawn).
  // On POSIX the `codex` npm bin spawns directly (node shebang); on Windows the
  // shim would need a shell, so we report it as not available until configured.
  return { binaryPath: 'codex', prependArgs: [], available: process.platform !== 'win32' };
}
