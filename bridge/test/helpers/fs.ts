/**
 * Resilient temp-dir cleanup for tests. On Windows a just-spawned git process can
 * briefly hold a handle to its cwd, making `rm` fail with EBUSY; retry and never
 * let cleanup fail a test.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DAEMON_FILES, DaemonState } from '../../src/index.js';

export async function rmrf(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  } catch {
    // best-effort cleanup; ignore
  }
}

/**
 * Give a test bridge one project: a work folder under [baseDir] listed in its
 * config's `workspaceRoots`, which the registry registers on start. A fresh
 * bridge has no projects until someone adds one.
 */
export async function seedProject(baseDir: string): Promise<string> {
  const work = join(baseDir, 'work');
  await mkdir(work, { recursive: true });
  await new DaemonState(baseDir).writeJson(DAEMON_FILES.config, { workspaceRoots: [work] });
  return work;
}
