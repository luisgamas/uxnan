// Which CLIs can be launched so they run a task without stopping at every
// tool for a person's approval — and what does it: a flag on the command line
// or, for one CLI, a variable in its environment. Verified 2026-09-21 against
// the installed CLIs' `--help` (Claude Code 2.1, Codex 0.154) and, for the
// rest, each CLI's own reference documentation.
//
// This is what `worker/start` adds by default (and `terminal/create` /
// `worktree/create` with an agent on `unattended: true`): a worker a
// coordinator starts has nobody at its terminal to click "Allow", so a
// per-tool prompt would stall the run. The person's own profiles and their own
// launches are untouched, and the mode chosen is always a CLI's *reviewed*
// automatic tier — never its "skip every check" flag, which stays a deliberate
// choice for the person to put in a profile's args. That is why no entry here
// is, or may ever be, a bypass flag: a CLI whose only unattended option is to
// skip everything is simply absent.
//
// Two levels, because the CLIs do not all offer the same thing:
// - `reviewed`: every tool is auto-approved, but a reviewer — a classifier
//   model, a reviewer subagent, a sandbox — still gates what runs.
// - `editsOnly`: file edits are auto-approved; shell commands and MCP tools
//   still prompt. Better than nothing for a worker that mostly writes code,
//   but the caller may still have to answer its prompts (`terminal/read` +
//   `agent/send --force`), which the receipt says with `partial`.
//
// Every entry is for the surface Uxnan drives: the CLI's interactive TUI,
// launched as `command args…` in a terminal. A flag that exists only on a
// CLI's one-shot `exec` subcommand does not count, however good it is.

/** How far the mode goes. */
export type UnattendedLevel = "reviewed" | "editsOnly";

/** What an unattended launch adds to a CLI: arguments, or environment. */
export type UnattendedMode =
  | { level: UnattendedLevel; args: readonly string[]; env?: undefined }
  | { level: UnattendedLevel; env: Readonly<Record<string, string>>; args?: undefined };

/** What the receipt says about an unattended launch. */
export type UnattendedOutcome = "applied" | "partial" | "configured" | "unsupported";

/** Per command basename (`claude`, `codex`, …): its reviewed or edits-only
 *  tier. Absent = no tier short of skipping everything, or none the
 *  interactive TUI accepts (`unsupported`). */
const UNATTENDED: Record<string, UnattendedMode> = {
  // ── reviewed ──────────────────────────────────────────────────────────────
  // Auto mode: a classifier model reviews actions before they run; the same
  // mode a person picks with shift+tab. Falls back to manual where auto is
  // unavailable, which is still a launch that works.
  claude: { level: "reviewed", args: ["--permission-mode", "auto"] },
  // "Route approval requests through automatic review using the
  // workspace-write sandbox" — a reviewer subagent, and the sandbox stays.
  codex: { level: "reviewed", args: ["--approve-for-me"] },
  // A classifier auto-approves safe actions and blocks risky ones; explicit
  // `ask` rules still prompt.
  qwen: { level: "reviewed", args: ["--approval-mode", "auto"] },
  // Honors the permission rules, then allows unmatched calls; commands the CLI
  // classifies as dangerous still ask.
  ante: { level: "reviewed", args: ["--permission-mode", "auto"] },
  // In this CLI the names are inverted: `--yolo` is the "ask when needed"
  // tier (routine edits and commands run, risky actions still ask, the
  // dangerous-command guard stays on); its skip-all is `--auto`, never here.
  kimi: { level: "reviewed", args: ["--yolo"] },
  // Edits run; every other action is judged by a fast model that runs it only
  // when clearly safe. Still rolling out — an account without it falls back
  // to prompting, which is a launch that works.
  devin: { level: "reviewed", args: ["--permission-mode", "smart"] },
  // No launch flag at all: the mode is an environment variable, and the
  // environment wins over its config file. `smart_approve` is its LLM risk
  // classifier; the default, `auto`, is skip-all.
  goose: { level: "reviewed", env: { GOOSE_MODE: "smart_approve" } },

  // ── editsOnly ─────────────────────────────────────────────────────────────
  // File edits auto-approved; shell stays governed by the permission rules.
  // Its reviewed tier lives only in a settings file (`toolPermission`).
  agy: { level: "editsOnly", args: ["--mode", "accept-edits"] },
  // Its classifier `auto` mode is reachable in-session and by config only.
  grok: { level: "editsOnly", args: ["--permission-mode", "acceptEdits"] },
  // Edits and safe file commands; arbitrary shell and MCP tools still prompt.
  // One package, four bin names.
  "command-code": { level: "editsOnly", args: ["--accept-edits"] },
  commandcode: { level: "editsOnly", args: ["--accept-edits"] },
  cmdc: { level: "editsOnly", args: ["--accept-edits"] },
  cmd: { level: "editsOnly", args: ["--accept-edits"] },
  // The built-in agent that auto-approves `write_file`/`edit` only.
  vibe: { level: "editsOnly", args: ["--agent", "accept-edits"] },
  // Read and write run, exec prompts. Its default `yolo` is skip-all.
  omp: { level: "editsOnly", args: ["--approval-mode", "write"] },
  // Auto-confirms risky actions; the blacklist and `--unrestricted` are
  // untouched.
  autohand: { level: "editsOnly", args: ["--yes"] },

  // ── deliberately absent ───────────────────────────────────────────────────
  // zero: `--auto low|medium` and `--permission-mode` are `zero exec` flags.
  //   The bare `zero` Uxnan launches starts its TUI in *ask* mode and takes
  //   only `--add-dir`, `--theme`, `--allow-escalation` and its skip-all flag
  //   (verified in the CLI's source, `internal/cli/app.go`).
  // droid: `--auto low|medium` is a `droid exec` flag; the interactive `droid`
  //   takes its level from `sessionDefaultSettings.autonomyLevel` in its
  //   settings file and has no flag for it (its CLI reference lists none).
  // opencode, kilo, cursor-agent, cn, kiro-cli, crush, rovo, mimo, cline,
  //   aider, openclaude, copilot: only a skip-all flag, an allow-list, or an
  //   `auto` whose semantics are undocumented.
  // pi, amp, codebuff, auggie: no approval prompt exists — nothing to add.
};

/** The command's basename, lowercase, without a Windows launcher extension:
 *  `/usr/local/bin/claude` and `claude.cmd` both count as `claude`. */
function basename(command: string): string {
  const base = command.trim().split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return base.replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/** What an unattended launch of `command` adds, or `null` when that CLI has
 *  no reviewed or edits-only tier the interactive launch accepts. */
export function unattendedMode(command: string): UnattendedMode | null {
  return UNATTENDED[basename(command)] ?? null;
}

/** The level `command` reaches unattended, or `null` (what Settings → Agents
 *  shows next to the per-agent switch). */
export function unattendedLevel(command: string): UnattendedLevel | null {
  return unattendedMode(command)?.level ?? null;
}

/** Flags that pick a permission or approval posture on any CLI — the person
 *  decided, whatever they chose. Matched on the flag alone (`--flag=value`
 *  counts), so a mode, a bypass, an allow-list or a plan mode all count. */
const MODE_FLAGS = new Set([
  "--permission-mode",
  "--approval-mode",
  "--approve-for-me",
  "-a",
  "--ask-for-approval",
  "-s",
  "--sandbox",
  "--auto",
  "--auto-approve",
  "--yolo",
  "-y",
  "--yes",
  "--yes-always",
  "--always-approve",
  "--unrestricted",
  "--restricted",
  "--accept-edits",
  "--allow",
  "--deny",
  "--allowedTools",
  "--allowed-tools",
  "--disallowedTools",
  "--disallowed-tools",
  "--trust-all-tools",
  "--trust-tools",
  "--permission",
  "--skip-permissions-unsafe",
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-allow-all",
  "--full-auto",
  "--plan",
  "--readonly",
  "--ask",
  "--use-spec",
]);

/** Flag families matched by prefix: `--allow-all`, `--allow-all-tools`,
 *  `--allow-tool=…`, `--allow-tools`. */
const MODE_FLAG_PREFIXES = ["--allow-all", "--allow-tool"];

/** Flags that mean a mode on some CLIs and something else on others: `--mode`
 *  is a permission mode for two CLIs and a transport for another; `--agent`
 *  picks the approval agent on one CLI and an agent profile elsewhere;
 *  `--force`/`-f` is a bypass on one CLI. */
const MODE_FLAGS_BY_COMMAND: Record<string, readonly string[]> = {
  agy: ["--mode"],
  "cursor-agent": ["--mode", "--force", "-f"],
  agent: ["--mode", "--force", "-f"],
  vibe: ["--agent"],
};

/** Whether the profile's own args already pick a permission mode — then the
 *  launch is left alone: the person decided. `command` (its basename is
 *  enough) resolves the flags whose meaning depends on the CLI. */
export function picksPermissionMode(args: readonly string[], command = ""): boolean {
  const perCommand = MODE_FLAGS_BY_COMMAND[basename(command)] ?? [];
  return args.some((a) => {
    const flag = a.trim().split("=")[0];
    if (MODE_FLAGS.has(flag) || perCommand.includes(flag)) return true;
    return flag.startsWith("--") && MODE_FLAG_PREFIXES.some((p) => flag.startsWith(p));
  });
}

/** Environment variables that pick a permission mode on the CLIs that read
 *  one from the environment. */
const MODE_ENV = new Set([
  "GOOSE_MODE",
  "COPILOT_ALLOW_ALL",
  "DEVIN_PERMISSION_MODE",
  "MIMOCODE_DANGEROUSLY_SKIP_PERMISSIONS",
  "AIDER_YES_ALWAYS",
  "CLINE_COMMAND_PERMISSIONS",
  "QWEN_SANDBOX",
]);

/** Whether the profile's own environment already picks a permission mode.
 *  Takes the profile's `{ key, value }` rows or a plain record. */
export function picksPermissionModeEnv(
  env: readonly { key: string; value: string }[] | Readonly<Record<string, string>> | undefined,
): boolean {
  if (!env) return false;
  const keys = Array.isArray(env)
    ? (env as readonly { key: string }[]).map((e) => e.key)
    : Object.keys(env as Record<string, string>);
  return keys.some((k) => MODE_ENV.has(k.trim()));
}

/** The plan for one unattended launch of a profile: what to add — arguments
 *  after the profile's own, variables on its environment — and what the
 *  receipt says. Pure; the bridge only decides *whether* to ask for it. */
export function planUnattended(profile: {
  command: string;
  args: readonly string[];
  env?: readonly { key: string; value: string }[];
}): { extraArgs?: readonly string[]; extraEnv?: Readonly<Record<string, string>>; outcome: UnattendedOutcome } {
  if (picksPermissionMode(profile.args, profile.command) || picksPermissionModeEnv(profile.env)) {
    return { outcome: "configured" };
  }
  const mode = unattendedMode(profile.command);
  if (!mode) return { outcome: "unsupported" };
  const outcome: UnattendedOutcome = mode.level === "reviewed" ? "applied" : "partial";
  return mode.args ? { extraArgs: mode.args, outcome } : { extraEnv: mode.env, outcome };
}
