/**
 * Single source of truth for the facts the site states out loud.
 *
 * Everything here is mirrored from the repository it describes — the root
 * `README.md`, each component's `README.md`, and the release workflow. When one
 * of those changes, this file changes with it, so no number or claim on the page
 * can quietly drift away from the product.
 */

export const REPO_OWNER = "luisgamas";
export const REPO_NAME = "uxnan";
export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;

/**
 * The site's public origin. Defaults to the Cloudflare Pages subdomain and is
 * overridden at build time by `NEXT_PUBLIC_SITE_URL` once a custom domain exists
 * (the deploy workflow sets it). No trailing slash.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://uxnan.pages.dev"
).replace(/\/$/, "");

/**
 * Every route the site exports, for the sitemap and any nav that needs the full
 * list. `trailingSlash: true`, so each path keeps its trailing slash. Add a page
 * here when you add a route — this is what search engines are handed.
 */
export const ROUTES = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/download/", changeFrequency: "weekly", priority: 0.8 },
] as const;

export const links = {
  github: `https://github.com/${REPO_SLUG}`,
  releases: `https://github.com/${REPO_SLUG}/releases`,
  issues: `https://github.com/${REPO_SLUG}/issues`,
  discussions: `https://github.com/${REPO_SLUG}/discussions`,
  license: `https://github.com/${REPO_SLUG}/blob/main/LICENSE`,
  security: `https://github.com/${REPO_SLUG}/blob/main/SECURITY.md`,
  contributing: `https://github.com/${REPO_SLUG}/blob/main/CONTRIBUTING.md`,
  desktopReadme: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/README.md`,
  mobileReadme: `https://github.com/${REPO_SLUG}/blob/main/uxnanmobile/README.md`,
  bridgeReadme: `https://github.com/${REPO_SLUG}/blob/main/bridge/README.md`,
  relayReadme: `https://github.com/${REPO_SLUG}/blob/main/relay/README.md`,
  macosGuide: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/docs/install-macos.md`,
  buildGuide: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/docs/build.md`,
  updatesGuide: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/docs/updates.md`,
  orchestrationGuide: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/docs/orchestration.md`,
  browserGuide: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/docs/browser.md`,
  providersGuide: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/docs/providers.md`,
  bridgeInstall: `https://github.com/${REPO_SLUG}/blob/main/bridge/docs/installation.md`,
  playStore: "https://sink.gamas.workers.dev/uxnan-android",
  npmBridge: "https://www.npmjs.com/package/uxnan-bridge",
  sponsor: "https://sink.gamas.workers.dev/github-sponsor",
  coffee: "https://sink.gamas.workers.dev/buymeacoffee",
} as const;

/** The command that installs the daemon the phone talks to. */
export const BRIDGE_INSTALL_COMMAND = "npm install -g uxnan-bridge";

/** The one-time Gatekeeper release for the unsigned, experimental macOS build. */
export const MACOS_QUARANTINE_COMMAND =
  'xattr -dr com.apple.quarantine "/Applications/Uxnan Desktop.app"';

/**
 * The agent CLIs the bridge drives end-to-end. Each one is spawned as its own
 * official local binary — no provider HTTP API, no SDK, no key handed over.
 *
 * `onPhone: false` marks a CLI that is still wired in the bridge but hidden from
 * the mobile picker (Gemini CLI is deprecated in favour of Antigravity's `agy`).
 */
export const WIRED_AGENTS = [
  { id: "claudecode", name: "Claude Code", logo: "claudecode.svg", onPhone: true },
  { id: "codex", name: "Codex", logo: "codex.svg", onPhone: true },
  { id: "opencode", name: "OpenCode", logo: "opencode.svg", onPhone: true },
  { id: "antigravity", name: "Antigravity", logo: "antigravity.svg", onPhone: true },
  { id: "grok", name: "Grok", logo: "grok.svg", onPhone: true },
  { id: "zero", name: "Zero", logo: "zero.svg", onPhone: true },
  { id: "pi", name: "pi", logo: "pi.svg", onPhone: true },
  { id: "gemini-cli", name: "Gemini CLI", logo: "gemini.svg", onPhone: false },
] as const;

export const WIRED_AGENT_COUNT = WIRED_AGENTS.length;
export const PHONE_AGENT_COUNT = WIRED_AGENTS.filter((a) => a.onPhone).length;

/**
 * Extra coding-agent CLIs shown in the "any agent" strip.
 *
 * These are *not* wired into the bridge — they are here because the desktop ADE
 * is terminal-native, so they run inside it with no integration work. Only real
 * command-line agents belong in this list: the apps ship a few more marks (Gemma,
 * Kimi, …) but those are models, not CLIs, and claiming otherwise on a landing
 * page would be a lie the first curious visitor catches.
 */
export const TERMINAL_ONLY_AGENTS = [
  { id: "goose", name: "Goose", logo: "goose.svg" },
  { id: "qwen", name: "Qwen Code", logo: "qwen.svg" },
] as const;

/** JSON-RPC surface the bridge exposes (see `shared/src/jsonrpc/`). */
export const BRIDGE_METHOD_COUNT = 66;
export const BRIDGE_NOTIFICATION_COUNT = 8;

/** Memory envelope the desktop app targets, and what an Electron shell costs. */
export const RAM_TARGET = "30–100 MB";
export const ELECTRON_RAM = "200–500 MB";
