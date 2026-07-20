/**
 * Resolves the Antigravity CLI (`agy`) to something `child_process.spawn` can run
 * directly with `shell:false` (so the user prompt is never interpolated into a
 * shell — no command injection).
 *
 * Unlike the pi/Gemini/Codex npm CLIs (Node entries behind a `.cmd` shim), `agy`
 * ships as a single native binary (`agy.exe` on Windows, `agy` on POSIX), which
 * spawns directly with `shell:false` on every platform. We resolve a concrete
 * path when we can find one (a configured path, the default install dir, or a
 * PATH scan) so availability is truthful; otherwise we fall back to the bare
 * launcher name.
 */
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface ResolvedAntigravity {
  /** Executable to spawn (`shell:false`) — a concrete path when found, else `agy`. */
  binaryPath: string;
  /** Args prepended before the adapter args (unused for the native `agy` exe). */
  prependArgs: string[];
  /** Whether the resolved target is known to exist on disk. */
  available: boolean;
}

/** The bare launcher name for the current platform. */
function launcherName(): string {
  return process.platform === 'win32' ? 'agy.exe' : 'agy';
}

/** Default per-platform install locations for the `agy` binary. */
function installCandidates(): string[] {
  const candidates: string[] = [];
  const name = launcherName();
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    // Antigravity installs to %LOCALAPPDATA%\agy\bin\agy.exe.
    if (localAppData) candidates.push(join(localAppData, 'agy', 'bin', name));
  } else {
    const home = process.env['HOME'];
    if (home) {
      candidates.push(join(home, '.local', 'bin', name));
      candidates.push(join(home, 'agy', 'bin', name));
    }
    candidates.push(join('/usr', 'local', 'bin', name));
    candidates.push(join('/opt', 'homebrew', 'bin', name));
  }
  return candidates;
}

/** Directories on `PATH` that hold the `agy` launcher, if any. */
function pathScan(): string | undefined {
  const rawPath = process.env['PATH'];
  if (!rawPath) return undefined;
  const name = launcherName();
  for (const dir of rawPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resolve the `agy` binary. An explicit `configured` path always wins; we only
 * report availability for it. Otherwise we probe the default install dir, then
 * scan `PATH`. Failing both we fall back to the bare launcher name — `agy` is a
 * native exe that CreateProcess/execvp resolves on `PATH` at spawn time, so we
 * still report it available (the turn surfaces a clear error if it is missing).
 */
export function resolveAntigravityBinary(configured?: string): ResolvedAntigravity {
  if (configured && configured.length > 0) {
    return { binaryPath: configured, prependArgs: [], available: existsSync(configured) };
  }
  for (const candidate of installCandidates()) {
    if (existsSync(candidate)) {
      return { binaryPath: candidate, prependArgs: [], available: true };
    }
  }
  const onPath = pathScan();
  if (onPath !== undefined) {
    return { binaryPath: onPath, prependArgs: [], available: true };
  }
  // Fall back to the launcher name; availability unknown (PATH lookup at spawn).
  // `agy` is a native binary spawnable with `shell:false` on all platforms.
  return { binaryPath: launcherName(), prependArgs: [], available: false };
}
