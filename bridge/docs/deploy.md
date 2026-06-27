# Bridge — packaging & deployment

![Install](https://img.shields.io/badge/install-npm_i_-g_uxnan--bridge-339933?style=for-the-badge&logo=npm&logoColor=white)
![Autostart](https://img.shields.io/badge/autostart-per_OS,_never_elevated-2ea44f?style=for-the-badge)

The bridge is software the **user installs on their PC**. The relay is a separate,
**optional / self-hosted** service (see
[`../../relay/docs/deploy.md`](../../relay/docs/deploy.md)).

## Run modes

- **LAN-direct (zero hosting):** if the phone and PC share a network, the phone
  connects directly to the bridge's LAN server — no relay to deploy. Simplest start.
- **Tailscale-direct (zero hosting, recommended off-LAN):** with both devices on
  the same tailnet, the bridge's `100.x` address is advertised in the pairing QR
  and the phone reaches it directly from anywhere — still no relay.
- **Self-hosted relay (optional):** only for off-LAN access without a mesh VPN. Set
  `relayEnabled: true` and point `relayUrl` at your own relay; the QR then carries
  it as a fallback after the direct `hosts`. Hosting options are in the relay
  deploy doc.

## Publishing the bridge (npm)

The three packages are publish-ready (`bin`, `files`, `engines`, `repository`,
`prepublishOnly: tsc`). Before `npm publish`:

1. **Resolve the `@uxnan/shared` dependency.** The workspace spec
   `"@uxnan/shared": "*"` does **not** resolve from the public registry. Either:
   - **Publish `@uxnan/shared` first**, then pin the bridge/relay dep to its real
     `^0.x` version; or
   - **Bundle** `@uxnan/shared` into the bridge build (one self-contained package,
     no separate publish to coordinate) — recommended for the simplest install.
2. Drop or pin the bridge's `"uxnan-relay": "*"` devDependency (only the e2e test
   uses it).
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
- **Relay autostart** (only relevant if you self-host the relay on the same PC;
  LAN-only needs no relay). See [`../FOR-DEV.md`](../FOR-DEV.md).
