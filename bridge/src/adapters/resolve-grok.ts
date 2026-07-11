/**
 * Resolves the Grok CLI to something `child_process.spawn` can run directly with
 * `shell:false` (so nothing is interpolated into a shell — no command injection).
 *
 * Grok's official installer drops a **native** executable at `~/.grok/bin/grok`
 * (`grok.exe` on Windows) — not a `.cmd`/`.ps1` shim — so it spawns directly on
 * every platform. We prefer that well-known install path, then fall back to the
 * `grok` launcher on PATH. A configured path (e.g. a source build) always wins.
 *
 * The adapter drives `grok agent stdio` (ACP — JSON-RPC 2.0 over stdio), so the
 * resolved target is just the base executable; the `agent stdio` args are added
 * by the adapter.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ResolvedGrok {
  /** Executable to spawn (`shell:false`). */
  binaryPath: string;
  /** Args prepended before the adapter args (e.g. `[grok.js]` for a node entry). */
  prependArgs: string[];
  /** Whether the resolved target is known to exist on disk. */
  available: boolean;
}

/** Well-known install locations for the native `grok` executable. */
function nativeCandidates(): string[] {
  const bin = process.platform === 'win32' ? 'grok.exe' : 'grok';
  return [join(homedir(), '.grok', 'bin', bin)];
}

/**
 * Resolve the Grok binary. An explicit `configured` path always wins (spawned
 * directly); otherwise we auto-detect the installer's `~/.grok/bin/grok`, then
 * fall back to the `grok` launcher on PATH.
 */
export function resolveGrokBinary(configured?: string): ResolvedGrok {
  if (configured && configured.length > 0) {
    return { binaryPath: configured, prependArgs: [], available: existsSync(configured) };
  }
  for (const candidate of nativeCandidates()) {
    if (existsSync(candidate)) {
      return { binaryPath: candidate, prependArgs: [], available: true };
    }
  }
  // Fall back to the launcher name; availability unknown (PATH lookup at spawn).
  // Grok ships a native executable (not a shell shim), so it spawns fine on
  // every platform once on PATH.
  return { binaryPath: 'grok', prependArgs: [], available: true };
}
