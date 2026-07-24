# Development — running the site locally

![Node](https://img.shields.io/badge/Node-%E2%89%A518.18-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)

## Install

`web/` is a **standalone npm package**. It is deliberately not listed in the root
`package.json` `workspaces` array — the site has nothing to share with the
bridge, relay and shared contracts, and keeping it out means a root `npm install`
never has to resolve React. Install from inside the directory:

```bash
cd web
npm install
```

## Run

```bash
npm run dev            # http://localhost:3000
npm run dev -- -p 4321 # a different port
```

Hot reload covers everything, including `globals.css`. Two things are worth
knowing while you iterate:

- **The theme is applied before React runs.** An inline script in
  `src/app/layout.tsx` stamps `js` and (when stored) `dark` onto `<html>`, which
  is why that element carries `suppressHydrationWarning`. If you change that
  script, re-check the console for a hydration mismatch.
- **The hero choreography is desktop-only.** Below 1024px the stage is a normal
  stacked layout. Resize past that breakpoint to exercise the pinned version.

## The scroll stage

The hero is one tall section (`300vh` on desktop) whose inner container is
`sticky`. `useScrollProgress` writes the section's progress into a `--p` custom
property, and `globals.css` derives everything else from it:

| Variable | Range | Drives |
|---|---|---|
| `--fade` | `--p` 0 → 0.20 | headline, sub-copy and buttons clearing out |
| `--lift` | `--p` 0 → 0.46 | the window rising from the fold and widening |
| `--wings` | `--p` 0.34 → 0.76 | the surrounding panels flying in |

To design a specific moment, temporarily pin it: put
`style={{ "--p": 0.6 } as React.CSSProperties}` on the `<section className="stage">`
in `src/components/hero/hero.tsx` and pass a dummy variable name to
`useScrollProgress("--unused")` so the scroll handler stops overwriting it.
Remove both before committing.

Each satellite reads two more variables from its own inline style: `--d` (its
arrival delay, 0 = first) and `--fx` / `--fy` (the offset it travels from).

## The glyph field

`src/components/hero/glyph-field.tsx` is a plain 2D canvas — no WebGL, no shader
pipeline. The knobs worth touching:

| Constant | Effect |
|---|---|
| `CELL_W` / `CELL_H` / `FONT_PX` | glyph grid density |
| `POINTER_RADIUS` | how wide the blue hole around the cursor is |
| `FRAME_MS` | repaint cadence (30 fps by default) |
| the `depth` formula in `build()` | the silhouette — how deep the columns run at the centre versus the edges |

It idles completely when scrolled out of view (an `IntersectionObserver`) and
never starts at all under `prefers-reduced-motion`.

## Checking a change

```bash
npm run check          # typecheck + lint — the same gate CI runs
```

Type checking and linting do not prove the page *looks* right. See
[`testing.md`](testing.md) for the visual pass.

## Editing the copy

Facts — agent counts, RAM figures, commands, links — live in `src/lib/site.ts`,
never inline in a component. Read [`content.md`](content.md) before changing any
sentence that states a number or a capability.
