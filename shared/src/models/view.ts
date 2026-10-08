/**
 * Agent views: an interactive page an agent shows inline in a chat.
 *
 * The bridge owns them. Every agent it drives gets the bridge's own MCP server
 * ({@link BRIDGE_MCP_SERVER_NAME}) with the {@link VIEW_TOOL_NAME} tool; a call
 * hands the bridge a self-contained HTML page, which it validates, prepares
 * (a no-network Content-Security-Policy and the view bootstrap, see
 * `views/view-protocol.ts`) and stores. The finished tool call reaches the
 * clients as a {@link ViewContentBlock} — never as the HTML itself — and each
 * client fetches the prepared page with `view/read` and renders it sandboxed:
 * an opaque-origin iframe on the desktop, a WebView on the phone.
 */

/** The MCP server name bridge-run agents see the bridge's own tools under. */
export const BRIDGE_MCP_SERVER_NAME = 'uxnan';

/** The tool an agent calls to show a view. */
export const VIEW_TOOL_NAME = 'view_show';

/** The most HTML an agent may hand over, in UTF-8 bytes. Keeps a prepared
 *  page inside one end-to-end-encrypted frame on the relay. */
export const VIEW_MAX_HTML_BYTES = 512 * 1024;

/** The longest title, in characters (longer ones are cut). */
export const VIEW_MAX_TITLE_LENGTH = 120;

/** The inline height range, in CSS pixels, a client lays a view out in before
 *  and after the page reports its own height. Taller pages scroll inside. */
export const VIEW_MIN_HEIGHT = 80;
export const VIEW_MAX_HEIGHT = 1600;

/** The height a client reserves when the agent gave none. */
export const VIEW_DEFAULT_HEIGHT = 320;

/** What the tool's answer carries so the bridge can find the view it made:
 *  `uxnan-view:<viewId>`. */
export const VIEW_MARKER_PREFIX = 'uxnan-view:';

/** A view id: 32 lowercase hex characters (128 random bits). */
export function isViewId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/** The view id a tool answer names, if any. */
export function viewIdInOutput(output: string): string | undefined {
  const match = /uxnan-view:([0-9a-f]{32})\b/.exec(output);
  return match?.[1];
}

/**
 * Whether a tool name, as an agent reports it, is the view tool: every CLI
 * spells an MCP tool its own way (`mcp__uxnan__view_show`, `uxnan_view_show`,
 * `uxnan.view_show`, `uxnan/view_show`, or the bare `view_show`).
 */
export function isViewToolName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[\s_./:-]+/g, '');
  return normalized === 'viewshow' || normalized.endsWith('uxnanviewshow');
}

/** A height clamped to the inline range. */
export function clampViewHeight(height: number): number {
  if (!Number.isFinite(height)) return VIEW_DEFAULT_HEIGHT;
  return Math.min(VIEW_MAX_HEIGHT, Math.max(VIEW_MIN_HEIGHT, Math.round(height)));
}

/**
 * A view in a chat, as a `stream/content/block` persisted with the assistant
 * message. It replaces the finished `view_show` tool step in place (same
 * `blockId`), so the page's HTML never rides the stream.
 */
export interface ViewContentBlock {
  type: 'view';
  blockId?: string;
  /** The key for `view/read`. */
  viewId: string;
  title: string;
  /** The height the agent asked for, clamped ({@link clampViewHeight}); the
   *  page's own measurement replaces it once it renders. */
  height?: number;
  /** Size of the agent's HTML, in bytes. */
  bytes: number;
}
