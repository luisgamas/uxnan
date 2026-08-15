// Which folder a new terminal starts in.
//
// Its own module, and free of any xterm import, so the rule can be tested on its
// own — it is a rule about *machines*, not about rendering.

import { parseWorkspaceKey } from "$lib/pathid";
import { targetOf, type TargetId } from "$lib/target";

/** The Global scratch space: no project, and therefore no folder. */
export const GLOBAL_WORKSPACE = "";

/** The folder a new terminal should open in.
 *
 *  An explicit `cwd` wins. Otherwise the workspace's own folder, so a terminal
 *  opened in a project lands in that project rather than the machine's home —
 *  **but only when the workspace and the terminal are on the same machine.**
 *
 *  That last clause is not a nicety. A workspace key carries the machine it
 *  belongs to, and a local path means nothing on a remote host: seeding a
 *  terminal on another machine with `C:\Users\me\project` makes its shell try to
 *  `cd` somewhere that does not exist and die on the spot — which looked, from
 *  the outside, like a terminal that flashed and refused to open.
 *
 *  The Global space (`""`) has no folder, so it falls through to the backend
 *  default (the home directory, on whichever machine the shell runs).
 */
export function inheritedCwd(
  explicit: string | undefined,
  workspace: string,
  target: string | undefined,
): string | undefined {
  if (explicit) return explicit;
  if (!workspace || workspace === GLOBAL_WORKSPACE) return undefined;
  const { target: workspaceTarget, path } = parseWorkspaceKey(workspace);
  return workspaceTarget === targetOf(target as TargetId | undefined) ? path : undefined;
}
