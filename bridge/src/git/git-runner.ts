/**
 * Runs git locally via `child_process.execFile` (no shell → no command
 * injection). Arguments are passed as an array; user-provided values are
 * validated by the handlers (see `requireSafe`).
 *
 * Source: architecture/02a-system-architecture.md §5.8.6.
 */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export class GitCommandError extends Error {
  readonly stderr: string;
  readonly code: number | null;

  constructor(message: string, stderr: string, code: number | null) {
    super(message);
    this.name = 'GitCommandError';
    this.stderr = stderr;
    this.code = code;
  }
}

export interface RunGitResult {
  stdout: string;
  stderr: string;
}

export function runGit(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<RunGitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        ...(options.env ? { env: options.env } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const rawCode = (error as NodeJS.ErrnoException).code;
          const code = typeof rawCode === 'number' ? rawCode : null;
          const detail = sanitizePaths(stderr || stdout || error.message, cwd);
          reject(new GitCommandError(`git ${args[0] ?? ''} failed`, detail, code));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/** Strip the project cwd and the user's home directory from text sent to the phone. */
export function sanitizePaths(text: string, cwd: string): string {
  let out = text;
  if (cwd) out = out.split(cwd).join('.');
  const home = homedir();
  if (home) out = out.split(home).join('~');
  return out.trim();
}
