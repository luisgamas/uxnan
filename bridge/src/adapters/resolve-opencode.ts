/**
 * Resolves the OpenCode executable to a path that `child_process.spawn` can run
 * directly with `shell:false` (so the user prompt is never interpolated into a
 * shell — no command injection).
 *
 * On Windows the npm `opencode` shim is a `.cmd`/`.ps1` that cannot be spawned
 * without a shell; it forwards to a native `opencode.exe` under
 * `node_modules/opencode-ai/bin/`. We locate that `.exe` so we can spawn it
 * directly. On macOS/Linux the `opencode` launcher on PATH spawns fine as-is.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Candidate `.exe` locations for the npm-global OpenCode on Windows. */
function windowsCandidates(): string[] {
  const candidates: string[] = [];
  const appData = process.env['APPDATA'];
  if (appData) {
    candidates.push(join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  }
  const programFiles = process.env['ProgramFiles'];
  if (programFiles) {
    candidates.push(join(programFiles, 'opencode', 'opencode.exe'));
  }
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) {
    candidates.push(join(localAppData, 'opencode', 'opencode.exe'));
  }
  return candidates;
}

export interface ResolvedOpenCode {
  /** Executable path to spawn (shell:false). */
  binaryPath: string;
  /** Whether the resolved path is known to exist on disk. */
  available: boolean;
}

/**
 * Resolve the OpenCode binary. An explicit `configured` path always wins; we only
 * report availability for it. Otherwise we auto-detect a runnable executable.
 */
export function resolveOpenCodeBinary(configured?: string): ResolvedOpenCode {
  if (configured && configured.length > 0) {
    return { binaryPath: configured, available: existsSync(configured) };
  }
  if (process.platform === 'win32') {
    for (const candidate of windowsCandidates()) {
      if (existsSync(candidate)) return { binaryPath: candidate, available: true };
    }
    // Fall back to the shim name; availability unknown (PATH lookup at spawn).
    return { binaryPath: 'opencode', available: false };
  }
  // POSIX: the launcher on PATH spawns directly.
  return { binaryPath: 'opencode', available: true };
}
