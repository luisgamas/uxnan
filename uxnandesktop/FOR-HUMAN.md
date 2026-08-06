# FOR-HUMAN — uxnan-desktop

Assets and credentials that **only a human can provide**. The app must always
build and run without them (graceful degradation); a missing asset may downgrade
a feature but must never break startup or the build. Never commit real secrets —
only this checklist and the inline `FOR-HUMAN:` markers describing what's needed.

(Distinct from [`FOR-DEV.md`](FOR-DEV.md), which tracks deferred *code* work.)

## Open items

_Nothing open._ Agent marks are **favicon-first by design**: a catalog entry
carries a `favicon` domain, the backend fetches it once per app run and inlines
it, and only four flagship marks ship as assets (`claudecode`, `codex`,
`openclaude`, `zero`). Adding an SVG for the rest is deliberately **not** wanted
— see [`docs/agent-launch.md`](docs/agent-launch.md).

## Needed for distributable / signed release builds

> The CI/CD pipeline (see `FOR-DEV.md → "CI/CD — release builds"`) can produce
> **unsigned** artifacts without these (degraded: OS "unknown publisher"
> warnings). They're required for a clean, signed, auto-updating release. Supply
> each as a **GitHub Actions repository secret** consumed by `release-desktop.yml`.

- [ ] **Code-signing identities (OS — paid, OPTIONAL)** (release) — to remove the OS
      "unidentified developer" / SmartScreen warnings on distributed builds. Supply
      each as a GitHub Actions secret consumed by `release-desktop.yml`:
      - **Windows** — code-signing cert (SignTool / `WINDOWS_CERTIFICATE` + password).
      - **macOS** — Apple Developer ID + notarization (`APPLE_CERTIFICATE`, `APPLE_ID`,
        team id, app-specific password). **Not required to ship macOS today:** CI
        already produces an **experimental, ad-hoc-signed** build (no Apple account
        needed), which users authorize by hand (see `docs/install-macos.md`); this
        cert is the *optional* upgrade to a warning-free, notarized install.
      - **Linux** — optional GPG for `.deb`/`.rpm` (spec §5.1).

      **Unrelated to the updater key** (free, already configured). The
      creation / rotation / storage procedure for both kinds of secret — and
      why none of them ever enters the repo — is documented in
      `docs/updates.md` → *Keys & certificates*. When a certificate lands,
      record its fingerprint/expiry in the platform matrix's `signing` block
      (`tests/platform-support.json`) — announcing `signed` without it fails
      the suite and the release gate.

## Deferred until later phases (no action needed yet)

- [ ] **Relay URL / self-hosted relay** (Phase 6) — for off-LAN mobile
      connectivity through the embedded bridge. LAN/Tailscale-direct needs none.

- [ ] **GitHub OAuth App `client_id`** (only for the *native* GitHub sign-in follow-up
      — `FOR-DEV.md → "GitHub integration — follow-ups"`). **Not needed today:** the
      shipped GitHub integration signs in through the local **`gh` CLI**, so it needs no
      app registration. It becomes relevant only if we add the OAuth **device-flow**
      login (to work without `gh` installed).
      - **What/Where:** register a **GitHub OAuth App** (Settings → Developer settings →
        OAuth Apps), tick **"Enable Device Flow"**, and provide its **public**
        `client_id` (a device-flow app needs **no client secret**). It would be wired
        into the (future) native auth path, not into any file today.
      - **Config:** none until the native-auth follow-up lands.
