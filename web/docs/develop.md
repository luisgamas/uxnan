# Develop, build and verify

## Run it

```bash
cd web
npm install
npm run dev        # http://localhost:3100
```

The page is one route. Editing a section under `src/components/sections/` hot
reloads; editing `globals.css` re-runs Tailwind.

## Build the artifact

```bash
npm run build      # static export → out/
npm run start      # serve out/ on 3100, exactly what a host would serve
```

`out/` is the whole deliverable: HTML, CSS, JS, fonts and SVGs, no server
runtime. **Verify against `npm run start`, not only the dev server** — the dev
server injects its own overlay and does not exercise the export.

> **Never run `next build` while `next dev` is running.** Both write to the same
> `.next/`, and a build landing under a live dev server corrupts it: every request
> then returns `500` (`__webpack_modules__[moduleId] is not a function`, or a
> missing module in the React Client Manifest) and it does not recover on its own.
> This has broken the review server twice. The fix is `rm -rf .next` and starting
> `npm run dev` again. On Windows, stopping the terminal job may leave the real
> server alive — find it with `Get-NetTCPConnection -LocalPort 3100 -State Listen`
> and stop that PID.
>
> A custom `distDir` does **not** solve it: with `output: "export"` that option
> also moves where the export lands, so `out/` — the thing the deploy uploads —
> would silently move with it.

**For review, serve the export instead of the dev server.** `npm run dev` is for
editing; when someone else is going to look at the page, build it and serve
`out/`. That is the artifact that gets deployed, it has no dev overlay, and it
cannot be corrupted by a concurrent build.

## The gates

Before calling a change done, all three must be clean:

```bash
npm run typecheck
npm run lint
npm run build
```

## Verifying visually

Type checking proves the page compiles, not that it looks right. For any visual
change, capture the page and actually look at it — at a desktop width **and** at
a phone width (390 px), because the mockups hide rails and columns below `lg`.

A headless capture that works on Windows without extra dependencies:

```bash
# 1. serve the built site
npm run build && npm run start

# 2. drive Edge over the DevTools protocol and screenshot the full page
#    (any CDP client works; the point is a real render, not a DOM dump)
```

Two traps worth knowing, both of which have produced a "passing" screenshot of a
broken page:

- **`--screenshot` on headless Edge/Chrome silently writes nothing** in recent
  versions. Capture through `Page.captureScreenshot` over CDP instead.
- **Scroll reveals never fire in a tall-viewport capture.** Sections use an
  `IntersectionObserver` (`src/components/reveal.tsx`); a capture that grows the
  viewport to the full document height leaves the last screenful unrevealed and
  therefore invisible. Force them before capturing:

  ```js
  document
    .querySelectorAll("[data-reveal]")
    .forEach((el) => el.setAttribute("data-reveal", "in"));
  ```

- **A dev-server capture taken mid-recompile renders unstyled HTML.** If a
  screenshot comes back as black-on-white text with giant SVGs, the CSS had not
  been served yet — re-capture, or capture the built site.

## Agent marks are synced, not stored

`public/agents/` is **git-ignored**. `scripts/sync-agent-marks.mjs` copies the
repository's `assets/agents/*.svg` into it before `dev` and `build`, so the site
and the root READMEs always render the same files. Change a mark once, in
`assets/agents/` — never in `public/`, that copy is overwritten on the next run.
A mark that is black or grey also needs its id in `INVERT_ON_DARK`
(`src/lib/site.ts`) to stay visible on the page's dark tiles.

## Adding a section

1. Add `src/components/sections/<name>.tsx`, exporting one component.
2. Put every factual claim in `src/lib/site.ts` first, and record where it came
   from in [`content.md`](content.md).
3. Wrap each block in `<Reveal>` so it fades in on scroll; give siblings a
   staggered `delay`.
4. Mount it in `src/app/page.tsx` — that file is the running order of the page
   and should stay readable at a glance.
