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
  { id: "kilocode", name: "Kilo Code", command: "kilocode", logo: "kilocode" },
  { id: "kimi", name: "Kimi", command: "kimi", logo: "kimi" },
  { id: "qwen", name: "Qwen Code", command: "qwen", logo: "qwen" },
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
