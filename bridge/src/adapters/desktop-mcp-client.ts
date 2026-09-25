/**
 * A minimal MCP client for Uxnan Desktop's control server — Streamable HTTP,
 * reduced to what a client that initializes, lists and calls tools needs:
 * JSON-RPC over POST, a JSON or an SSE answer, and the `Mcp-Session-Id` the
 * server may hand out at `initialize`.
 *
 * Shared by the two places the bridge hands the desktop's tools to an agent
 * that cannot reach an HTTP MCP server itself: the pi extension
 * (`pi-desktop-extension.ts`) and the stdio proxy Zero and Antigravity start
 * (`mcp-proxy.ts`). It imports nothing, because pi loads the extension — and so
 * this file — in its own process.
 */

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContent {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export class DesktopMcpClient {
  readonly #url: string;
  readonly #headers: Record<string, string>;
  readonly #clientName: string;
  #sessionId: string | undefined;
  #nextId = 1;

  /** [cwd] is the conversation's folder, already percent-encoded for its header;
   *  [agentId] names the desktop terminal the agent runs in, when it does. */
  constructor(
    url: string,
    token: string,
    cwd: string,
    clientName = 'uxnan-bridge',
    agentId?: string,
  ) {
    this.#url = url;
    this.#clientName = clientName;
    this.#headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'x-uxnan-cwd': cwd,
      ...(agentId ? { 'x-uxnan-agent-id': agentId } : {}),
    };
  }

  async initialize(signal?: AbortSignal): Promise<{ instructions?: string }> {
    const result = (await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: this.#clientName, version: '1.0.0' },
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

  /**
   * Pass one JSON-RPC message through unchanged: a request resolves with the
   * server's answer, a notification with `undefined`.
   */
  async forward(message: { id?: unknown }, signal?: AbortSignal): Promise<RpcAnswer | undefined> {
    const response = await this.#post(message, signal);
    if (message.id === undefined || message.id === null) return undefined;
    return readAnswer(response, message.id);
  }

  async #post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { ...this.#headers };
    if (this.#sessionId) {
      headers['mcp-session-id'] = this.#sessionId;
      headers['mcp-protocol-version'] = MCP_PROTOCOL_VERSION;
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

export interface RpcAnswer {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** The JSON-RPC answer to request `id`, from a JSON body or an SSE stream. */
async function readAnswer(response: Response, id: unknown): Promise<RpcAnswer> {
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
