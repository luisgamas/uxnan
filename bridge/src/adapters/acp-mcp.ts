/**
 * Uxnan Desktop's tools for an agent driven over the Agent Client Protocol
 * (Grok, Zero): the desktop's MCP server as an ACP `McpServer` entry, sent on
 * every `session/new` and `session/load` — ACP's own per-session channel, so a
 * shared ACP process serves each conversation its own folder, and a changed
 * attachment (attached, detached, a new token) reaches the next turn.
 *
 * The entry follows the ACP schema's http variant — `type`, `name`, `url` and a
 * `headers` list, all required — and is only sent to an agent that advertised
 * `agentCapabilities.mcpCapabilities.http` in `initialize`: an agent that did
 * not would drop it silently. The token rides in that JSON-RPC message on the
 * agent's stdin, never argv or a file.
 */
import {
  DESKTOP_CWD_HEADER,
  DESKTOP_MCP_SERVER_NAME,
  encodeCwdHeader,
  type DesktopTools,
} from '@uxnan/shared';

export interface AcpMcpServerHttp {
  type: 'http';
  name: string;
  url: string;
  headers: { name: string; value: string }[];
}

/** Whether an ACP `initialize` result advertises HTTP MCP servers. */
export function acpSupportsHttpMcp(initialize: unknown): boolean {
  if (!initialize || typeof initialize !== 'object') return false;
  const caps = (initialize as { agentCapabilities?: { mcpCapabilities?: { http?: unknown } } })
    .agentCapabilities;
  return caps?.mcpCapabilities?.http === true;
}

/** The `mcpServers` list for one session: the desktop's server when it is
 *  attached and the agent takes HTTP servers, else none. */
export function acpDesktopMcpServers(
  desktop: DesktopTools | undefined,
  cwd: string,
  httpSupported: boolean,
): AcpMcpServerHttp[] {
  if (!desktop || !httpSupported) return [];
  return [
    {
      type: 'http',
      name: DESKTOP_MCP_SERVER_NAME,
      url: desktop.mcpUrl,
      headers: [
        { name: 'Authorization', value: `Bearer ${desktop.token}` },
        { name: DESKTOP_CWD_HEADER, value: encodeCwdHeader(cwd) },
      ],
    },
  ];
}
