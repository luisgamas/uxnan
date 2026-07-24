# FOR-DEV — uxnan-web

Open engineering work for the marketing site. Items are removed the moment they
are implemented **and** verified; the commit history is the record that they
happened.

## Status

**Built and verified locally; deploy pipeline wired, awaiting its first run.**
Build to Cloudflare Pages via GitHub Actions (`deploy-web.yml` → Direct Upload)
is in place; the `og.png` social card, `/sitemap.xml`, `/robots.txt`, per-page
canonicals, JSON-LD and `/llms.txt` are all configured. Publishing is blocked
only on the human's one-time Cloudflare setup (see `FOR-HUMAN.md`).

The site is now a **single-page funnel** (`/`) plus **`/download`**; the earlier
`/desktop` and `/mobile` product routes were removed along with their unused
sections and the `PageHero` / `DeepRow` / `ConnectionDiagram` helpers.

Done today:

- **Two pages** — home and `/download` — sharing one
  chrome (`SiteShell`), with the header rewriting in-page anchors to `/#id` when
  it is not on the home page.
- Home: hero (glyph field + scroll stage + OS-aware split download + macOS auth
  card), problem, two-product cards, enriched Desktop+Mobile mockup marquee,
  agents strip, FAQ, full-bleed CTA and revealing footer.
- **Interface recreations rebuilt from the apps' own components** — borderless
  project groups, two-line worktree rows with real git indicators, the agent view
  with sub-agents, a Files-first right panel with a git-coloured tree, and a
  faithful Claude Code transcript.
- One-click, OS-aware downloads against the GitHub Releases API (including macOS
  architecture), with a nightly fallback when stable has no build for a platform,
  and a permanent macOS "experimental" note.
- Live star and download counters.
- Light/dark theming with no flash on first paint, `prefers-reduced-motion`
  fallbacks throughout, and a no-JavaScript path that still renders everything.
- Responsive down to 390px: the pinned hero choreography is desktop-only, and
  phones get the same panels as a swipeable strip plus their own entrance and
  float animations.
- `npm run typecheck`, `npm run lint` and `npm run build` are green, and CI runs
  all three on Node 20 and 22.

## Pending

- [ ] **First live deploy.** The deploy pipeline is built (`deploy-web.yml` →
      Cloudflare Pages Direct Upload) and the build is green, but it has never
      run: it is blocked only on the human creating the `uxnan` Pages project and
      adding the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets (see
      `FOR-HUMAN.md`). Once those exist, push to `main` and confirm the run is
      green and `https://uxnan.pages.dev` serves the site.
- [ ] **PR preview deployments (optional).** `deploy-web.yml` only publishes
      production on push to `main`. A preview deploy per PR (`wrangler pages
      deploy … --branch=<pr>`) would give a shareable URL per change; skipped for
      now to keep the first setup simple and the token off every PR run.
- [ ] **Real screenshots alongside the recreations.** The DOM recreations are
      deliberately stylised. Once the desktop app's UI settles, consider a
      screenshot gallery section for people who want to see the genuine article.
- [ ] **Spanish version.** The rest of the ecosystem ships EN/ES; the site is
      English only. Adding `es` means extracting the copy from the section
      components into a dictionary and adding a locale switch — the structure
      already isolates the facts in `src/lib/site.ts`, but the prose is inline.
- [ ] **Automated tests.** There are none. The logic worth covering is small but
      real: `downloadOptionsFor` asset matching per platform and channel,
      `resolveBestDownload`'s channel fallback, `detectOs`, and the number
      formatters in `utils.ts`. A Vitest harness like the desktop app's would be
      the natural shape.
- [ ] **Hero collage between 1024px and 1280px.** The pinned window scrolls and
      widens there, but the surrounding panels are `xl`-only: at `lg` there is no
      room for a 56rem window plus four satellites without heavy overlap. Either
      shrink the window at `lg` and show two panels, or leave it as is
      deliberately.
- [ ] **Keep the recreations honest as the apps move.** The mockups now mirror
      real component structure (`ProjectCard`, `WorktreeRow`, `AgentRow`,
      `RightPanel`, `FileTreeRow`). When those change shape in `uxnandesktop/`,
      `web/src/components/mockups/` is the thing that silently goes stale.
- [ ] **Decide on link-rot protection.** The footer and FAQ deep-link into
      `main` on GitHub (`docs/*.md`). If those files move, the links break
      silently; a periodic link check in CI would catch it.
