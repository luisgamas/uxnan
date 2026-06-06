# Changelog

All notable changes to the `uxnanmobile` app are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Pairing logic (QR)** — spec 02a §5.5:
  - `PairingPayload` entity with `fromQrString` (Base64-JSON QR decode) and
    `PairingValidator` (domain service): checks QR version, required fields and
    expiry with clock-skew tolerance, returning a typed result.
  - `ITrustedDeviceRepository` + `TrustedDeviceRepository`: split storage —
    device metadata in drift, the bridge identity key in `SecureStore`.
  - `SessionCoordinator.processPairingPayload` (validate → persist
    `TrustedDevice` → set active → QR-bootstrap connect) and `cancelPairing`,
    with optional pairing dependencies so existing wiring is unaffected.
  - Providers: `trustedDeviceRepositoryProvider`, `pairingValidatorProvider`,
    wired into `sessionCoordinatorProvider`.
  - Tests: payload parse/round-trip + malformed/missing-field, validator
    (valid/expired/unsupported-version/malformed), repository split-storage
    round-trip, and an end-to-end `processPairingPayload` over the simulated
    bridge.
  - **FOR-DEV** (deferred): manual-code pairing (relay REST), the pairing/
    onboarding UI (next increment), and standalone pairing use-case classes.
    See `FOR-DEV.md`.

- **SessionCoordinator + connection orchestration** — spec 02a §5.2.1 / 02c §11:
  - `SessionCoordinator` (application layer): drives the connection lifecycle
    (connect / disconnect / switchMac), runs the handshake via
    `SecureTransportLayer`, opens a `SecureChannel`, and exposes
    `connectionPhase`, `recoveryState`, `activeMac` and inbound `incomingMessages`
    as streams.
  - `sendRequest`: encrypts + sends when connected, otherwise buffers for replay;
    inbound envelopes are decrypted and routed to the `RequestCorrelator`
    (responses) or the `incomingMessages` stream (requests/notifications).
  - Automatic reconnection: on an unexpected drop, retries with
    `BackoffCalculator` up to a max (default 10) before entering the terminal
    error phase; intentional `disconnect()` does not reconnect.
  - `TransportSelector` interface + `RelayTransportSelector` (relay via
    `relayUrl` with `x-role`/`x-session-id` headers; LAN discovery deferred).
  - `SecureStore` interface + `FlutterSecureStore`, and `PhoneIdentityStore`
    (load-or-create the persistent Ed25519 identity — spec 02b RF-PAIR-08).
  - Riverpod 3.x providers: `secureStoreProvider`, `phoneIdentityStoreProvider`,
    `secureTransportLayerProvider`, `transportSelectorProvider`,
    `sessionCoordinatorProvider`, and the `connectionPhaseProvider` /
    `connectionRecoveryProvider` / `activeMacProvider` `StreamProvider`s.
  - Tests: a persistent **simulated bridge over an in-memory transport** drives
    a full connect, an encrypted `sendRequest` round-trip, inbound notification
    delivery, intentional disconnect, and **automatic reconnect after a drop**;
    plus `PhoneIdentityStore` load-or-create against an in-memory store.
  - Deferred: `IncomingMessageProcessor` (domain-event classification, with the
    conversation module), `TransportSelector` LAN discovery, and live WebSocket
    integration against a real bridge.

- **Secure transport + connection mechanics** — spec 02a §5.9 / 02c §11:
  - `WebSocketTransport` interface + `WebSocketChannelTransport`
    (`web_socket_channel`, `IOWebSocketChannel` so the relay's `x-role` /
    `x-session-id` upgrade headers are honored).
  - `SecureTransportLayer.performHandshake`: the phone side of the
    clientHello → serverHello → clientAuth → ready flow, verifying the nonce
    echo, transcript expiry (with clock-skew tolerance), the trusted bridge
    identity, and the Ed25519 signature before deriving the session key.
  - `SecureChannel`: AES-256-GCM encrypt/decrypt with 1-based outbound
    sequencing and replay rejection (`seq <= lastApplied` ⇒
    `TransportException(replay)`).
  - `RequestCorrelator` (JSON-RPC request/response matching + timeout),
    `BackoffCalculator` (exp. 1→60s with ±30% jitter), `OutboundMessageBuffer`
    (sliding window) and `classifyRaw` message triage.
  - Value objects/entities: `RpcMessage` (+`RpcError`), `PhoneIdentity`,
    `TrustedDevice`, `ConnectionRecoveryState`; added `web_socket_channel` dep
    and a `TransportErrorKind.replay`.
  - Tests: a full **two-party handshake over an in-memory transport pair**
    (phone + simulated bridge derive the same key; untrusted-identity rejected),
    channel round-trip + replay rejection, correlator, backoff bounds, buffer
    sliding window, and RpcMessage JSON.
  - Deferred to the next increment: `SessionCoordinator` orchestration
    (ConnectionPhase state machine + reconnection loop + Riverpod wiring),
    `TransportSelector` LAN discovery, `IncomingMessageProcessor`, and live
    WebSocket integration against a real bridge.

- **E2EE cryptography** — spec 02a §5.9 / 02b §5:
  - `KeyGeneration`: Ed25519 identity key pairs, X25519 ephemeral key pairs,
    CSPRNG nonces.
  - `HandshakeCrypto`: canonical transcript builder, Ed25519 bilateral
    sign/verify, and X25519 + HKDF-SHA256 session-key derivation
    (`salt = clientNonce || serverNonce`, `info = "uxnan-e2ee-v1"`).
  - `EnvelopeCrypto`: AES-256-GCM authenticated encryption with the documented
    envelope wire format (12-byte nonce, 16-byte tag); decryption failures
    surface as `TransportException(decryption)`.
  - `SecureSession` entity (in-memory key + seq counters) and `SecureEnvelope`
    value object.
  - `MessageFingerprinter` (SHA-256 via pointycastle) + `TextFingerprint`.
  - Tests against published vectors: Ed25519 (RFC 8032), X25519 (RFC 7748),
    HKDF-SHA256 (RFC 5869), AES-256-GCM (NIST all-zero), a full two-party
    handshake that proves both sides derive the same key, plus tamper/wrong-key
    rejection and SHA-256 known-answer checks.
  - Contract note: the transcript is the UTF-8 of the fields' wire strings
    concatenated in order (hex for byte fields, raw string for `sessionId`,
    decimal for integers); the bridge must mirror this exactly.
  - Library choice: AES-256-GCM uses the `cryptography` package (native
    acceleration via `cryptography_flutter`); the algorithm/params are exactly
    per spec — no variant. `pointycastle` remains for synchronous SHA-256.
  - Deferred to the connection module: WebSocket transport, secure-transport
    seq/replay enforcement, request correlator, LAN/relay transport selector,
    and the `SessionCoordinator` handshake orchestration (they need the live
    message flow / bridge).

- **Local persistence (drift / SQLite)** — spec 02c §10:
  - Full schema (`schemaVersion` 1): `threads`, `messages`, `turns`,
    `projects`, `trusted_devices`, `composer_drafts`, `git_action_log` tables,
    with WAL + foreign-keys pragmas.
  - `UxnanDatabase` (drift) with an in-memory `forTesting` constructor.
  - `Thread` domain entity + `IThreadRepository` / `IComposerDraftRepository`
    contracts.
  - `DriftThreadRepository` (faithful to spec §10.3) and
    `DriftComposerDraftRepository`.
  - DI providers: `databaseProvider`, `threadRepositoryProvider`,
    `composerDraftRepositoryProvider` (spec 03 §1.5 / §3.6 levels 1–2).
  - In-memory repository tests for the full thread CRUD + watch surface.
  - Table indexes use the real drift `@TableIndex` annotation (the spec's
    `List<Index> get indexes` sketch is not the actual drift API).
  - `Message`/`Turn`/`Project`/`TrustedDevice` repositories are deferred to
    their modules (they depend on the `MessageContent` sealed hierarchy,
    `AgentConfig`, or split storage with `SecureStore`); their tables already
    exist in the schema.

### Changed

- Migrated state management to **Riverpod 3.x** (`^3.0.0`), reconciling the
  spec's "Riverpod 3.x manual" guidance (AGENTS.md / 00-index). The state layer
  will use the modern `Notifier`/`NotifierProvider` API.

### Added (foundation)

- Initial Flutter project scaffold (Android + iOS), package name `uxnan`,
  application id `com.uxnan.mobile`.
- Clean Architecture skeleton: `core/`, `domain/`, `application/`,
  `infrastructure/`, `presentation/` directory layers (per spec 02a §7).
- `core/` layer:
  - `protocol_constants.dart` and `app_constants.dart` (compile-time
    `--dart-define` configuration, spec 03 §3.3 / 02a §5.9.1).
  - Typed errors: `AppException`, `RpcException` (JSON-RPC code table),
    `TransportException`.
  - Extensions on `String`, `DateTime`, `Uint8List` (hex/base64).
  - `AppLogger` (gated by `ENABLE_LOGGING`) and `Debouncer` utilities.
- Domain enums: `MessageRole`, `TurnStatus`, `ThreadStatus`,
  `ThreadSyncState`, `HandshakeMode`, `ConnectionPhase`, `GitActionKind`,
  `AgentId` (with stable wire-id mapping).
- Material 3 design system: `colors.dart`, `typography.dart`, `spacing.dart`
  and the dark-first `buildUxnanTheme()` builder (spec 02c §3.1).
- App fonts bundled: Inter (400/500/600/700) and JetBrains Mono (400/500) under
  `assets/fonts/`, declared in `pubspec.yaml` (resolves the FOR-HUMAN item).
- App entry point: minimal `main.dart` (`ProviderScope`), `app.dart`
  (`MaterialApp.router` + theme + l10n), `app_router.dart` (`go_router`
  provider) and the home empty-state screen.
- Internationalization (`flutter_localizations` + ARB): English and Spanish.
- `analysis_options.yaml` based on `very_good_analysis` (spec 02c §15.1).
- Foundation tests: core extensions, `AgentId` mapping, and an app smoke test.
- iOS deployment target 15.0; Android `minSdk` 24 (spec 02b §3.4).

### Notes / deferred

- The following spec packages are added in their respective module increments
  to keep the build green until native configuration exists:
  Firebase (`firebase_core`, `firebase_messaging`, `flutter_local_notifications`),
  QR scanner (`mobile_scanner`, `permission_handler`), SSH terminal
  (`dartssh2`, `xterm`), rich media (`flutter_inappwebview`, `lottie`,
  `cached_network_image`, `shimmer`), `image_picker`, `file_picker`, `vibration`,
  and `freezed`/`json_serializable` (added when entities need them).
- Riverpod is pinned to `^3.0.0` (see the Changed entry above). The spec's 2.x
  `StateNotifierProvider` examples (02b §2.1) are adapted to the modern
  `Notifier`/`NotifierProvider` API when the state layer is built.
- `analysis_options.yaml` omits the spec's `prefer_relative_imports` rule
  because it contradicts `always_use_package_imports`; the project enforces
  full package imports (spec 03 §1.5).
