# Content — every claim and where it comes from

The page is marketing, so it is allowed to be warm, short and confident. It is
**not** allowed to be wrong. Every number, name, command and capability it states
lives in [`src/lib/site.ts`](../src/lib/site.ts) and traces back to something in
the monorepo.

**When one of these facts changes in the product, it changes here in the same
change set.**

| The page says | Where it comes from |
|---|---|
| The star and download counters under the hero badge | GitHub's own API, read **at build time** by `src/lib/github.ts`. Stars are `stargazers_count`; downloads sum the `download_count` of **installer assets only** (`.exe .msi .dmg .deb .rpm .AppImage .apk .aab`) — manifests, signatures and updater bundles are not downloads, and counting them made the figure *drop* after every release because the release workflow re-uploads `latest.json` with `--clobber`. If the call fails the row is omitted rather than guessed |
| "Windows, Linux · macOS (experimental) · Android on Google Play · iOS coming soon" | root `README.md` → _Install_ — macOS builds are unsigned, iOS is written but unshipped |
| "22 agents report precise status" + the two agent grids | `uxnandesktop/docs/agent-hooks.md` → the reporter table and _"Nine agents in the catalog have no precise state"_; root `README.md` → _Works with any CLI agent_ |
| Antigravity is marked _partial support_ | root `README.md` footnote — one-shot per turn, no live approval channel |
| "+ any CLI agent" | `uxnandesktop/docs/agent-launch.md` — custom agents are registered by hand |
| "runs the vendor's own official binary… never calls a provider API, holds a key, or embeds an SDK" | root `README.md` → _Works with any CLI agent_ |
| Isolated worktree per task; terminals restore with scrollback; PR with the merge methods the repo allows; nested subagents | root `README.md` → _What it feels like to use_; `uxnandesktop/docs/github.md`; `uxnandesktop/architecture/02b-terminal-engine.md`; `uxnandesktop/docs/agent-hooks.md` |
| **226 MB** asleep · **252 MB** one terminal · **274 MB** four terminals, and "~250 MB" in the hero badge | `uxnandesktop/docs/resource-benchmarks.md` → results table (Windows 11, release build, private working memory) |
| "every run records the OS, webview version, CPU, build profile and commit" | same doc → _Preconditions_ |
| Live streaming, message queue delivering mid-turn, diff review, push on finish | root `README.md` → _Uxnan Mobile_; `uxnanmobile/FOR-DEV.md` → `## Status` |
| "on the CLIs that allow it" (mid-turn delivery is not universal) | `bridge/docs/agents.md` → per-agent drive surface |
| `npm install -g uxnan-bridge` · `uxnan-bridge start` · QR pairing · LAN/Tailscale first, relay as fallback | `bridge/README.md`; root `README.md` → _How it connects_ |
| `X25519 · Ed25519 · AES-256-GCM` | root `README.md` → _Security_; `architecture/02a-system-architecture.md` §5.9 |
| MPL-2.0, free, open source | `LICENSE` |
| Windows / macOS / Linux downloads, Android on Google Play open testing | root `README.md` → _Install_ |
| "the Windows and macOS builds aren't code-signed yet" | root `README.md` → _Install_ (honest heads-up); `uxnandesktop/docs/install-macos.md` |
| "Every surface is Svelte and Rust, and the design tokens live in one file" | `uxnandesktop/src/app.css`; `AGENTS.md` → _Desktop conventions_ |

## Claims the page deliberately does **not** make

- **No user, star or download counts.** Numbers that move need a source of truth
  the site does not have; a stale "1,200 users" is worse than no number.
- **No telemetry or privacy promise beyond the transport.** The page says the
  relay only sees sealed envelopes, because that is specified and implemented. It
  says nothing about what the apps do or do not collect locally.
- **No iOS download.** iOS is written but unshipped; offering it would be a
  broken promise. If it ships, add it to `PLATFORMS` and the CTA.
- **No Gemini CLI.** It is deprecated and has no mobile surface — it must not
  appear in the agent list.
