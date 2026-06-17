/**
 * Shared child-process surface for one-shot CLI agent adapters (OpenCode, Claude
 * Code, …). Spawning with `shell:false` and the prompt passed as an argv element
 * means the user prompt is never interpolated into a shell (no command injection).
 * stdin is IGNORED (closed): these CLIs otherwise block waiting for stdin EOF.
 */
import { spawn } from 'node:child_process';

/** Minimal child-process surface the adapters rely on (so it can be faked in tests). */
export interface SpawnedProcess {
  stdout: NodeJS.ReadableStream;
  /**
   * Optional stderr stream. Most adapters read JSON from stdout, but some CLI
   * sub-commands (e.g. `pi --list-models`) print their human-facing table to
   * stderr, so adapters that need it read from here too.
   */
  stderr?: NodeJS.ReadableStream;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

/** Extra spawn options some adapters need (e.g. per-turn env for the approval hook). */
export interface SpawnExtra {
  /** Additional environment variables, merged over the bridge's own `process.env`. */
  env?: Record<string, string>;
}

export type SpawnFn = (
  command: string,
  args: string[],
  cwd: string,
  extra?: SpawnExtra,
) => SpawnedProcess;

export const defaultSpawn: SpawnFn = (command, args, cwd, extra) =>
  spawn(command, args, {
    cwd,
    // stdin IGNORED: the agent CLIs hang waiting for stdin EOF otherwise.
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    ...(extra?.env ? { env: { ...process.env, ...extra.env } } : {}),
  });
