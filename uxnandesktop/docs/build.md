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

### The host engines (`uxnan-host`)

Every installer carries the [host engine](./remote-hosts.md#terminals-that-outlive-the-connection-the-host-engine)
for **every** platform the app can put it on — a Windows laptop drives a Linux
server — as resources under `host-engine/<triple>/uxnan-host`. They are static
and small (~1.5–1.9 MB each, ~7 MB the four), which is why they are bundled
rather than downloaded: nothing to fetch, nothing to verify twice, and it works
with no Internet on either side.

| Triple | Built on | How |
|---|---|---|
| `x86_64-unknown-linux-musl` | Linux (or a Mac) | `cargo zigbuild`, static |
| `aarch64-unknown-linux-musl` | Linux (or a Mac) | `cargo zigbuild`, static |
| `aarch64-apple-darwin` | macOS | `cargo build`, ad-hoc signed by the linker |
| `x86_64-apple-darwin` | macOS | `cargo build --target`, cross-compiled |

`scripts/build-host-engine.mjs` does the work: with `--build` it builds the ones
the machine can (zig and `cargo-zigbuild` for Linux, a Mac for the Apple pair)
into `src-tauri/host-engine/` (git-ignored); with `--require` it fails unless all
four are there. The sidecar overlay runs it with neither flag before `tauri dev`
and `tauri build`, so a local build bundles whatever is present — and a host
whose platform has none keeps its terminals on plain SSH channels.

**In the release** no single runner can build all four, so `release-desktop.yml`
builds them in a `host-engine` job (Linux on Ubuntu with zig, the Apple pair on
`macos-14`), each with the release's version synced into the workspace — the app
accepts an engine on a host only when its version is the app's own — and every
installer leg downloads them and runs `--require` before packaging.

The app looks for them in its resource folder first (`ssh/engine.rs` →
`local_binary`), then in `$UXNAN_HOST_BINARIES/<triple>/`, and in a debug build
in `src-tauri/host-engine/` and cargo's `target/<triple>/release/`.

### The frontend's build target

`vite.config.js` compiles the frontend to `BUILD_TARGET` from
[`build-target.js`](../build-target.js) — `es2021`, `safari14`, `chrome105` —
never to Vite's default. It is one floor for all three platforms, since they
ship the same bundle: Safari 14 is the WKWebView of macOS 11, the app's
`minimumSystemVersion`; WebView2 on Windows is evergreen Chromium (well past
`chrome105`), and the WebKitGTK that Tauri 2 requires on Linux is newer than
Safari 14 — so nothing a supported webview runs is lowered. The bug below was
in that shared bundle, so it froze terminals on every platform, and its test
runs on all three CI runners.

The floor is a correctness rule, not a size preference. Under Vite 6's
default (`es2020`, …) esbuild 0.25 lowers logical assignment and, while
minifying, drops the variable it was assigning to: xterm.js 6's DECRQM
handler (`CSI ? Ps $ p`) shipped as a `ReferenceError`, and the first TUI that
asked the terminal which modes it supports — OpenCode 2 does, at startup —
killed that tab's parser, so the tab froze and every later byte was dropped.
`tests/build-target.test.mjs` minifies the real xterm.js under the configured
target and asks it those questions; lowering the target turns it red.

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
| **Linux** | `.deb`, `.AppImage`, `.rpm` | AppImage is the most portable. See *Linux AppImage* below. |

### Linux AppImage

The release builds the Linux packages on **`ubuntu-22.04`**, the oldest Ubuntu
it supports, on purpose: an AppImage (like the `.deb`/`.rpm`) runs against the
host's C library, so the build machine's glibc is the floor every Linux package
carries — **glibc 2.35** (Ubuntu 22.04, Debian 12 and anything newer). Building
on `ubuntu-latest` raised it to 2.39 and left those systems unable to start the
app.

[`scripts/linux-appimage.sh`](../scripts/linux-appimage.sh) does two things
around `tauri build`:

- **`prepare`**, before it: seeds Tauri's tool cache with linuxdeploy's
  `AppRun` at mode `0755` (the bundler would download it as `0770`, and that
  file becomes the `AppRun.wrapped` that starts the app — so an image mounted by
  another user, e.g. under firejail, died with *Permission denied*), and has
  linuxdeploy leave out `libwayland-client.so.0`, which the AppImage excludelist
  forbids (through `LINUXDEPLOY_EXCLUDED_LIBRARIES`, which only the linuxdeploy
  pinned by `@tauri-apps/cli` 2.12+ reads). Both happen before the updater signs the image, so the `.sig` matches
  what ships — nothing is repacked afterwards.
- **`check <AppImage>`**, after it: asserts what the
  [AppImage catalog](https://appimage.github.io) tests — every executable
  runnable by anyone, no excluded library, a desktop entry with categories,
  valid AppStream metadata, the glibc floor — then launches the image the way
  the catalog does (firejail, a virtual display, WebKit's GPU paths off),
  shoots the real *Uxnan Desktop* window about 12 s later and fails if it is
  95 % or more one colour, which the catalog rejects as an empty window (a
  black frame, or the splash still up). In CI it first removes
  `xdg-desktop-portal`, which the WebKitGTK build dependencies pull in and the
  catalog's runner does not have: on a runner it hangs, and GTK waits out a
  25 s D-Bus timeout for it before any window exists.

It runs in the release's Linux leg and in the Linux leg of the `bundle` job of
`ci-desktop.yml`, which uploads the window it saw as the `appimage-window`
artifact.

### Installers are proven in CI, not first on a release

The `verify` legs compile and test but never bundle. The `bundle` job of
`ci-desktop.yml` (*installers (os)*) builds every installer the release builds,
signs the updater artifacts with a key made for that run, and then uses them:

| Leg | What it proves |
|---|---|
| `ubuntu-22.04` | `.deb`, `.rpm`, AppImage built and signed; the `.deb` carries the AppStream file; `linux-appimage.sh check` |
| `windows-latest` | NSIS installs (with `uxnan-cli.exe`), the app opens, the installer runs **again over the open app** and closes it — what the in-app updater does — then uninstalls; the MSI installs with its sidecar and uninstalls |
| `macos-14` | the `.app` with its sidecar passes `codesign --verify --deep --strict` (ad-hoc), the DMG mounts with the app, the updater archive is signed, the app launches |

It runs when something that shapes an installer changed — `tauri*.conf.json`,
`src-tauri/linux/`, `linux-appimage.sh`, the two desktop workflows, or the
`@tauri-apps/cli` version, which *is* the bundler — or on demand:
`gh workflow run ci-desktop.yml --ref <branch>`.

The Linux packages also carry **AppStream metadata**,
[`src-tauri/linux/dev.luisgamas.uxnandesktop.appdata.xml`](../src-tauri/linux/dev.luisgamas.uxnandesktop.appdata.xml),
installed to `/usr/share/metainfo/` through `bundle.linux.{appimage,deb,rpm}.files`
in `tauri.conf.json`; software centres and the catalog take the name, summary,
description, license and links from it. The desktop entry's category comes
from `bundle.category` (`DeveloperTool` → `Development`).

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
