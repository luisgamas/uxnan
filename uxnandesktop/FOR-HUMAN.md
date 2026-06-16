# FOR-HUMAN — uxnan-desktop

Assets and credentials that **only a human can provide**. The app must always
build and run without them (graceful degradation); a missing asset may downgrade
a feature but must never break startup or the build. Never commit real secrets —
only this checklist and the inline `FOR-HUMAN:` markers describing what's needed.

(Distinct from [`FOR-DEV.md`](FOR-DEV.md), which tracks deferred *code* work.)

## Open items

- [ ] **Branded app icons** — the scaffold ships Tauri's default placeholder
      icons.
      - **What:** the Uxnan Desktop icon set (PNG + `.ico` + `.icns`).
      - **Where:** `src-tauri/icons/` (overwrite `32x32.png`, `128x128.png`,
        `128x128@2x.png`, `icon.ico`, `icon.icns`, and the `Square*Logo.png` /
        `StoreLogo.png` set).
      - **Config:** generate with `npm run tauri icon path/to/source.png` (1024²
        source recommended); paths are already referenced in
        `src-tauri/tauri.conf.json → bundle.icon`. None beyond that.

## Needed for distributable / signed release builds

> The CI/CD pipeline (see `FOR-DEV.md → "CI/CD — release builds"`) can produce
> **unsigned** artifacts without these (degraded: OS "unknown publisher"
> warnings). They're required for a clean, signed, auto-updating release. Supply
> each as a **GitHub Actions repository secret** consumed by `release.yml`.

- [ ] **Code-signing identities** (release) — Windows code-signing cert
      (SignTool / `WINDOWS_CERTIFICATE` + password), Apple Developer ID +
      notarization (`APPLE_CERTIFICATE`, `APPLE_ID`, team id, app-specific
      password), optional GPG for Linux packages (spec §5.1).
- [ ] **Auto-updater key + endpoint** (release) — `TAURI_SIGNING_PRIVATE_KEY`
      (+ password) as a secret; `pubkey` and `endpoints` for
      `tauri-plugin-updater` in `tauri.conf.json` (spec §5.2). Only if
      auto-update is enabled.

## Deferred until later phases (no action needed yet)

- [ ] **Relay URL / self-hosted relay** (Phase 6) — for off-LAN mobile
      connectivity through the embedded bridge. LAN/Tailscale-direct needs none.
