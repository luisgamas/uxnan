// The coding-agent CLIs the AI commit-message generator supports. The user picks
// one of these (filtered to the ones actually installed) plus a model; the
// backend (`agentcli.rs`) resolves and runs the CLI — no command/flags to set.
// Ids match the Rust `agentcli::SUPPORTED` and the agent-catalog logo keys.

export interface AiCommitAgent {
  /** Stable id (matches the Rust backend + the logo key). */
  id: string;
  /** Display name with correct casing. */
  name: string;
  /** Logo basename under `static/agents/`. */
  logo: string;
}

export const AI_COMMIT_AGENTS: AiCommitAgent[] = [
  { id: "claude", name: "Claude Code", logo: "claudecode" },
  { id: "codex", name: "Codex", logo: "codex" },
  { id: "gemini", name: "Gemini CLI", logo: "gemini" },
  { id: "opencode", name: "OpenCode", logo: "opencode" },
  { id: "pi", name: "Pi", logo: "pi" },
];
