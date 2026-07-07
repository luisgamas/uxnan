// Catalog of known CLI coding agents. Settings → Agents shows the whole list,
// detects which `command`s are installed (PATH + PATHEXT), and lets the user
// one-click add the installed ones (or add a custom agent by hand).
//
// Logos resolve in a fallback chain (see `agentIconSources`): a user's own
// custom logo → a bundled SVG under `static/agents/<logo>.svg` → the product's
// favicon (fetched by `faviconUrl`) → the generic Bot glyph. Bundled SVGs are
// the crispest, so keep them for the flagship agents; `favicon` covers everything
// else without shipping an asset. Names use the product's real casing; commands
// are the executable name as found on PATH — keep both correct so detection works.

export interface CatalogAgent {
  /** Stable id, also used as the logo key. */
  id: string;
  /** Display name with correct casing (e.g. "Claude Code", "OpenCode"). */
  name: string;
  /** Executable name on PATH (e.g. `claude`, `agy`). */
  command: string;
  /** SVG basename under `static/agents/` (top-tier logo when one is bundled). */
  logo: string;
  /** Site to pull a favicon from when no bundled SVG resolves (e.g. `cursor.com`). */
  favicon?: string;
}

export const AGENT_CATALOG: CatalogAgent[] = [
  { id: "claudecode", name: "Claude Code", command: "claude", logo: "claudecode", favicon: "claude.ai" },
  { id: "codex", name: "Codex", command: "codex", logo: "codex", favicon: "openai.com" },
  { id: "gemini", name: "Gemini CLI", command: "gemini", logo: "gemini", favicon: "gemini.google.com" },
  { id: "opencode", name: "OpenCode", command: "opencode", logo: "opencode", favicon: "opencode.ai" },
  { id: "pi", name: "Pi", command: "pi", logo: "pi" },
  { id: "antigravity", name: "Antigravity", command: "agy", logo: "antigravity", favicon: "antigravity.google" },
  { id: "goose", name: "Goose", command: "goose", logo: "goose", favicon: "goose-docs.ai" },
  { id: "grok", name: "Grok", command: "grok", logo: "grok", favicon: "x.ai" },
  { id: "kilocode", name: "Kilo Code", command: "kilo", logo: "kilocode", favicon: "kilocode.ai" },
  { id: "kimi", name: "Kimi", command: "kimi", logo: "kimi", favicon: "moonshot.cn" },
  { id: "qwen", name: "Qwen Code", command: "qwen", logo: "qwen", favicon: "qwenlm.github.io" },
  // Additional known CLI agents. `command` is the executable users put on PATH —
  // not always the npm package name (Cursor ships `cursor-agent`, Kiro ships
  // `kiro-cli`, Continue ships `cn`, Mistral Vibe ships `vibe`). These have no
  // bundled SVG; their logo comes from `favicon` (or the Bot glyph if unset).
  { id: "cursor", name: "Cursor", command: "cursor-agent", logo: "cursor", favicon: "cursor.com" },
  { id: "aider", name: "Aider", command: "aider", logo: "aider", favicon: "aider.chat" },
  { id: "amp", name: "Amp", command: "amp", logo: "amp", favicon: "ampcode.com" },
  { id: "cline", name: "Cline", command: "cline", logo: "cline", favicon: "cline.bot" },
  { id: "droid", name: "Droid", command: "droid", logo: "droid", favicon: "factory.ai" },
  { id: "copilot", name: "GitHub Copilot", command: "copilot", logo: "copilot", favicon: "github.com" },
  { id: "continue", name: "Continue", command: "cn", logo: "continue", favicon: "continue.dev" },
  { id: "kiro", name: "Kiro", command: "kiro-cli", logo: "kiro", favicon: "kiro.dev" },
  { id: "auggie", name: "Auggie", command: "auggie", logo: "auggie", favicon: "augmentcode.com" },
  { id: "crush", name: "Crush", command: "crush", logo: "crush", favicon: "charm.sh" },
  { id: "codebuff", name: "Codebuff", command: "codebuff", logo: "codebuff", favicon: "codebuff.com" },
  { id: "commandcode", name: "Command Code", command: "command-code", logo: "commandcode", favicon: "commandcode.ai" },
  { id: "mimo", name: "MiMo Code", command: "mimo", logo: "mimo", favicon: "mimo.xiaomi.com" },
  { id: "devin", name: "Devin", command: "devin", logo: "devin", favicon: "devin.ai" },
  { id: "mistralvibe", name: "Mistral Vibe", command: "vibe", logo: "mistralvibe", favicon: "mistral.ai" },
  { id: "rovo", name: "Rovo Dev", command: "rovo", logo: "rovo", favicon: "atlassian.com" },
  { id: "autohand", name: "Autohand Code", command: "autohand", logo: "autohand", favicon: "autohand.ai" },
  { id: "openclaude", name: "OpenClaude", command: "openclaude", logo: "openclaude", favicon: "openclaude.gitlawb.com" },
  { id: "omp", name: "OMP", command: "omp", logo: "omp", favicon: "omp.sh" },
  { id: "ante", name: "Ante", command: "ante", logo: "ante", favicon: "antigma.ai" },
];

/** A site's favicon, via Google's public favicon service (64px, downscaled for
 *  crispness). Used as the logo fallback for agents without a bundled SVG. */
export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

/** Ordered logo candidates for a logo key, tried in turn by AgentLogo until one
 *  loads (then the Bot glyph). A user's custom logo (stored inline as a `data:`
 *  URL, or an `http(s)`/`/` path) wins outright and is used as-is — that's what
 *  keeps a manually-added logo persistent. Otherwise a catalog agent yields its
 *  bundled SVG first, then its favicon. */
export function agentIconSources(logo?: string | null): string[] {
  if (!logo) return [];
  if (/^(data:|https?:|\/)/.test(logo)) return [logo];
  const out = [`/agents/${logo}.svg`];
  const entry = AGENT_CATALOG.find((c) => c.logo === logo || c.id === logo);
  if (entry?.favicon) out.push(faviconUrl(entry.favicon));
  return out;
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
