/**
 * Shared child-process surface for one-shot CLI agent adapters (OpenCode, Claude
 * Code, …). Spawning with `shell:false` and the prompt passed as an argv element
 * means the user prompt is never interpolated into a shell (no command injection).
 * stdin is IGNORED (closed) by default: these CLIs otherwise block waiting for
 * stdin EOF. An adapter whose CLI reads a real input stream opts in with
 * {@link SpawnExtra.stdin} — see the Claude adapter, which needs the pipe to
 * hand the agent a follow-up mid-turn.
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
   * Writable stdin, present only when the spawn asked for `stdin: 'pipe'`.
   * A CLI reading a message stream keeps it open for the length of the turn;
   * ending it is what tells the CLI no more input is coming.
   */
  stdin?: NodeJS.WritableStream;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

/** Extra spawn options some adapters need (e.g. per-turn env for the approval hook). */
export interface SpawnExtra {
  /** Additional environment variables, merged over the bridge's own `process.env`. */
  env?: Record<string, string>;
  /**
   * `'pipe'` gives the child a writable stdin instead of the default closed one.
   * Only for a CLI that genuinely reads a stream (`claude --input-format
   * stream-json`): the one-shot CLIs hang on an open pipe, which is why
   * `'ignore'` remains the default.
   */
  stdin?: 'pipe' | 'ignore';
}

export type SpawnFn = (
  command: string,
  args: string[],
  cwd: string,
  extra?: SpawnExtra,
) => SpawnedProcess;

export const defaultSpawn: SpawnFn = (command, args, cwd, extra) => {
  const child = spawn(command, args, {
    cwd,
    // stdin IGNORED unless asked for: the one-shot agent CLIs hang waiting for
    // stdin EOF otherwise.
    stdio: [extra?.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    ...(extra?.env ? { env: { ...process.env, ...extra.env } } : {}),
  });
  // `stdio` is computed, so TypeScript widens the streams to `| null` even
  // though 'pipe' guarantees stdout/stderr. The cast is the narrowing the
  // literal tuple used to give for free; `stdin` stays optional on
  // {@link SpawnedProcess} because it really is absent when not piped.
  return child as unknown as SpawnedProcess;
};
