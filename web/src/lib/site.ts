/**
 * Every factual claim the site makes lives here.
 *
 * If one of these numbers, names or commands changes in the product, it changes
 * here in the same change set — the page components must never hard-code a fact.
 * The `source` comments say where each claim is verifiable in the monorepo.
 */

/**
 * Absolute origin of the deployed site, baked in at build time by the deploy
 * workflow (`NEXT_PUBLIC_SITE_URL`). Falls back to the Pages subdomain until a
 * custom domain is configured — see `docs/deploy.md`.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://uxnan.pages.dev";

export const SITE = {
  name: "Uxnan",
  tagline: "Your agents don't need you watching.",
  description:
    "Run Claude Code, Codex, OpenCode and more side by side on your PC — each in its own git worktree — and steer them from your phone.",
  /** source: README.md, right under the wordmark. */
  disclaimer:
    "Uxnan — a name with no relation to, or derivation from, any existing product.",
} as const;

export const LINKS = {
  /** Tracked short links — what the buttons point at. */
  repo: "https://sink.gamas.workers.dev/uxnan-repo",
  x: "https://sink.gamas.workers.dev/gamas-x",

  github: "https://github.com/luisgamas/uxnan",
  releases: "https://github.com/luisgamas/uxnan/releases/latest",
  releasesAll: "https://github.com/luisgamas/uxnan/releases",
  play: "https://sink.gamas.workers.dev/uxnan-android",
  bridgeNpm: "https://www.npmjs.com/package/uxnan-bridge",
  license: "https://github.com/luisgamas/uxnan/blob/main/LICENSE",
  security: "https://github.com/luisgamas/uxnan/blob/main/SECURITY.md",
  coffee: "https://sink.gamas.workers.dev/buymeacoffee",
  sponsor: "https://sink.gamas.workers.dev/github-sponsor",
  benchmarks:
    "https://github.com/luisgamas/uxnan/blob/main/uxnandesktop/docs/resource-benchmarks.md",
  macInstall:
    "https://github.com/luisgamas/uxnan/blob/main/uxnandesktop/docs/install-macos.md",
} as const;

/**
 * Agent marks come from the repository's own `assets/agents/`, synced into
 * `public/agents/` before dev and build (`scripts/sync-agent-marks.mjs`) so the
 * site and the root READMEs render the exact same files and neither can drift.
 * Nothing is fetched from a third party at page load.
 */
/** The four agents that keep a drawn mark; every other one uses its favicon. */
const HAND_DRAWN = new Set(["claudecode", "codex", "openclaude", "zero"]);

const mark = (id: string) =>
  `/agents/${id}.${HAND_DRAWN.has(id) ? "svg" : "png"}`;

/**
 * Every agent uxnan drives, in two groups.
 *
 * `precise` is the list that reports **working / blocked / waiting / done**
 * through its own hook surface (or, for Zero, through the session it writes to
 * disk). `basic` is the rest of the desktop catalog: they launch and run exactly
 * the same way and show the coarse working/idle inference, but their CLI exposes
 * no way to say a turn ENDED — so uxnan does not pretend otherwise.
 *
 * source: uxnandesktop/docs/agent-hooks.md → the reporter table and
 * "Nine agents in the catalog have no precise state"
 */
export const AGENTS_PRECISE = [
  { id: "claudecode", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "opencode", name: "OpenCode" },
  { id: "cursor", name: "Cursor" },
  { id: "copilot", name: "GitHub Copilot" },
  { id: "droid", name: "Droid" },
  { id: "grok", name: "Grok" },
  { id: "amp", name: "Amp" },
  { id: "goose", name: "Goose" },
  { id: "qwen", name: "Qwen Code" },
  { id: "kiro", name: "Kiro" },
  { id: "auggie", name: "Auggie" },
  { id: "devin", name: "Devin" },
  { id: "kimi", name: "Kimi" },
  { id: "kilocode", name: "Kilo Code" },
  { id: "mimo", name: "MiMo Code" },
  { id: "commandcode", name: "Command Code" },
  { id: "openclaude", name: "OpenClaude" },
  { id: "pi", name: "Pi" },
  { id: "omp", name: "OMP" },
  { id: "zero", name: "Zero" },
  { id: "antigravity", name: "Antigravity", note: "partial" },
].map((a) => ({ ...a, icon: mark(a.id) }));

/** The catalog agents that launch and run, but report no precise state. */
export const AGENTS_BASIC = [
  { id: "aider", name: "Aider" },
  { id: "cline", name: "Cline" },
  { id: "continue", name: "Continue" },
  { id: "crush", name: "Crush" },
  { id: "codebuff", name: "Codebuff" },
  { id: "mistralvibe", name: "Mistral Vibe" },
  { id: "rovo", name: "Rovo Dev" },
  { id: "autohand", name: "Autohand" },
  { id: "ante", name: "Ante" },
].map((a) => ({ ...a, icon: mark(a.id) }));

/** Both groups, for anything that just needs "every agent". */
export const AGENTS = [...AGENTS_PRECISE, ...AGENTS_BASIC];

/**
 * Marks that ship black (`currentColor` resolves to black inside an `<img>`), so
 * they need lifting to near-white on the page's dark surfaces. Only the drawn
 * ones can be here: a favicon carries its own colours and inverting one wrecks
 * it. They are left untouched on the phone mockups, whose tiles are white.
 */
export const INVERT_ON_DARK = new Set(["codex", "openclaude"]);

/** Agent marks by id, for the mockups that name one directly. */
export const AGENT_ICON = Object.fromEntries(
  AGENTS.map((a) => [a.id, a.icon]),
) as Record<(typeof AGENTS)[number]["id"], string>;

/** The Claude Code mark as the terminal itself renders it. */
export const CLAUDE_TERMINAL_ICON = "/agents/claudecode.svg";

/**
 * Measured on Windows 11, release build, WebView2 150 — private working memory.
 * source: uxnandesktop/docs/resource-benchmarks.md → results table
 */
export const BENCH = {
  idleMb: 226,
  oneTerminalMb: 252,
  fourTerminalsMb: 274,
  headline: "~250 MB",
  scenarioIdle: "workspace asleep",
  scenarioFour: "four terminals, four agents",
  platform: "Windows 11 · release build · private working memory",
} as const;

/** source: bridge/README.md */
export const BRIDGE_INSTALL = "npm install -g uxnan-bridge";
export const BRIDGE_START = "uxnan-bridge start";

/** source: README.md → Security; architecture/02a §5.9 */
export const CRYPTO = "X25519 · Ed25519 · AES-256-GCM";

/**
 * What you can actually install today, in the order the page states it.
 * source: README.md → Install (macOS builds are unsigned/experimental, iOS is
 * written but unshipped)
 */
export const PLATFORM_LINE =
  "Windows, Linux · macOS (experimental) · Android on Google Play · iOS coming soon";

/** source: LICENSE */
export const LICENSE = "MPL-2.0";
