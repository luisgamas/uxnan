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
  /**
   * Optional writable stdin. `null`/closed for the one-shot adapters (the prompt
   * is an argv element), but the interactive-approval path keeps it open to feed
   * the CLI's stream-json control responses.
   */
  stdin?: NodeJS.WritableStream | null;
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

/**
 * Spawn with stdin KEPT OPEN, for the interactive-approval path
 * (`claude --input-format stream-json`): the bridge writes the prompt and the
 * approval `control_response`s to stdin while reading the event stream.
 */
export const interactiveSpawn: SpawnFn = (command, args, cwd) =>
  spawn(command, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
