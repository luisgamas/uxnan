import { DESKTOP_MCP_SERVER_NAME, type AgentMcpServer } from '@uxnan/shared';
import { DesktopMcpClient } from '../adapters/desktop-mcp-client.js';

/** How a page renders, as the desktop's `view/render` reports it. */
export interface ViewRender {
  /** A PNG of the page, base64. */
  png: string;
  width: number;
  height: number;
  /** The document's own height, CSS pixels. */
  contentHeight: number;
  console: { level: string; text: string }[];
  timedOut: boolean;
}

/** Renders a prepared page somewhere that can draw it, or says there is
 *  nowhere to (no desktop attached). */
export type ViewRenderer = (html: string, width: number) => Promise<ViewRender | undefined>;

const REMOTE_ATTRIBUTE = /\b(src|href|poster|data|action)\s*=\s*["']\s*(https?:)?\/\/[^"']+["']/gi;
const REMOTE_CSS = /url\(\s*["']?\s*(https?:)?\/\/|@import\s+["']?\s*(https?:)?\/\//i;
const NETWORK_CALL =
  /\b(fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(|navigator\.sendBeacon)/;

/**
 * What can be told about a page without drawing it: what its no-network policy
 * will block (remote scripts, styles, images, fonts; `fetch` and friends),
 * whether it follows the host's theme (any theme variable at all; colors
 * written as literals), whether it draws a colored stripe on one edge of a box
 * (the app separates with hairlines) and whether its height can keep growing
 * (`vh`).
 * Links (`<a href>`) are fine — they open outside the page, after asking.
 */
export function viewFindings(source: string): string[] {
  const findings: string[] = [];
  const remote = new Set<string>();
  for (const match of source.matchAll(REMOTE_ATTRIBUTE)) {
    const before = source.slice(
      Math.max(0, source.lastIndexOf('<', match.index ?? 0)),
      match.index,
    );
    if (/^<a\b/i.test(before)) continue;
    remote.add(match[0].trim().slice(0, 120));
  }
  if (remote.size > 0) {
    findings.push(
      `Blocked: the page has no network, so these will not load — inline them (data: URIs) or use a bundled library: ${[...remote].slice(0, 5).join(', ')}${remote.size > 5 ? ', …' : ''}.`,
    );
  }
  if (REMOTE_CSS.test(source)) {
    findings.push('Blocked: a stylesheet loads a remote url() or @import; inline it.');
  }
  if (NETWORK_CALL.test(source)) {
    findings.push(
      'Blocked: the page calls the network (fetch/XMLHttpRequest/WebSocket); embed the data instead.',
    );
  }
  if (!/var\(\s*--(color|font|border-radius)-/.test(source)) {
    findings.push(
      'Theme: the page uses none of the host theme variables, so it will not follow light/dark mode — style it with var(--color-text-primary), var(--color-chart-1) and the others.',
    );
  }
  const fixed = fixedColors(source);
  if (fixed.length > 0) {
    findings.push(
      `Colors: ${fixed.length} fixed color${fixed.length === 1 ? '' : 's'} (${fixed.slice(0, 4).join(', ')}${fixed.length > 4 ? ', …' : ''}) will not follow the theme or match the app — use the variables: --color-chart-1 to 6 for series, --color-chart-muted, --color-text-*, --color-background-*.`,
    );
  }
  if (EDGE_STRIPE.test(source)) {
    findings.push(
      'Design: a thick border on one edge of a box (a colored stripe) does not match the app — separate with 1px hairlines in --color-border-primary and put color on the data or a small icon.',
    );
  }
  if (VIEWPORT_HEIGHT.test(source)) {
    findings.push(
      'Height: the frame grows to fit the page, so a height in vh (or height:100% on html/body) makes it grow again and again — give charts fixed pixel heights and let content set the rest.',
    );
  }
  return findings;
}

const EDGE_STRIPE =
  /\bborder-(left|right|top|bottom|inline-start|inline-end|block-start)(-width)?\s*:\s*([2-9]|\d{2,})(\.\d+)?px/i;

const VIEWPORT_HEIGHT =
  /\b(min-|max-)?height\s*:\s*\d+(\.\d+)?(vh|dvh|svh|lvh)\b|(html|body)\s*(,[^{]*)?\{[^}]*\bheight\s*:\s*100%/i;

/**
 * The colors a page writes as literals instead of theme variables: hex,
 * rgb()/hsl() and the like, in its styles, scripts and SVG. A literal inside
 * a `var(--x, …)` fallback is fine — the variable is what the page uses — and
 * so is anything inside a `data:` URI. Distinct values, in order.
 */
export function fixedColors(source: string): string[] {
  const stripped = source
    .replace(/<script\b[^>]*\bsrc\s*=\s*["']uxnan:[^"']*["'][^>]*>\s*<\/script\s*>/gi, '')
    .replace(/data:[^"')\s]+/gi, '')
    .replace(/var\(\s*--[\w-]+\s*,[^()]*(\([^()]*\)[^()]*)*\)/g, '');
  const found = new Set<string>();
  for (const match of stripped.matchAll(
    /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/gi,
  )) {
    // A color is a value: right after `:`, `=`, `(`, `,` or a quote. That
    // leaves out prose ("PR #357") and fragment links (`href="#a1b2c3"`).
    const before = stripped.slice(Math.max(0, (match.index ?? 0) - 8), match.index);
    if (!/[:=(,'"]\s*$/.test(before) || /href\s*=\s*["']$/i.test(before)) continue;
    found.add(match[0].toLowerCase());
  }
  return [...found];
}

/**
 * Render a prepared page on an attached desktop, through its MCP server's
 * `view_render` tool. The desktop answers with an image block and/or the
 * result as JSON text; both are read.
 */
export async function renderOnDesktop(
  server: AgentMcpServer,
  html: string,
  width: number,
): Promise<ViewRender> {
  const client = new DesktopMcpClient(server.url, server.token, '', 'uxnan-bridge-views');
  await client.initialize();
  const answer = (await client.request('tools/call', {
    name: 'view_render',
    arguments: { html, width },
  })) as { content?: { type?: string; text?: string; data?: string }[]; isError?: boolean };
  const blocks = answer?.content ?? [];
  const text = blocks.find((b) => b.type === 'text')?.text ?? '';
  if (answer?.isError) throw new Error(text || 'The desktop could not render the page.');
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* an image-only answer */
  }
  const image = (result['image'] ?? {}) as Record<string, unknown>;
  const png =
    blocks.find((b) => b.type === 'image')?.data ??
    (typeof result['png'] === 'string' ? result['png'] : undefined) ??
    (typeof image['data'] === 'string' ? image['data'] : undefined);
  if (!png) throw new Error('The desktop rendered the page but sent no image.');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const consoleList = Array.isArray(result['console']) ? result['console'] : [];
  return {
    png,
    width: num(result['width'] ?? image['width']),
    height: num(result['height'] ?? image['height']),
    contentHeight: num(result['contentHeight']),
    console: consoleList
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        level: String(c['level'] ?? 'log'),
        text: String(c['text'] ?? '').slice(0, 500),
      }))
      .slice(0, 50),
    timedOut: result['timedOut'] === true,
  };
}

/** A renderer over the desktop server a run would get, when one is attached. */
export function desktopRenderer(desktop: () => AgentMcpServer | undefined): ViewRenderer {
  return async (html, width) => {
    const server = desktop();
    if (!server || server.name !== DESKTOP_MCP_SERVER_NAME) return undefined;
    return renderOnDesktop(server, html, width);
  };
}

/** The check's answer to the model: findings, then the render, if any. */
export function viewCheckReport(
  findings: string[],
  render: ViewRender | undefined,
  renderError?: string,
): { content: Record<string, unknown>[] } {
  const lines: string[] = [];
  if (findings.length === 0) lines.push('No problems found in the page itself.');
  else lines.push(...findings.map((f) => `- ${f}`));
  if (render) {
    const errors = render.console.filter((c) => c.level === 'error');
    lines.push(
      `Rendered at ${render.width}px: the content is ${render.contentHeight}px tall` +
        (render.timedOut ? ' (it had not settled after 10 s).' : '.'),
      errors.length > 0
        ? `Console errors:\n${errors.map((e) => `  ${e.text}`).join('\n')}`
        : 'No console errors.',
      'The screenshot below is what the person will see. If it looks right, call view_show with the same page.',
    );
  } else {
    lines.push(
      renderError
        ? `It could not be rendered: ${renderError}`
        : "No desktop is connected to render it, so this is a check of the page's source only.",
    );
  }
  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      ...(render ? [{ type: 'image', mimeType: 'image/png', data: render.png }] : []),
    ],
  };
}
