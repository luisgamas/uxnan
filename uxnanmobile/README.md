# uxnanmobile

Flutter mobile client (Android + iOS) for **Uxnan** — a remote control for AI
coding agents running on a PC, over an end-to-end encrypted channel.

> **Status: Android ALPHA-READY. iOS pending FOR-HUMAN assets** (APNs key,
> `Info.plist` usage strings, signing; first build requires macOS).
>
> Full technical specification: [`../architecture/`](../architecture/00-index.md).
> The architecture docs are the source of truth; this app implements them.

## Stack

| Concern | Choice |
|---|---|
| Language / SDK | Dart 3.4+, Flutter 3.22+ |
| Architecture | Clean Architecture — `core/`, `domain/`, `application/`, `infrastructure/`, `presentation/` |
| State management | Riverpod **3.x** (manual providers, **no** code generation) |
| Navigation | `go_router` |
| UI | Material 3 (+ "Neural Expressive" M3 Expressive design language), adaptive light/dark, centralized design tokens |
| Local persistence | `drift` (SQLite) — 7 tables |
| Secure storage | `flutter_secure_storage` (Keychain / Keystore) |
| Crypto | `cryptography` + `pointycastle` (X25519, Ed25519, AES-256-GCM, HKDF) |
| Lint | `very_good_analysis` |

Package id: `dev.luisgamas.uxnanmobile` · Dart package name: `uxnan` (imports use
`package:uxnan/...`).

## Project layout (`lib/`)

```
core/            cross-cutting utilities (constants, errors, extensions, utils)
domain/          entities, value_objects, enums, repositories, services (pure Dart)
application/     coordinators, managers, processors (use cases orchestration)
infrastructure/  transport, storage (drift), repositories, platform, crypto,
                 notifications, pairing, speech, media
presentation/    screens, widgets, providers, router, theme
l10n/            generated localizations (en, es)
```

Layer import rules (enforced by review + analysis), per spec 03 §1.5:
`presentation → domain/application` · `application → domain` ·
`infrastructure → domain` · `domain → (pure)` · `core → (none)`.

## Getting started

```bash
flutter pub get
flutter gen-l10n          # regenerate localizations after editing l10n/*.arb
flutter run \
  --dart-define=ENV=dev \
  --dart-define=ENABLE_LOGGING=true
```

> **No `RELAY_URL` needed to connect.** The bridge address comes from the
> **pairing QR**: a fresh bridge is **LAN/Tailscale-direct** (`relayEnabled`
> defaults to `false`) and advertises its direct `host:port`s, which the phone
> tries first. The relay is **optional** — self-hosted, used only as a remote
> fallback. When a paired bridge advertises a relay URL, the phone reads it
> from the QR; nothing is injected at compile time.

### Build flavors

Configuration is injected at compile time with `--dart-define` (spec 03 §3.3):

| Variable | dev | staging | prod (default) |
|---|---|---|---|
| `ENV` | `dev` | `staging` | `prod` |
| `ENABLE_LOGGING` | `true` | `true` | `false` |

## Quality

```bash
dart format lib test
flutter analyze            # must report 0 issues (no warnings)
flutter test               # unit + widget tests (415 passing)
```

## Status

**MVP wired (Android alpha-ready).** All core modules are implemented and
connected to live bridge data, validated on-device against a real bridge:

- **E2EE crypto + secure transport** (X25519 + Ed25519 + HKDF + AES-256-GCM,
  handshake, seq/replay, outbound buffer, reconnect loop).
- **Pairing & onboarding** — `OnboardingScreen`, `QrScannerScreen`,
  `MyDevicesScreen`, **`ManualCodeScreen`** (bridge-first manual-code
  pairing, `GET /pair/resolve?code=`, host typed or via mDNS discover).
- **Direct LAN/Tailscale transport** — `DirectTransportSelector` tries each
  direct `hosts` entry from the QR first, falls back to the relay.
- **Multi-PC connection-targeting** — all live actions target the PC we
  actually hold a channel to; browsing is read-only. `bridge/status`
  consumed (Relay / Direct transport indicator).
- **Live streaming conversations** that survive leaving/re-entering the
  screen (per-thread in-memory buffers + `turn/list` re-sync) with a
  per-thread **"Responding…"** activity indicator.
- **Structured agent turns** — assistant replies without a bubble,
  consecutive text merged, collapsible **Work log (N)**, collapsible
  **Changed files (N) · +a −d** with per-file diffs, **Copy response**,
  **Last edits** strip above the composer; **Thinking** section
  (settings-gated, default off).
- **New conversation flow** — `project/list` + `agent/list` + `agent/models`
  + **folder browser** (`workspace/browseDirs`) to root a thread anywhere.
- **Structured model picker** (readable names, default badge, Claude alias
  "(latest)" + pinned versions + resolved-version row, `thread/setModel`).
- **Per-model run-option knobs** (data-driven: `enum` / `toggle`,
  generic renderer).
- **Context-usage indicator** (percentage when the model window is known,
  raw token count otherwise; **0 baseline** for agents with
  `reportsContextUsage`).
- **Per-agent sign-in status** (`auth/status`) — banner above the composer,
  red dot in the threads list, "Check sign-in" in new-conversation card,
  auto-refresh on app resume.
- **Interactive approval** (Approve / Reject / "always allow this session")
  with a spring `AnimatedSize` morph; validated end-to-end against Echo,
  Claude Code (`PreToolUse` hook), Codex (`app-server`) and Gemini
  (`BeforeTool` hook). OpenCode/pi have no headless pre-tool channel yet.
- **Composer** — bottom-anchored bar; **stop-the-turn** mid-run; **voice
  → text** (`speech_to_text`); **image attachments** (photo library /
  camera, downscaled to 2048 px / q85, image-only message allowed,
  gated by the agent's `images` capability).
- **Per-PC threads** (`Thread.deviceId`) with per-agent filter chips,
  search / sort / density, archived-thread screen, per-thread actions
  (rename / archive / unarchive / delete / copy id), **Remove device**
  (unpair), **Copy thread ID** for CLI resume.
- **Full Git** — full-screen `GitScreen` (per-file `git/diff`,
  branch switch with auto-stash, smart PR dialog, undo-commit,
  `git/revert`, `git/deleteBranch`, `git/removeWorktree`, etc.).
- **FCM push** (gated) — Android LIVE; deep-link to conversation;
  **personalized copy** + foreground suppression; per-channel
  notification preferences (Replies / Errors).
- **Settings** — theme mode (System/Light/Dark) + a **custom-theme library**
  with a dedicated Theme Manager (single/dual-brightness themes, live-preview
  grid, multi-select bulk delete/export, JSON import/export); language (EN/ES,
  follows device or picker); notification preferences.
- **i18n** — full app translated (EN + ES) via `flutter gen-l10n`.

Remaining/deferred work (Bug A relink latency, OpenCode/pi interactive approvals
— a bridge-side gap, project-level thread scoping, automated integration test,
and all iOS work) is tracked in [`FOR-DEV.md`](FOR-DEV.md); the pending iOS/Apple
assets are in [`FOR-HUMAN.md`](FOR-HUMAN.md). See [`CHANGELOG.md`](CHANGELOG.md)
for the full history.

## Documentation

Developer reference lives in [`docs/`](docs/README.md): the as-built
[architecture](docs/architecture.md), the [testing guide](docs/testing.md), and
the [conventions](docs/conventions.md). The product/design spec (source of
truth) is the monorepo [`architecture/`](../architecture/00-index.md).
