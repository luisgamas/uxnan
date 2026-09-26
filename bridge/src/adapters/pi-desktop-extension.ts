/**
 * Uxnan Desktop's tools for pi — a pi extension, loaded with `-e` into the
 * resident `pi --mode rpc` of a conversation while the desktop is attached
 * (architecture/02a §5.8.15). pi has no MCP client of its own, so this file is
 * one: it opens the desktop's MCP server at startup, lists its tools and
 * registers each one as a pi tool whose `execute` is a `tools/call`.
 *
 * It runs **inside pi's process**, not the bridge's, so it imports nothing: pi
 * loads it on its own (through jiti) and hands the factory its extension API.
 * Everything it needs arrives in the environment the bridge spawns pi with —
 * `UXNAN_MCP_URL`, `UXNAN_MCP_TOKEN` and `UXNAN_THREAD_CWD` (the conversation's
 * folder, already percent-encoded for its header) — so the token never reaches
 * argv or a file. Verified against pi 0.85.1: the factory is awaited before the
 * session starts, the tools reach the model, and a call answers.
 *
 * The MCP client itself is `desktop-mcp-client.ts`, shared with the stdio
 * proxy. A server that cannot be reached registers nothing — pi still starts,
 * without the tools.
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

export default async function uxnanDesktopTools(pi: PiExtensionApi): Promise<void> {
  const url = process.env['UXNAN_MCP_URL'];
  const token = process.env['UXNAN_MCP_TOKEN'];
  const cwd = process.env['UXNAN_THREAD_CWD'] ?? '';
  if (!url || !token) return;

  const client = new DesktopMcpClient(url, token, cwd, 'uxnan-pi');
  let tools: McpTool[];
  let instructions: string | undefined;
  try {
    const signal = AbortSignal.timeout(STARTUP_TIMEOUT_MS);
    ({ instructions } = await client.initialize(signal));
    tools = await client.listTools(signal);
  } catch {
    // The desktop is gone or refused us: pi runs without its tools.
    return;
  }

  let first = true;
  for (const tool of tools) {
    if (PI_BUILTIN_TOOLS.has(tool.name)) continue;
    pi.registerTool({
      name: tool.name,
      label: tool.title ?? tool.name,
      description: tool.description ?? tool.name,
      // The server's own guidance, once — pi adds it to the system prompt while
      // the tool is active.
      ...(first && instructions ? { promptGuidelines: [instructions] } : {}),
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
