# web — the Uxnan marketing site

A single-page, static marketing site for Uxnan: what the two apps are, who they
are for, and where to get them. It is written to **convince**, not to document —
the technical detail lives in each component's `README.md` and `docs/`.

> Deployed by `deploy-web.yml` on every push to `main` that touches `web/**`:
> GitHub's runners build the static export and upload it, together with the
> `functions/` Pages Function, to Cloudflare Pages as a Direct Upload. See
> [`docs/deploy.md`](docs/deploy.md).

## What it is

- **One page.** Hero → agents → parallel worktrees → mobile → footprint → open
  source → download. No sub-pages, no docs site, no blog.
- **Mockups, never screenshots.** Both apps are recreated in the DOM
  (`src/components/mockups/`), so they follow the page's theme, stay sharp at any
  resolution, cost a few kB instead of a few MB, and never go stale in the way a
  screenshot of an old build does. They are held to the real UI — see
  [`docs/design.md`](docs/design.md).
- **Every static claim is sourced.** Agent lists, commands and links live in
  [`src/lib/site.ts`](src/lib/site.ts), each with the file it came from; the
  live star/download counters come from GitHub through `/api/stats`.
  [`docs/content.md`](docs/content.md) is the claim-to-source table.

## Stack

Next.js 15 (App Router) with `output: "export"` for the page shell, plus one
Cloudflare Pages Function for the live public repository counters. React 19,
TypeScript, Tailwind CSS v4, Hugeicons for icons — the same set the desktop app
draws (see [`docs/design.md`](docs/design.md)) — Geist + JetBrains Mono
self-hosted through `next/font`. No analytics or third-party scripts; the only
runtime data request is the same-origin `/api/stats` endpoint. Agent marks are
the repository's own SVGs (see [`docs/design.md`](docs/design.md)).

It is a **standalone npm package** — deliberately not part of the root
`workspaces`. Install and run everything from inside `web/`.

## Getting started

```bash
cd web
npm install
npm run dev          # http://localhost:3100
```

| Command | What it does |
|---|---|
| `npm run dev` | dev server on port 3100 |
| _(`predev` / `prebuild`)_ | `scripts/sync-agent-marks.mjs` copies `assets/agents/*.{svg,png}` into `public/agents/`; runs automatically |
| `npm run build` | static export into `out/` |
| `npm run start` | serve the built `out/` on port 3100 |
| `npm run lint` | ESLint (`next/core-web-vitals` + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |

## Structure

```
functions/
└── api/stats.ts         cached GitHub metrics endpoint
src/
├── app/
│   ├── layout.tsx       fonts, metadata, <html>
│   ├── page.tsx         the section order, and nothing else
│   └── globals.css      design tokens, base styles, keyframes
├── components/
│   ├── repo-stats.tsx   live star/download counter
│   ├── mockups/         desktop.tsx · phone.tsx — the DOM recreations
│   ├── sections/        one file per band of the page
│   ├── nav.tsx  reveal.tsx  download-button.tsx
└── lib/site.ts          every static fact the page states
```

## Docs

- [`docs/develop.md`](docs/develop.md) — running it, the verification gates, and
  how to screenshot a change before asking for review.
- [`docs/content.md`](docs/content.md) — the claim-to-source table. Read this
  before changing a number.
- [`docs/design.md`](docs/design.md) — palette, type, motion, and the rules the
  mockups must follow to stay faithful to the apps.
- [`docs/deploy.md`](docs/deploy.md) — the Cloudflare Pages pipeline, its
  one-time setup and how to point it at a custom domain.
