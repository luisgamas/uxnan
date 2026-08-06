# FOR-HUMAN — uxnan-web

Assets and account-level setup that only a human can provide.

## Open items

None. The Cloudflare Pages project (`uxnan`, Direct Upload, production branch
`main`) exists, the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets are
set, and the site is published — `deploy-web.yml` runs on every push to `main`
that touches `web/**`. The pipeline and its one-time setup are documented in
[`docs/deploy.md`](docs/deploy.md).

Optional, whenever you want it: for a custom domain, add it in the Pages project
and set the repository **variable** `NEXT_PUBLIC_SITE_URL` to the final origin
(e.g. `https://uxnan.dev`). Until then the canonical URL, the sitemap and the
Open Graph tags all resolve to the `.pages.dev` subdomain.
