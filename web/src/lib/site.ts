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
  testingGuide: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/docs/testing.md`,
  benchmarksGuide: `https://github.com/${REPO_SLUG}/blob/main/uxnandesktop/docs/resource-benchmarks.md`,
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
 * The agent CLIs with first-class integration — real-time status, resumable
 * sessions and their own model list — driven via the bridge (mobile) or
 * directly (desktop). Each is spawned as its own official local binary: no
 * provider HTTP API, no SDK, no key handed over.
 *
 * This is deliberately **not** a cap on what Desktop can run: Desktop is
 * terminal-native, so any CLI agent works unmodified the day it ships (see the
 * Agents section and FAQ) — this array is only the smaller, first-class subset
 * that also happens to be exactly what Mobile's picker offers.
 *
 * `onPhone: false` marks the one entry excluded from *every* visitor-facing
 * surface on this site (the mobile picker, the marketing marquee, and every
 * agent count): Gemini CLI is deprecated in favour of Antigravity's `agy` and
 * must stay out of marketing (see `AGENTS.md` → "Gemini CLI is deprecated").
 * It stays in this array only so `bridge/README.md`'s own "eight real agents
 * wired" figure has a data source to check against — never read
 * `WIRED_AGENTS.length` for a page claim, use `PHONE_AGENT_COUNT` below.
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

/**
 * The count of first-class agents — every `WIRED_AGENTS` entry with
 * `onPhone: true`. This is the number every visitor-facing sentence on the
 * site must use when it states an agent count, whether the sentence is about
 * the mobile picker specifically or the first-class set in general.
 */
export const PHONE_AGENT_COUNT = WIRED_AGENTS.filter((a) => a.onPhone).length;

/**
 * Extra coding-agent CLIs shown in the "any agent" strip — a sample proving
 * the claim, not an exhaustive list.
 *
 * These are *not* wired with first-class integration — they are here because
 * the desktop ADE is terminal-native, so they run inside it with no
 * integration work. Only real command-line agents belong in this list: the
 * apps ship a few more marks (Gemma, Kimi, …) but those are models, not CLIs,
 * and claiming otherwise on a landing page would be a lie the first curious
 * visitor catches.
 */
export const TERMINAL_ONLY_AGENTS = [
  { id: "goose", name: "Goose", logo: "goose.svg" },
  { id: "qwen", name: "Qwen Code", logo: "qwen.svg" },
] as const;

/** JSON-RPC surface the bridge exposes (see `shared/src/jsonrpc/`). */
export const BRIDGE_METHOD_COUNT = 68;
export const BRIDGE_NOTIFICATION_COUNT = 10;

/**
 * What the desktop app actually costs, and what an Electron shell costs.
 *
 * `RAM_FOOTPRINT` is **measured**, not a target: the median of five repetitions
 * of the "one project, one terminal" scenario on Windows 11 (WebView2
 * 150.0.4078.105, release build), counting private committed bytes across the
 * whole process tree so pages shared between the webview's processes are not
 * counted twice. `RAM_CORE` is the Rust process on its own — everything above it
 * is the OS webview the interface renders in.
 *
 * Source: `uxnandesktop/scripts/resources/baselines/windows/`. Re-measure before
 * changing them, and keep the conditions beside the figure wherever it is shown:
 * a memory number without its platform and build is not a claim anyone can
 * defend. Method: `uxnandesktop/docs/resource-benchmarks.md`.
 */
export const RAM_FOOTPRINT = "~250 MB";
export const RAM_CORE = "~40 MB";
export const ELECTRON_RAM = "200–500 MB";

/**
 * The desktop app's own automated test suite — the honest "we have tests, here
 * is the number" claim for an alpha project with no user testimonials yet.
 *
 * Source: `uxnandesktop/FOR-DEV.md` → *Status* and
 * `uxnandesktop/docs/testing.md` (§ L1/L3 backend, § L2 frontend), which agree
 * on both counts. Re-derive before changing: the backend figure is stated
 * explicitly ("476 Rust tests"), the frontend figure is stated explicitly
 * ("693 frontend Vitest tests" / "**693 tests** across both projects"). Neither
 * includes the 24 WebdriverIO end-to-end tests, which are cited separately as
 * qualitative proof ("a real end-to-end suite over the packaged app") rather
 * than folded into the headline number.
 */
export const DESKTOP_RUST_TEST_COUNT = 476;
export const DESKTOP_VITEST_TEST_COUNT = 693;
export const DESKTOP_TEST_COUNT = DESKTOP_RUST_TEST_COUNT + DESKTOP_VITEST_TEST_COUNT;

/**
 * A best-effort static floor for the header's star counter, shown instantly on
 * first paint and while `GitHubStats` waits on (or loses) the live GitHub API
 * call — an anonymous visitor's browser is rate-limited to 60 requests/hour, so
 * the nav must never just go blank. The live count replaces it the moment the
 * fetch succeeds and is always used when it is higher; this is a floor, not a
 * cap. Source: `https://api.github.com/repos/${REPO_SLUG}` (checked 2026-08-01
 * — bump it occasionally so the pre-fetch number stays plausible).
 */
export const GITHUB_STARS_FALLBACK = 24;

/**
 * The same kind of static floor as `GITHUB_STARS_FALLBACK`, for the summed
 * `download_count` across every asset of every published (non-draft) release —
 * shown by the hero's stats line before the live fetch answers, or if it never
 * does. Source: `gh api repos/${REPO_SLUG}/releases --paginate --jq '[.[] |
 * select(.draft==false) | .assets[].download_count] | add'` (checked
 * 2026-08-01 — bump it occasionally so the pre-fetch number stays plausible).
 */
export const DOWNLOADS_FALLBACK = 341;
