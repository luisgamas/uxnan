# The bridge Uxnan Desktop carries

Every installer ships its own Uxnan bridge, so chats and the phone work on a
machine that has no Node.js at all. This page is how that runtime is built,
where it goes on a user's machine, how it is kept current, and how to remove
it. The contract side is architecture/02a §5.8.18; the desktop side is
`02e` §3.5.

## What is in it

`scripts/build-bridge-runtime.mjs` assembles `src-tauri/bridge-runtime/`,
which the sidecar overlay (`src-tauri/tauri.cli.conf.json`) bundles as a
resource:

| Path | What |
|---|---|
| `node/bin/node` (`node/node.exe` on Windows) | The official Node.js binary for the installer's platform — **24.22.2 LTS**, downloaded from nodejs.org and checked against the SHA-256 pinned in the script (`NODE`), never against a checksum file fetched beside it. Its `LICENSE` sits next to it. |
| `app/node_modules/uxnan-bridge/` | The bridge **built from this commit** (`npm pack` of `shared` and `bridge`), with its production dependencies resolved to the versions the root `package-lock.json` pins (npm `overrides`), installed with `--ignore-scripts` for the installer's `--os`/`--cpu`. |
| `app/node_modules/@napi-rs/keyring*` | The OS keychain module and its native build for that platform — where the bridge keeps its identity. The native build is unpacked from its published tarball after the install: npm refuses another CPU's package even with `--cpu`. |
| `uxnan-runtime.json` | The manifest: bridge version, Node version, target triple, the two entry points (`node`, `cli`) and the size and SHA-256 of **every** file. |

`firebase-admin` (an optional dependency of the bridge, ~66 MB) is left out by
decision: a bundled bridge sends no background push yet. The follow-up is to
send push through FCM's HTTP v1 API directly for every bridge, npm or bundled
(`bridge/FOR-DEV.md` → *Transport & connectivity*); push stays gated on the
Firebase credentials only a human can provide (`bridge/FOR-HUMAN.md`).

Measured on macOS arm64 (bridge 0.0.53, Node 24.22.2): 1 266 files, 128.4 MiB
uncompressed — the Node binary is 116.9 MiB of it — about 41 MiB gzip-compressed
and 26 MiB xz. Node's official archives put the other platforms in the same
range (Linux x64 and Windows x64 binaries are of the same order).

```bash
# from the repository root, once: the bridge is packed from the built workspaces
npm ci && npm run build
cd uxnandesktop
node scripts/build-bridge-runtime.mjs --build            # this machine's triple
node scripts/build-bridge-runtime.mjs --build --target x86_64-apple-darwin
node scripts/build-bridge-runtime.mjs --require          # fail unless a verified one is there
```

With no flag (what `tauri dev` / `tauri build` run) the script only makes sure
the folder exists: a development build carries no bridge unless you built one,
and says so.

**Release.** `release-desktop.yml` builds the workspaces and runs
`--build --require --target <triple>` on every installer leg (the Intel mac leg
cross-assembles it: the x64 keyring build is unpacked from its tarball; nothing is run).
`ci-desktop.yml`'s installer job does the same and checks the `.deb` and the
NSIS install carry it. Because every installer ships the bridge of its commit,
a shipping change under `bridge/`, `shared/` or `relay/` — the bridge's own
version bump included — makes the desktop owe a release too
(`scripts/release/components.mjs` → `embeds`), cut after the bridge.

## Where it goes

The service never runs the bridge from inside the app: an AppImage is mounted
in `/tmp` only while the app runs, and an app update replaces the bundle under
a live process. `bridgeclient/runtime.rs` **copies** it — hashing every file as
it is written and comparing with the manifest, contents only (no extended
attributes, so no download quarantine follows it) — to a per-user folder that
is **not** `~/.uxnan`:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/Uxnan/bridge-runtime/` |
| Linux | `$XDG_DATA_HOME/uxnan/bridge-runtime/` (else `~/.local/share/…`) |
| Windows | `%LOCALAPPDATA%\uxnan\bridge-runtime\` |

Each version is a complete folder, `versions/<bridge>+node<node>/`, renamed into
place only after every file matched; a damaged copy is replaced, never reused.
The service is then the bridge's own: Uxnan runs `<node> <cli.js>
install-service` from that folder, which writes the LaunchAgent / systemd unit
/ scheduled task with those **absolute** paths, `WorkingDirectory` = the user's
home and `start --service`; the bridge takes the PATH of the user's login shell
when it starts. `uxnan-bridge service-status` reads back the `program` a
service runs, which is how the app tells its own bridge from one the user
registered.

## First launch

A fresh install starts in `managed` mode. When no bridge serves the local
channel, the app, in order: starts the registered service (and, if that service
points at files that are gone, replaces it with its own); registers an
independent `uxnan-bridge` found on `PATH` instead of installing a duplicate;
and only with neither installs and registers the bridge it carries. A
registered independent bridge that does not start is **named**, not replaced:
Settings → Bridge & mobile offers **Use Uxnan's bridge**. The single-instance
lock (`~/.uxnan/bridge.lock`) stays the authority throughout — two bridges never
run on the same state.

A **development build** (`tauri dev`) does not install the bundled bridge on
its own, since the service it would register is the machine's one bridge; it
does when you press **Set up the bridge**. A saved state keeps its mode: an
existing `off` stays off, and costs nothing.

## Updating it

`BridgeStatus.host.install` says how the running bridge was installed:

- **`bundled`** — the desktop owns its update. The bridge never asks npm
  (`update.canApply` is false and says why). When the app carries a newer
  bridge than the one running, it switches at a moment no turn runs on any
  client (`autoUpdateDue` in `src/lib/bridge/install.svelte.ts`), even with
  **Update automatically** off — it is part of the app.
- **`npm`** — the bridge updates itself (`bridge/update`), as before.

A switch (`BridgeClient::install_bundled`) is atomic: copy and verify the new
version → stop the running bridge (its own `stop`, waiting for the lock) →
`install-service` from the new folder → wait (20 s) for the local channel to
answer **with the new version**. If it does not, the previous program is
registered again and the failed folder removed; the result says it rolled back.
The current and the previous version are kept, older ones pruned.

## Removing it

Settings → Bridge & mobile → **Remove the bridge** (shown for the bridge Uxnan
installed) turns the connection off, stops the bridge, runs its
`uninstall-service` (which also removes the entry it kept in Antigravity's MCP
config) and deletes `bridge-runtime/`. It never touches `~/.uxnan`: the
identity in the OS keychain, the trusted phones and the conversations stay for
whichever bridge runs next. A service the user registered themselves is left
alone, and the app says so.

## Keychain and signing (macOS)

The bridge keeps its Ed25519 identity in the login keychain, whose access list
remembers the program that stored it. The official Node binary is signed with
the OpenJS Foundation's Developer ID (hardened runtime,
`disable-library-validation`, so the unsigned keyring addon loads), so a newer
bundled Node is the same program to the keychain. Moving an existing bridge
from another Node (Homebrew, nvm) to the bundled one can make macOS ask once
for access. If access is denied the bridge **refuses to start** rather than
mint a new identity (`keyring-secret-store.ts`), and the switch rolls back.

The app itself is ad-hoc signed and not notarized today. Notarizing it later
means re-signing the bundled `node` and the keyring `.node` with the project's
Developer ID (`uxnandesktop/FOR-HUMAN.md`).

## Verifying it

- `npx vitest run scripts/build-bridge-runtime.test.mjs` — pinned hashes,
  triples, the locked closure, the manifest and its verification.
- `cargo test --lib bridgeclient::runtime` — copy-and-verify, reuse, damage,
  pruning, version order.
- With a runtime built: `cargo test --lib live_the_built_runtime -- --ignored`
  copies it to a scratch folder and runs `version` from the copy.
- A live bridge from it, without touching your real one: start it with a
  scratch `HOME`, an in-memory identity and the LAN off, then
  `HOME=<scratch> <runtime>/node/bin/node <runtime>/app/node_modules/uxnan-bridge/dist/src/cli.js status`
  answers `bridge/status` over the local channel with `"install": "bundled"`.
  Never run `install-service` from a scratch setup: the service label is the
  machine's one.
