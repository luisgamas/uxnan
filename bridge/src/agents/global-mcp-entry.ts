/**
 * The one `uxnan-browser` entry the bridge keeps in Antigravity's user-global
 * MCP config (architecture/02a §5.8.15) — the only channel `agy` reads MCP
 * servers from.
 *
 * The entry names a command, nothing else: `<node> <bridge cli.js> mcp-proxy`.
 * No token and no port are ever written — the proxy reads them from the
 * environment the bridge gives the agent process, only while Uxnan Desktop is
 * attached (`adapters/mcp-proxy.ts`), and answers as a server with no tools
 * anywhere else. That is what makes a global entry acceptable here, where the
 * desktop refuses one for its terminals: outside a bridge run it exposes
 * nothing and fails nowhere.
 *
 * Verified end to end on agy 1.2.10: a real turn found the tools through the
 * proxy and called one, with the token and the conversation's folder on every
 * request. Added through `agy mcp add` so the file format stays Antigravity's;
 * the file is only read, to skip the call when the entry is already right.
 * Removed again by `uxnan-bridge uninstall-service`.
 *
 * Zero is deliberately NOT given one: it runs stdio MCP servers inside its
 * macOS sandbox with the network denied — loopback HTTP and Unix sockets alike
 * fail with `EPERM` (verified on zero 0.9.0) — so the entry would sit in the
 * user's config and never work. Zero gets the tools when it honors ACP
 * `mcpServers` (the bridge already sends them the moment it advertises HTTP
 * MCP support, `adapters/acp-mcp.ts`).
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocatedAgent } from '@uxnan/shared';
import { PROXY_SERVER_NAME } from '../adapters/mcp-proxy.js';

export interface ProxyCommand {
  command: string;
  args: string[];
}

/** The command the entry runs: this bridge's CLI through this node. */
export function proxyCommand(): ProxyCommand {
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('../cli.js', import.meta.url)), 'mcp-proxy'],
  };
}

export type GlobalEntryAgent = 'antigravity-cli';

export interface GlobalEntryEnvironment {
  home: string;
  env: NodeJS.ProcessEnv;
  /** Run a CLI (argv[0] with the rest); rejects on failure. */
  run: (command: string, args: string[]) => Promise<void>;
}

const defaultRun = (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 20_000, windowsHide: true }, (err) =>
      err ? reject(err) : resolve(),
    );
  });

export function currentGlobalEntryEnvironment(): GlobalEntryEnvironment {
  return { home: homedir(), env: process.env, run: defaultRun };
}

/** Where Antigravity keeps its MCP servers (verified on agy 1.2.10). */
export function configFileFor(_agent: GlobalEntryAgent, where: GlobalEntryEnvironment): string {
  return join(where.home, '.gemini', 'config', 'mcp_config.json');
}

/** The entry as the CLI stored it, or `undefined`. */
async function storedEntry(
  agent: GlobalEntryAgent,
  where: GlobalEntryEnvironment,
): Promise<{ command?: unknown; args?: unknown } | undefined> {
  try {
    const config = JSON.parse(await readFile(configFileFor(agent, where), 'utf-8')) as {
      mcpServers?: Record<string, unknown>;
    };
    const entry = config.mcpServers?.[PROXY_SERVER_NAME];
    return entry && typeof entry === 'object' ? (entry as { command?: unknown }) : undefined;
  } catch {
    return undefined;
  }
}

function sameCommand(entry: { command?: unknown; args?: unknown }, wanted: ProxyCommand): boolean {
  return (
    entry.command === wanted.command &&
    Array.isArray(entry.args) &&
    entry.args.length === wanted.args.length &&
    entry.args.every((arg, i) => arg === wanted.args[i])
  );
}

/**
 * Make sure [agent]'s global config has the `uxnan-browser` entry running
 * [wanted]. Resolves what happened; never throws (a CLI that refuses leaves
 * the agent without the desktop's tools, nothing more).
 */
export async function ensureGlobalEntry(
  agent: GlobalEntryAgent,
  located: LocatedAgent,
  wanted: ProxyCommand = proxyCommand(),
  where: GlobalEntryEnvironment = currentGlobalEntryEnvironment(),
): Promise<'present' | 'added' | 'failed'> {
  const entry = await storedEntry(agent, where);
  if (entry && sameCommand(entry, wanted)) return 'present';
  try {
    await where.run(located.binaryPath, [
      ...located.prependArgs,
      'mcp',
      'add',
      PROXY_SERVER_NAME,
      '--',
      wanted.command,
      ...wanted.args,
    ]);
    return 'added';
  } catch {
    return 'failed';
  }
}

/** Take the entry out of [agent]'s global config (uninstall). Never throws. */
export async function removeGlobalEntry(
  agent: GlobalEntryAgent,
  located: LocatedAgent,
  where: GlobalEntryEnvironment = currentGlobalEntryEnvironment(),
): Promise<boolean> {
  if (!(await storedEntry(agent, where))) return false;
  try {
    await where.run(located.binaryPath, [
      ...located.prependArgs,
      'mcp',
      'remove',
      PROXY_SERVER_NAME,
    ]);
    return true;
  } catch {
    return false;
  }
}
