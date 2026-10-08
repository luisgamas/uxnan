/**
 * MCP servers for ACP agents that advertise HTTP MCP support (currently Grok),
 * sent on every `session/new` and `session/load` — ACP's own per-session channel, so a
 * shared ACP process serves each conversation its own folder, and a changed
 * attachment (attached, detached, a new token) reaches the next turn.
 *
 * The entry follows the ACP schema's http variant — `type`, `name`, `url` and a
 * `headers` list, all required — and is only sent to an agent that advertised
 * `agentCapabilities.mcpCapabilities.http` in `initialize`: an agent that did
 * not would drop it silently. The token rides in that JSON-RPC message on the
 * agent's stdin, never argv or a file.
 */
import { UXNAN_CWD_HEADER, encodeCwdHeader, type AgentMcpServer } from '@uxnan/shared';

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

/** The `mcpServers` list for one session. */
export function acpMcpServers(
  servers: AgentMcpServer[] | undefined,
  cwd: string,
  httpSupported: boolean,
): AcpMcpServerHttp[] {
  if (!httpSupported) return [];
  return (servers ?? []).map((server) => ({
    type: 'http',
    name: server.name,
    url: server.url,
    headers: [
      { name: 'Authorization', value: `Bearer ${server.token}` },
      { name: UXNAN_CWD_HEADER, value: encodeCwdHeader(cwd) },
    ],
  }));
}
