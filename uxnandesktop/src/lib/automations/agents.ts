// The machine an automation works on, as the window needs it: which agents it
// can use — the ones the machine its folder is on has — and how its folder
// reads. This machine answers for itself (`ai_commit_agents`); a host answers
// through its inventory, keyed by the same CLI names — an agent installed here
// is no use to a run that happens there.

import { aiCommitAgents } from "$lib/api";
import { hosts } from "$lib/state/hosts.svelte";
import { sshHostId, type TargetId } from "$lib/target";

export async function agentsOn(target: TargetId | null | undefined): Promise<string[]> {
  const hostId = sshHostId(target);
  if (!hostId) return aiCommitAgents().catch(() => [] as string[]);
  if (!hosts.inventories[hostId] && hosts.isConnected(hostId)) {
    await hosts.loadInventory(hostId);
  }
  return Object.keys(hosts.inventories[hostId]?.agents ?? {});
}

/** The folder of an automation (or a run) as a person reads it: on a host,
 *  prefixed with that host's name, since the path alone names a folder of
 *  some machine and the reader would assume this one. */
export function folderOnMachine(workingDir: string, target: TargetId | null | undefined): string {
  const hostId = sshHostId(target);
  return hostId ? `${hosts.labelOf(hostId)}: ${workingDir}` : workingDir;
}
