# Deploy — Cloudflare Pages via GitHub Actions

![Host](https://img.shields.io/badge/Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![CI](https://img.shields.io/badge/build-GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)

The site is built on **GitHub's runners** and the finished static export is
uploaded to **Cloudflare Pages** as a *Direct Upload*. Cloudflare only serves the
files; it never runs a build of its own.

> **Why this way, not Cloudflare's own Git build?** Both are free. Building in
> GitHub Actions keeps the quality gate and the publish in one place — the exact
> commit is typechecked, linted and built, and only a green build is uploaded —
> and it burns the repo's free Actions minutes rather than Cloudflare's build
> quota. If you ever prefer Cloudflare's built-in Git integration instead, delete
> `deploy-web.yml` and connect the repo in the Pages dashboard with the settings
> in the "Alternative" section at the bottom.

## How it works

Two workflows, mirroring the rest of the monorepo's "verify → act" pattern:

| Workflow | Trigger | Does |
|---|---|---|
| [`ci-web.yml`](../../.github/workflows/ci-web.yml) | pull requests touching `web/**` | typecheck · lint · build (the merge gate) |
| [`deploy-web.yml`](../../.github/workflows/deploy-web.yml) | push to `main` touching `web/**`, or manual | re-runs the same verify, then uploads `web/out` to Cloudflare |

`deploy-web.yml` calls the reusable [`verify-web.yml`](../../.github/workflows/verify-web.yml)
first and deploys only if it passes, so a broken build never reaches production.

## One-time setup

Do this once; after that every push to `main` deploys automatically.

### 1. Create the Cloudflare Pages project

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Upload assets**
(the *Direct Upload* path, **not** "Connect to Git").

- **Project name:** `uxnan` — this is what makes the site answer on
  **`https://uxnan.pages.dev`**. (The workflow passes `--project-name=uxnan`; if
  you name it something else, change that flag too.)
- **Production branch:** `main`.

You can create it empty — you do not need to upload anything by hand; the first
workflow run fills it.

### 2. Get an API token

**My Profile → API Tokens → Create Token → Cloudflare Pages: Edit** (the template
called *"Edit Cloudflare Pages"*). It only needs that one permission. Copy the
token — it is shown once.

### 3. Get the account id

On the Cloudflare dashboard home, the **Account ID** is in the URL
(`dash.cloudflare.com/<account-id>`) and in the right-hand sidebar of any
Workers & Pages page.

### 4. Add the two repository secrets

**GitHub → the repo → Settings → Secrets and variables → Actions → New repository
secret:**

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the id from step 3 |

That is everything. No key, database, or third service is involved.

### 5. (Optional, later) a custom domain

Add the domain in the Pages project's **Custom domains** tab, then add a
**repository variable** (not a secret) `NEXT_PUBLIC_SITE_URL` set to the final
origin (e.g. `https://uxnan.dev`). The build reads it so the Open Graph and
canonical URLs point at the real host; until it is set, everything resolves to
`https://uxnan.pages.dev`.

## What happens on a push

1. `deploy-web.yml` fires for a push to `main` that touched `web/**`.
2. It typechecks, lints and builds the export (`npm run build` → `web/out`), with
   `NEXT_PUBLIC_SITE_URL` baked in.
3. `cloudflare/wrangler-action` runs `wrangler pages deploy web/out
   --project-name=uxnan --branch=main`, which uploads the files and, because
   `main` is the production branch, promotes them to production.
4. The Actions run's *production* environment links straight to the live URL.

Trigger it by hand any time from **Actions → Deploy — Web (Cloudflare Pages) → Run
workflow**.

## Response headers

[`public/_headers`](../public/_headers) ships with the export and Cloudflare
applies it: long-lived immutable caching for `/_next/static/*`, a day for
`og.png`, and a few conservative security headers. There is deliberately **no**
`Content-Security-Policy` — the pre-paint theme script in `layout.tsx` is inline,
and a strict `script-src` would block it and reintroduce the theme flash.

## Verifying a deploy

On the live URL, check the things that behave differently from `localhost`:

- The **download button** resolves a real installer (it calls the GitHub API from
  the browser; anonymous callers share 60 requests/hour/IP).
- The header **star and download counters** appear.
- A shared link unfurls with the title, description **and the `og.png` image**.
- `https://uxnan.pages.dev/download/` loads directly (clean URLs come from
  `trailingSlash: true`), and `/sitemap.xml`, `/robots.txt` and `/llms.txt` all
  return their content.

## Search Console & discoverability

The site ships everything a crawler needs; the only human step is telling Google
it exists.

- **Sitemap & robots.** `/sitemap.xml` (built from the route list in `site.ts`)
  and `/robots.txt` (allows everything, points at the sitemap) are generated at
  build time. Submit `https://uxnan.pages.dev/sitemap.xml` in **Google Search
  Console → Sitemaps** once the property is verified.
- **Verifying the property.** The site lives on a `*.pages.dev` subdomain, which
  you do not own the DNS zone for — so the **DNS / Domain-property method is not
  available**. Add a **URL-prefix property** for `https://uxnan.pages.dev/` and
  use the **HTML-tag** method: copy the token from the `content="…"` value Search
  Console shows, then add it as a repository **variable**
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` (Settings → Secrets and variables →
  Actions → **Variables**). The deploy build injects it as a
  `<meta name="google-site-verification">` tag — so the token stays out of this
  public repo's source and only appears in the built HTML, which is public by
  design. Trigger a deploy (push to `web/**` or *Run workflow*), then click
  **Verify**. Do **not** commit Google's HTML verification *file* — the variable
  keeps the repo clean and achieves the same thing. (The token is not a secret:
  it cannot be used to claim your property from any other domain.)
- **Canonicals & structured data.** Each route is a server component that exports
  its own canonical URL; the home page also carries schema.org JSON-LD describing
  Uxnan and both apps, so a result can be built without scraping prose.
- **For AI crawlers.** `/llms.txt` (`public/llms.txt`) is a short, hand-written
  summary of what Uxnan is and where its docs are — the emerging convention for
  making a site legible to LLMs. Keep it current when the pitch changes.

## Alternative — Cloudflare's built-in Git build

If you would rather let Cloudflare build from Git (no Actions minutes, no
secrets), delete `deploy-web.yml`, connect the repo in the Pages dashboard, and
use: **root directory** `web`, **build command** `npm run build`, **output
directory** `out`, and set `NEXT_PUBLIC_SITE_URL` as a Pages environment variable.
Everything else in the project stays the same — nothing in the code is tied to
either host.
