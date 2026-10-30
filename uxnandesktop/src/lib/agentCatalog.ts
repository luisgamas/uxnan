// Catalog of known CLI coding agents. Settings → Agents shows the whole list,
// detects which `command`s are installed (PATH + PATHEXT), and lets the user
// one-click add the installed ones (or add a custom agent by hand).
//
// Every logo ships with the app and renders offline (see `agentIconSources`):
// a user's own custom logo → the agent's mark from `static/agents/` → the
// generic Bot glyph. The marks are the repository's single set in
// `assets/agents/` (the same files the site and the READMEs show), synced in by
// `scripts/sync-agent-marks.mjs`: a drawn SVG for the four agents in
// `DRAWN_MARKS`, and for every other agent its vendor favicon vendored as a PNG
// from its `favicon` domain (`web/scripts/fetch-agent-favicons.mjs` — run it
// when adding an agent). Nothing is fetched at run time. Names use the
// product's real casing; commands are the executable name as found on PATH —
// keep both correct so detection works.

export interface CatalogAgent {
  /** Stable id, also used as the logo key. */
  id: string;
  /** Display name with correct casing (e.g. "Claude Code", "OpenCode"). */
  name: string;
  /** Executable name on PATH (e.g. `claude`, `agy`). */
  command: string;
  /** Mark basename under `assets/agents/` (`.svg` when drawn, else `.png`). */
  logo: string;
  /** The site the vendored favicon was taken from (e.g. `cursor.com`), read by
   *  `web/scripts/fetch-agent-favicons.mjs` — never fetched by the app. */
  favicon?: string;
  /**
   * The bundled SVG is a single dark colour (a black path, or `currentColor`,
   * which an `<img>` resolves to black), so it needs inverting on dark themes to
   * stay visible. Never set this for a coloured mark — inverting one breaks it.
   */
  mono?: boolean;
}

export const AGENT_CATALOG: CatalogAgent[] = [
  { id: "claudecode", name: "Claude Code", command: "claude", logo: "claudecode", favicon: "claude.ai" },
  { id: "codex", name: "Codex", command: "codex", logo: "codex", favicon: "openai.com", mono: true },
  { id: "opencode", name: "OpenCode", command: "opencode", logo: "opencode", favicon: "opencode.ai" },
  { id: "pi", name: "Pi", command: "pi", logo: "pi", favicon: "pi.dev" },
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
  { id: "openclaude", name: "OpenClaude by Gitlawb", command: "openclaude", logo: "openclaude", favicon: "openclaude.gitlawb.com", mono: true },
  { id: "omp", name: "OMP", command: "omp", logo: "omp", favicon: "omp.sh" },
  { id: "ante", name: "Ante", command: "ante", logo: "ante", favicon: "antigma.ai" },
  { id: "zero", name: "Zero by Gitlawb", command: "zero", logo: "zero", favicon: "zero.gitlawb.com" },
];

/** The agents whose mark is drawn (an SVG); every other one is its vendored
 *  favicon (a PNG). The same four `web/scripts/fetch-agent-favicons.mjs` skips. */
export const DRAWN_MARKS: ReadonlySet<string> = new Set(["claudecode", "codex", "openclaude", "zero"]);

/** The file a catalog agent's mark ships as, under `static/agents/`. */
export function markFile(logo: string): string {
  return `${logo}.${DRAWN_MARKS.has(logo) ? "svg" : "png"}`;
}

/** Ordered logo candidates for a logo key, tried in turn by AgentLogo until one
 *  loads (then the Bot glyph). A user's custom logo (stored inline as a `data:`
 *  URL, or a `/` path) wins outright — that's what keeps a manually-added logo
 *  persistent. A catalog agent yields its shipped mark. Nothing remote: an
 *  `http(s)` URL is never a candidate, so no logo is ever fetched. */
export function agentIconSources(logo?: string | null): string[] {
  if (!logo) return [];
  if (/^(data:|\/)/.test(logo)) return [logo];
  const entry = AGENT_CATALOG.find((c) => c.logo === logo || c.id === logo);
  return entry ? [`/agents/${markFile(entry.logo)}`] : [];
}

/** Whether a logo key's **bundled** SVG is a single dark colour (the `mono`
 *  flag). A custom logo (`data:` / `http(s)` / `/…`) and a favicon are never
 *  reported as monochrome — only the asset we ship can be assumed. */
export function isMonochromeLogo(logo?: string | null): boolean {
  if (!logo || /^(data:|https?:|\/)/.test(logo)) return false;
  return AGENT_CATALOG.find((c) => c.logo === logo || c.id === logo)?.mono === true;
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

/** The catalog entry behind a **backend** agent id — the hooks registry
 *  (`agent_hooks::hook_agent_ids`) and the browser-MCP catalog
 *  (`mcpinject::AGENTS`) both key on the CLI's own name. Those ids match the
 *  catalog's for every agent but Claude Code, whose CLI is `claude` and whose
 *  catalog entry is `claudecode`. Undefined for an id we ship no entry for. */
export function backendAgentEntry(id: string): CatalogAgent | undefined {
  const key = id === "claude" ? "claudecode" : id;
  return AGENT_CATALOG.find((c) => c.id === key);
}

/** Product name for a backend agent id, falling back to the id itself so a
 *  newly wired agent still renders a row instead of an empty label. */
export function backendAgentName(id: string): string {
  return backendAgentEntry(id)?.name ?? id;
}

/** Logo key for a backend agent id (empty when we ship no catalog entry, which
 *  `AgentLogo` renders as its generic Bot glyph). */
export function backendAgentLogo(id: string): string {
  return backendAgentEntry(id)?.logo ?? "";
}
