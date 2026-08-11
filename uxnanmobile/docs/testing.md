# Testing & validation — uxnanmobile

![Analyze](https://img.shields.io/badge/flutter_analyze-very__good__analysis-0175C2?style=for-the-badge&logo=dart&logoColor=white)
![Tests](https://img.shields.io/badge/flutter_test-unit_%2B_widget-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![DB](https://img.shields.io/badge/drift-in--memory_in_tests-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

How to run the checks, how the tests are organized, the patterns they use, and
what still needs a real device or a live bridge. (For the **Node** side —
`bridge`/`relay`/`shared` — see
[`../../bridge/docs/testing.md`](../../bridge/docs/testing.md) and
[`../../relay/docs/testing.md`](../../relay/docs/testing.md).)

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

```text
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
- **Workspace viewer regression layers.** Pure presentation tests cover file
  classification, README HTML normalization (tables, `<kbd>`/`<sub>`/`<sup>`),
  GitHub block splitting (alerts, `<details>`, fenced-code immunity), safe
  relative-resource resolution and GIF/SVG detection; unit tests cover remote
  media-type resolution (payload signature over header), caching, and the
  https/size guards through a stubbed Dio adapter. Widget tests drive the real
  viewer through mocked workspace RPC responses and a stubbed remote loader —
  an extensionless shield, a badge-sized slot whose fetch fails, alert
  callouts, a disclosure that only reveals its body on tap, task
  lists/tables/highlighted fences, and a **real-world README shape** (layout
  table with a demo image, `<picture>`, `<kbd>` chips, alerts, disclosures, odd
  fence languages) asserted to render with nothing dropped — while the bridge
  suite asserts exact PDF base64 and size-limit behavior. That last fixture is
  the standing guard for the regression where "more GitHub support" cost the
  document its own content: the Markdown work was validated by diffing
  normalization against the previous implementation over 29 widely-used
  external READMEs (React, VS Code, Deno, Kubernetes, Storybook, Windows
  Terminal, appwrite, n8n, …) and rendering each one — the diff must stay empty
  except for deliberate improvements, and no document may raise a layout error. `flutter build apk --debug` additionally compiles the
  native PDFium integration; see [`file-viewer.md`](file-viewer.md).
- **Simulated bridge.** Transport/coordinator tests run a persistent in-memory
  "bridge" peer to exercise the handshake, RPC round-trips, notifications and
  reconnect without a network.
- **Crypto vectors.** The E2EE primitives are checked against RFC 8032/7748/5869
  and NIST AES-GCM vectors. Plus a **cross-language interop vector** for the
  envelope AAD: a fixed key/nonce/AAD/plaintext whose ciphertext+tag are produced
  by the bridge's Node `crypto` and decrypted by the app's `AesGcm` (the same
  bytes are asserted from the bridge side in `bridge/test/transport/crypto.test.ts`).
  This is the artifact that proves the two `buildEnvelopeAad` implementations
  agree byte-for-byte — a mismatch would make the app and the bridge mutually
  undecryptable.

## What automated tests do NOT cover (verify manually)

These need a real device and/or a live bridge+relay; defer until reachable:

- **On-device flows:** pairing QR scan → handshake, push notifications and the
  notification-tap deep-link (needs Firebase native config — see `FOR-HUMAN.md`),
  camera permission, speech-to-text. Also verify an Android cloud/device-transfer
  restore and an iOS device restore require re-pairing (the secure phone identity
  must not migrate), then confirm profile activity rehydrates from the bridge.
- **Live bridge contracts:** the exact JSON shapes of `thread/list`,
  `git/status`, `agent/*`, and the advanced `approval`/`plan`/`subagent`/
  `compaction`/`assistant_response_boundary` payloads are decoded with
  **tolerant** parsers; confirm field names against a real bridge / a real
  Codex/Claude turn.
- **Native build correctness** beyond compilation (run the APK on a device).

When you add a feature that can only be fully verified this way, leave a
`FOR-DEV:` marker and note it in [`../FOR-DEV.md`](../FOR-DEV.md) rather than
claiming it verified.

## Measuring how a reply renders while it streams

Streaming smoothness cannot be asserted from a widget test — it is frames on a
real phone. Whenever you touch the conversation's render path, measure it the
same way, or the numbers below mean nothing.

**Never measure this in a debug build.** Debug runs the JIT with assertions on,
so its build times are not the app's. This is not a technicality: the stutter was
once assumed to be "just debug", and it was not.

1. **Add a probe** (it is deliberately not kept in the tree — a probe that
   reports per frame doubles the work it measures). Gate it on `!kReleaseMode`,
   register `SchedulerBinding.instance.addTimingsCallback`, count one rebuild per
   call to `ThreadManager._rebuildActiveTimeline` with the live turn's
   `streamedLength`, and print **one line every 3 s**:

   ```
   UXPROBE mode=profile window=3s rebuilds=17 chars=8639
           build p50=1.3 p95=8.8 max=18.4 raster p50=3.8 janky=3/344
   ```

2. **Build and install** — profile signs with the debug keystore, so it upgrades
   over the installed app and the local database survives:

   ```bash
   flutter build apk --profile --dart-define=ENABLE_LOGGING=true
   adb install -r build/app/outputs/flutter-apk/app-profile.apk
   ```

3. **Capture** `adb logcat -s flutter` while asking for **one long reply
   containing code** — the most expensive shape, since it pays Markdown and
   syntax highlighting. Aim past 5 000 characters: below that nothing has ever
   shown up.

4. **Read it by reply length, not in aggregate.** The failure mode this path is
   prone to is cost that *grows with the reply*, which an average hides.

**Baseline to compare against** (Galaxy A55, profile, replies over 4 500 chars,
after the settled-chunk split of 2026-08-11): build p95 ≈ **11 ms**, worst frame
≈ 22 ms, dropped frames ≈ **1.2 %**, raster flat at ≈ 3.7 ms, and — the part that
matters — p95 **flat or falling** as the reply grows. Before that change the same
phone gave p95 28.1 ms, 7.0 % dropped, and p95 climbing 18 → 36 ms from 5 k to
11 k characters.

A raster time that stays near 3.7 ms while build time climbs means the cost is
building and laying out widgets, not drawing them — do not go looking at the GPU.
