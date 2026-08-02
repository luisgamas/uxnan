# Changelog — uxnan-web

All notable changes to the marketing site are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The site is **not tag-versioned**: it has no release artifact and no consumers, so
it ships whenever `main` moves and Cloudflare Pages rebuilds it. Entries are
grouped by the date they landed rather than by a version number.

## [Unreleased]

### Changed — visual review pass (header dedup, full-screen mobile menu, framed clips)

Four fixes from a visual pass over the previous two rounds of changes below.

- **One live stats counter instead of two.** The header's bordered pill
  (`GitHubStats`, `hidden lg:inline-flex`) and the hero's own stats line were
  both live at once — duplicated UI, and the header version disappeared below
  `lg` anyway. The pill is gone (`github-stats.tsx` deleted); the fetch logic
  moved into a shared `useRepoStats()` hook (`lib/hooks.ts`) behind a new
  `RepoStatsLine` component (`site/repo-stats-line.tsx`) that the hero and the
  mobile menu overlay (below) both render, so there is exactly one
  implementation and one fallback to keep honest.
- **The header's GitHub icon is now visible at every width.** It used to be
  `hidden … sm:grid` (invisible below 640px) *and* sit next to the also-hidden
  stats pill, so a phone visitor had zero GitHub affordance in the header —
  only the theme toggle and the hamburger. It is now a plain always-visible
  icon-link; the header carries no counter of its own any more (see above).
- **The mobile menu is a full-screen overlay, not a dropdown.** The dropdown
  used to render in normal flow right under the compact bar, so at typical
  phone heights the hamburger button and the hero's own CTAs stayed visible
  (and tappable) around it — it read as unfinished. It now covers the
  viewport outright (`fixed inset-0 z-[60]`, above the header's own `z-50`)
  with its own logo + close (✕) button, larger nav links, the Download CTA,
  and — reusing `RepoStatsLine` — the "Free · Open source · MPL-2.0" line and
  the live star/download counters, so a phone visitor who never sees the
  header's (now counter-less) compact bar still sees them. The existing
  scroll-lock (`document.body.style.overflow = "hidden"` for as long as the
  menu is open) needed no changes.
- **The three "See it work" clips get an intentional frame.** They used to
  sit edge-to-edge in a plain rounded box (`aspect-[4/3] overflow-hidden
  bg-surface-sunken`), which read as an afterthought next to the DOM mockups'
  deliberate chrome. Each clip now sits in an inset bezel — a sunken surface
  behind a hairline-bordered, more-tightly-rounded inner frame — the same
  layering the mockups use for depth, deliberately *not* a box-shadow (this
  site drops elevation everywhere: `--shadow-*: none`) and deliberately
  *not* a fake macOS-style titlebar (the clips are real captures, not
  recreations — see `docs/content.md`'s mockup table — and a fake titlebar
  would blur that distinction).
- **Per-clip crop (`objectPosition`) so the named action is actually in
  frame.** `FeatureVideo` gained an `objectPosition` prop (default `50% 50%`,
  unchanged for any future caller that doesn't set one). The source clips are
  a fixed 1280×720 (16:9) capture, cropped by `object-fit: cover` into the
  card's 4:3 frame — which, at that ratio, only ever trims *width* (a fixed
  25% of it, height always matches exactly), so only the X% of
  `objectPosition` has any visible effect. Values were picked by seeking each
  real file frame by frame (Puppeteer against the same local Edge binary used
  for the mobile-viewport work below), not guessed, and confirmed by
  screenshotting the actual rendered cards:
  - `launch-agent` → `20% 50%`: keeps the worktree row *and* the right-click
    "Launch agent" menu item (which opens left-of-centre, not at the edge) in
    frame together.
  - `agent-subagents` → `35% 50%`: keeps the sidebar's full 3-item sub-agent
    list in frame while still showing a slice of the terminal's `Task(...)`
    calls to its right.
  - `create-pr` → `100% 50%` (the source's true right edge): the GitHub
    panel — branch picker, PR title/description, the checks + Review button —
    was losing its last few characters at anything less than the full edge
    (verified at `90%` first, which still clipped "outside the visible" mid
    -word; `100%` shows it complete).
- **Verified the mobile viewport correctly this time.** An earlier pass in
  this same file (below) diagnosed a `--window-size`-driven false alarm and
  concluded no fix was needed; this pass's own first screenshot attempt hit
  the same category of headless-only artifact from a different angle (a
  seeked-but-unpainted video frame rendering solid black) before landing on a
  reliable method — Puppeteer with real device-metrics emulation
  (`page.setViewport({ isMobile: true, hasTouch: true, … })`), each clip's
  `<video>` scrolled into view individually so its lazy `src` actually loads
  before seeking, then a brief `play()`/`pause()` to force the seeked frame
  to composite. `tsc --noEmit`, `npm run lint` and `npm run build` are clean.

### Changed — hero rewrite + live repo stats in the hero

- **The hero subhead is now the actual pitch, in ~2 lines.** It used to be a
  4-sentence paragraph ("Two independent apps... not another agent... Desktop
  runs several on ~250 MB... Neither needs the other") that buried the point
  under a RAM figure that already lives in the proof strip. It now reads:
  *"**Desktop** runs any CLI agent — 7 with first-class support. **Mobile**
  reaches those 7 from your phone. Independent apps. No lock-in."* — confident
  and concrete rather than a pitch, and it states the thing the agents-related
  copy elsewhere already established (any CLI + a first-class subset) where a
  visitor sees it first, in two lines instead of four sentences.
- **Live star + download counters in the hero**, under the "Free · Open
  source · MPL-2.0" line — plain small text, not a pill or a button, each half
  a discreet link (stars → the repo, downloads → Releases). Same
  fallback-then-live pattern as the header's `GitHubStats`
  (`fetchReleaseData`, `sessionStorage`-cached): starts from a static floor and
  swaps to the live count the moment the public API answers, silently keeping
  the floor if the anonymous rate limit is hit. This is the fix for stars and
  downloads being invisible on mobile — the header's `GitHubStats` is `hidden
  lg:inline-flex` (there is no room for it in the compact mobile header, and it
  is not folded into the hamburger menu either), so the hero's copy is now the
  one place every visitor, regardless of viewport, sees the repo is real.
- **New fallback constant `DOWNLOADS_FALLBACK`** (`site.ts`), the same kind of
  manually-checked snapshot as `GITHUB_STARS_FALLBACK` — the summed
  `download_count` of every asset on every published release, checked via
  `gh api repos/${REPO_SLUG}/releases --paginate --jq '[.[] |
  select(.draft==false) | .assets[].download_count] | add'` (341 on
  2026-08-01). `docs/content.md`'s claim table updated to cover both floors and
  both consumers (header + hero) in one row.
- **Verified against a real mobile viewport, not just a narrow desktop
  window.** A first pass using `msedge --headless --window-size=390,…
  --screenshot` appeared to show the hero headline, paragraph, download
  buttons and proof strip all clipped at the right edge on every phone width
  tested (375–430px) — investigated at length (flex cross-axis sizing,
  `min-w-0`, `--force-prefers-reduced-motion` for the reveal-on-scroll
  animation, `--virtual-time-budget`), including one reverted `min-w-0`
  experiment. **It turned out to be a false alarm**: `--window-size` alone
  does not trigger Chromium's actual mobile viewport emulation (the `<meta
  name="viewport">` handling that narrow *desktop* windows don't get), so the
  page was being laid out against a wider effective viewport than the
  screenshot's pixel dimensions implied. A proper check — Puppeteer against
  the same local Edge binary with `page.setViewport({ width: 390, height: 844,
  isMobile: true, hasTouch: true })`, plus `getBoundingClientRect()` on every
  suspect element — showed everything correctly constrained (`h1` at exactly
  342px, right edge at 366px inside a 390px viewport, zero horizontal
  `scrollWidth` overflow) and confirmed visually: headline, paragraph, both
  download buttons (stacked, full-width, matching `DownloadButton`'s existing
  `flex-col sm:flex-row` responsive design) and the proof strip all render
  correctly on a real mobile viewport. No layout fix was needed.

### Changed — agent-count wording correction

Closed out the conversion-focused redesign below by fixing how the page talks
about which agents Uxnan supports, and audited the inherited work for
breakage.

- **Desktop is not a fixed agent list, and the copy no longer reads that way.**
  The Agents section used to say *"`WIRED_AGENT_COUNT` (8) CLIs are wired for
  remote control from the phone"* — a bridge-only figure (it counted the
  deprecated, phone-hidden Gemini CLI) attached to a claim about the phone on a
  section that is about both apps. It now says *"`PHONE_AGENT_COUNT` (7) CLIs
  get first-class integration — live status, resumable sessions, their own
  model list,"* immediately followed by the section's existing, unchanged
  pitch that Desktop is terminal-native and runs any CLI unmodified. The hero
  proof-strip pill dropped "**N** real agent CLIs" for "**N** first-class agent
  CLIs" for the same reason: "real" reads as an exhaustive/exclusive count,
  "first-class" correctly reads as a subset. The FAQ's "Which agents work?"
  answer now names the same "first-class integration" framing instead of
  leaving Desktop's 7-CLI figure unexplained.
- **Gemini CLI no longer renders anywhere on the site.** The Agents section's
  drifting marquee used to spread the full `WIRED_AGENTS` array — including
  the deprecated, phone-hidden Gemini CLI entry — across its "wired end to
  end" row. It now filters to `onPhone: true` before rendering, so the
  marquee, and every agent count derived from it, matches the project's
  "Gemini CLI is deprecated, keep it out of marketing" rule. `WIRED_AGENT_COUNT`
  (the all-agents-including-Gemini figure) is removed from `site.ts` since
  nothing should read it for a page claim; `PHONE_AGENT_COUNT` is now
  documented as the one count every visitor-facing sentence must use.
- **`docs/content.md`'s claim table re-derived** against `bridge/docs/agents.md`
  (the per-agent status/session-resume/model-discovery table) and
  `uxnandesktop/docs/agent-launch.md`, and two new "deliberately hedged" notes
  added: `PHONE_AGENT_COUNT` is not a cap on Desktop, and Gemini CLI must never
  appear on a rendered surface even as an example.
- **The feature clips are tracked in git** (`public/videos/<slug>.mp4`, eight
  H.264 silent recordings, ~4 MB total): the deployed site must ship them, so
  they travel with the branch that uses them instead of existing only on the
  maintainer's machine. `docs/development.md` documents the re-render path.
- **Audited the inherited redesign for breakage** after `mockup-marquee.tsx`'s
  removal: no dangling imports, no orphaned mockup components (every file
  under `src/components/mockups/` is still reachable from `page.tsx`), no
  leftover `mockup-marquee`/`UsageCard`/`BrowserPanel`/`LauncherCard`/`DragCard`
  references, and the CSS keyframes the surviving marquee/gauge animations
  need (`ux-marquee`, `ux-grow-x`, `mask-edges`) are all still defined.
  `tsc --noEmit`, `npm run lint` and `npm run build` are clean.

### Changed — conversion-focused redesign

The home page rebuilt around six sections plus the hero, each stating one idea,
and a repeated call to action — aimed at getting an alpha visitor to try the app
and star the repo without the page feeling like a spec sheet.

- **Dark is now the default theme** (was light). `layout.tsx`'s inline
  pre-paint script now adds `dark` to `<html>` unless
  `localStorage["uxnan-theme"]` is explicitly `"light"`; the light palette is
  unchanged and stays fully reachable from the header toggle, and every
  existing `dark:` utility across the mockups keeps working unmodified — only
  which theme a first-time visitor lands on has changed. `useTheme()`'s initial
  state and the `viewport.themeColor` metadata follow the same flip (a single
  static colour now, since the app no longer follows the OS preference either
  way).
- **A page-wide grain overlay** — a fixed, `pointer-events: none` SVG
  turbulence tile at 2.5% opacity over the whole viewport, so the near-black
  surfaces read as material rather than flat digital fill. Static, not
  animated, so it costs nothing and needs no `prefers-reduced-motion` guard.
- **The 15-card feature marquee is gone.** `Features` (`#features`) is now
  three real, silent screen recordings of the app — "Start an agent in
  seconds", "Watch the whole team, not one chat", "Ship it without leaving the
  window" — lazy-loaded and played only once each clip nears the viewport
  (`src/components/mockups/feature-video.tsx`). Files live at
  `public/videos/<slug>.mp4`, tracked in git so every deploy ships them.
- **The Two Apps cards each carry one visual now** instead of a denser bullet
  list: the Desktop card embeds the memory gauge mockup, the Mobile card embeds
  a Conversation phone screen.
- **A proof strip under the hero's call to action** — four short, linked facts
  instead of a testimonial the project doesn't have yet: the measured RAM
  figure, the desktop test count, the MPL-2.0 licence, and the number of agent
  CLIs in the mobile picker.
- **The closing call to action names the ask.** Its secondary button now reads
  "Star on GitHub" (was "Read the source"), with a star icon.
- **The header's star counter is never blank.** `GitHubStats` now starts from
  a static floor (`GITHUB_STARS_FALLBACK`) and shows it immediately on first
  paint, swapping in the live count the moment the public API answers — a
  visitor who exhausts the anonymous rate limit still sees a number, not a
  missing nav item. Its breakpoint also dropped from `xl` to `lg` so it shows
  up more often.
- **Nav label "Look" → "Demo"**, matching the new video section.
- **The FAQ's "Which agents work?" answer is shorter** — dropped the
  Gemini-CLI-hidden-in-favour-of-Antigravity implementation detail, which
  belongs in the repo's own docs, not a conversion page.
- **Dead mockups removed** now that the marquee that used them is gone:
  `UsageCard`, `BrowserPanel`, `LauncherCard`, `DragCard`, the `mockup-marquee.tsx`
  component, and five now-unreferenced phone screens (Threads, Picker, Git,
  Files, Profile) — `Phone` keeps only `devices` and `conversation`. First-load
  JS for `/` dropped from ~140 kB to ~135 kB as a result.

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
