// Non-interactive ("print mode") invocations for known CLI agents, used by the
// AI commit-message generator. These differ from the agent *launch* profiles
// (which start an interactive session): here we need the one-shot flag that
// makes the CLI emit a single response for the prompt and exit. The built prompt
// is always appended by the backend as the final argument.

export interface AiCommitPreset {
  /** Stable id (also the agent-catalog logo key where they line up). */
  id: string;
  /** Display name with correct casing. */
  name: string;
  /** Executable on PATH. */
  command: string;
  /** Args inserted before the prompt to select the CLI's headless print mode. */
  args: string[];
}

export const AI_COMMIT_PRESETS: AiCommitPreset[] = [
  { id: "claudecode", name: "Claude Code", command: "claude", args: ["-p"] },
  { id: "codex", name: "Codex", command: "codex", args: ["exec"] },
  { id: "gemini", name: "Gemini CLI", command: "gemini", args: ["-p"] },
  { id: "opencode", name: "OpenCode", command: "opencode", args: ["run"] },
];

/** Which preset (if any) a command + args pair matches, else null (= "Custom"). */
export function matchPreset(command: string, args: string[]): AiCommitPreset | null {
  const c = command.trim();
  const a = args.join(" ");
  return AI_COMMIT_PRESETS.find((p) => p.command === c && p.args.join(" ") === a) ?? null;
}
