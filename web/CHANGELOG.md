# Changelog — uxnan-web

All notable changes to the marketing site are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The site is **not tag-versioned**: it has no release artifact and no consumers, so
it ships whenever `main` moves and Cloudflare Pages rebuilds it. Entries are
grouped by the date they landed rather than by a version number.

## [Unreleased]

### Changed

- **The RAM claim is now a measurement.** `RAM_TARGET = "30–100 MB"` is replaced
  by `RAM_FOOTPRINT = "~250 MB"` and `RAM_CORE = "~40 MB"`, taken from the desktop
  app's first approved benchmark baseline (Windows 11, WebView2 150, release
  build, median of five repetitions, private bytes across the whole process
  tree). The old figure described the Rust core alone — the row Task Manager
  shows — while the app also runs six OS-webview processes Windows lists under
  their own name, so quoting the smaller number as the app's footprint was
  disprovable by anyone who opened Task Manager. The hero, the OG/schema
  description, the feature card and the two-apps summary all follow from those
  constants, and `docs/content.md` records the source file and how to re-derive
  it. The Electron range is unchanged and stays explicitly *not* a benchmark of
  any named product.
- **Contract counts refreshed to 68 methods / 10 notifications**
  (`BRIDGE_METHOD_COUNT`, `BRIDGE_NOTIFICATION_COUNT`). The mobile message queue
  added `queue/resume` + `queue/clear` and the `stream/turn/cancelled` +
  `stream/queue/updated` notifications; both numbers were re-derived from
  `shared/src/jsonrpc/` rather than incremented on trust.
- **Mobile mockups now match the app at miniature scale.** The feature marquee
  keeps each screen's real hierarchy and signature controls without reproducing
  details that disappear inside a 114 × 230 px phone.
- **Flat UI, slower marquees.** Dropped card/button elevations and box-shadows
  site-wide (shadow tokens resolve to `none`); feature and agent marquees run
  slower (~95–115s / ~75–95s per loop).
- **Single-page product story.** `/desktop` and `/mobile` product routes removed;
  mobile surfaces fold into the home features marquee. Nav points at home anchors
  + Download. Hero download is a **split control** when the detected OS has several
  installers (e.g. .exe/.msi); macOS shows the full orange authorisation card under
  the hero download row and a **dialog** after any macOS installer click (including
  on `/download`). Download page keeps three desktop cards + mobile + bridge; the
  permanent Documentation block and static macOS yellow panel are gone.
- **UI scale coherence + product marquees.** Home feature cards match Two Apps
  weight (roomy mockup stage). Desktop “Why it is light” is two equal cards
  (Electron red vs free-for-agents green). Desktop and Mobile feature deep-rows
  became horizontal mockup marquees. Platform copy: Windows/Linux clean; macOS
  experimental only; Mobile drops open-testing; iOS is “Coming soon” with a
  self-build docs link. Downloads page: three desktop columns each with
  stable + nightly, mobile + bridge below, docs/macOS notes reorganized.
- **Home shortened to a single-page funnel.** Hero scroll stage (desktop window +
  flying panels) kept. Full Desktop/Mobile deep-dive sections removed from `/`,
  and the standalone `/desktop` and `/mobile` routes removed entirely (their
  surfaces live in the features marquee) — the site is now just the home funnel
  plus `/download`. A compact **horizontal marquee of live mockups** (`#features`)
  replaces tall feature grids and long vertical product teasers — two
  auto-scrolling rows, pause on hover, short captions. Flow: problem → two apps →
  look → agents → FAQ → CTA.
- **Home copy reworked as a decision funnel.** Headline *"Power for agents. Not
  wasted on chrome."* Problem names who gets left behind; Two Apps cards lead with
  each product’s pain; agents strip drops protocol-count noise; FAQ and CTA
  tightened. Metadata and nav updated to match.
- **Product pages re-led on the same pains.** Desktop: agents-first / chrome-last
  and hardware written off by heavy shells. Mobile: remote control without a
  vendor app stack — bridge only, Desktop optional.
- **Positioning rewritten around two separate products.** The copy no longer
  frames Uxnan Mobile as "the phone half" of Uxnan Desktop; each is named and
  promised separately.
- **Interface recreations rebuilt against the real component tree.** Projects are
  borderless groups with two-line worktree rows and their real git indicators
  (dirty count, ahead/behind, PR check colour, terminal count); the selection fill
  wraps a worktree *and* its agents; the agent view shows sub-agents hanging off a
  left rule with the `running/total` badge; the right panel is **Files** first
  with a git-coloured file tree (untracked green, modified amber, deleted red);
  and the centre pane is a faithful Claude Code transcript — `⏺` steps,
  `Read()`/`Update()`/`Bash()` tool calls, `⎿` results, numbered diff lines, the
  rounded input box and the permission-mode hint. The transcript is bottom-aligned
  so a short container clips the oldest lines, exactly like a scrolled terminal.
- **Downloading is one click.** The popover is gone: the primary button resolves
  the visitor's platform (including which macOS architecture) and links straight
  at the installer. Everything else moved to the new downloads page.
- **The macOS "experimental" warning is now a constant**, shown on every channel
  rather than derived from whether a build was tagged stable or nightly.
- **The closing call to action is a full-bleed tinted band** instead of a card, so
  nothing gets clipped against its edge.
- **Home features are a dual marquee of DOM recreations** (not a multi-row card
  grid), so more surfaces show without stretching vertical scroll.

### Fixed

- **Footer links were not clickable.** The revealed footer sat at `z-index: -1`,
  which paints it behind the body's own content box and takes it out of hit
  testing; it is now `z-index: 0` under a `z-10` main, and the scroll runway is
  `pointer-events: none`.
- Hydration mismatch warning from the pre-paint theme script (`<html>` now carries
  `suppressHydrationWarning`).
- The agent marquee left a gap on wide displays — each loop half is now at least
  as wide as the viewport.
- Hero satellites drifted away from the window as the viewport grew, and painted
  underneath it; they are now pinned to a fixed-width rail centred on the settled
  window.

### Added

- **Deploy pipeline** — `deploy-web.yml` builds the static export on GitHub's
  runners and uploads `web/out` to Cloudflare Pages as a Direct Upload
  (`cloudflare/wrangler-action`), verifying the commit first. `ci-web.yml` is now
  the pull-request gate only, so `main` is verified once and deployed rather than
  verified twice. Needs two repo secrets (`CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`) and a Pages project named `uxnan` →
  `https://uxnan.pages.dev`; steps in `docs/deploy.md`.
- **Social preview card** — `public/og.png` (1200×630) wired into the Open Graph
  and Twitter metadata, so shared links unfurl with an image. Default origin is
  `https://uxnan.pages.dev`; a build-time `NEXT_PUBLIC_SITE_URL` overrides it for a
  custom domain.
- **`public/_headers`** — long-lived immutable caching for `/_next/static/*`, a
  day for `og.png`, and conservative security headers (no CSP, so the inline
  pre-paint theme script keeps working).
- **The site itself** — a single-page marketing funnel (Next.js 15 static export,
  React 19, Tailwind CSS v4, TypeScript): the home page (problem, the separation
  between the two products, the features marquee, the agent strip, FAQ, CTA) plus
  a **`/download`** page listing every installer.
- **`/download`** — a channel switch (stable / nightly) over per-platform sections
  for Windows, macOS, Linux and the phone. The installer list is whatever the
  release actually published, so a platform that gains a build appears on its own;
  a channel with nothing for a platform says so. Carries the macOS authorisation
  steps and the bridge install command.
- **Discoverability** — a build-time `/sitemap.xml` and `/robots.txt` (from the
  route list in `site.ts`), per-page canonical URLs, schema.org JSON-LD
  (`WebSite` + `Organization` + both apps as `SoftwareApplication`), and a
  hand-written `/llms.txt` so an AI landing on the URL knows what Uxnan is.
- **Phone screen recreations** for the model picker, the git screen, the file
  browser and the activity profile, alongside the conversation and thread lists.
- **Feature scenes** — a launcher, a file dragged onto a terminal, and a memory
  gauge, built as animated DOM.
- **OS-aware download button** — detects the visitor's platform, resolves the
  matching installer from the GitHub Releases API for the selected channel
  (**stable** / **nightly**), and shows the file name, size and version. Lists
  every platform in a popover, marks macOS as experimental, and carries the
  one-time `xattr -dr com.apple.quarantine` release command with a copy button.
  Falls back to the Releases page when the anonymous API quota is exhausted.
- **Live GitHub counters** — stars and the summed download count of every
  published release asset, in the header and cached per session.
- **Interactive hero** — a canvas glyph field whose columns stay shallow across
  the middle and reach deeper at the edges, mutating continuously, tinting to the
  accent and receding around the pointer; plus a scroll-driven stage in which the
  desktop window rises and widens while the project, agent, pull-request and
  phone panels fly in around it.
- **Interface recreations in DOM** — the three-panel ADE, the ordered project
  sidebar, the agent view, the GitHub pull-request panel, the docked developer
  browser, the provider usage meters and two phone screens, all built from real
  markup so they follow the theme and stay sharp at any resolution.
- **Light/dark theme** with a header toggle, applied before first paint by an
  inline script and persisted in `localStorage`; light is the default.
- **Footer reveal** — the page body scrolls off to uncover a fixed footer that
  scales up very slightly as it arrives (desktop only).
- **CI** — `ci-web.yml` + reusable `verify-web.yml` run typecheck, lint and the
  static export on every PR and on push to `main`.

### Notes

- Content is **English only** by design for now; the structure leaves room for a
  Spanish version without a rewrite.
- Every factual claim on the page (agent counts, RAM figures, JSON-RPC method
  counts, commands, links) is centralised in `src/lib/site.ts` so it can be
  re-checked against the repository in one place. See `docs/content.md`.
