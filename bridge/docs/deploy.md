# Bridge — packaging & deployment

![Install](https://img.shields.io/badge/install-npm_i_-g_uxnan--bridge-339933?style=for-the-badge&logo=npm&logoColor=white)
![Autostart](https://img.shields.io/badge/autostart-per_OS,_never_elevated-2ea44f?style=for-the-badge)

The bridge is software the **user installs on their PC**. The relay is
optional and is **deployed by the bridge** into the user's own Cloudflare
account (see [`../../relay/docs/deploy.md`](../../relay/docs/deploy.md)); its
Worker bundle ships inside the bridge package (`dist/relay-worker/`).

## Run modes

- **LAN-direct (zero hosting):** if the phone and PC share a network, the phone
  connects directly to the bridge's LAN server — no relay to deploy. Simplest start.
- **Tailscale-direct (zero hosting, recommended off-LAN):** with both devices on
  the same tailnet, the bridge's `100.x` address is advertised in the pairing QR
  and the phone reaches it directly from anywhere — still no relay.
- **Your own relay (optional):** only for off-LAN access without a mesh VPN.
  `uxnan-bridge relay setup --account <id>` deploys it into your Cloudflare
  account and enables it; the QR then carries it after the direct `hosts`, and
  paired phones learn it through the shared settings. See
  [`connectivity.md`](./connectivity.md#3-your-own-relay).

## Publishing the bridge (npm)

Two packages are published — `@uxnan/shared` and `uxnan-bridge` (`bin`,
`files`, `engines`, `repository`, `prepublishOnly`); `uxnan-relay` is private.
Before `npm publish`:

1. **Resolve the `@uxnan/shared` dependency.** The workspace spec
   `"@uxnan/shared": "*"` does **not** resolve from the public registry. Either:
   - **Publish `@uxnan/shared` first**, then pin the bridge dep to its real
     `^0.x` version; or
   - **Bundle** `@uxnan/shared` into the bridge build (one self-contained package,
     no separate publish to coordinate) — recommended for the simplest install.
2. Build the relay first (`npm run build -w uxnan-relay`; the root `npm run build`
   does it): the bridge's build copies its Worker bundle and version into
   `dist/relay-worker/` (`tools/copy-relay-worker.mjs`), which the package
   `files` include. `uxnan-relay` stays a devDependency — the published bridge
   carries the bundle, not the package.
3. Verify a packed install end-to-end: `npm pack` the package, then
   `npm install -g ./uxnan-bridge-*.tgz` and run `uxnan-bridge qr`.
4. Confirm `scripts/*.sh` keep their executable bit in the packed tarball.

Then end users run `npm install -g uxnan-bridge` → `uxnan-bridge start` /
`uxnan-bridge install-service`.

## Autostart

`uxnan-bridge install-service` registers logon autostart per platform (see
[`installation.md`](./installation.md)). Pairs well with a global install.

## Deferred / FOR-DEV

- A **single binary** (Node SEA / `pkg`) so users don't need Node installed.
- Nothing for the relay: it runs in Cloudflare, and the bridge reconnects to it
  on every start.
