# FOR-DEV — uxnan-web

Open engineering work for the marketing site. Items are removed the moment they
are implemented **and** verified; the commit history is the record that they
happened.

> **`## Status` below is this component's canonical implementation status** — the
> root `AGENTS.md` points here instead of keeping its own inventory.

## Status

**Rebuilt as a single-page site (v2), replacing the version currently published.**
The Cloudflare Pages project, its secrets and the deploy workflow are all live —
the previous site is what `uxnan.pages.dev` serves until this lands on `main`.

The site is one route (`/`) that runs hero → agents → parallel worktrees →
mobile → measured footprint → open source → call to action. It is a Next.js 15
static export (React 19, Tailwind v4, `lucide-react`), self-hosting Geist and
JetBrains Mono through `next/font`.

What works today:

- **DOM recreations of both apps**, held to the shipped UI: the Uxnan Desktop
  window (one tab per running agent, the project rail with its live agent view
  and nested subagents, a Claude Code terminal with its session header and
  composer, and the Files / Changes / History / GitHub panel) and five Uxnan
  Mobile screens (conversation list, live conversation, agent picker, profile
  statistics, devices). Phone screens are drawn once at a canonical 260 × 563 and
  scaled by the frame, so proportions stay real at any size.
- **Every claim sourced** through `src/lib/site.ts`, with the claim-to-source
  table in `docs/content.md`.
- **Star and download counters** read from the GitHub API at build time, counting
  installer assets only so the total cannot go down (see `src/lib/github.ts`).
- **Agent marks are the repository's own SVGs**, synced from `assets/agents/`
  before dev and build so the site and the READMEs never diverge.
- Benchmark figures count down from 999 on first scroll, fading red → green →
  white as they land, and server-render at the real number.
- SEO wiring carried over: `metadataBase` / canonical from
  `NEXT_PUBLIC_SITE_URL`, `/robots.txt`, `/sitemap.xml`, the `og.png` social
  card, `llms.txt` and the Cloudflare `_headers` file.
- `npm run typecheck`, `npm run lint` and `npm run build` are green, and CI runs
  all three on Node 20 and 22.

## Pending

- [ ] **Spanish version.** The rest of the ecosystem ships EN/ES; the site is
      English only. The facts are already isolated in `src/lib/site.ts`, but the
      prose is inline in the section components.
- [ ] **Automated tests.** There are none. The logic worth covering is small but
      real: the download total's exclusion rules and `formatCount` in
      `src/lib/github.ts`, and `detect()` in `download-button.tsx`.
- [ ] **Keep the recreations honest as the apps move.** `src/components/mockups/`
      mirrors real UI: when the desktop shell or the mobile screens change shape,
      those files are what silently goes stale.
- [ ] **Decide on link-rot protection.** The footer and the copy deep-link into
      `main` on GitHub (`docs/*.md`). If those files move the links break
      silently; a periodic link check in CI would catch it.
