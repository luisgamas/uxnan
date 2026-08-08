# Changelog

All notable changes to the marketing site are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **The agent section shows the whole catalog, not seven names.** Two rows of
  tiles now — same compact shape as before, mark on the left and name on the
  right: the **22 agents that report precise state** (working / blocked / waiting /
  done, plus session resume and live model discovery), and the **9 that launch
  and run but whose CLI cannot say a turn ended** — shown dimmed, with a line
  saying exactly that rather than leaving the difference implied.

- **Marks are the vendors' own favicons, vendored as PNGs.** Only four agents
  keep a drawn mark (Claude Code, Codex, OpenClaude, Zero); the rest use their
  favicon, fetched **once** into `assets/agents/` by
  `scripts/fetch-agent-favicons.mjs` rather than hot-linked, so no visitor's
  browser calls a third party to draw a 40px logo. It is also what the desktop
  app itself shows, so the app, the site and the READMEs agree.

- **The chip behind each mark is light now.** A favicon is drawn for a white
  page, and about half of them are dark shapes that disappeared on the old dark
  chip (OpenCode, Kimi, Devin, MiMo, Command Code…). On a light chip they all
  read, and nothing in that grid needs inverting any more.


- **The desktop mockup's agent-state glyphs follow the shipped app again**, and
  now show the whole vocabulary instead of a wall of identical green: the
  **Comet Trail** (a 3×3 dot matrix with a bright head and a fading two-dot tail
  sweeping the ring) while working, a question bubble when an agent needs *you*,
  a pause circle when it is blocked on another system, and a check when the turn
  is done — replacing the pulsing coloured dot the app no longer uses. `idle`
  keeps its plain dot, as it does in the app. The four running agents and their
  subagents were re-cast so each state appears once, including on the tab strip.
  Subagents stay on the working glyph on purpose: a child only ever reaches
  `working` / `done` in the real app, and only the working ones are rendered.
- A new **`orange`** palette token (`#f97316`) splits the two "not moving"
  states the way the app does — orange for *waiting on you*, amber for *blocked
  on another system*. The parallel-worktree section's "Waiting on you" tone moved
  to it, so one state is one colour across the page.
- **The site was rebuilt from scratch as a single-page funnel**, replacing the
  previous multi-section site in this directory: hero with a live product
  composition, agent line-up, parallel-worktree section, mobile section, measured
  footprint, open source and a closing call to action. The deploy pipeline, the
  Cloudflare `_headers`, `og.png` and `llms.txt` carry over unchanged; the
  `/download` route, the screen-recording clips and the bundled agent SVGs do
  not.
- Agent marks are served from the repository's own `assets/agents/`, synced into
  `public/agents/` by `scripts/sync-agent-marks.mjs` before dev and build (the
  synced copy is git-ignored). One source of truth for the site and both root
  READMEs, no third-party request at page load, and `INVERT_ON_DARK` lifts the
  black and grey marks on dark surfaces without touching the phone mockups.
- The hero download counter ignores the updater manifest (`desktop-updater-*`
  releases and any `latest.json`). The release workflow re-uploads that file with
  `--clobber`, which deletes the asset and resets its download count — that is
  why the published total went **down** after every release; update pings are not
  downloads of the product either way.

### Added

- DOM recreations of both apps in `src/components/mockups/`: the Uxnan Desktop
  window (one tab per running agent, project rail with its live agent view and
  nested subagents, a Claude Code terminal with session header and composer,
  Files / Changes / History / GitHub panel) and five Uxnan Mobile screens
  (conversation list, live conversation, agent picker, profile statistics,
  devices). Phone screens are drawn at one canonical size and scaled by the
  frame, so their proportions match the real app at any width.
- `src/lib/site.ts` as the single home for every factual claim, with the
  claim-to-source table in `docs/content.md`.
- Star and download counters in the hero, read from the GitHub API at build time
  and omitted when it cannot be reached (`src/lib/github.ts`).
- A count-down on the benchmark figures: each number falls from 999 the first
  time it scrolls into view, fading red → green → white as it lands, and
  server-renders at the real value for anyone without JavaScript.
- `/robots.txt` and `/sitemap.xml`, plus canonical and Open Graph URLs derived
  from `NEXT_PUBLIC_SITE_URL`. `llms.txt` was rewritten against this page and the
  seven active agents (it still advertised a `/download` route and Gemini CLI).
- Nav with X then GitHub buttons through the project's short links; footer with
  per-product link names, the project's disclaimer line, and Sponsor / Buy Me a
  Coffee as icon buttons.
- Component docs: `README.md`, `docs/develop.md`, `docs/content.md`,
  `docs/design.md` (the pre-existing `docs/deploy.md` is unchanged).
