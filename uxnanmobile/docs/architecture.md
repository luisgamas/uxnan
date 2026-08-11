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
  the flat GoRouter table, wrapped in a single `ShellRoute`.
  `presentation/theme/` holds the design tokens — including `icons.dart`, the
  `UxIcons` catalogue every glyph is named in.

**Wide windows get a permanent drawer, and only that changes.** `AppShell`
(`presentation/screens/shell/app_shell.dart`) is the `ShellRoute` builder: on
compact and medium it returns the routed screen *literally*, so the phone's
screen stack and back behaviour are untouched; on expanded and above it puts
that screen in `TwoPaneScaffold`'s content pane beside `NavDrawer`.

**Destinations are never wrapped.** Onboarding and pairing because there is
nothing to navigate to yet (and pairing would offer to switch to a PC you are
mid-way through adding); **settings and profile** because they are somewhere you
*went*, not something you opened from the list — and Settings splits into its
own two panes, so a drawer beside it would be a third column showing
conversations that cannot change anything on that screen. The decision is made
from the route, not the width, so it holds while a raw-pushed child screen (a
settings section) is open and across a rotation.

The route table itself does not change. A second navigator, or a branch per
pane, would give tablets their own navigation model, and every deep link, push
notification and `context.go` would have to work in both.

`NavDrawer` is **three zones and nothing else**: the PC (with a real `switchMac`
behind the switcher, and the pairing call to action in its place when nothing is
paired), the spaces tree via `ThreadsScreen(embedded: true)`, and the profile row
that returns the content pane to the overview. It is a `Material` rather than a
`NavigationDrawer`: that component models N fixed destinations with one
selected, and its own scrollable would nest inside the tree's.

Navigation inside the shell goes through `context.openInPane` / `closePane`
(`presentation/router/pane_navigation.dart`), which is where "a tap means two
different things" is decided instead of at every call site. On a phone it
pushes and pops. On a wide window it **replaces**: nothing was left behind, so a
stack there is one the layout gives you no way to see. Because the file browser
and git screens open with a raw `Navigator.push` — landing above the routed page
— `openInPane` empties `shellNavigatorKey` before it navigates; without that,
`go` swapped the page underneath and left them covering it.

**Two panes is the ceiling.** Where a surface already sits beside the drawer,
or is itself split, the next level down stacks inside its pane through a nested
`Navigator` rather than becoming a third column — see `docs/conventions.md`.
Settings uses it for its sections' own children; the conversation's file browser
and git screens get the same shape from `shellNavigatorKey`, which is why they
fill the content pane and leave the drawer alone.

A repository's identity is `repoKeyFor(path)`, namespaced away from the folder
at the same path: collapse state is a set of these strings, and sharing one made
collapsing the main folder collapse the whole project.

Which PC it shows comes from `shellDeviceProvider`, resolved by how much each
source knows — the open conversation's thread, then the last list visited
(persisted through `ThreadListPreferencesStore`), then the connected PC. A deep
link into `/conversation/:id` has no list behind it, and without this the drawer
is blank in exactly the case a tablet user meets first.

The home screen (`presentation/screens/devices/my_devices_screen.dart`) is the
**overview**. Its bar carries the product's identity rather than the screen's —
`_BrandMark` as the title, a `ProfileAvatarView` action on the right — and its
heading is `_OverviewHeadline`, a two-row greeting plus a status line that
simply scrolls away under the pinned bar. Facts come from
`profileNameProvider`, `trustedDevicesProvider`, `connectedDeviceProvider` and
`memberSinceProvider`; each is dropped rather than faked when absent.
`memberSinceProvider` reads the metrics **cache** only — `profileMetricsProvider`
falls back to aggregating the whole local database, which the app's first screen
must not trigger.

Each PC card is an identity row (glyph with a status dot · name · address · a
labelled last-connection line · overflow menu) over a row of `NeBadge`s —
connection, and a live one when agents are working — with Connect and the
conversation count on the bottom row. Status and network path share one badge via `networkKindLabel`, the same
mapping `TransportBadge` uses, so the two cannot drift apart. The counts come
from the local thread cache (`deviceThreadCountProvider`,
`deviceWorkingCountProvider`, both on `deviceThreadsProvider`), so they describe
a PC the phone is not currently connected to. Those providers count only threads **explicitly tagged** with that
`deviceId`: the threads list deliberately shows untagged legacy threads under
every PC, and counting them the same way would inflate every card by the same
threads.

The profile screen carries no identity card — that would duplicate the
overview's header one screen deeper. Editing the profile and the ledger
export/import live in its app-bar overflow menu (`profile_backup_actions.dart`),
disabled while no PC is connected because the bridge is what seals and verifies
the file.

Connection feedback stays scoped to the actual PC card, and says only what is
known:

- A live session's connection badge names the classified network path (`LAN`,
  `Tailscale`, `Direct`, `Relay`) derived from the winning endpoint — falling
  back to a plain "Connected" when the path is not classified yet, never to an
  empty badge.
- A PC whose attempt is in flight reads `Detecting…`. The path is deliberately
  withheld until the channel is live, because it is not known yet.
- A disconnected PC reads `Disconnected`, and only its own card's Connect button
  goes to `Connecting…` while its own attempt runs.

The status dot on the machine glyph carries the same three states, so the card
is readable before any of its text is.

A PC's conversations are grouped by the **folder** they run in, by
`groupThreadsByWorkspace` (`application/services/workspace_grouping.dart`) — a
pure function over `threadsProvider` + `projectsProvider`, so the whole
inference is testable and the `git/worktrees` contract can replace it without
touching the UI. Paths are matched after normalising separators and case; the
path shown and copied is the one that was reported. Configured roots contribute
their name only.

A **repository level** sits above the folders when the bridge can prove one:
`git/worktrees` (`workspaceRepoTableProvider`) says which folders are worktrees
of which repository. It asks about the folders **on the list** — the distinct
`cwd`s of this PC's conversations — not about the bridge's configured roots:
`workspaceRoots` is optional and frequently empty, since a conversation can be
started anywhere through the folder picker. One reply names every sibling of its
repository, so folders already covered are skipped and ten worktrees of one repo
cost one call. It is never inferred from
path prefixes — worktrees are siblings on disk, so a shared prefix says nothing,
and inferring it is what sank the first attempt at this level.

`buildWorkspaceTree` then applies the two rules that keep it honest: a
repository node appears only when it relates **two or more** folders (a heading
over one folder is chrome, not structure), and a folder that relates to nothing
stays where it is rather than being swept into an "other" bucket. On a bridge
without the method the table is empty and the list is exactly the flat one it
was before.

`ThreadsScreen` flattens the folders into typed rows (`_WorkspaceRow`,
`_ThreadRow`) so the sliver stays lazy. Folder collapse is persisted as the set
of **closed** keys (`collapsedProjectsProvider`), so a folder seen for the first
time is open. **Three orderings apply independently**, one per level of the tree:
`projectSortProvider`, `worktreeSortProvider` and `threadSortProvider`. All
three take the same `ListSort` — one enum rather than three near-identical ones,
which would drift apart the first time one of them gained an option:

| | Meaning |
|---|---|
| `status` | What wants you first: waiting, then blocked, then working. Ties break on recent activity — what you were most likely looking at. |
| `activity` | What moved last. |
| `created` | Newest first. A folder has no creation date of its own (the bridge reports a path, not a history), so `workspaceCreatedAt` stands in with the **oldest conversation inside it**: when work there began. |
| `name` | Alphabetical. |

The worktrees **inside** a project are ordered by the same setting as the
top-level ones: `buildWorkspaceTree` takes a comparator instead of sorting them
itself, which is what previously put them out of the menu's reach. Without one
it still leads with the main worktree.

The menu itself asks in **two steps** — levels, then that level's orderings —
because offering all of them at once was seventeen entries and ran off the
screen. Both steps open at the same anchor (`menuPositionUnder`), so the second
does not read as a different control; the first shows each level's current
ordering so the common question is answered without drilling in; and a screen
with one level to order skips straight to its orderings.

Only the agent ordering is persisted; the other two are in memory, because they
are usually changed to answer a question rather than set once as a preference.
The archive offers a **reduced** set (`kArchiveSorts`: created and name):
archived work is finished by definition, so `status` and `activity` would sort
by a value that can no longer change.

A folder row is two lines whose **second one changes with the fold**: open, just
the conversation count, since every conversation carries its own agent mark and
state one row below; closed, the agents inside it as well, plus the strongest
state among them on the first line. Folding must not hide what the screen exists
to surface. The count yields before the marks do, so a long translation
ellipsizes instead of overflowing the row.

The **archive** (`archived_threads_screen.dart`) stays a flat list on purpose.
The active list groups because the question it answers is *where work is
happening*; the archive answers *which one was it*, and a search field with a
date sort answers that better than a hierarchy you have to expand — grouping
would put a navigation step in front of a lookup.

Each folder's **git state** comes from `workspaceGitProvider`
(`presentation/providers/workspace_git_provider.dart`), a per-cwd
`git/status`. Its rules are about cost: only while connected to that PC, only
while the indicators are on screen (`autoDispose` — a collapsed folder draws
none, so nothing is watched and nothing is fetched), and at most one request per
folder per `kWorkspaceGitThrottle` (15 s). The refresh that matters arrives on
`gitStatusBusProvider` after a commit, push or pull, so the poll is the slow
safety net rather than the mechanism. The row omits zeros, caps at three
signals, and draws nothing at all when it has no answer — never "clean".

A thread row reads state → agent → text (`thread_tile.dart`), mirroring
`uxnandesktop`'s agent rows: `AgentStatusIndicator`, then a bare `AgentLogo` a
step larger, then the title over its second line.

An agent's state in the thread list is **derived, not reported**:
`agentRunStatusProvider` (`presentation/providers/agent_run_state_provider.dart`)
folds turn activity, the pending-question set, sign-in status, queue state and
unread into one `AgentRunState` plus two modifiers. The desktop's equivalent
comes from a hook server it owns; nothing in the bridge carries it, so this must
not be mistaken for a fact the PC sent.

The pending-question set is the piece that makes it useful in a list:
`ThreadManager.awaitingInputStream` records the approval/question blocks as they
arrive **for every thread**, not just the open one, and clears them when the user
answers or the turn ends. It is in-memory only, and rebuilt on resync because
`turn/list` replays the blocks.

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
   earlier native assistant messages. **Deltas are coalesced, in a window
   that grows with the reply** (`_streamCoalesceWindow`, 16→100 ms): the reply
   is rendered as Markdown while it streams, so rebuilding per delta re-parsed
   all of it every time, making a turn quadratic in its own length. A fixed
   one-frame window does not help — deltas land in bursts, even after the
   bridge coalesces the agent's output over 25 ms before sending — so
   the window widens as the text grows, which is where the cost is (measured on
   a 6 000-char reply: 18.9 s of rebuild work per delta, 3.4 s at 100 ms).
   Nothing is dropped: whatever lands inside the window renders together on the
   next frame. Only deltas coalesce — a completed turn, a content block or a
   re-sync still renders immediately.
   **A settled paragraph is no longer rebuilt at all.** Streaming prose is cut
   at boundaries that cannot move again (`streaming_markdown_split.dart`) and
   each finished chunk keeps its widget instance, which Flutter skips rather
   than rebuilding; only the chunk still growing is rebuilt. The cut refuses any
   blank line inside a code fence or before a line that could continue the block
   above it, and the two renderings are compared **pixel by pixel** in
   `streaming_markdown_fidelity_test.dart` — Markdown split in the wrong place
   renders differently, so "it looks the same" is asserted, not assumed.
   Measured on device before this: 5.4 ms per frame at p95 under 4 500
   characters against 28.1 ms past it, with the raster flat at 3.7 ms.
4. `assistant_response_boundary` metadata keeps those native messages ordered;
   `compaction` metadata marks only protocol-confirmed context compactions. Both
   survive `turn/list` re-sync and are excluded from copy text and previews.
5. While the channel is connected, `ThreadManager` polls `turn/list` for the
   active idle conversation every three seconds. The bridge reconciles the
   agent-owned native transcript first, so completed turns written from another
   supported client arrive as ordinary user + assistant messages. Concurrent
   reconnect/navigation/resume reads are deduplicated, local user messages are
   matched by turn id, and no polling occurs while the bridge owns a live turn.
   A newest-page read also **drops the messages of a turn the bridge no longer
   reports** — the bridge owns which turns a thread has, and without this a turn
   it removed (a duplicate its own history import had created) would render from
   the phone's store forever. Deliberately narrow: only inside the window that
   page covers, so an older page loaded by scrolling up is untouched; never the
   streaming turn, a queued one, or an echo that has no turn id yet; and never a
   message written after the read began, so a send that lands while the page is
   in flight survives.
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
  row, and folding restores them.
- **drift migrations** are additive with explicit version bumps; see
  `local_database.dart`.

See [conventions.md](conventions.md) for the coding rules and
[testing.md](testing.md) for how each of these is tested.
