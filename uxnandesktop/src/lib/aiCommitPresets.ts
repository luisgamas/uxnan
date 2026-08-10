// The agents offered for AI commit messages and AI PR bodies. The user picks one
// (filtered to the ones actually installed) plus a model; the backend
// (`agentcli.rs`) resolves and runs the CLI — no command/flags to set.
//
// **This is a curated subset of `agentcli::SUPPORTED`, not a mirror of it.**
// Being drivable headlessly is necessary but not sufficient: an agent only earns
// a place here once it is *wired* for this surface — above all it must answer a
// model list (`aicommit::list_models`), or the model picker sits empty and the
// entry looks broken. Listing a name is not the same as supporting it.
//
// So SUPPORTED may legitimately be longer. What must never happen is the reverse
// — an agent here that the backend cannot run — and a test enforces exactly that
// direction, plus a logo key the catalog knows and a matching display name.
//
// The five offered agents are wired end to end: each resolves to a spawnable
// binary, answers a model list (Claude from a curated table, Codex via
// `codex app-server`, OpenCode/Antigravity/Grok from their own `models`
// command), and returns its answer on stdout in print mode.

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
  { id: "opencode", name: "OpenCode", logo: "opencode" },
  { id: "grok", name: "Grok", logo: "grok" },
  // `agy` is the command the backend resolves, not the catalog's display id.
  { id: "agy", name: "Antigravity", logo: "antigravity" },
];

/** The agents offered for AI commit messages and PR bodies. */
export function activatableAiCommitAgents(): AiCommitAgent[] {
  return AI_COMMIT_AGENTS;
}

/** What a picker should list. The parameter keeps existing call sites simple. */
export function aiCommitAgentChoices(_currentId?: string | null): AiCommitAgent[] {
  return activatableAiCommitAgents();
}
