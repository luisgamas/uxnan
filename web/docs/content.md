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
| "8 CLIs are wired end to end" | `WIRED_AGENT_COUNT` | `bridge/README.md` → *Real agents wired*; the adapters in `bridge/src/agents/` |
| "7 agents in the picker" | `PHONE_AGENT_COUNT` | `uxnanmobile/README.md` → *Provider-agnostic, real multi-agent support* (Gemini CLI is wired but hidden) |
| Agent names and marks | `WIRED_AGENTS` | the same two READMEs; logos copied from `uxnandesktop/static/agents/` and `uxnanmobile/assets/images/agents/` |
| Agents that "run in the terminal" | `TERMINAL_ONLY_AGENTS` | real command-line coding agents only. The apps ship extra marks (Gemma, Kimi, …) that are **models, not CLIs** — they must not be listed as agents |
| "30–100 MB of RAM" | `RAM_TARGET` | `uxnandesktop/README.md` → *Why it helps, even in alpha* |
| "200–500 MB" for an Electron shell | `ELECTRON_RAM` | the same section — stated as a range those apps commonly idle in, **not** a benchmark of a named product |
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
| `satellites.tsx` phones | The mobile app's Material 3 treatment and the recognizable silhouette of Devices, Conversation, New conversation, Threads, Git, Files and Profile. At 114 × 230 px these are intentionally reduced to hierarchy and signature controls, not full replicas. |

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

- **Say the specific thing.** "30–100 MB" beats "lightweight". "One git worktree
  per task" beats "powerful workflow".
- **Name the pain before the fix.** The reader should recognise their own week in
  the problem section before the product is mentioned — especially people on
  modest hardware and people who refuse a single vendor's phone+desktop leash.
- **One idea per section.** The public site is essentially home + `/download`.
  Home is the decision funnel (pain → pick an app → mockup marquee of both
  products → FAQ). Do not reintroduce separate `/desktop` or `/mobile` marketing
  routes without an explicit product decision.
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
