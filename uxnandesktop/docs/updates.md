# Updates & release channels

How the in-app auto-updater works, how to set it up (one-time), and how to cut a
release on each channel.

## What it does (for users)

Uxnan Desktop checks GitHub Releases for a newer version, downloads it in the
background, and installs it **on your terms**. Configure it in
**Settings → Updates**:

- **Release channel** — `stable` (default) or `nightly`. Nightly gets earlier,
  less-stable builds (GitHub **pre-releases**).
- **Check automatically** — on launch + every 6 h (default on). A manual
  **Check now** button always works.
- **Download automatically** — fetch a found update in the background (default
  on). Downloading never interrupts a running agent.
- **Install** — how a downloaded update is applied: **Ask me** (default),
  **Automatically when agents are idle**, or **Only when I trigger it**.

When an update is ready, a slim banner appears at the top of the window, above
the panels.

### Why install is special (agents)

Each agent runs as a terminal (PTY) child of the app. **Installing an update
restarts the app, which stops every running agent** — there is no way to keep a
live agent process alive across that restart. So the updater separates the two
steps:

- **Download** is harmless and runs in the background.
- **Install** is guarded. If an agent is working, the banner offers
  **Install when idle** (auto-installs the moment all agents go quiet),
  **Install now** (with an "an agent is running" warning), or dismiss for later.
  Resumable agents (e.g. Claude Code, Codex persist their session) can be
  continued after the restart.

Before installing, the backend closes terminals cleanly (the same path as
quitting the app), so nothing is killed mid-write.

## How it works (for contributors)

- **App side** — `src-tauri/src/updater.rs` wraps `tauri-plugin-updater`:
  - `endpoint_for(channel)` builds the per-channel manifest URL
    `https://github.com/luisgamas/uxnan/releases/download/desktop-updater-<channel>/latest.json`
    (`<channel>` is `stable` or `nightly`; the plugin has no `{{channel}}` URL
    variable, so we set the endpoint at runtime from the user's channel).
  - `app_version` returns the **full** release name for display (for example,
    `0.0.10` or `0.0.11-nightly.20260712.1`); the bundled/compared version is
    the numeric base.
  - `updater_check` → returns `UpdateInfo` or `null`.
  - `updater_download` → downloads + **stages the installer bytes in memory**
    (`AppState.staged_update`), emitting `updater:download-progress` and
    `updater:downloaded`.
  - `updater_install` → re-checks (to get a fresh install handle), guards against
    a stale download, closes terminals, installs, and restarts.
  - The frontend store `src/lib/state/updater.svelte.ts` orchestrates check →
    (auto?)download → install, applies the install policy, and runs the
    idle-guard. The prompt is a **pinned sonner toast**
    (`src/lib/components/UpdateToast.svelte`, driven by `src/lib/updateToast.svelte.ts`
    with a stable id + `duration: Infinity`), and the same download/install
    actions are also available inline in **Settings → Updates**
    (`src/lib/components/Settings.svelte`).
    The pinned card is a compact vertical surface: during `downloading` it shows
    only the progress state, while the release-notes link is reserved for
    `downloaded`, when the installer is ready to apply. Its title, supporting
    text, dismissal control, and full-width actions follow the desktop tokens.
    The link follows the selected `desktop-stable-v…` or `desktop-nightly-v…`
    tag.
- **Signature** — verified against `plugins.updater.pubkey` in
  `src-tauri/tauri.conf.json`. This is a **free minisign key**, unrelated to OS
  code-signing (the paid Authenticode/Apple cert that removes "unknown publisher"
  warnings — see `FOR-HUMAN.md`).
  - **macOS is experimental** (unsigned, ad-hoc-signed). The updater downloads
    inside the app rather than through a browser, so the replacement bundle is
    **not re-quarantined** and self-updates generally apply without repeating the
    Gatekeeper authorization. First-time install still needs it — see
    [`install-macos.md`](install-macos.md).
- **Channel = the release tag, enforced by CI.** A
  `desktop-stable-v0.0.PATCH` tag creates a normal Release and feeds `stable`.
  A `desktop-nightly-v0.0.PATCH-nightly.YYYYMMDD.N` tag creates a GitHub
  pre-release and feeds `nightly`. The manifest workflow validates the matching
  GitHub pre-release flag and fails rather than silently crossing channels.
- **Version comparison** — the updater compares the **numeric base** version
  (`0.0.5`), which CI bundles (the Windows MSI rejects a non-numeric pre-release
  id). So bump that base each release (e.g. `0.0.5` → `0.0.6`) for the updater to
  detect a new version; the `-alpha.YYYYMMDD` suffix is display-only.
- **Manifest hosting** — `release-desktop.yml` builds + signs and attaches a
  merged `latest.json` to the per-version **draft** release. When you **publish**
  that release, `release-desktop-manifest.yml` reads its `prerelease` flag and
  copies its `latest.json` onto the rolling `desktop-updater-<stable|nightly>`
  release the app polls.

## First-time setup (one-time, required to ship updates)

The updater is fully wired, but it can't verify/apply an update until a real
signing key exists. The repo ships a **throwaway placeholder `pubkey`** so the
app starts; replace it with your own (free):

1. **Generate the keypair** (nothing to buy):
   ```bash
   cd uxnandesktop
   npx tauri signer generate -w ~/.uxnan-updater.key
   ```
   This prints a **public** key and writes the **private** key to the path.
   Keep the private key + password secret; if you lose them you can't sign future
   updates.
2. **Public key → config.** Put the printed public key in
   `src-tauri/tauri.conf.json → plugins.updater.pubkey` (replaces the
   placeholder; safe to commit).
3. **Private key → repo secrets** (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — the contents of the generated private key file.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password (empty string if none).
4. **(Optional) OS code-signing** is separate and paid — see `FOR-HUMAN.md`. The
   updater works without it.

## Cutting a release on a channel

Tag a green commit with the channel encoded in the tag. Bump the numeric base
for **every** Desktop build, regardless of channel, so the updater detects it.

```bash
# Stable: a normal GitHub Release and the stable updater manifest.
git tag desktop-stable-v0.0.10
git push origin desktop-stable-v0.0.10

# Nightly: a GitHub pre-release and the nightly updater manifest.
git tag desktop-nightly-v0.0.11-nightly.20260712.1
git push origin desktop-nightly-v0.0.11-nightly.20260712.1
```

Then:

1. `release-desktop.yml` runs (verify → build → sign), creating a **draft**
   GitHub Release named after the version, with the installers, their `.sig`
   files, and a merged `latest.json`.
2. Review the draft body and assets, but **do not change its pre-release
   checkbox**: the workflow already set it from the tag. Publish it as-is.
3. Publishing fires `release-desktop-manifest.yml`, which validates the tag ↔
   pre-release invariant, then copies `latest.json` onto the matching rolling
   `desktop-updater-stable` / `desktop-updater-nightly` release (created on first
   use — don't delete it). Apps on that channel pick up the update on their next
   check.

> A tag with the wrong shape is rejected before installers are built. A manually
> altered GitHub pre-release flag is rejected before the updater manifest changes.

## Without the signing key

Everything degrades cleanly: builds still produce installers (just no
`.sig`/`latest.json`), `release-desktop-manifest.yml` exits with a notice, and the
in-app check simply finds nothing — the app runs normally. Until then, distribute
installers by downloading them from the GitHub Release manually.

## Troubleshooting

- **"Check now" says up to date but a newer release exists** — confirm the
  release is **published** (not a draft) and on the **same channel** the app
  follows, and that `latest.json` is present on `desktop-updater-<channel>`.
- **Download fails / signature error** — the `pubkey` in `tauri.conf.json` must
  match the private key used to sign (`TAURI_SIGNING_PRIVATE_KEY`). Mismatched
  keys fail verification.
- **Stale staged download** — if a newer release appears between download and
  install, `updater_install` refuses the stale bytes and asks to download again.
