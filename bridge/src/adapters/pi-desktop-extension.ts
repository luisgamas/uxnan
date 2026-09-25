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
 * The transport is MCP's Streamable HTTP, reduced to what a client that only
 * lists and calls tools needs: JSON-RPC over POST, a JSON or an SSE answer, and
 * the `Mcp-Session-Id` the server may hand out at `initialize`. A server that
 * cannot be reached registers nothing — pi still starts, without the tools.
 */

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

interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpContent {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

const PROTOCOL_VERSION = '2025-06-18';
/** pi's own tools, which a desktop tool must never shadow. */
const PI_BUILTIN_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
/** How long the startup handshake may take before pi starts without the tools. */
const STARTUP_TIMEOUT_MS = 5_000;

class McpClient {
  readonly #url: string;
  readonly #headers: Record<string, string>;
  #sessionId: string | undefined;
  #nextId = 1;

  constructor(url: string, token: string, cwd: string) {
    this.#url = url;
    this.#headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'x-uxnan-cwd': cwd,
    };
  }

  async initialize(signal?: AbortSignal): Promise<{ instructions?: string }> {
    const result = (await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'uxnan-pi', version: '1.0.0' },
      },
      signal,
    )) as { instructions?: unknown };
    await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal);
    return typeof result?.instructions === 'string' ? { instructions: result.instructions } : {};
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = (await this.request('tools/list', cursor ? { cursor } : {}, signal)) as {
        tools?: McpTool[];
        nextCursor?: string;
      };
      for (const tool of page?.tools ?? []) if (typeof tool?.name === 'string') tools.push(tool);
      cursor = typeof page?.nextCursor === 'string' ? page.nextCursor : undefined;
    } while (cursor);
    return tools;
  }

  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.#nextId++;
    const response = await this.#post({ jsonrpc: '2.0', id, method, params }, signal);
    const message = await readAnswer(response, id);
    if (message.error) throw new Error(message.error.message ?? `${method} failed`);
    return message.result;
  }

  async #post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { ...this.#headers };
    if (this.#sessionId) {
      headers['mcp-session-id'] = this.#sessionId;
      headers['mcp-protocol-version'] = PROTOCOL_VERSION;
    }
    const response = await fetch(this.#url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    const session = response.headers.get('mcp-session-id');
    if (session) this.#sessionId = session;
    if (!response.ok) throw new Error(`Uxnan Desktop answered HTTP ${response.status}`);
    return response;
  }
}

interface RpcAnswer {
  id?: unknown;
  result?: unknown;
  error?: { message?: string };
}

/** The JSON-RPC answer to request `id`, from a JSON body or an SSE stream. */
async function readAnswer(response: Response, id: number): Promise<RpcAnswer> {
  const text = await response.text();
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return JSON.parse(text) as RpcAnswer;
  }
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const message = JSON.parse(data) as RpcAnswer;
    if (message.id === id) return message;
  }
  throw new Error('Uxnan Desktop sent no answer');
}

/** An MCP tool result as pi tool content; an MCP error becomes a thrown one. */
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

  const client = new McpClient(url, token, cwd);
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
