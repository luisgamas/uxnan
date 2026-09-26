/**
 * Where the coding-agent CLIs are installed, and how to find one — the single
 * rule the bridge and Uxnan Desktop share (architecture/02a §5.8.17).
 *
 * The table itself is `agent-locations.json` at this package's root: the
 * desktop compiles the same file into its Rust resolver (`include_str!`), so
 * the phone, the desktop's chat and the desktop's terminals can never disagree
 * about which agents are installed — the disagreement the maintainer hit when
 * the chat offered agents the desktop knew were missing, and missed ones it
 * knew were there.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export interface AgentLocation {
  /** The bridge's `AgentId`. */
  bridgeId: string;
  /** Uxnan Desktop's backend id (`agentcli::SUPPORTED`). */
  desktopId: string;
  /** The launcher name on PATH. */
  command: string;
  /** Native executables, checked first, by platform family. */
  native?: { posix: string[]; win32: string[] };
  /** The npm package's JS entry, relative to an npm root (run as `node <entry>`). */
  npmEntry?: string;
}

export interface AgentLocationTable {
  npmRoots: { posix: string[]; win32: string[] };
  /** Folders a login PATH normally has that a service's PATH lacks. */
  pathDirs: { posix: string[]; win32: string[] };
  agents: AgentLocation[];
}

let table: AgentLocationTable | undefined;

/** The shared table (read once from `agent-locations.json`). */
export function agentLocationTable(): AgentLocationTable {
  // dist/src/agents/agent-locations.js → the package root holds the JSON.
  table ??= JSON.parse(
    readFileSync(new URL('../../../agent-locations.json', import.meta.url), 'utf-8'),
  ) as AgentLocationTable;
  return table;
}

/** The table entry for a bridge agent id, if Uxnan knows where it installs. */
export function agentLocation(bridgeId: string): AgentLocation | undefined {
  return agentLocationTable().agents.find((a) => a.bridgeId === bridgeId);
}

export interface LocateEnvironment {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** The node executable that would run an npm entry. */
  nodePath: string;
  /** Replaces the table's npm roots (tests, which must not see this machine's). */
  npmRoots?: string[];
}

export function currentLocateEnvironment(): LocateEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    nodePath: process.execPath,
  };
}

/**
 * Expand the table's tokens for this machine; `undefined` when a token names
 * a folder this machine does not have (e.g. `%APPDATA%` off Windows).
 */
export function expandLocation(path: string, where: LocateEnvironment): string | undefined {
  let out = path;
  if (out === '~' || out.startsWith('~/')) out = join(where.home, out.slice(1));
  const prefix = nodePrefix(where);
  out = out.replace('$NODE_PREFIX', prefix);
  const winVars: Record<string, string | undefined> = {
    '%APPDATA%': where.env['APPDATA'],
    '%LOCALAPPDATA%': where.env['LOCALAPPDATA'],
    '%PROGRAMFILES%': where.env['ProgramFiles'],
  };
  for (const [token, value] of Object.entries(winVars)) {
    if (!out.includes(token)) continue;
    if (!value) return undefined;
    out = out.replace(token, value);
  }
  return join(out);
}

/**
 * The prefix global npm packages of [where.nodePath] live under: `<prefix>/lib/
 * node_modules` on POSIX (`<prefix>/bin/node`), `<prefix>/node_modules` on
 * Windows (`<prefix>\node.exe`).
 */
function nodePrefix(where: LocateEnvironment): string {
  const bin = dirname(where.nodePath);
  return where.platform === 'win32' ? bin : dirname(bin);
}

export interface LocatedAgent {
  /** What to spawn: the native binary, node (for an npm entry), or the launcher. */
  binaryPath: string;
  /** Args before the agent's own (`[entry.js]` for an npm entry). */
  prependArgs: string[];
  available: boolean;
  /** Every location checked, in order (`PATH:<dir>` for PATH entries). */
  checked: string[];
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Find [location]'s CLI on this machine. [configured] (a user's explicit path)
 * always wins. On Windows a PATH hit counts only when it is a real executable
 * (`.exe`/`.com`): an npm `.cmd` shim cannot be spawned without a shell.
 */
export function locateAgent(
  location: AgentLocation,
  configured?: string,
  where: LocateEnvironment = currentLocateEnvironment(),
): LocatedAgent {
  const checked: string[] = [];
  if (configured && configured.length > 0) {
    checked.push(configured);
    return { binaryPath: configured, prependArgs: [], available: isFile(configured), checked };
  }
  const family = where.platform === 'win32' ? 'win32' : 'posix';
  for (const raw of location.native?.[family] ?? []) {
    const path = expandLocation(raw, where);
    if (!path) continue;
    checked.push(path);
    if (isFile(path)) return { binaryPath: path, prependArgs: [], available: true, checked };
  }
  if (location.npmEntry) {
    for (const raw of where.npmRoots ?? agentLocationTable().npmRoots[family]) {
      const root = expandLocation(raw, where);
      if (!root) continue;
      const entry = join(root, location.npmEntry);
      checked.push(entry);
      if (isFile(entry)) {
        return { binaryPath: where.nodePath, prependArgs: [entry], available: true, checked };
      }
    }
  }
  const names =
    where.platform === 'win32'
      ? [`${location.command}.exe`, `${location.command}.com`]
      : [location.command];
  const rawPath = where.env['PATH'] ?? where.env['Path'] ?? '';
  for (const dir of rawPath.split(where.platform === 'win32' ? ';' : delimiter)) {
    if (!dir) continue;
    checked.push(`PATH:${dir}`);
    for (const name of names) {
      const candidate = join(dir, name);
      if (isFile(candidate)) {
        return { binaryPath: candidate, prependArgs: [], available: true, checked };
      }
    }
  }
  return { binaryPath: location.command, prependArgs: [], available: false, checked };
}
