// Built-in CLI coding-agent presets. These are *templates* the user can add to
// their agents from Settings → Agents — they are not auto-seeded, so the agents
// list stays empty until the user picks one. Each becomes an `AgentProfile`
// (its `command` + `args`) that can be launched into any worktree.
//
// `command` is the executable name as found on PATH; the user can edit it (or
// the args) after adding, e.g. to pin a model or point at an absolute path.

export interface AgentTemplate {
  name: string;
  command: string;
  args: string[];
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  { name: "Claude Code", command: "claude", args: [] },
  { name: "Codex CLI", command: "codex", args: [] },
  { name: "Gemini CLI", command: "gemini", args: [] },
  { name: "Aider", command: "aider", args: [] },
  { name: "opencode", command: "opencode", args: [] },
];
