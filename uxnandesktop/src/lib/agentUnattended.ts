// Which CLIs can be launched so they run a task without stopping at every
// tool for a person's approval — and the flag that does it, verified against
// the real CLI's `--help` on 2026-09-21 (Claude Code 2.1, Codex 0.154).
//
// This is what `worker/start` (and `terminal/create` / `worktree/create` with
// an agent) adds on `unattended: true`: a worker a coordinator starts has
// nobody at its terminal to click "Allow", so a per-tool prompt would stall
// the run. It is opt-in, per launch: the person's own profiles and their own
// launches are untouched, and the modes chosen are each CLI's *reviewed*
// automatic mode — not its "skip every check" flag, which stays a deliberate
// choice for the person to put in a profile's args.
//
// A CLI without a known flag reports `unsupported` in the receipt and launches
// as configured: the caller learns it may have to answer prompts through
// `terminal/read` + `agent/send --force`.

/** Per command (`claude`, `codex`, …): the arguments for an unattended launch. */
const UNATTENDED: Record<string, readonly string[]> = {
  // Auto mode: a reviewer decides in the person's place; the same mode a
  // person picks with shift+tab.
  claude: ["--permission-mode", "auto"],
  // "Route approval requests through automatic review using the
  // workspace-write sandbox" — never asks, stays sandboxed to the worktree.
  codex: ["--approve-for-me"],
};

/** The arguments to append for an unattended launch of `command`, or `null`
 *  when that CLI has no flag for it. The command is matched by its basename,
 *  case-insensitively, so `/usr/local/bin/claude` and `claude.cmd` both count. */
export function unattendedArgs(command: string): readonly string[] | null {
  const base = command.trim().split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const name = base.replace(/\.(exe|cmd|bat|ps1)$/, "");
  return UNATTENDED[name] ?? null;
}

/** Whether the user's own args already pick a permission mode — then the
 *  launch is left alone: the person decided. */
export function picksPermissionMode(args: readonly string[]): boolean {
  const known = new Set([
    "--permission-mode",
    "--dangerously-skip-permissions",
    "--allow-dangerously-skip-permissions",
    "--approve-for-me",
    "--dangerously-bypass-approvals-and-sandbox",
    "--full-auto",
    "-a",
    "--ask-for-approval",
  ]);
  return args.some((a) => known.has(a.trim().split("=")[0]));
}
