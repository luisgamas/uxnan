# uxnan-web — the marketing site

The public website for the [Uxnan](../README.md) ecosystem: what the two apps
are, the problem each one solves, and where to download them.

![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![License](https://img.shields.io/badge/LICENSE-MPL--2.0-2ea44f?style=for-the-badge)

> **Status:** built and verified locally; the deploy pipeline (GitHub Actions →
> Cloudflare Pages, target `https://uxnan.pages.dev`) is wired but has not run
> yet — it is waiting on the one-time Cloudflare setup in
> [`FOR-HUMAN.md`](FOR-HUMAN.md). Remaining engineering work is in
> [`FOR-DEV.md`](FOR-DEV.md).

## What it is

Two static routes (`/` and `/download/`), exported ahead of time and served as
plain files. There is no server, no database and no analytics: every dynamic
thing on them happens in the visitor's browser.

| Route | What it carries |
|---|---|
| `/` | Decision funnel, six sections plus the hero: hero (scroll mockups + OS-aware download + a proof strip), the problem, two apps, three real screen-recorded clips ("See it work"), the agent strip, FAQ, CTA |
| `/download/` | Desktop installers (Windows / Linux / macOS × stable+nightly), Mobile + bridge |

> **Two products, never one.** Uxnan Desktop and Uxnan Mobile share an ecosystem
> and a bridge, and nothing else: each is useful with the other uninstalled. The
> copy on this site names them separately and promises them separately, and a
> change that blurs that is a regression, not a simplification.

- **OS-aware downloads.** The primary button detects the visitor's OS — including
  which macOS architecture — resolves the matching installer from GitHub Releases
  and links straight at it. When that OS has several formats (e.g. `.exe` / `.msi`),
  a chevron opens the rest. Stable is preferred with nightly fallback; GitHub
  rate-limits fall back to the Releases page. On macOS, the experimental
  authorisation card appears under the hero download and again as a dialog after
  any macOS installer click.
- **Live repository counters.** Stars and the summed download count of every
  release asset, read from the public API at page load.
- **Interface recreations, not screenshots.** The three-panel ADE, the project
  sidebar, the agent view with its sub-agents, the Files tree, a Claude Code
  transcript, the pull-request panel and two phone screens are all real DOM —
  sharp at any resolution, theme-aware, and animatable from the scroll position.
  They are built from the apps' own component structure; see
  [`docs/content.md`](./docs/content.md) for what that commits us to.
- **Three real clips, not more mockups.** "See it work" plays three short,
  silent screen recordings of the actual app (`public/videos/*.mp4`) — lazy,
  muted, looping, paused under `prefers-reduced-motion` — instead of stretching
  the DOM-recreation approach to cover every feature.
- **A hero that reacts.** A canvas glyph field whose columns run shallow across
  the middle and deep at the edges, tinting towards the accent and receding
  around the pointer; a scroll-driven stage where the app window rises and
  widens while the surrounding panels fly in; and a proof strip underneath the
  call to action (measured RAM, the test count, the licence, the agent count),
  each fact linking to the page that backs it.

Everything degrades: with scripting off the whole page still renders and reads,
and `prefers-reduced-motion` drops the pinned choreography for a plain stacked
layout.

## Docs

Task-focused guides live in [`docs/`](./docs/):
[development & running locally](./docs/development.md) ·
[building the static export](./docs/build.md) ·
[deploying to Cloudflare Pages](./docs/deploy.md) ·
[testing & verification](./docs/testing.md) ·
[how the copy stays true](./docs/content.md).

## Layout

```
web/
├── docs/                     # Task-focused docs (develop, build, deploy, test, content)
├── public/
│   ├── agents/               # Agent CLI marks, copied from the apps' own assets
│   ├── logo.svg              # Brand mark
│   ├── og.png                # 1200×630 social preview card
│   ├── llms.txt              # Hand-written summary for AI crawlers
│   └── _headers              # Cloudflare Pages caching + security headers
├── src/
│   ├── app/
│   │   ├── globals.css       # Design tokens, scroll-stage + footer-reveal choreography
│   │   ├── layout.tsx        # Metadata, JSON-LD, fonts, pre-paint theme script
│   │   ├── page.tsx          # Home funnel (server component + canonical)
│   │   ├── download/         # /download (server metadata + client UI)
│   │   ├── sitemap.ts        # /sitemap.xml, built from site.ts ROUTES
│   │   └── robots.ts         # /robots.txt
│   ├── components/
│   │   ├── hero/             # Hero copy, scroll stage, canvas glyph field
│   │   ├── mockups/          # DOM recreations of the app surfaces
│   │   ├── sections/         # Problem, two apps, agents, features, FAQ, CTA
│   │   ├── site/             # Header, footer, download button, GitHub stats, theme toggle
│   │   └── ui/               # Button primitives
│   └── lib/
│       ├── site.ts           # Every factual claim + SITE_URL + ROUTES, in one file
│       ├── releases.ts       # OS detection + GitHub Releases resolution
│       ├── hooks.ts          # Scroll progress, reveal observer, theme
│       └── utils.ts          # cn(), number/byte formatting, easing
├── next.config.ts            # `output: "export"` — a static build in `out/`
└── package.json
```

## Develop

Prereqs: Node ≥ 18.18. This package uses **npm** and is deliberately **not** part
of the root workspaces, so install from inside `web/`.

```bash
cd web
npm install
npm run dev          # http://localhost:3000
npm run check        # typecheck + lint (the CI gate)
npm run build        # static export → out/
```

See [`docs/development.md`](./docs/development.md) for the iteration loop and
[`docs/testing.md`](./docs/testing.md) for how to verify a change before opening
a PR.

## Conventions

- **One source of truth for facts.** Every number, agent list, command and link
  the page states lives in [`src/lib/site.ts`](src/lib/site.ts). Nothing factual
  is typed inline in a component — see [`docs/content.md`](./docs/content.md).
- **Design tokens over ad-hoc values.** Colours, radii and surfaces come from the
  CSS variables in `globals.css`; the palette mirrors the desktop app's, with a
  single accent hue.
- **Spacing is generous on purpose.** 17px body copy, 48px default controls,
  `.section` for vertical rhythm and `.shell` for the page gutter. Nothing on
  this site should read as cramped.
- **Animation is CSS, driven by one variable.** Scroll handlers write a progress
  value into a custom property; the movement is expressed in `calc()` so React
  never re-renders on a scroll frame.
- Commits: Conventional Commits with the `web` scope (`feat(web): …`).
