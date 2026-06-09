# Testing & validation — uxnanmobile

How to run the checks, how the tests are organized, the patterns they use, and
what still needs a real device or a live bridge. (For the **Node** side —
`bridge`/`relay`/`shared` — see the monorepo [`../../TESTING.md`](../../TESTING.md).)

## Commands

Run from `uxnanmobile/`:

```bash
flutter pub get
flutter gen-l10n            # after editing l10n/*.arb
flutter analyze            # very_good_analysis, strict — must be clean
flutter test               # the whole suite
flutter test test/unit/application/thread_manager_test.dart   # one file
flutter build apk --debug  # native Android build (analyze/test do NOT catch native issues)
dart format lib test       # formatting (also wraps long lines)
```

Quality gate before calling anything done: **`flutter analyze` clean +
`flutter test` green**, and a `flutter build apk --debug` after touching native
config (Gradle/manifest/plist) or renaming the applicationId.

## Layout

```
test/
├── unit/
│   ├── core/            # extensions, small utils
│   ├── domain/          # entities, value objects, codecs, services
│   ├── application/     # coordinators, managers, processors
│   ├── infrastructure/  # transport, crypto, drift repositories
│   └── presentation/    # providers, theme
├── widget/presentation/ # screen + widget tests
└── integration/         # (placeholder; see "deferred" below)
```

Convention: every public function gets a test (AGENTS.md, ALPHA rule). Mirror the
`lib/` path under `test/unit|widget/`.

## Patterns used here

- **In-memory drift.** Repository/manager tests open
  `UxnanDatabase.forTesting(NativeDatabase.memory())` — no files, fast, isolated.
- **Fake `RpcSend`.** `ThreadManager`/`GitActionManager` take a `sendRequest`
  function; tests pass a fake that records the method and returns a canned
  `RpcMessage.response(...)`. Unknown methods return an empty result so
  best-effort calls (`thread/archive`, …) degrade exactly like in production.
- **`ProviderContainer` overrides.** Provider tests build a `ProviderContainer`
  with `overrides:` (e.g. override `agentsProvider`), `await` the future, then
  read the derived provider.
- **Widget harness.** Widget tests wrap the screen in `ProviderScope(overrides:
  [...])` + `MaterialApp.router` with a tiny `GoRouter` and the app's
  `AppLocalizations` delegates; stream providers are overridden with
  `Stream.value(...)`. The default test window is **800×600** — keep modal
  sheets scrollable so they don't overflow there.
- **Simulated bridge.** Transport/coordinator tests run a persistent in-memory
  "bridge" peer to exercise the handshake, RPC round-trips, notifications and
  reconnect without a network.
- **Crypto vectors.** The E2EE primitives are checked against RFC 8032/7748/5869
  and NIST AES-GCM vectors.

## What automated tests do NOT cover (verify manually)

These need a real device and/or a live bridge+relay; defer until reachable:

- **On-device flows:** pairing QR scan → handshake, push notifications and the
  notification-tap deep-link (needs Firebase native config — see `FOR-HUMAN.md`),
  camera permission, speech-to-text.
- **Live bridge contracts:** the exact JSON shapes of `thread/list`,
  `git/status`, `agent/*`, and the advanced `approval`/`plan`/`subagent` payloads
  are decoded with **tolerant** parsers; confirm field names against a real
  bridge / a real Codex/Claude turn.
- **Native build correctness** beyond compilation (run the APK on a device).

When you add a feature that can only be fully verified this way, leave a
`FOR-DEV:` marker and note it in [`../FOR-DEV.md`](../FOR-DEV.md) rather than
claiming it verified.
