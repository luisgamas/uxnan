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
const mark = (id: string) => `/agents/${id}.svg`;

/**
 * The seven agents with deep, first-class integration.
 * source: README.md → "Works with any CLI agent"; bridge/docs/agents.md
 */
export const AGENTS = [
  { id: "claudecode", name: "Claude Code", icon: mark("claudecode") },
  { id: "codex", name: "Codex", icon: mark("codex") },
  { id: "opencode", name: "OpenCode", icon: mark("opencode") },
  { id: "pi", name: "Pi", icon: mark("pi") },
  { id: "grok", name: "Grok", icon: mark("grok") },
  {
    id: "antigravity",
    name: "Antigravity",
    icon: mark("antigravity"),
    note: "partial",
  },
  { id: "zero", name: "Zero", icon: mark("zero") },
] as const;

/**
 * Marks that ship black or grey (`currentColor` resolves to black inside an
 * `<img>`), so they need lifting to near-white on the page's dark surfaces.
 * They are left untouched on the phone mockups, whose tiles are white.
 */
export const INVERT_ON_DARK = new Set(["codex", "opencode", "pi", "grok"]);

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
