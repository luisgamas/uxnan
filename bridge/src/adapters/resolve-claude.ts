/**
 * Resolves the Claude Code executable to something `child_process.spawn` can run
 * directly with `shell:false` (so the user prompt is never interpolated into a
 * shell — no command injection).
 *
 * Claude Code ships two ways:
 *  - the native installer drops a real binary at `~/.local/bin/claude[.exe]`,
 *    which spawns directly; and
 *  - the npm package `@anthropic-ai/claude-code` exposes a `cli.js` behind a
 *    `.cmd`/shell shim that cannot be spawned with `shell:false`. For that case we
 *    spawn `node <cli.js>` instead, so the launch stays shell-free.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ResolvedClaude {
  /** Executable to spawn (`shell:false`). For the npm `cli.js` case this is `process.execPath` (node). */
  binaryPath: string;
  /** Args prepended before the adapter's own args (e.g. `[cli.js]` when running via node). */
  prependArgs: string[];
  /** Whether the resolved target is known to exist on disk. */
  available: boolean;
}

/** Native-installer binary location, identical layout on Windows and POSIX. */
function nativeBinaryPath(): string {
  return join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
}

/** Candidate npm-global `cli.js` locations for `@anthropic-ai/claude-code`. */
function npmCliCandidates(): string[] {
  const candidates: string[] = [];
  const rel = join('@anthropic-ai', 'claude-code', 'cli.js');
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
 * Resolve the Claude Code binary. An explicit `configured` path always wins; we
 * only report availability for it. Otherwise we auto-detect a runnable target.
 */
export function resolveClaudeBinary(configured?: string): ResolvedClaude {
  if (configured && configured.length > 0) {
    return { binaryPath: configured, prependArgs: [], available: existsSync(configured) };
  }
  const native = nativeBinaryPath();
  if (existsSync(native)) {
    return { binaryPath: native, prependArgs: [], available: true };
  }
  for (const cli of npmCliCandidates()) {
    if (existsSync(cli)) {
      return { binaryPath: process.execPath, prependArgs: [cli], available: true };
    }
  }
  // Fall back to the launcher name; availability unknown (PATH lookup at spawn).
  // On POSIX the `claude` launcher on PATH spawns directly; on Windows the shim
  // would need a shell, so we report it as not available until configured.
  return { binaryPath: 'claude', prependArgs: [], available: process.platform !== 'win32' };
}
