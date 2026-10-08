import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BRIDGE_MCP_SERVER_NAME,
  UXNAN_CWD_HEADER,
  VIEW_MAX_HEIGHT,
  VIEW_MIN_HEIGHT,
  VIEW_TOOL_NAME,
} from '@uxnan/shared';
import type { ViewStore } from './view-store.js';
import { describeViewLibraries } from './view-libraries.js';

const BODY_LIMIT = 1536 * 1024;
/**
 * How an agent learns it can show a view — the tool's description and the
 * server's `instructions`, the channel every MCP client reads. They say WHEN
 * as a rule, not as an option: measured on 2026-10-08, a description that
 * only allowed a view ("when a chart … communicates better") got none from
 * Claude Code, Codex or OpenCode on an ordinary question about numbers, and
 * the person will never ask for the tool by name.
 */
export const VIEW_TOOL_DESCRIPTION = `Show the person an interactive page inline in this chat — on their desktop and on their phone. Use it, without being asked, whenever your answer compares options, plans, prices or products, or contains numbers to compare, a trend over time, a breakdown or proportion, a ranking, a schedule, a diagram or flow, a UI mockup, or anything you would otherwise put in a Markdown table: show it here instead of the table, and keep your text to a sentence or two about what it means. The person will not ask for it by name. Give a short title and exactly one of html (one self-contained HTML document) or path (an HTML file in the working folder — better for long pages you will revise). The page has no network: no CDNs, fetch, remote fonts or images; inline everything (data: URIs are fine). Keep it light: inline SVG or a bundled library for charts, <canvas> for thousands of points, small DOMs. Bundled libraries load with no network: ${describeViewLibraries()}. Style it with the host's theme variables so it matches light and dark mode, always with a fallback, e.g. color: var(--color-text-primary, #222): --color-background-primary, --color-background-secondary, --color-text-primary, --color-text-secondary, --color-border-primary, --color-ring-primary, --color-background-info, --color-background-danger, --color-background-success, --color-background-warning, --font-sans, --font-mono, --border-radius-sm, --border-radius-md, --border-radius-lg. Set height to the expected height in CSS pixels. The person can point at elements and send you notes about them; a button in the page can propose a message with window.uxnan.sendMessage(text), which only fills their composer.`;

export const VIEW_SERVER_INSTRUCTIONS = `You are talking to a person through Uxnan, which shows your replies in a chat on their desktop and their phone. Uxnan can show interactive pages inside that chat with the view_show tool. Whenever your answer compares options, plans, prices or products, or contains numbers to compare, a trend, a breakdown, a ranking, a schedule, a diagram or a mockup — anything you would otherwise write as a Markdown table, a list of figures or ASCII art — show it with view_show instead, and keep the surrounding text short. Do this on your own: the person does not know the tool exists and will not ask for it by name. Pages are self-contained HTML with no network access, styled with the host's theme variables (see the tool's description).`;

export interface ViewMcpHandle {
  url: string;
  token: string;
  close(): Promise<void>;
}
export async function startViewMcpServer(options: { store: ViewStore }): Promise<ViewMcpHandle> {
  const token = randomBytes(32).toString('base64url');
  const server = createServer((req, res) => {
    void handle(req, res, token, options.store);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('View MCP server did not bind to a TCP port');
  return { url: `http://127.0.0.1:${address.port}/mcp`, token, close: () => closeServer(server) };
}

async function handle(
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
  token: string,
  store: ViewStore,
): Promise<void> {
  if (req.method === 'GET' || req.method === 'DELETE') {
    res.writeHead(405, { Allow: 'POST' }).end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/mcp') {
    res.writeHead(404).end();
    return;
  }
  if (!authMatches(req.headers.authorization, token)) {
    res.writeHead(401).end();
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
    return;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    json(res, 400, rpcError(null, -32600, 'Invalid Request'));
    return;
  }
  const msg = body as Record<string, unknown>;
  const id = msg.id;
  const method = msg.method;
  if (typeof method !== 'string') {
    json(res, 400, rpcError(id, -32600, 'Invalid Request'));
    return;
  }
  if (method === 'notifications/initialized') {
    res.writeHead(202).end();
    return;
  }
  try {
    let result: unknown;
    switch (method) {
      case 'initialize': {
        const protocol = (msg.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
        result = {
          protocolVersion: typeof protocol === 'string' ? protocol : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: BRIDGE_MCP_SERVER_NAME, version: '1.0.0' },
          instructions: VIEW_SERVER_INSTRUCTIONS,
        };
        break;
      }
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = {
          tools: [
            {
              name: VIEW_TOOL_NAME,
              description: VIEW_TOOL_DESCRIPTION,
              inputSchema: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: 'Short title shown above the inline page.',
                  },
                  html: { type: 'string', description: 'Self-contained HTML document.' },
                  path: {
                    type: 'string',
                    description: 'HTML file path relative to the conversation working folder.',
                  },
                  height: {
                    type: 'integer',
                    minimum: VIEW_MIN_HEIGHT,
                    maximum: VIEW_MAX_HEIGHT,
                    description: 'Expected inline height in CSS pixels.',
                  },
                },
                // Exactly one of html/path is checked when the tool is called:
                // `oneOf`/`not` are keywords several agent CLIs drop or reject
                // when they translate an MCP schema for their model.
                required: ['title'],
              },
            },
          ],
        };
        break;
      case 'tools/call':
        result = await callTool(msg.params, req, store);
        break;
      default:
        json(res, 200, rpcError(id, -32601, `Method not found: ${method}`));
        return;
    }
    if (id === undefined) {
      res.writeHead(202).end();
      return;
    }
    json(res, 200, { jsonrpc: '2.0', id, result });
  } catch (error) {
    if (id === undefined) {
      res.writeHead(202).end();
      return;
    }
    json(res, 200, {
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [
          { type: 'text', text: error instanceof Error ? error.message : 'View creation failed.' },
        ],
      },
    });
  }
}

async function callTool(params: unknown, req: IncomingMessage, store: ViewStore): Promise<unknown> {
  if (!params || typeof params !== 'object')
    throw new Error('Invalid tool parameters. Provide title and exactly one of html or path.');
  const p = params as Record<string, unknown>;
  if (p.name !== VIEW_TOOL_NAME) throw new Error(`Unknown tool: ${String(p.name)}`);
  const a = p.arguments;
  if (!a || typeof a !== 'object')
    throw new Error('Provide title and exactly one of html or path.');
  const arg = a as Record<string, unknown>;
  if (
    typeof arg.title !== 'string' ||
    (arg.html !== undefined && typeof arg.html !== 'string') ||
    (arg.path !== undefined && typeof arg.path !== 'string') ||
    (arg.height !== undefined && (!Number.isInteger(arg.height) || typeof arg.height !== 'number'))
  )
    throw new Error(
      'Invalid arguments: title must be text, html/path must be text, and height must be an integer.',
    );
  const cwdValue = req.headers[UXNAN_CWD_HEADER];
  let cwd: string | undefined;
  if (typeof cwdValue === 'string') {
    try {
      cwd = decodeURIComponent(cwdValue);
    } catch {
      throw new Error(
        'The conversation working folder header was invalid; provide html instead of path.',
      );
    }
  }
  const { viewId, meta } = await store.create({
    title: arg.title,
    ...(arg.html !== undefined ? { html: arg.html } : {}),
    ...(arg.path !== undefined ? { path: arg.path } : {}),
    ...(arg.height !== undefined ? { height: arg.height as number } : {}),
    ...(cwd ? { cwd } : {}),
  });
  return {
    content: [
      {
        type: 'text',
        text: `Shown to the person inline in the chat as "${meta.title}" — on the desktop and on the phone. uxnan-view:${viewId}`,
      },
    ],
  };
}
function authMatches(value: string | undefined, token: string): boolean {
  const prefix = 'Bearer ';
  if (!value?.startsWith(prefix)) return false;
  const supplied = Buffer.from(value.slice(prefix.length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function readBody(req: IncomingMessage): Promise<string> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    length += b.length;
    if (length > BODY_LIMIT) throw new Error('Request body too large');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function json(res: import('node:http').ServerResponse, status: number, value: unknown): void {
  res
    .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    .end(JSON.stringify(value));
}
function rpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', error: { code, message }, id: id ?? null };
}
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
