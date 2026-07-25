# Testing & verification

![Gate](https://img.shields.io/badge/gate-typecheck_%2B_lint_%2B_build-2ea44f?style=for-the-badge)

## The automated gate

```bash
cd web
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (next/core-web-vitals + next/typescript)
npm run build          # the static export must succeed
```

`npm run check` runs the first two together. CI
([`verify-web.yml`](../../.github/workflows/verify-web.yml)) runs all three on
Node 20 and 22 and asserts that `out/index.html` exists.

There is **no unit-test suite yet** — see [`../FOR-DEV.md`](../FOR-DEV.md) for
what is worth covering first (`downloadOptionsFor`, `detectOs`, the formatters).

## The visual pass — required

A green typecheck says the code compiles, not that the page is right. This site
is almost entirely layout, motion and copy, so **every change needs eyes on the
rendered result** before it is called done.

```bash
npm run dev
```

Then walk the page and check:

- **The hero, scrolled slowly.** The headline clears out before the window
  arrives; the window rises and widens; the four panels fly in without colliding
  with it or leaving the viewport.
- **The glyph field.** Columns stay shallow across the middle and reach deeper at
  the edges, so the headline always sits on quiet canvas. Move the pointer
  through it — glyphs should tint towards blue and thin out around the cursor.
- **Both themes.** Toggle in the header. Watch for anything that only reads in
  light: hairlines, the mockup placeholder bars, the agent marks.
- **Narrow widths.** 390px and 768px. Below 1024px the hero must *not* pin, the
  satellites must not render, and the footer must be a normal block.
- **Reduced motion.** In Chrome/Edge DevTools: *Rendering → Emulate CSS
  prefers-reduced-motion*. The hero should fall back to a plain stacked layout
  with the window under the headline, and nothing should animate.
- **The download button.** It should name your OS and a real file. Open the
  chevron: both channels resolve, every platform is listed, and macOS shows the
  Gatekeeper note with a working copy button.

### Scripting off

The page must still render completely with JavaScript disabled — the reveal
animations are gated on a `js` class exactly so that nothing starts invisible.
DevTools → *Command palette → Disable JavaScript*, then reload.

### Headless screenshots

For a quick regression sweep across viewports and both themes, drive a headless
browser rather than resizing by hand:

```bash
msedge --headless=new --disable-gpu --hide-scrollbars \
       --window-size=1440,900 --virtual-time-budget=8000 \
       --screenshot=hero.png http://localhost:3000/
```

Note that CSS animations do not advance under `--virtual-time-budget`, so
reveal-animated elements can be captured mid-fade. Add
`--run-all-compositor-stages-before-draw`, or emulate reduced motion with
`--force-prefers-reduced-motion`, to get a settled frame.

## Before opening a PR

- [ ] `npm run check` and `npm run build` are green.
- [ ] The change was looked at in the browser, in both themes, at a narrow and a
      wide width.
- [ ] Any factual claim you added or edited was re-derived from the repository —
      see [`content.md`](content.md).
- [ ] `CHANGELOG.md` has an entry, and `FOR-DEV.md` / `FOR-HUMAN.md` were updated
      if the change opened or closed an item.
