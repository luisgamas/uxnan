/**
 * `uxnan-bridge mcp-proxy` — Uxnan Desktop's tools for an agent that only
 * reads MCP servers from its user-global config: Antigravity
 * (architecture/02a §5.8.15; why not Zero: `agents/global-mcp-entry.ts`).
 *
 * `agy` cannot be handed a server per run, so the bridge registers ONE entry in
 * its global config — `uxnan-browser`, a stdio server that runs this command —
 * with no token and no port in it. This proxy reads what it needs from the
 * environment the agent passes to the servers it starts (verified on agy
 * 1.2.10 and zero 0.9.0: stdio servers inherit it and start in the
 * conversation's folder):
 *
 * - `UXNAN_MCP_URL` / `UXNAN_MCP_TOKEN` — the desktop's endpoint and token, set
 *   by the bridge on the agent process only while the desktop is attached;
 * - `UXNAN_THREAD_CWD` — the conversation's folder, percent-encoded; without it
 *   the proxy's own working directory is the folder;
 * - `UXNAN_AGENT_ID` — set instead when the agent runs in one of Uxnan Desktop's
 *   own terminals, whose launch token the desktop scopes by that terminal.
 *
 * Outside a bridge run — the user starting Zero or Antigravity by hand — none of
 * that is set and the proxy answers as a server with no tools: nothing breaks,
 * nothing is exposed, and nothing warns. MCP stdio framing: one JSON-RPC message
 * per line on stdin, one per line on stdout.
 */
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { encodeCwdHeader, type DesktopTools } from '@uxnan/shared';
import { DesktopMcpClient, MCP_PROTOCOL_VERSION, type RpcAnswer } from './desktop-mcp-client.js';

/** The server name the entry is registered under (same as every other launch). */
export const PROXY_SERVER_NAME = 'uxnan-browser';

interface Message {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

/** What a server with no tools answers — the proxy outside Uxnan, or offline. */
export function emptyServerAnswer(message: Message, version: string): RpcAnswer {
  const id = message.id ?? null;
  switch (message.method) {
    case 'initialize': {
      const requested = (message.params as { protocolVersion?: unknown } | undefined)
        ?.protocolVersion;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: typeof requested === 'string' ? requested : MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: PROXY_SERVER_NAME, version },
        },
      };
    }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: [] } };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Uxnan Desktop is not attached to this run' },
      };
  }
}

export interface McpProxyOptions {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  version: string;
}

/** Serve the proxy until [input] ends. */
export async function runMcpProxy(options: McpProxyOptions): Promise<void> {
  const env = options.env ?? process.env;
  const url = env['UXNAN_MCP_URL'];
  const token = env['UXNAN_MCP_TOKEN'];
  const folder = env['UXNAN_THREAD_CWD'] || encodeURIComponent(options.cwd ?? process.cwd());
  const agentId = env['UXNAN_AGENT_ID'];
  const client =
    url && token
      ? new DesktopMcpClient(url, token, folder, 'uxnan-proxy', agentId || undefined)
      : undefined;
  const write = (answer: RpcAnswer): void => {
    options.output.write(`${JSON.stringify(answer)}\n`);
  };

  const lines = createInterface({ input: options.input });
  // Answer in order: the agent may pipeline requests.
  let chain = Promise.resolve();
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    chain = chain.then(async () => {
      const isRequest = message.id !== undefined && message.id !== null;
      if (!client) {
        if (isRequest) write(emptyServerAnswer(message, options.version));
        return;
      }
      try {
        const answer = await client.forward(message);
        if (isRequest && answer) write({ jsonrpc: '2.0', ...answer, id: message.id });
      } catch (err) {
        if (!isRequest) return;
        // The desktop went away mid-run: behave as a server without tools for
        // discovery, and fail the call itself honestly.
        if (message.method === 'tools/call') {
          write({
            jsonrpc: '2.0',
            id: message.id ?? null,
            error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
          });
        } else {
          write(emptyServerAnswer(message, options.version));
        }
      }
    });
  }
  await chain;
}

/**
 * The environment an agent process needs so the proxy it starts reaches the
 * desktop — endpoint and token only in the environment, never argv or a file —
 * and a `key` naming that attachment, so a resident process started with a
 * different one (attached, detached, a new token) is recycled before its next
 * turn. [cwd] is set for a process that serves one conversation; a process
 * shared by several (Zero's) leaves it out and each proxy uses its own folder.
 */
export function proxyLaunchEnv(
  desktop: DesktopTools | undefined,
  cwd?: string,
): { env: Record<string, string>; key: string } {
  if (!desktop) return { env: {}, key: '' };
  return {
    env: {
      UXNAN_MCP_URL: desktop.mcpUrl,
      UXNAN_MCP_TOKEN: desktop.token,
      ...(cwd !== undefined ? { UXNAN_THREAD_CWD: encodeCwdHeader(cwd) } : {}),
    },
    key: `${desktop.mcpUrl}#${createHash('sha256').update(desktop.token).digest('hex').slice(0, 16)}`,
  };
}
