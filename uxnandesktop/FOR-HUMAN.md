# FOR-HUMAN — uxnan-desktop

Assets and credentials that **only a human can provide**. The app must always
build and run without them (graceful degradation); a missing asset may downgrade
a feature but must never break startup or the build. Never commit real secrets —
only this checklist and the inline `FOR-HUMAN:` markers describing what's needed.

(Distinct from [`FOR-DEV.md`](FOR-DEV.md), which tracks deferred *code* work.)

## Open items

- [ ] **Production app-icon artwork (sign-off)** — a brand mark already ships:
      `src-tauri/icons/*` were regenerated from `logo.svg` (+ `static/logo*.svg` /
      `favicon.png`), so these are no longer Tauri's default placeholders. What
      remains is **final production-quality artwork + sign-off**.
      - **Where:** `src-tauri/icons/` (`32x32.png`, `128x128.png`,
        `128x128@2x.png`, `icon.ico`, `icon.icns`, `Square*Logo.png` / `StoreLogo.png`).
      - **Config:** regenerate with `npm run tauri icon path/to/source.png` (1024²
        source); paths are already wired in `tauri.conf.json → bundle.icon`.

## Needed for distributable / signed release builds

> The CI/CD pipeline (see `FOR-DEV.md → "CI/CD — release builds"`) can produce
> **unsigned** artifacts without these (degraded: OS "unknown publisher"
> warnings). They're required for a clean, signed, auto-updating release. Supply
> each as a **GitHub Actions repository secret** consumed by `release-desktop.yml`.

- [ ] **Code-signing identities (OS — paid)** (release) — Windows code-signing cert
      (SignTool / `WINDOWS_CERTIFICATE` + password), Apple Developer ID +
      notarization (`APPLE_CERTIFICATE`, `APPLE_ID`, team id, app-specific
      password), optional GPG for Linux packages (spec §5.1). This removes the OS
      "unknown publisher" warning. **Unrelated to the updater key below** (which
      is free).
- [ ] **Auto-updater signing key (FREE — required to ship updates)** — the in-app
      updater is fully wired (Settings → Updates), but it can't verify/apply an
      update until a real minisign keypair exists. The repo currently ships a
      **throwaway placeholder `pubkey`** in `src-tauri/tauri.conf.json` so the app
      starts; you must replace it with your own.
      - **Generate:** `cd uxnandesktop && npx tauri signer generate -w ~/.uxnan-updater.key`
        (free; nothing to buy). Keep the private key + password secret.
      - **Where:** put the printed **public** key in
        `src-tauri/tauri.conf.json → plugins.updater.pubkey` (replaces the
        placeholder; safe to commit). Add the **private** key as repo secret
        `TAURI_SIGNING_PRIVATE_KEY` and its password as
        `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (consumed by `release-desktop.yml`).
      - **Then:** push a `desktop-v*` tag, **publish** the draft Release; that
        fires `release-desktop-manifest.yml`, which puts `latest.json` on the
        rolling `desktop-updater-<channel>` release the app polls.
      - **Step-by-step:** [`docs/updates.md`](docs/updates.md) → "First-time setup".

## Deferred until later phases (no action needed yet)

- [ ] **Relay URL / self-hosted relay** (Phase 6) — for off-LAN mobile
      connectivity through the embedded bridge. LAN/Tailscale-direct needs none.
