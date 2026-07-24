# Build — the static export

![Output](https://img.shields.io/badge/output-static_export-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)

## What `npm run build` produces

```bash
cd web
npm run build
```

`next.config.ts` sets `output: "export"`, so the build writes a complete static
site to `web/out/` — HTML, CSS, JS and assets, with no Node.js server involved.
`trailingSlash: true` emits `out/<route>/index.html`, which any static host
resolves as a clean URL.

Because there is no server runtime, everything dynamic on the page happens in the
browser: OS detection, the GitHub Releases lookup, the star and download
counters, and the theme.

Two consequences worth remembering:

- **The Next.js image optimizer is off** (`images.unoptimized`). Every image on
  the site is a small SVG, so this costs nothing — but it does mean `next/image`
  would add markup for no benefit, which is why the ESLint rule that pushes you
  towards it is disabled with a comment in `eslint.config.mjs`.
- **No API routes, no middleware, no server actions.** If a future feature needs
  one, it needs a different hosting model first.

## Serving the export locally

```bash
npx serve out          # or: python -m http.server --directory out
```

This is the closest thing to what visitors get, and it is the right way to check
anything that behaves differently in a production build (no dev overlay, minified
bundles, real asset paths).

## Absolute URLs

`NEXT_PUBLIC_SITE_URL` is read at build time and becomes `metadataBase`, which is
what the Open Graph and canonical URLs resolve against. It falls back to a
placeholder, so social previews only point at the right host once the variable is
set in the hosting environment.

```bash
NEXT_PUBLIC_SITE_URL=https://uxnan.dev npm run build
```

## Bundle expectations

The page ships around **140 kB of first-load JavaScript** (gzipped, React
included). If a change pushes that meaningfully higher, it is worth asking
whether the feature earns it — on a site whose entire argument is that software
should be light, the bundle is part of the message.

Fonts are self-hosted through the `geist` package (`next/font`), so there is no
request to a font CDN and no layout shift on first paint.
