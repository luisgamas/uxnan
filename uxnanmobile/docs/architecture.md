# Architecture (as built)

![Layers](https://img.shields.io/badge/Clean_Architecture-core_%E2%86%92_domain_%E2%86%92_app_%E2%86%92_infra_%E2%86%92_ui-0553B1?style=for-the-badge)
![State](https://img.shields.io/badge/Riverpod_3.x-manual_DI-blue?style=for-the-badge)
![Persistence](https://img.shields.io/badge/drift-SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

A developer-oriented map of the actual code. The canonical design is the
monorepo [`architecture/`](../../architecture/00-index.md) spec — when this doc
and the spec disagree, the spec wins (the project is ALPHA; code follows spec).

Dart package: `uxnan` (imports are `package:uxnan/...`). Android applicationId /
iOS bundle: `dev.luisgamas.uxnanmobile`. State management: **Riverpod 3.x, manual** (no
codegen). Local persistence: **drift** (SQLite). UI: **Material 3**.

## Layers

Clean Architecture under `lib/`, with a strict dependency direction:

```text
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
  command + `approval`/`plan`/`subagent`/`compaction`/
  `assistant_response_boundary` + `UnknownContent` fallback). Compaction and
  response-boundary variants are zero-text timeline metadata.
- `domain/repositories/` — `IThreadRepository`, `IMessageRepository`,
  `ITrustedDeviceRepository`, git log repo (interfaces only).
- `application/coordinators/session_coordinator.dart` — connection lifecycle:
  transport selection, E2EE handshake, secure channel, request/response
  correlation, auto-reconnect with backoff. Exposes streams.
- `application/managers/` — `ThreadManager` (threads + active timeline),
  `GitActionManager` (status/commit/push), `FileBrowserManager` (lazy workspace
  tree, search, guarded file/image reads, writes and Git diffs), and
  `PushRegistrar` (FCM token + notification taps).
  `application/processors/incoming_message_processor.dart` turns bridge
  notifications into `DomainEvent`s.
- `infrastructure/transport/` — `WebSocketTransport`, `SecureTransportLayer`
  (handshake), `SecureChannel` (AES-256-GCM + seq/replay), `RequestCorrelator`,
  `BackoffCalculator`, `OutboundMessageBuffer`.
- `infrastructure/storage/local_database.dart` — the drift schema + migrations.
- `infrastructure/storage/secure_store.dart` — OS-backed secrets. Android backup
  rules exclude the plugin's encrypted preference files; iOS uses a non-migrating
  Keychain accessibility class. An installation without its original secret gets
  a fresh pairing identity, while the root app shell keeps `metricsSnapshotsProvider`
  alive so every (re)connection rehydrates profile activity from the bridge.
- `infrastructure/repositories/` — drift implementations of the domain repos.
- `presentation/providers/` — `infrastructure_providers.dart` (infra DI) and
  `application_providers.dart` (coordinators/managers + derived stream/family
  providers the UI watches).
- `presentation/screens/` — `devices/`, `threads/`, `conversation/`,
  `onboarding/`, `pairing/`; `conversation/files/` owns the capability-based
  source, Markdown, image, SVG, PDF and Git-diff viewer described in
  [`file-viewer.md`](file-viewer.md). `presentation/router/app_router.dart` is
  the flat GoRouter table. `presentation/theme/` holds the design tokens.

The Devices screen keeps connection feedback scoped to the actual PC card:

- A live session renders `Connected` plus the classified network badge (`LAN`,
  `Tailscale`, `Direct`, or `Relay`) derived from the winning endpoint.
- A PC whose connection attempt is in flight renders one `Detecting…` status.
  The badge is intentionally hidden until the channel is live because the
  network path is not known yet.
- A disconnected PC renders no network badge. Its `Connect` button remains
  disabled with `Connecting…` only while its own attempt is active.

This presentation logic lives in `_StatusLine` within
`presentation/screens/devices/my_devices_screen.dart`; the underlying
`networkKindProvider` and session streams remain unchanged.

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
   `BehaviorSubject` stream. A completion re-reads the authoritative turn and
   reconciles terminal text additively, so a final payload cannot overwrite
   earlier native assistant messages. **Deltas are coalesced into one rebuild
   per frame**: the reply is rendered as Markdown while it streams, so
   rebuilding per delta re-parsed the whole reply every time, making a turn
   quadratic in its own length (measured: 5.8 s of rebuild work for a 6 000-char
   reply, against 1.2 s unformatted). A delta arriving faster than the screen
   redraws cannot be seen, so nothing is lost by rendering the window together
   on the next frame. Only deltas coalesce — a completed turn, a content block
   or a re-sync still renders immediately.
4. `assistant_response_boundary` metadata keeps those native messages ordered;
   `compaction` metadata marks only protocol-confirmed context compactions. Both
   survive `turn/list` re-sync and are excluded from copy text and previews.
5. While the channel is connected, `ThreadManager` polls `turn/list` for the
   active idle conversation every three seconds. The bridge reconciles the
   agent-owned native transcript first, so completed turns written from another
   supported client arrive as ordinary user + assistant messages. Concurrent
   reconnect/navigation/resume reads are deduplicated, local user messages are
   matched by turn id, and no polling occurs while the bridge owns a live turn.
6. The UI watches the derived stream providers and rebuilds reactively. Partial
   assistant prose and settled prose both pass through the shared
   `MarkdownBody` + `uxnanMarkdownStyleSheet` path, so formatting does not switch
   from visible source syntax when a turn completes. During streaming every
   assistant response stays visible; after completion, earlier progress
   responses fold under the localized **N previous messages** disclosure.
7. Assistant prose sends explicit Markdown links, detected bare local paths and
   inline-code paths through one callback. `FileBrowserManager` asks the bridge
   to resolve the citation on the PC, then opens `FileViewerScreen` with the
   returned `cwd + path`. A relative citation stays rooted at the conversation;
   an absolute or parent-relative citation may switch the viewer to a sibling
   worktree's Git root. Mobile never tries to reinterpret PC paths locally.

For a new thread, `ThreadManager` preserves the bridge-provided title. When the
first textual user message is sent and that title is still empty, the thread id,
or the bridge's `New` / `New thread` placeholder, the manager normalizes and
truncates that prompt into the conversation title and syncs it with
`thread/rename`. It checks for an existing user message first, so subsequent
prompts cannot overwrite either the automatic title or a manual rename.

## Patterns worth knowing

- **Streams over `ValueNotifier`.** Managers expose `rxdart` `BehaviorSubject`
  streams (replayed on listen) consumed via Riverpod `StreamProvider`s.
- **Tolerant parsers.** JSON from the bridge is decoded defensively (unknown
  `MessageContent` types round-trip as `UnknownContent`; unknown enum values
  fall back). Newer bridges never break decoding.
- **Graceful degradation.** Thread `rename`/`delete`/`archive`/`unarchive` apply
  locally first, then call the bridge best-effort and swallow "method not found"
  so the app stays usable before the bridge implements a handler.
- **Capability-aware UI.** The compact turn-context shelf (approval and model
  run options) and the "+" media menu are gated by the active agent's
  capabilities; unknown capabilities remain permissive. The shelf starts
  folded beside the visible edit/context indicators; expanding it animates
  those read-only indicators out so the controls can use the full phone-width
  row, and folding restores them. The deprecated
  `gemini-cli` is an explicit exception: descriptors, cached threads, metrics and
  provider usage are filtered before they reach any mobile product surface.
- **drift migrations** are additive with explicit version bumps; see
  `local_database.dart`.

See [conventions.md](conventions.md) for the coding rules and
[testing.md](testing.md) for how each of these is tested.
