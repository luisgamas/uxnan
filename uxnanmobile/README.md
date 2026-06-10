# uxnanmobile

Flutter mobile client (Android + iOS) for **Uxnan** — a remote control for AI
coding agents running on a PC, over an end-to-end encrypted channel.

> Full technical specification: [`../architecture/`](../architecture/00-index.md).
> The architecture docs are the source of truth; this app implements them.

## Stack

| Concern | Choice |
|---|---|
| Language / SDK | Dart 3.4+, Flutter 3.22+ |
| Architecture | Clean Architecture — `core/`, `domain/`, `application/`, `infrastructure/`, `presentation/` |
| State management | Riverpod (manual providers, **no** code generation) |
| Navigation | `go_router` |
| UI | Material 3, adaptive light/dark, centralized design tokens |
| Local persistence | `drift` (SQLite) |
| Secure storage | `flutter_secure_storage` (Keychain / Keystore) |
| Crypto | `cryptography` + `pointycastle` (X25519, Ed25519, AES-256-GCM, HKDF) |
| Lint | `very_good_analysis` |

Package id: `com.uxnan.mobile` · Dart package name: `uxnan` (imports use
`package:uxnan/...`).

## Project layout (`lib/`)

```
core/            cross-cutting utilities (constants, errors, extensions, utils)
domain/          entities, value_objects, enums, repositories, usecases (pure Dart)
application/     coordinators, managers, processors (use cases orchestration)
infrastructure/  transport, storage (drift), repositories, platform, crypto
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
> fallback and for **background push** (FCM). When a paired bridge advertises a
> relay URL, the phone reads it from the QR; nothing is injected at compile time.

### Build flavors

Configuration is injected at compile time with `--dart-define` (spec 03 §3.3):

| Variable | dev | staging | prod (default) |
|---|---|---|---|
| `ENV` | `dev` | `staging` | `prod` |
| `ENABLE_LOGGING` | `true` | `true` | `false` |

## Quality

```bash
dart format lib test
flutter analyze            # must report 0 issues
flutter test               # unit + widget tests
```

## Status

Wired MVP. All core modules are implemented and connected to live bridge data:
E2EE crypto + secure transport, QR pairing/onboarding, the paired-PC list with
**truthful, connection-targeted multi-PC status** (every live action targets the
PC we actually hold a channel to — browsing another PC is read-only until you
connect to it), threads scoped to the selected PC, **live streaming
conversations that survive leaving/re-entering the screen** (per-thread buffers
+ `turn/list` re-sync) with a per-thread **"Responding…" activity** indicator,
the new-conversation flow (`project/list` + `agent/list` + `agent/models`) with
a **folder browser** (`workspace/browseDirs`) to root a thread anywhere, a
per-thread **structured model picker** (readable names, default badge, Claude
alias "(latest)" + pinned versions + resolved-version row; `thread/setModel`), a
**context-usage indicator** (percentage when the model's window is known, raw
token count otherwise), per-thread actions (rename / delete / copy id, with a new
thread defaulting its title to its id), capability-aware conversation controls
(approval/attach gated by the agent's `AgentCapabilities`), notification tap →
deep-link to the conversation, Git status/commit/push, robust reconnection (app
heartbeat + relay peer-close), "Verify connection", and gated FCM push
notifications (builds/runs with no Firebase config). Remaining/deferred work
(interactive approval responses, notification preferences UI, LAN discovery,
per-file diff, etc.) is tracked in
[`FOR-DEV.md`](FOR-DEV.md); native Firebase config is in
[`FOR-HUMAN.md`](FOR-HUMAN.md). See [`CHANGELOG.md`](CHANGELOG.md) for the
full history.

## Documentation

Developer reference lives in [`docs/`](docs/README.md): the as-built
[architecture](docs/architecture.md), the [testing guide](docs/testing.md), and
the [conventions](docs/conventions.md). The product/design spec (source of
truth) is the monorepo [`architecture/`](../architecture/00-index.md).
