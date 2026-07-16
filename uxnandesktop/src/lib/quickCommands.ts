// Pure helpers for user-programmed quick commands (top-bar launcher).
//
// The runtime side (building the context, resolving the shell, dispatching to a
// terminal) lives in the projects store; everything here is pure and
// unit-tested: token substitution, cwd resolution, and the scope filters that
// split the flat list into the menu's "active context" and "global" sections.

import type { QuickCommand } from "./types";

/** The active workspace context a command's tokens/cwd resolve against. */
export interface CommandContext {
  /** Absolute path of the active worktree/workspace ("" for the Global space). */
  worktreePath: string;
  /** Active worktree's branch, or null when unknown / not a git worktree. */
  branch: string | null;
  /** Active project's id, or null outside a registered repo. */
  repoId: string | null;
  /** Active project's root path, or null. */
  repoPath: string | null;
  /** Active project's display name, or null. */
  repoName: string | null;
}

/** Substitute `{worktree}` / `{path}` / `{branch}` / `{repo}` / `{repoName}`
 *  tokens in a command line with the active context. Unknown tokens are left
 *  untouched; a token with no value (e.g. `{branch}` outside a worktree) becomes
 *  an empty string. Case-insensitive on the token name. */
export function substituteTokens(command: string, ctx: CommandContext): string {
  const values: Record<string, string> = {
    worktree: ctx.worktreePath,
    path: ctx.worktreePath,
    branch: ctx.branch ?? "",
    repo: ctx.repoPath ?? "",
    reponame: ctx.repoName ?? "",
  };
  return command.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => {
    const key = name.toLowerCase();
    return key in values ? values[key] : whole;
  });
}

/** Resolve the working directory a command should run in, given its `cwd` mode.
 *  `undefined` means "let the terminal decide" (the active workspace folder, or
 *  the backend home for the Global space). */
export function resolveCommandCwd(
  cmd: QuickCommand,
  ctx: CommandContext,
): string | undefined {
  switch (cmd.cwd) {
    case "activeWorktree":
      return ctx.worktreePath || undefined;
    case "projectRoot":
      return ctx.repoPath || undefined;
    case "custom":
      return cmd.customCwd?.trim() || undefined;
  }
}

/** Commands that apply to the active context: worktree-scoped ones bound to the
 *  active worktree, plus project-scoped ones bound to the active project. Empty
 *  when there is no active worktree/project (the Global space). */
export function contextualQuickCommands(
  list: QuickCommand[],
  ctx: CommandContext,
): QuickCommand[] {
  return list.filter(
    (c) =>
      (c.scope === "worktree" &&
        !!ctx.worktreePath &&
        c.worktreePath === ctx.worktreePath) ||
      (c.scope === "project" && !!ctx.repoId && c.projectId === ctx.repoId),
  );
}

/** The always-available global commands. */
export function globalQuickCommands(list: QuickCommand[]): QuickCommand[] {
  return list.filter((c) => c.scope === "global");
}
