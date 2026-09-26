/**
 * Give the bridge the PATH the user's own terminal has.
 *
 * A bridge started as the user's service (launchd, systemd --user) or by a GUI
 * app gets the service manager's minimal PATH — `/usr/bin:/bin:/usr/sbin:/sbin`
 * on macOS — where Homebrew, npm's global bin, nvm and every installed agent
 * are missing: agents would be reported uninstalled and a `#!/usr/bin/env node`
 * launcher could not even start. So at startup the bridge asks the user's login
 * *and* interactive shell for its real PATH (`$SHELL -ilc`, the same probe Uxnan
 * Desktop makes for itself) and adds what is missing, plus the well-known
 * folders from the shared agent table. Nothing is ever reordered or removed.
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter } from 'node:path';
import { agentLocationTable, expandLocation } from '@uxnan/shared';

const BEGIN = '__UXNAN_PATH_BEGIN__';
const END = '__UXNAN_PATH_END__';
/** How long the shell may take before the bridge starts without its PATH. */
export const LOGIN_SHELL_TIMEOUT_MS = 5_000;

/** The PATH between the markers of the probe's output, ignoring rc-file noise. */
export function extractPath(output: string): string | undefined {
  const start = output.indexOf(BEGIN);
  const end = output.indexOf(END, start + BEGIN.length);
  if (start < 0 || end < 0) return undefined;
  const path = output.slice(start + BEGIN.length, end).trim();
  return path.length > 0 ? path : undefined;
}

/** Ask the user's login shell for its PATH; `undefined` when it cannot say. */
export function loginShellPath(timeoutMs = LOGIN_SHELL_TIMEOUT_MS): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined);
  const shell = process.env['SHELL'] || '/bin/sh';
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const done = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn(shell, ['-ilc', `printf '${BEGIN}%s${END}' "$PATH"`], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(undefined);
    }, timeoutMs);
    timer.unref?.();
    child.on('error', () => done(undefined));
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf-8')));
    child.on('close', () => done(extractPath(output)));
  });
}

/**
 * [current] with every entry of [extra] it lacks appended, in order, keeping
 * only folders that exist.
 */
export function mergePath(current: string, extra: string[]): string {
  const entries = current.split(delimiter).filter((e) => e.length > 0);
  const seen = new Set(entries);
  for (const dir of extra) {
    if (dir.length === 0 || seen.has(dir)) continue;
    try {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    seen.add(dir);
    entries.push(dir);
  }
  return entries.join(delimiter);
}

/** Enrich `process.env.PATH` in place. Returns the folders it added. */
export async function enrichProcessPath(): Promise<string[]> {
  const before = process.env['PATH'] ?? '';
  const login = await loginShellPath();
  const family = process.platform === 'win32' ? 'win32' : 'posix';
  const where = {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    nodePath: process.execPath,
  };
  const known = agentLocationTable()
    .pathDirs[family].map((dir) => expandLocation(dir, where))
    .filter((dir): dir is string => dir !== undefined);
  const after = mergePath(before, [...(login?.split(delimiter) ?? []), ...known]);
  process.env['PATH'] = after;
  const had = new Set(before.split(delimiter));
  return after.split(delimiter).filter((dir) => !had.has(dir));
}
