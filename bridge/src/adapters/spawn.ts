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
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

export type SpawnFn = (command: string, args: string[], cwd: string) => SpawnedProcess;

export const defaultSpawn: SpawnFn = (command, args, cwd) =>
  spawn(command, args, {
    cwd,
    // stdin IGNORED: the agent CLIs hang waiting for stdin EOF otherwise.
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
