/**
 * Resolves the Gemini CLI (`@google/gemini-cli`) to something
 * `child_process.spawn` can run directly with `shell:false` (so the user prompt
 * is never interpolated into a shell — no command injection).
 *
 * The npm package ships a bundled Node entry at `bundle/gemini.js` behind a
 * `.cmd`/`.ps1` shim that cannot be spawned with `shell:false`, so we spawn
 * `node <bundle/gemini.js>` — robust across platforms (same approach as the Codex
 * and pi adapters).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ResolvedGemini {
  /** Executable to spawn (`shell:false`). For the npm entry this is `process.execPath` (node). */
  binaryPath: string;
  /** Args prepended before the adapter args (e.g. `[gemini.js]` when running via node). */
  prependArgs: string[];
  /** Whether the resolved target is known to exist on disk. */
  available: boolean;
}

/** Candidate npm-global `bundle/gemini.js` locations for `@google/gemini-cli`. */
function npmEntryCandidates(): string[] {
  const candidates: string[] = [];
  const rel = join('@google', 'gemini-cli', 'bundle', 'gemini.js');
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
 * Resolve the Gemini binary. An explicit `configured` path always wins; we only
 * report availability for it. Otherwise we auto-detect a runnable target.
 */
export function resolveGeminiBinary(configured?: string): ResolvedGemini {
  if (configured && configured.length > 0) {
    return { binaryPath: configured, prependArgs: [], available: existsSync(configured) };
  }
  for (const entry of npmEntryCandidates()) {
    if (existsSync(entry)) {
      return { binaryPath: process.execPath, prependArgs: [entry], available: true };
    }
  }
  // Fall back to the launcher name; availability unknown (PATH lookup at spawn).
  // On POSIX the `gemini` npm bin spawns directly (node shebang); on Windows the
  // shim would need a shell, so we report it not available until configured.
  return { binaryPath: 'gemini', prependArgs: [], available: process.platform !== 'win32' };
}
