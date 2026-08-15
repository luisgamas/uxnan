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

/**
 * Environment keys the **desktop ADE** injects into one terminal of one launch:
 * `UXNAN_AGENT_ID` (that terminal's id), its hook server's url + token, the
 * endpoint file, and the browser / MCP endpoints. They identify a terminal, and
 * an agent reports its state by echoing them back.
 *
 * The bridge must never pass them on. Environment variables are inherited by the
 * whole process tree, so a `uxnan-bridge start` run **inside** an ADE terminal
 * gets that terminal's identity — and every agent CLI it spawns would inherit it
 * and report to the ADE as if it *were* that terminal: an agent card on a
 * terminal nobody launched an agent in, with a session stamped on the tab.
 *
 * `UXNAN_HOOK_URL` / `_TOKEN` / `_THREAD_ID` are on the list even though the
 * bridge uses those names itself, for its approval hook: it **sets** them per
 * turn (see the Claude adapter), and a value it sets wins over the scrub. What
 * must not survive is a value inherited from someone else, which would point the
 * hook at another process's server.
 */
export const DESKTOP_TERMINAL_ENV_KEYS = [
  'UXNAN_AGENT_ID',
  'UXNAN_HOOK_URL',
  'UXNAN_HOOK_TOKEN',
  'UXNAN_HOOK_THREAD_ID',
  'UXNAN_ENDPOINT_FILE',
  'UXNAN_BROWSER_URL',
  'UXNAN_BROWSER_TOKEN',
  'UXNAN_MCP_URL',
  'UXNAN_MCP_TOKEN',
] as const;

/**
 * The environment an agent CLI should run with: the bridge's own, minus the
 * inherited terminal identity ({@link DESKTOP_TERMINAL_ENV_KEYS}), plus whatever
 * the caller sets deliberately — which wins, so the approval hook's own
 * coordinates still reach the agent.
 */
export function agentEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of DESKTOP_TERMINAL_ENV_KEYS) delete env[key];
  return extra ? { ...env, ...extra } : env;
}

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
    // Always an explicit environment, never the implicit inherited one: that is
    // what keeps a terminal's identity from reaching the agent (`agentEnv`).
    env: agentEnv(extra?.env),
  });
  // `stdio` is computed, so TypeScript widens the streams to `| null` even
  // though 'pipe' guarantees stdout/stderr. The cast is the narrowing the
  // literal tuple used to give for free; `stdin` stays optional on
  // {@link SpawnedProcess} because it really is absent when not piped.
  return child as unknown as SpawnedProcess;
};
