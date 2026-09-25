/**
 * Where a launcher is on `PATH`, if anywhere — the one check every agent
 * resolver makes before calling a CLI available.
 *
 * A resolver used to fall back to the bare launcher name and report it
 * available ("PATH lookup at spawn"). For a CLI that is not installed that was
 * wrong twice over: the phone and the desktop offered an agent that could not
 * run, and asking it for its models spawned a missing binary — which, for the
 * ACP adapters, took the whole bridge down with an unhandled `ENOENT`.
 */
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** The first `PATH` entry holding `name` as a regular file, else `undefined`.
 *  `env` is injectable for tests. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const rawPath = env['PATH'] ?? env['Path'];
  if (!rawPath) return undefined;
  for (const dir of rawPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // An unreadable PATH entry is simply not a match.
    }
  }
  return undefined;
}
