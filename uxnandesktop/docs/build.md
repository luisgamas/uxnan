# Desktop — release builds & packaging

![Bundler](https://img.shields.io/badge/build-tauri_build-FFC131?style=for-the-badge&logo=tauri&logoColor=000000)
![Targets](https://img.shields.io/badge/installers-Windows_%7C_macOS_%7C_Linux-lightgrey?style=for-the-badge)
![Per_OS](https://img.shields.io/badge/cross--compile-build_on_each_OS-0a0a0a?style=for-the-badge)

How to compile Uxnan Desktop for distribution. For day-to-day debug runs see
[`development.md`](development.md).

> **A build is not a validation.** What each platform has actually demonstrated
> — `code-only` / `builds` / `smoke` / `validated` / `signed` / `release-ready`,
> with evidence — is recorded in the
> [platform support matrix](platform-support.md). Today: Windows `smoke`
> (exercised daily, E2E + resource baseline), macOS and Linux `builds` (CI
> compiles and tests them; no run on real hardware has been recorded).

## Build a release bundle

```bash
cd uxnandesktop
npm install                 # if not already
npm run tauri build
```

This runs the `beforeBuildCommand` (`npm run build` → SvelteKit SPA into
`build/`, then `scripts/build-cli.mjs` → the `uxnan-cli` sidecar), compiles the
Rust backend in **release** mode (optimized), and produces the native
installers for the **current** platform. Cross-compiling to other OSes is not
done from one machine — build each target on its own OS/CI runner.

### The `uxnan-cli` sidecar

The console client of the [control surface](./control-api.md) ships **inside
the app** as a Tauri sidecar (`bundle.externalBin`), so every installer carries
it and the app can put it on the PATH of every terminal it opens. Two files
make that happen, and `npm run tauri` is a small wrapper (`scripts/tauri.mjs`)
that applies them:

| File | Role |
|---|---|
| `scripts/build-cli.mjs` | `cargo build -p uxnan-cli --release --target <triple>` and a copy to `src-tauri/binaries/uxnan-cli-<triple>[.exe]`, the name Tauri expects. The triple is the one Tauri hands its before-commands (`TAURI_ENV_TARGET_TRIPLE`, so it follows `--target`), or the host's when run by hand. `binaries/` is git-ignored. |
| `src-tauri/tauri.cli.conf.json` | The **sidecar overlay**: `bundle.externalBin` plus before-commands that run the script. The wrapper passes it (`--config`) to `tauri dev` and `tauri build` only. |

Why an overlay rather than `tauri.conf.json`: Tauri validates a declared
sidecar's file on **every** `cargo build` of the app — `cargo test`, `cargo
clippy`, an editor's check — so declaring it in the main config would make each
of those fail until someone built the CLI first. With the overlay, plain cargo
never hears of the sidecar; the two commands that produce a runnable app do.
`npm run tauri build -- --no-bundle` (the benchmarks) skips it too. Whatever
the app is built with the overlay lands `uxnan-cli` next to the main
executable: `Contents/MacOS/` in the `.app`, the install folder on Windows,
`/usr/bin` for a deb/rpm, the mounted `usr/bin` of an AppImage, `target/debug/`
under `tauri dev` — where `control::cli` looks for it.

`release-desktop.yml` names that same script (`tauriScript: npm run tauri`),
so the released installers carry the sidecar.

## Output locations

| Artifact | Path (under `src-tauri/target/release/`) |
|---|---|
| Raw executable | `uxnan-desktop` (`.exe` on Windows) |
| Installers / bundles | `bundle/<format>/…` |

Per platform, `bundle/` contains:

| Platform | Formats | Notes |
|---|---|---|
| **Windows** | `.msi` (WiX), `.exe` (NSIS) | Tauri downloads WiX/NSIS automatically on first bundle. |
| **macOS** | `.app`, `.dmg` (one per architecture) | Requires Xcode Command Line Tools. CI ships an **experimental, unsigned** build, ad-hoc-signed per arch (`aarch64` + `x86_64`) — see [install-macos.md](install-macos.md). |
| **Linux** | `.deb`, `.AppImage`, `.rpm` | AppImage is the most portable. |

## Useful variants

```bash
# Build only the Rust binary (no installers) — faster smoke test:
npm run tauri build -- --no-bundle

# Limit the bundle formats (example: Windows MSI only):
npm run tauri build -- --bundles msi

# Debug-optimized build (keeps debug assertions; for profiling a "release-ish" run):
npm run tauri build -- --debug

# macOS: build a specific architecture (CI builds both, one DMG each):
npm run tauri build -- --target aarch64-apple-darwin   # Apple Silicon
npm run tauri build -- --target x86_64-apple-darwin    # Intel
```

## Quick local verification before bundling

```bash
npm run check                              # svelte-check (type check)
npm run build                              # SPA build succeeds
( cd src-tauri && cargo test --workspace && cargo clippy --workspace --all-targets && cargo fmt --all --check )
```

See [`testing.md`](testing.md) for the full gate list.

## Signing, notarization & updates (human-provided)

These are **not** required to produce a local build, but are needed for
distribution. They depend on assets only a human can provide — tracked in
[`../FOR-HUMAN.md`](../FOR-HUMAN.md):

- **Windows** — code-signing certificate (SignTool) to avoid SmartScreen warnings.
- **macOS** — the maintainer ships an **experimental, unsigned** build that is only
  **ad-hoc-signed** (`bundle.macOS.signingIdentity: "-"` in `tauri.conf.json`), so it
  needs **no Apple account**; users clear Gatekeeper by hand
  ([install-macos.md](install-macos.md)). An **Apple Developer ID + notarization**
  (paid) is the *optional* path to a warning-free install — it removes the manual
  step but is **not** required to run, and is not configured.
- **Linux** — optional GPG signing for `.deb`/`.rpm`.
- **Auto-updater** — `pubkey` + `endpoints` for `tauri-plugin-updater` in
  `tauri.conf.json` (see the spec, `architecture/03-implementation-guide.md` §5.2).

Bundle identity (product name, identifier `dev.luisgamas.uxnandesktop`, icons) lives in
`src-tauri/tauri.conf.json`. Replace the placeholder icons before release
(`npm run tauri icon path/to/source.png`) — see `../FOR-HUMAN.md`.
