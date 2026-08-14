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
