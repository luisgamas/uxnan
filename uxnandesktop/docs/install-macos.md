# Installing Uxnan Desktop on macOS (EXPERIMENTAL)

![Status](https://img.shields.io/badge/macOS-EXPERIMENTAL-orange?style=for-the-badge&logo=apple&logoColor=white)
![Signing](https://img.shields.io/badge/signing-ad--hoc_(unsigned)-lightgrey?style=for-the-badge)

> **The macOS build is experimental and unsigned.** It has **no Apple Developer
> ID and is not notarized**, so macOS will not let it open on the first try — you
> have to authorize it by hand, **once**. This is a property of macOS Gatekeeper,
> not a sign that the app is unsafe. If you'd rather not do this, you can always
> [build it yourself](build.md) on your own Mac (a self-built app runs with no
> prompt), and **issues / PRs that improve these installers — or help
> non-technical users — are very welcome.**

## Pick the right download

Two separate `.dmg` files are published, one per CPU architecture:

| Your Mac | Download |
|---|---|
| **Apple Silicon** (M1/M2/M3/M4 — most Macs since 2020) | the `aarch64` / "Apple Silicon" `.dmg` |
| **Intel** (pre-2020 Macs) | the `x86_64` / "Intel" `.dmg` |

Not sure which you have?  → Apple menu () → **About This Mac** → look at
**Chip** / **Processor** ("Apple M…" = Apple Silicon; "Intel …" = Intel).

Installing the wrong architecture will fail to open, so grab the matching one.

## Install — choose your comfort level

Do the common part first, then follow **one** of the three tiers below.

**Common step (everyone):** open the `.dmg` and **drag "Uxnan Desktop" into the
Applications folder.** Always run it from **Applications** — running it straight
from the mounted disk image or from Downloads can trigger macOS "app
translocation" and misbehave.

---

### Tier 1 — No Terminal (the official Apple way)

Best if you don't want to touch a command line.

1. In **Applications**, double-click **Uxnan Desktop**.
2. macOS shows *"Apple could not verify … it is free of malware"* (or
   *"unidentified developer"*). Click **Done** (do **not** click Move to Trash).
3. Open **System Settings → Privacy & Security**. Scroll down to the **Security**
   section — you'll see *"Uxnan Desktop was blocked to protect your Mac."* Click
   **Open Anyway**.
4. Confirm with your password / Touch ID. On macOS Sequoia (15) and Tahoe (26)
   you may be asked to double-click the app once more and click **Open** — do so.

That's it — macOS remembers your choice and opens it normally from then on.

> On **macOS Sequoia and later, the old right-click → Open shortcut no longer
> works** — you must use **System Settings → Privacy & Security → Open Anyway**.

---

### Tier 2 — One Terminal command

Faster if you're comfortable with Terminal. After dragging the app to
**Applications**, run:

```bash
xattr -dr com.apple.quarantine "/Applications/Uxnan Desktop.app"
```

This removes the *quarantine* attribute macOS put on the download, so the app
opens on the first double-click. (`-d` deletes the attribute, `-r` applies it to
everything inside the app bundle.)

---

### Tier 3 — Verify what you're running (advanced)

If you want to inspect it before trusting it:

```bash
# See the ad-hoc signature (Signature=adhoc, Identifier=dev.luisgamas.uxnandesktop):
codesign -dv --verbose=4 "/Applications/Uxnan Desktop.app"

# See Gatekeeper's verdict (it will REJECT — expected for an unsigned app):
spctl -a -vvv "/Applications/Uxnan Desktop.app"

# Inspect the quarantine attribute before removing it:
xattr -p com.apple.quarantine "/Applications/Uxnan Desktop.app"
```

Please **don't** disable Gatekeeper system-wide (`sudo spctl --master-disable`) —
it weakens security for *every* app. Authorize this one app instead (Tier 1 or 2).

## Why the extra step?

macOS only opens apps without a warning when they carry a paid **Apple Developer
ID** signature *and* have been **notarized** by Apple. This build has neither —
that's the maintainer's deliberate, experimental choice while macOS support
matures. What it **does** have is an **ad-hoc signature**, which is what lets the
Apple Silicon build run at all (Apple Silicon refuses to launch a binary with no
signature whatsoever). The one-time authorization above is the price of skipping
the paid Apple path.

## Updates

The in-app updater (**Settings → Updates**, stable/nightly channels) works on
macOS too — it's signed with a free minisign key, independent of Apple signing.
Because the updater downloads inside the app (not through a browser), updates it
installs are **not re-quarantined**, so once you've authorized the app the first
time, self-updates generally apply without repeating the Gatekeeper step. This
path is experimental; if an update ever refuses to open, re-apply Tier 1 or 2, or
just download the latest `.dmg`.

## Troubleshooting

- **"Uxnan Desktop is damaged and can't be opened. You should move it to the
  Trash."** — This is almost always the **quarantine attribute**, not real
  damage. Run the Tier 2 command (`xattr -dr com.apple.quarantine …`) and open
  again. Also make sure you downloaded the **matching architecture**.
- **Nothing happens / it bounces once and quits.** — Confirm you moved it to
  **/Applications** (translocation), and that you picked the right
  architecture (Apple Silicon vs Intel).
- **"Open Anyway" isn't in System Settings.** — You need to try opening the app
  **first** (double-click → Done); the button only appears after macOS has
  blocked a launch.
- **CLIs (Claude, Codex, Gemini, `gh`, node, …) show as "not installed"
  although they are.** — Uxnan enriches its `PATH` from your login shell at
  startup so Homebrew / npm / version-manager tools are found even when launched
  from Finder. If something is still missing, make sure it's on your login
  shell's `PATH` (e.g. Homebrew's line in `~/.zprofile`), then relaunch the app.

## Prefer to build it yourself?

A build you compile locally is **not quarantined and needs no authorization
step**. See [release builds & packaging](build.md) — in short, on your Mac:

```bash
cd uxnandesktop
npm install
npm run tauri build          # produces a .dmg/.app for your Mac's architecture
```

Found a way to make the experimental installers smoother for everyone (especially
non-technical users)? Please open an issue or a PR.
