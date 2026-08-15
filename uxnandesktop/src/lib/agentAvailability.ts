// Which agents can actually be launched on a given machine.
//
// The list of agents is the user's own configuration, and it describes *this*
// machine: the CLIs they installed here. A host has its own — that is the whole
// point of running the work there — so offering this machine's list for a host
// invites launching something that is not installed, which fails in a pane
// seconds later with a message from a shell rather than from us.
//
// The host's inventory (`ssh_host_inventory`) already answers the question:
// which agent commands exist there, with versions. This module is the rule that
// reads it, kept pure so both halves — "what to offer" and "why one is missing"
// — are testable without a host.

/** Just enough of an agent profile to decide. */
export interface LaunchableAgent {
  id: string;
  command: string;
}

/** The command as the inventory reports it: no directory, no extension, folded.
 *  A profile may hold `claude`, `C:\tools\claude.cmd` or `/usr/local/bin/claude`
 *  and mean the same CLI. */
export function commandKey(command: string): string {
  const base = command.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.(exe|cmd|bat|ps1|sh)$/i, "").toLowerCase();
}

/** The agents to offer for a machine.
 *
 *  `inventory` is what that host reported — `undefined` when it has not been
 *  asked yet (or is not a host at all). **Absence of an inventory is not
 *  absence of agents:** with nothing to go on, every agent is offered, because
 *  hiding them all would be a claim we cannot support. Only a real inventory
 *  filters, and then it filters honestly: what that machine does not have is not
 *  offered there.
 */
export function agentsFor<T extends LaunchableAgent>(
  agents: readonly T[],
  inventory: { agents: Record<string, string> } | undefined | null,
): T[] {
  if (!inventory) return [...agents];
  const present = new Set(Object.keys(inventory.agents).map(commandKey));
  return agents.filter((a) => present.has(commandKey(a.command)));
}

/** The agents configured here that the host does not have, for a message that
 *  says *which* rather than "some are missing". Empty when nothing was asked. */
export function agentsMissingFrom<T extends LaunchableAgent>(
  agents: readonly T[],
  inventory: { agents: Record<string, string> } | undefined | null,
): T[] {
  if (!inventory) return [];
  const present = new Set(Object.keys(inventory.agents).map(commandKey));
  return agents.filter((a) => !present.has(commandKey(a.command)));
}

/** One agent a host reported, ready to render. */
export interface HostAgent {
  /** The command as the inventory reported it, folded (`claude`). */
  key: string;
  /** The product's real name when the catalog knows it; the command otherwise. */
  name: string;
  /** Logo key for `AgentLogo`'s fallback chain. */
  logo: string;
  /** What that machine answered to `--version`, verbatim. Can be empty. */
  version: string;
}

/** What a host has, as a list worth showing.
 *
 *  The inventory is keyed by **command** (`claude`, `agy`), which is what the
 *  host was asked about — not by catalog id — so the names and logos are looked
 *  up through `commandKey`. A command the catalog does not know is still listed:
 *  it is installed there, and dropping it would under-report the machine. It
 *  simply shows under its own name, and `AgentLogo`'s chain ends at the generic
 *  glyph.
 *
 *  Sorted by display name so the strip does not reshuffle between two reads of
 *  the same machine. */
export function hostAgents<T extends LaunchableAgent & { name?: string; logo?: string }>(
  catalog: readonly T[],
  inventory: { agents: Record<string, string> } | undefined | null,
): HostAgent[] {
  if (!inventory) return [];
  const known = new Map(catalog.map((a) => [commandKey(a.command), a]));
  return Object.entries(inventory.agents)
    .map(([command, version]) => {
      const key = commandKey(command);
      const match = known.get(key);
      return {
        key,
        name: match?.name ?? command,
        logo: match?.logo ?? match?.id ?? key,
        version: version ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
