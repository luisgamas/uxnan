# FOR-HUMAN — uxnan-desktop

Assets and credentials that **only a human can provide**. The app must always
build and run without them (graceful degradation); a missing asset may downgrade
a feature but must never break startup or the build. Never commit real secrets —
only this checklist and the inline `FOR-HUMAN:` markers describing what's needed.

(Distinct from [`FOR-DEV.md`](FOR-DEV.md), which tracks deferred *code* work.)

## Open items

- [ ] **(Optional) Crisper brand SVGs for catalog agents** — every catalog agent
      already shows a logo automatically: `AgentLogo.svelte` resolves a bundled SVG
      first, then the agent's favicon (`favicon` field in `src/lib/agentCatalog.ts`,
      fetched via Google's favicon service), then the generic Bot glyph. So this is
      **not blocking** — it only sharpens agents that currently fall back to a
      low-res favicon.
      - **What/Where:** drop a vector logo at `static/agents/<logo>.svg`, where
        `<logo>` is the catalog entry's `logo` field; it takes priority over the
        favicon. Agents without a bundled SVG today: `cursor`, `aider`, `amp`,
        `cline`, `droid`, `copilot`, `continue`, `kiro`, `auggie`, `crush`,
        `codebuff`, `commandcode`, `mimo`, `devin`, `hermes`, `mistralvibe`, `rovo`,
        `autohand`, `openclaude`, `openclaw`, `omp`, `ante`.
      - **Config:** none — `AgentLogo` picks up `/agents/<logo>.svg` automatically
        once the file exists (viewBox-normalized, monochrome-friendly like the
        existing ones).
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
      "unknown publisher" warning. **Unrelated to the updater key** (which is free
      and already configured).

## Deferred until later phases (no action needed yet)

- [ ] **Relay URL / self-hosted relay** (Phase 6) — for off-LAN mobile
      connectivity through the embedded bridge. LAN/Tailscale-direct needs none.
