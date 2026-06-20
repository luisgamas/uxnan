# Architecture (as built)

A developer-oriented map of the actual code. The canonical design is the
monorepo [`architecture/`](../../architecture/00-index.md) spec — when this doc
and the spec disagree, the spec wins (the project is ALPHA; code follows spec).

Dart package: `uxnan` (imports are `package:uxnan/...`). Android applicationId /
iOS bundle: `dev.luisgamas.uxnanmobile`. State management: **Riverpod 3.x, manual** (no
codegen). Local persistence: **drift** (SQLite). UI: **Material 3**.

## Layers

Clean Architecture under `lib/`, with a strict dependency direction:

```
presentation ─▶ application ─▶ domain ◀─ infrastructure
     └──────────────▶ domain ◀──────────────┘
                       core (no deps)
```

| Layer | Path | Responsibility | May depend on |
|---|---|---|---|
| `core/` | `lib/core/` | Pure helpers (logger, extensions). | nothing |
| `domain/` | `lib/domain/` | Entities, value objects, enums, repository **interfaces**, domain services. Pure Dart, no Flutter. | core |
| `application/` | `lib/application/` | Coordinators, managers, processors — orchestration and use-case logic. | domain |
| `infrastructure/` | `lib/infrastructure/` | Transport (WebSocket + E2EE), storage (drift), repository **implementations**, crypto, notifications, platform. | domain |
| `presentation/` | `lib/presentation/` | Screens, widgets, Riverpod providers (DI), router, theme. | domain, application |

Rule of thumb: `domain` never imports Flutter; `presentation` never reaches into
`infrastructure` except through a provider.

## Directory map (the parts you'll touch most)

- `domain/entities/` — `Thread`, `Message`, `TrustedDevice`, `AgentDescriptor`
  (+ `AgentCapabilities`), `SecureSession`, git entities, …
- `domain/value_objects/message_content.dart` — the sealed `MessageContent`
  hierarchy + its tolerant JSON codec (text/code/image/tool/diff/mermaid/system/
  command + `approval`/`plan`/`subagent` + `UnknownContent` fallback).
- `domain/repositories/` — `IThreadRepository`, `IMessageRepository`,
  `ITrustedDeviceRepository`, git log repo (interfaces only).
- `application/coordinators/session_coordinator.dart` — connection lifecycle:
  transport selection, E2EE handshake, secure channel, request/response
  correlation, auto-reconnect with backoff. Exposes streams.
- `application/managers/` — `ThreadManager` (threads + active timeline),
  `GitActionManager` (status/commit/push), `PushRegistrar` (FCM token +
  notification taps). `application/processors/incoming_message_processor.dart`
  turns bridge notifications into `DomainEvent`s.
- `infrastructure/transport/` — `WebSocketTransport`, `SecureTransportLayer`
  (handshake), `SecureChannel` (AES-256-GCM + seq/replay), `RequestCorrelator`,
  `BackoffCalculator`, `OutboundMessageBuffer`.
- `infrastructure/storage/local_database.dart` — the drift schema + migrations.
- `infrastructure/repositories/` — drift implementations of the domain repos.
- `presentation/providers/` — `infrastructure_providers.dart` (infra DI) and
  `application_providers.dart` (coordinators/managers + derived stream/family
  providers the UI watches).
- `presentation/screens/` — `devices/`, `threads/`, `conversation/`,
  `onboarding/`, `pairing/`. `presentation/router/app_router.dart` is the flat
  GoRouter table. `presentation/theme/` holds the design tokens.

## Dependency injection / provider graph

Manual Riverpod. Infrastructure is constructed in `infrastructure_providers.dart`
and composed in `application_providers.dart`. The important ones:

- `sessionCoordinatorProvider` → the `SessionCoordinator`.
- Stream providers off the coordinator: `connectionPhaseProvider`,
  `connectionRecoveryProvider`, `activeMacProvider`, `trustedDevicesProvider`.
- `threadManagerProvider` → `ThreadManager`; UI watches `threadsProvider`
  (all threads) and `activeTimelineProvider` (the open conversation).
- `agentsProvider` (`agent/list`), `agentModelsProvider(agentId)`
  (`agent/models`), and `agentCapabilitiesProvider(agentId)` (capabilities with
  a permissive default when unknown).
- `gitActionManagerProvider` + `gitRepoStateProvider` / `gitActiveActionProvider`.
- `pushRegistrarProvider` (kept alive by `_PushHost` in `app.dart`).

## Data flow (bridge → UI)

1. `SessionCoordinator` connects, performs the E2EE handshake, and opens a
   `SecureChannel`. Outbound RPCs go through `sendRequest`; inbound frames are
   exposed as the `incomingMessages` stream.
2. `IncomingMessageProcessor` classifies inbound notifications into typed
   `DomainEvent`s (turn started/delta/completed/error/aborted, git progress).
3. `ThreadManager` applies streaming events to a `TurnTimelineSnapshot` (via a
   reducer), persists finalized messages to drift, and exposes the timeline as a
   `BehaviorSubject` stream.
4. The UI watches the derived stream providers and rebuilds reactively.

## Patterns worth knowing

- **Streams over `ValueNotifier`.** Managers expose `rxdart` `BehaviorSubject`
  streams (replayed on listen) consumed via Riverpod `StreamProvider`s.
- **Tolerant parsers.** JSON from the bridge is decoded defensively (unknown
  `MessageContent` types round-trip as `UnknownContent`; unknown enum values
  fall back). Newer bridges never break decoding.
- **Graceful degradation.** Thread `rename`/`delete`/`archive`/`unarchive` apply
  locally first, then call the bridge best-effort and swallow "method not found"
  so the app stays usable before the bridge implements a handler.
- **Capability-aware UI.** Conversation controls (approval row, attach button)
  are gated by the active agent's `AgentCapabilities`, permissive when unknown.
- **drift migrations** are additive with explicit version bumps; see
  `local_database.dart`.

See [conventions.md](conventions.md) for the coding rules and
[testing.md](testing.md) for how each of these is tested.
