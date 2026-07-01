// Catalog of known CLI coding agents. Settings → Agents shows the whole list,
// detects which `command`s are installed (PATH + PATHEXT), and lets the user
// one-click add the installed ones (or add a custom agent by hand).
//
// `logo` is the basename of an SVG under `static/agents/` (served at
// `/agents/<logo>.svg`). Names use the product's real casing; commands are the
// executable name as found on PATH — keep both correct so detection works.

export interface CatalogAgent {
  /** Stable id, also used as the logo key. */
  id: string;
  /** Display name with correct casing (e.g. "Claude Code", "OpenCode"). */
  name: string;
  /** Executable name on PATH (e.g. `claude`, `agy`). */
  command: string;
  /** SVG basename under `static/agents/`. */
  logo: string;
}

export const AGENT_CATALOG: CatalogAgent[] = [
  { id: "claudecode", name: "Claude Code", command: "claude", logo: "claudecode" },
  { id: "codex", name: "Codex", command: "codex", logo: "codex" },
  { id: "gemini", name: "Gemini CLI", command: "gemini", logo: "gemini" },
  { id: "opencode", name: "OpenCode", command: "opencode", logo: "opencode" },
  { id: "pi", name: "Pi", command: "pi", logo: "pi" },
  { id: "antigravity", name: "Antigravity", command: "agy", logo: "antigravity" },
  { id: "goose", name: "Goose", command: "goose", logo: "goose" },
  { id: "grok", name: "Grok", command: "grok", logo: "grok" },
  { id: "kilocode", name: "Kilo Code", command: "kilo", logo: "kilocode" },
  { id: "kimi", name: "Kimi", command: "kimi", logo: "kimi" },
  { id: "qwen", name: "Qwen Code", command: "qwen", logo: "qwen" },
  // Additional known CLI agents. `command` is the executable users put on PATH —
  // not always the npm package name (Cursor ships `cursor-agent`, Kiro ships
  // `kiro-cli`, Continue ships `cn`, Mistral Vibe ships `vibe`). Brand logos for
  // these are pending (see FOR-HUMAN.md); AgentLogo shows a generic glyph until
  // each SVG lands under `static/agents/`.
  { id: "cursor", name: "Cursor", command: "cursor-agent", logo: "cursor" },
  { id: "aider", name: "Aider", command: "aider", logo: "aider" },
  { id: "amp", name: "Amp", command: "amp", logo: "amp" },
  { id: "cline", name: "Cline", command: "cline", logo: "cline" },
  { id: "droid", name: "Droid", command: "droid", logo: "droid" },
  { id: "copilot", name: "GitHub Copilot", command: "copilot", logo: "copilot" },
  { id: "continue", name: "Continue", command: "cn", logo: "continue" },
  { id: "kiro", name: "Kiro", command: "kiro-cli", logo: "kiro" },
  { id: "auggie", name: "Auggie", command: "auggie", logo: "auggie" },
  { id: "crush", name: "Crush", command: "crush", logo: "crush" },
  { id: "codebuff", name: "Codebuff", command: "codebuff", logo: "codebuff" },
  { id: "commandcode", name: "Command Code", command: "command-code", logo: "commandcode" },
  { id: "mimo", name: "MiMo Code", command: "mimo", logo: "mimo" },
  { id: "devin", name: "Devin", command: "devin", logo: "devin" },
  { id: "hermes", name: "Hermes", command: "hermes", logo: "hermes" },
  { id: "mistralvibe", name: "Mistral Vibe", command: "vibe", logo: "mistralvibe" },
  { id: "rovo", name: "Rovo Dev", command: "rovo", logo: "rovo" },
  { id: "autohand", name: "Autohand Code", command: "autohand", logo: "autohand" },
  { id: "openclaude", name: "OpenClaude", command: "openclaude", logo: "openclaude" },
  { id: "openclaw", name: "OpenClaw", command: "openclaw", logo: "openclaw" },
  { id: "omp", name: "OMP", command: "omp", logo: "omp" },
  { id: "ante", name: "Ante", command: "ante", logo: "ante" },
];

/** Resolve a logo value to an `<img src>`, or null when there's none. A catalog
 *  key (e.g. `claudecode`) maps to its bundled SVG; a user's custom logo is
 *  stored inline as a `data:` URL and used as-is (also tolerates `http(s)`/`/`). */
export function agentLogoSrc(logo?: string | null): string | null {
  if (!logo) return null;
  if (/^(data:|https?:|\/)/.test(logo)) return logo;
  return `/agents/${logo}.svg`;
}

/** Best logo key for an agent: its stored `icon`, else matched from the catalog
 *  by command (so agents added before icons existed still show a brand logo). */
export function agentLogoKey(
  icon: string | null | undefined,
  command: string,
): string | null {
  if (icon) return icon;
  return AGENT_CATALOG.find((c) => c.command === command.trim())?.logo ?? null;
}
