# FOR-HUMAN — uxnan-web

Assets and account-level setup that only a human can provide. The site builds and
runs without every item here; the only thing that genuinely needs a human is the
Cloudflare account setup, because it involves credentials.

## Open items

- [ ] **Cloudflare Pages project + two GitHub secrets** (enables the deploy)
  - **What:** a Cloudflare Pages **Direct Upload** project named `uxnan`
    (production branch `main`), so the site answers on
    `https://uxnan.pages.dev`; plus the credentials the deploy workflow needs.
  - **Where:** the Cloudflare dashboard (the project) and **GitHub → repo →
    Settings → Secrets and variables → Actions** (the secrets). Nothing to commit.
  - **Config:** add two repository secrets —
    - `CLOUDFLARE_API_TOKEN` — a token with the **Cloudflare Pages — Edit**
      permission.
    - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id.

    Then a push to `main` touching `web/**` runs `deploy-web.yml` and publishes.
    Step-by-step (project creation, where to find the token and id) is in
    [`docs/deploy.md`](docs/deploy.md).
  - **Optional, later:** for a custom domain, add it in the Pages project and set
    a repository **variable** `NEXT_PUBLIC_SITE_URL` to the final origin (e.g.
    `https://uxnan.dev`); until then everything resolves to the `.pages.dev`
    subdomain.
