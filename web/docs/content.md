# Content — how the copy stays true

![Rule](https://img.shields.io/badge/facts-src%2Flib%2Fsite.ts-blue?style=for-the-badge)

A marketing page is the easiest place in a repository for a claim to quietly stop
being true. Nothing compiles it, no test asserts it, and the person who changes
the code is rarely the person who wrote the sentence about it. This document
exists so that never happens here.

## The rule

**Every fact the page states lives in [`src/lib/site.ts`](../src/lib/site.ts).**
Agent lists and counts, RAM figures, JSON-RPC method counts, install commands,
the macOS Gatekeeper command, and every outbound link. Components import them;
they never type them inline.

When one of those things changes in the repository, `site.ts` is the single file
that changes here — and the sentences around it are then re-read against the new
value.

## Where each claim comes from

| Claim on the page | Constant | Source of truth in the repo |
|---|---|---|
| "7 CLIs get first-class integration" (hero proof strip, Agents section, FAQ) / "7 agents in the picker" (Two Apps, `/download`) | `PHONE_AGENT_COUNT` | `bridge/docs/agents.md` → *Wired agents* (the status/session-resume/model-discovery table) and `uxnandesktop/docs/agent-launch.md` (sessions named at launch, curated model lists) for what "first-class" means; `uxnanmobile/README.md` → *Provider-agnostic, real multi-agent support* ("Seven real agents are selectable today — OpenCode, Claude Code, Codex, pi, Antigravity, Zero and Grok") for the count itself |
| Agent names and marks | `WIRED_AGENTS` | same sources as above; logos copied from `uxnandesktop/static/agents/` and `uxnanmobile/assets/images/agents/` |
| Agents that "run in the terminal" | `TERMINAL_ONLY_AGENTS` | real command-line coding agents only. The apps ship extra marks (Gemma, Kimi, …) that are **models, not CLIs** — they must not be listed as agents |
| "~250 MB of RAM" | `RAM_FOOTPRINT` | **measured**, not a target: `uxnandesktop/scripts/resources/baselines/windows/R02.json` (median of 5 repetitions, private bytes across the process tree). Re-measure with `npm run bench` before changing it, and keep the platform/build beside the figure |
| "~40 MB core" | `RAM_CORE` | the same baseline — the Rust process alone, without the OS webview the UI renders in |
| "200–500 MB" for an Electron shell | `ELECTRON_RAM` | stated as a range those apps commonly idle in, **not** a benchmark of a named product — nobody has measured one for this repo |
| "1,169 automated tests" (hero proof strip) | `DESKTOP_RUST_TEST_COUNT`, `DESKTOP_VITEST_TEST_COUNT`, `DESKTOP_TEST_COUNT` | `uxnandesktop/FOR-DEV.md` → *Status* ("476 Rust tests … + 693 frontend Vitest tests") and `uxnandesktop/docs/testing.md` (§ L1/L3, § L2), which state the same two numbers. Desktop only — the bridge's own suite is not folded in, since it is not currently pinned to one clean, dated total the way the desktop numbers are |
| The header's and hero's star/download counters, before the live fetch answers (or if it never does) | `GITHUB_STARS_FALLBACK`, `DOWNLOADS_FALLBACK` | manually-checked snapshots — `stargazers_count` from `/repos/${REPO_SLUG}` and the summed `download_count` of every asset on every non-draft release (`gh api repos/${REPO_SLUG}/releases --paginate --jq '[.[] | select(.draft==false) | .assets[].download_count] | add'`) — **not** derived automatically, bump them occasionally so the pre-fetch numbers stay plausible. Both `GitHubStats` (header, hidden below `lg`) and the hero's own stats line (`hero.tsx`, visible at every width, same `fetchReleaseData` call) start from these floors and swap to the live numbers the moment the fetch succeeds |
| "68 JSON-RPC methods, 10 notifications" | `BRIDGE_METHOD_COUNT`, `BRIDGE_NOTIFICATION_COUNT` | `bridge/README.md` → *Architecture*; re-derive from `shared/src/jsonrpc/` rather than trusting the old number |
| `npm install -g uxnan-bridge` | `BRIDGE_INSTALL_COMMAND` | `bridge/README.md` → *Install* |
| `xattr -dr com.apple.quarantine …` | `MACOS_QUARANTINE_COMMAND` | `uxnandesktop/docs/install-macos.md` → *Tier 2* |
| Every outbound link | `links` | the paths must exist on `main` |

Release-asset names and version numbers are **not** hard-coded: `src/lib/releases.ts`
resolves them from the GitHub API at runtime. What *is* hard-coded there is the
tag prefix of each channel (`desktop-stable-v` / `desktop-nightly-v`) and the
file-name patterns the release workflow produces (`…_x64-setup.exe`,
`…_aarch64.dmg`, `…_amd64.AppImage`, …). If
[`release-desktop.yml`](../../.github/workflows/release-desktop.yml) ever renames
an artifact or a tag, `downloadOptionsFor` stops matching and the button silently
falls back to the Releases page — so treat that workflow as a consumer of this
file.

## Two products, not one product with two halves

This is the single thing about Uxnan that outside writing gets wrong most often,
so the site defends against it in copy:

- **Uxnan Desktop** runs CLI coding agents on your PC, cheaply.
- **Uxnan Mobile** reaches agents already running on a PC, from a device that
  could never run one itself — and does not require the desktop app.
- They share the **bridge** and nothing else; the bridge belongs to the phone
  app's story, not the desktop app's.

There are no separate product marketing routes: both are named on the home page
(Two Apps + features marquee) and installed from `/download`. Copy that says
"and a phone app that keeps you in the loop" — as though the two were halves of
one product — is wrong even when every individual word is true.

## The interface recreations are a contract

`src/components/mockups/` mirrors real component structure, not an artist's
impression of it:

| Recreation | Mirrors |
|---|---|
| `sidebar.tsx` | `ProjectCard.svelte` (borderless group, not a card), `WorktreeRow.svelte` (two lines, dirty/ahead/behind/PR/terminal indicators, selection wrapping the agents), `AgentSpace.svelte`, `AgentRow.svelte` (sub-agents on a left rule, `running/total` badge) |
| `file-tree.tsx` | `RightPanel.svelte` tab order — **Files** first, then Changes, History, GitHub — and `FileTreePanel.svelte`'s git colours (untracked green, deleted red, otherwise amber) |
| `claude-terminal.tsx` | The Claude Code CLI's own output: `⏺` steps, `Tool(argument)` calls, `⎿` results, numbered diff lines, the input box and the permission-mode hint |
| `satellites.tsx` phones | The mobile app's Material 3 treatment and the recognizable silhouette of the Devices list and a Conversation. Two variants on purpose (Devices for the hero, Conversation for the Two Apps card) rather than a full screen tour — the "See it work" clips are where the fuller mobile story now lives. At 114–126 px wide these are intentionally reduced to hierarchy and signature controls, not full replicas. |
| `feature-video.tsx` clips | Not a recreation at all — a real, silent screen capture of the running app, dropped in at `public/videos/<slug>.mp4`. Used sparingly (three clips, one idea each) precisely because the DOM recreations already carry the "this is the real interface" argument; the clips exist to prove it moves the way it says it does |

When those components change shape in `uxnandesktop/` or `uxnanmobile/`, nothing
breaks and no test fails — the mockups simply become a picture of an app that no
longer exists. Treat them as documentation of the UI and update them in the same
pass.

## Claims that are deliberately hedged

Some things on the page are true only with their qualifier attached. Do not
"tighten" this copy:

- **macOS is experimental and unsigned.** `MACOS_IS_EXPERIMENTAL` in
  `releases.ts` is a **constant, not a function of the channel**: a stable tag
  does not make the build notarised, so the warning must not disappear when the
  visitor switches channels. The authorisation steps are shown next to the
  download rather than after it — removing that is how someone ends up with an app
  that will not open.
- **Linux is built in CI but not exercised end to end by the maintainer.** The
  FAQ says so.
- **The project is alpha.** The FAQ says that too, plainly, and points at the
  per-project status files instead of claiming a completeness the repo does not.
- **The memory numbers are a target and a range**, not measurements taken side by
  side. The comparison card spells that out under the bars.
- **"No paid tier"** is a statement about today's MPL-2.0 licensing, and it is
  the only monetisation claim the page makes.
- **`PHONE_AGENT_COUNT` is not a cap on what Desktop can run.** Desktop is
  terminal-native: any CLI agent works unmodified the moment it exists,
  whether or not Uxnan has ever heard of it. `PHONE_AGENT_COUNT` names the
  smaller, **first-class** subset — real-time status, resumable sessions,
  their own model list — that also happens to be exactly what Mobile's picker
  offers. Every sentence that states this number must keep that scope
  explicit ("first-class", "in the picker") rather than reading as "these are
  the only real agents"; the FAQ's "Which agents work?" answer is the model to
  copy from.
- **Gemini CLI never appears on this site.** It is discontinued upstream
  (`WIRED_AGENTS` keeps its entry only so `onPhone: false` has something to
  flip — see the doc comment in `site.ts`); every visitor-facing surface
  filters it out (the Agents section's marquee, every agent count, the FAQ).
  Don't add it back to a rendered list even as an example — see `AGENTS.md` →
  "Gemini CLI is deprecated".

## When you change the product

If your change lands in `bridge/`, `uxnandesktop/`, `uxnanmobile/`, `relay/` or
`shared/` and it alters something in the table above, update `web/src/lib/site.ts`
in the **same change set** — the same rule the rest of the monorepo follows for
`CHANGELOG.md` and the architecture docs (see the root
[`AGENTS.md`](../../AGENTS.md) → *Update documentation*). Then read the sentences
that use the constant: a number can change without the sentence around it still
making sense.

## Voice

For anyone writing new copy:

- **Say the specific thing, and only if it is measured.** "~250 MB" beats
  "lightweight" — but only because a benchmark produced it. A number nobody has
  measured is worse than the adjective it replaced, because it can be checked.
  "One git worktree per task" beats "powerful workflow".
- **Name the pain before the fix.** The reader should recognise their own week in
  the problem section before the product is mentioned — especially people on
  modest hardware and people who refuse a single vendor's phone+desktop leash.
- **One idea per section, six to seven sections total.** The public site is
  essentially home + `/download`. Home is the decision funnel: hero (with a
  proof strip, not a testimonial) → the pain → pick an app → three real clips
  ("See it work") → bring your own agent → FAQ → the same call to action again,
  plus "Star on GitHub". Do not reintroduce separate `/desktop` or `/mobile`
  marketing routes without an explicit product decision, and do not let any one
  section grow back into a feature dump — a long list belongs in a doc, not a
  grid on this page.
- **Say independence once, then move on.** Desktop and Mobile must never be
  blurred into one product — but after the Two Apps fork, stop re-explaining the
  same independence paragraph in every block.
- **macOS authorisation** belongs under the hero download when the visitor is on
  macOS, and as a post-download dialog — not as a permanent panel on `/download`.
- **No superlatives, no competitors by name.** The Electron comparison is about a
  technical choice, not about anyone's product.
- **Short sentences carry more.** The page is read at a scroll, not studied.
  Drop protocol cipher lists and JSON-RPC method counts from marketing surfaces;
  those belong in docs and FAQs that need them.
- **Never promise a roadmap item as if it shipped.** If it is in a `FOR-DEV.md`,
  it does not belong on the site.
