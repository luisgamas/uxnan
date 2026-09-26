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
desktop-and-phone chats → mobile → measured footprint → open source → call to
action. It is a Next.js 15
static export (React 19, Tailwind v4, Hugeicons), self-hosting Geist and
JetBrains Mono through `next/font`.

What works today:

- **DOM recreations of both apps**, held to the shipped UI: the Uxnan Desktop
  window (one tab per open chat or agent terminal, the sidebar with the paired
  phone and the open worktree's agent view, a chat streaming its steps with the
  composer, the right dock on its Files surface, the status bar) and five Uxnan
  Mobile screens (conversation list linked with the desktop, the desktop's chat
  live with its work log, a finished answer, agent picker, the home screen
  with your paired PCs). Phone screens are drawn once at a canonical 260 × 563 and
  scaled by the frame, so proportions stay real at any size.
- **Every static claim sourced** through `src/lib/site.ts`, with the
  claim-to-source table in `docs/content.md`; moving repository counters come
  from the documented GitHub-backed Pages Function.
- **Star and download counters** render a build-time fallback and refresh through
  the cached `functions/api/stats.ts` endpoint, counting installer assets across
  all paginated releases so the total cannot go down because of updater assets.
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
