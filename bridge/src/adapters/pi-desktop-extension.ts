/**
 * MCP servers for pi — a bridge extension, loaded with `-e` into the resident
 * `pi --mode rpc` of one conversation. pi 1.1.0 has a built-in MCP client; the
 * bridge uses this extension to provide run-scoped credentials without writing
 * its user-global MCP configuration. It lists each server's tools and registers
 * each as a pi tool whose `execute` is a `tools/call`.
 *
 * It runs **inside pi's process**, not the bridge's, so it imports nothing: pi
 * loads it on its own (through jiti) and hands the factory its extension API.
 * Everything it needs arrives in the environment the bridge spawns pi with —
 * `UXNAN_MCP_SERVERS` and `UXNAN_THREAD_CWD` (the conversation folder,
 * percent-encoded for its header) — so credentials never reach argv or a file.
 * Verified against pi 1.1.0: the factory is awaited before the
 * session starts, the tools reach the model, and a call answers.
 *
 * The HTTP client is shared with the stdio proxy. A server that cannot be
 * reached registers nothing — pi still starts with any reachable servers.
 */
import { DesktopMcpClient, type McpContent, type McpTool } from './desktop-mcp-client.js';

/** The slice of pi's `ExtensionAPI` this extension uses. */
interface PiExtensionApi {
  registerTool(tool: PiToolDefinition): void;
}

interface PiToolDefinition {
  name: string;
  label: string;
  description: string;
  promptGuidelines?: string[];
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<{ content: PiContent[]; details?: unknown }>;
}

type PiContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** pi's own tools, which a desktop tool must never shadow. */
const PI_BUILTIN_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
/** How long the startup handshake may take before pi starts without the tools. */
const STARTUP_TIMEOUT_MS = 5_000;

function toPiResult(result: unknown): { content: PiContent[] } {
  const { content, isError } = (result ?? {}) as { content?: McpContent[]; isError?: boolean };
  const out: PiContent[] = [];
  for (const part of content ?? []) {
    if (part.type === 'text' && typeof part.text === 'string') {
      out.push({ type: 'text', text: part.text });
    } else if (part.type === 'image' && part.data && part.mimeType) {
      out.push({ type: 'image', data: part.data, mimeType: part.mimeType });
    } else {
      out.push({ type: 'text', text: JSON.stringify(part) });
    }
  }
  if (isError) {
    throw new Error(out.map((p) => (p.type === 'text' ? p.text : '')).join('\n') || 'tool failed');
  }
  return { content: out.length > 0 ? out : [{ type: 'text', text: '(no output)' }] };
}

export default async function uxnanMcpServers(pi: PiExtensionApi): Promise<void> {
  let servers: { name: string; url: string; token: string }[];
  try {
    servers = JSON.parse(process.env['UXNAN_MCP_SERVERS'] ?? '[]') as typeof servers;
  } catch {
    return;
  }
  const cwd = process.env['UXNAN_THREAD_CWD'] ?? '';
  if (!servers.length) return;
  const registered: { client: DesktopMcpClient; server: string; tool: McpTool }[] = [];
  const instructionSet = new Set<string>();
  for (const server of servers) {
    if (
      !server ||
      typeof server.name !== 'string' ||
      typeof server.url !== 'string' ||
      typeof server.token !== 'string'
    )
      continue;
    const client = new DesktopMcpClient(server.url, server.token, cwd, 'uxnan-pi');
    try {
      const signal = AbortSignal.timeout(STARTUP_TIMEOUT_MS);
      const initialized = await client.initialize(signal);
      if (initialized.instructions) instructionSet.add(initialized.instructions);
      for (const tool of await client.listTools(signal))
        registered.push({ client, server: server.name, tool });
    } catch {
      /* A disconnected server does not prevent the remaining servers from loading. */
    }
  }
  const counts = new Map<string, number>();
  for (const item of registered) counts.set(item.tool.name, (counts.get(item.tool.name) ?? 0) + 1);
  let first = true;
  for (const item of registered) {
    const { client, server, tool } = item;
    if (PI_BUILTIN_TOOLS.has(tool.name)) continue;
    const prefix = server.replace(/[^a-zA-Z0-9_]/g, '_');
    const name = counts.get(tool.name)! > 1 ? `${prefix}_${tool.name}` : tool.name;
    pi.registerTool({
      name,
      label: tool.title ?? tool.name,
      description: tool.description ?? tool.name,
      // The server's own guidance, once — pi adds it to the system prompt while
      // the tool is active.
      ...(first && instructionSet.size ? { promptGuidelines: [...instructionSet] } : {}),
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      async execute(_toolCallId, params, signal) {
        return toPiResult(
          await client.request('tools/call', { name: tool.name, arguments: params ?? {} }, signal),
        );
      },
    });
    first = false;
  }
}
