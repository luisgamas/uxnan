// The access mode a conversation runs in on its agent — the same rule the
// bridge applies before a turn (`effectiveAccessMode` in shared/), kept here
// because the desktop takes only types from shared/.
import type { AccessMode } from "$shared/models/thread";
import type { AgentCapabilities } from "$shared/agents/agent-capabilities";

/**
 * The stored mode when the agent offers it, else the agent's default (else
 * its first mode); undefined when the agent offers no mode.
 */
export function effectiveAccessMode(
  caps: Pick<AgentCapabilities, "accessModes" | "defaultAccessMode">,
  stored: AccessMode | undefined,
): AccessMode | undefined {
  const offered = caps.accessModes ?? [];
  if (offered.length === 0) return undefined;
  if (stored !== undefined && offered.includes(stored)) return stored;
  const fallback = caps.defaultAccessMode;
  return fallback !== undefined && offered.includes(fallback) ? fallback : offered[0];
}
