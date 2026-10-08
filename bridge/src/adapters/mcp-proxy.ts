/**
 * `uxnan-bridge mcp-proxy` — bridge-run MCP tools for an agent that only
 * reads MCP servers from its user-global config: Antigravity
 * (architecture/02a §5.8.15; why not Zero: `agents/global-mcp-entry.ts`).
 *
 * `agy` cannot be handed a server per run, so the bridge registers ONE entry in
 * its global config — `uxnan-browser`, a stdio server that runs this command —
 * with no token and no port in it. This proxy reads what it needs from the
 * environment the agent passes to the servers it starts (verified on agy
 * 1.2.10: stdio servers inherit it and start in the conversation's folder):
 *
 * - `UXNAN_MCP_SERVERS` — the ordered bridge + optional desktop endpoint list
 *   and bearer tokens, set only in the bridge-launched agent's environment;
 * - `UXNAN_MCP_URL` + `UXNAN_MCP_TOKEN` — what Uxnan Desktop sets instead for an
 *   agent it launches in one of its terminals (its own server only, which the
 *   proxy serves as `uxnan-browser`); read only when `UXNAN_MCP_SERVERS` is
 *   absent;
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
import { DESKTOP_MCP_SERVER_NAME, encodeCwdHeader, type AgentMcpServer } from '@uxnan/shared';
import {
  DesktopMcpClient,
  MCP_PROTOCOL_VERSION,
  type McpTool,
  type RpcAnswer,
} from './desktop-mcp-client.js';

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

/**
 * The servers this proxy fronts, from its environment: a bridge run's
 * `UXNAN_MCP_SERVERS` list, else a desktop terminal's single `UXNAN_MCP_URL` /
 * `UXNAN_MCP_TOKEN` pair, else none. Malformed entries are dropped.
 */
export function proxyServers(env: NodeJS.ProcessEnv): AgentMcpServer[] {
  const raw = env['UXNAN_MCP_SERVERS'];
  if (raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is AgentMcpServer =>
          !!s &&
          typeof s === 'object' &&
          typeof (s as AgentMcpServer).name === 'string' &&
          typeof (s as AgentMcpServer).url === 'string' &&
          typeof (s as AgentMcpServer).token === 'string',
      );
    } catch {
      return [];
    }
  }
  const url = env['UXNAN_MCP_URL'];
  const token = env['UXNAN_MCP_TOKEN'];
  return url && token ? [{ name: DESKTOP_MCP_SERVER_NAME, url, token }] : [];
}

/** Serve the proxy until [input] ends. */
export async function runMcpProxy(options: McpProxyOptions): Promise<void> {
  const env = options.env ?? process.env;
  const servers = proxyServers(env);
  const folder = env['UXNAN_THREAD_CWD'] || encodeURIComponent(options.cwd ?? process.cwd());
  const agentId = env['UXNAN_AGENT_ID'];
  const clients = servers.map((server) => ({
    server,
    client: new DesktopMcpClient(
      server.url,
      server.token,
      folder,
      'uxnan-proxy',
      agentId || undefined,
    ),
  }));
  const routes = new Map<string, { client: DesktopMcpClient; tool: McpTool }>();
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
      if (clients.length === 0) {
        if (isRequest) write(emptyServerAnswer(message, options.version));
        return;
      }
      try {
        let answer: RpcAnswer | undefined;
        if (message.method === 'initialize') {
          const initialized = await Promise.all(clients.map(({ client }) => client.initialize()));
          answer = {
            jsonrpc: '2.0',
            id: message.id ?? null,
            result: {
              protocolVersion:
                typeof (message.params as { protocolVersion?: unknown } | undefined)
                  ?.protocolVersion === 'string'
                  ? (message.params as { protocolVersion: string }).protocolVersion
                  : MCP_PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: PROXY_SERVER_NAME, version: options.version },
              instructions: initialized
                .map((i) => i.instructions)
                .filter(Boolean)
                .join('\n'),
            },
          };
        } else if (message.method === 'notifications/initialized') {
          // Each upstream client sent its own initialized notification during
          // `initialize`; the downstream handshake is terminated here.
          answer = undefined;
        } else if (message.method === 'tools/list') {
          const groups = await Promise.all(
            clients.map(async ({ server, client }) => ({
              server,
              client,
              tools: await client.listTools(),
            })),
          );
          const counts = new Map<string, number>();
          for (const g of groups)
            for (const t of g.tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
          routes.clear();
          const tools = groups.flatMap((g) =>
            g.tools.map((tool) => {
              const prefix = g.server.name.replace(/[^a-zA-Z0-9_]/g, '_');
              const name = counts.get(tool.name)! > 1 ? `${prefix}_${tool.name}` : tool.name;
              routes.set(name, { client: g.client, tool });
              return { ...tool, name };
            }),
          );
          answer = { jsonrpc: '2.0', id: message.id ?? null, result: { tools } };
        } else if (message.method === 'tools/call') {
          const p = message.params as { name?: unknown; arguments?: unknown } | undefined;
          const route = typeof p?.name === 'string' ? routes.get(p.name) : undefined;
          if (!route) throw new Error(`Unknown MCP tool: ${String(p?.name)}`);
          answer = await route.client.forward({
            ...message,
            params: { name: route.tool.name, arguments: p?.arguments ?? {} },
          } as { id?: unknown });
        } else {
          answer = await clients[0]!.client.forward(message);
        }
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
  servers: AgentMcpServer[] | undefined,
  cwd?: string,
): { env: Record<string, string>; key: string } {
  if (!servers?.length) return { env: {}, key: '' };
  return {
    env: {
      UXNAN_MCP_SERVERS: JSON.stringify(servers),
      ...(cwd !== undefined ? { UXNAN_THREAD_CWD: encodeCwdHeader(cwd) } : {}),
    },
    key: createHash('sha256')
      .update(JSON.stringify(servers.map((s) => [s.name, s.url, s.token])))
      .digest('hex')
      .slice(0, 16),
  };
}
