/**
 * Resilient temp-dir cleanup for tests. On Windows a just-spawned git process can
 * briefly hold a handle to its cwd, making `rm` fail with EBUSY; retry and never
 * let cleanup fail a test.
 */
import { rm } from 'node:fs/promises';

export async function rmrf(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  } catch {
    // best-effort cleanup; ignore
  }
}
