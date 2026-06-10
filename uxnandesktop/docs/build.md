# Desktop — release builds & packaging

How to compile Uxnan Desktop for distribution. For day-to-day debug runs see
[`development.md`](development.md).

## Build a release bundle

```bash
cd uxnandesktop
npm install                 # if not already
npm run tauri build
```

This runs the `beforeBuildCommand` (`npm run build` → SvelteKit SPA into
`build/`), compiles the Rust backend in **release** mode (optimized), and
produces the native installers for the **current** platform. Cross-compiling to
other OSes is not done from one machine — build each target on its own OS/CI
runner.

## Output locations

| Artifact | Path (under `src-tauri/target/release/`) |
|---|---|
| Raw executable | `uxnan-desktop` (`.exe` on Windows) |
| Installers / bundles | `bundle/<format>/…` |

Per platform, `bundle/` contains:

| Platform | Formats | Notes |
|---|---|---|
| **Windows** | `.msi` (WiX), `.exe` (NSIS) | Tauri downloads WiX/NSIS automatically on first bundle. |
| **macOS** | `.app`, `.dmg` | Requires Xcode Command Line Tools. |
| **Linux** | `.deb`, `.AppImage`, `.rpm` | AppImage is the most portable. |

## Useful variants

```bash
# Build only the Rust binary (no installers) — faster smoke test:
npm run tauri build -- --no-bundle

# Limit the bundle formats (example: Windows MSI only):
npm run tauri build -- --bundles msi

# Debug-optimized build (keeps debug assertions; for profiling a "release-ish" run):
npm run tauri build -- --debug
```

## Quick local verification before bundling

```bash
npm run check                              # svelte-check (type check)
npm run build                              # SPA build succeeds
( cd src-tauri && cargo test && cargo clippy --all-targets && cargo fmt --check )
```

See [`testing.md`](testing.md) for the full gate list.

## Signing, notarization & updates (human-provided)

These are **not** required to produce a local build, but are needed for
distribution. They depend on assets only a human can provide — tracked in
[`../FOR-HUMAN.md`](../FOR-HUMAN.md):

- **Windows** — code-signing certificate (SignTool) to avoid SmartScreen warnings.
- **macOS** — Apple Developer ID + notarization (mandatory since macOS 10.15).
- **Linux** — optional GPG signing for `.deb`/`.rpm`.
- **Auto-updater** — `pubkey` + `endpoints` for `tauri-plugin-updater` in
  `tauri.conf.json` (see the spec, `architecture/03-implementation-guide.md` §5.2).

Bundle identity (product name, identifier `com.uxnan.desktop`, icons) lives in
`src-tauri/tauri.conf.json`. Replace the placeholder icons before release
(`npm run tauri icon path/to/source.png`) — see `../FOR-HUMAN.md`.
