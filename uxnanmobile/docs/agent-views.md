# Interactive agent views

Agent views are assistant message blocks whose HTML is fetched from the bridge
with `view/read`. The timeline stores only `viewId`, title, byte count, optional
height hint and block id. Mobile validates the id and response bounds before
displaying the prepared HTML.

## Rendering and isolation

`ViewBlock` reserves the agent-provided height (or 320 px) clamped to 80–1600
CSS px. A valid `ui/notifications/size-changed` message updates that height.
The WebView is created only when its message widget enters the built viewport;
up to three inline instances stay live. When all three slots are occupied, the
card offers a tap to load. Prepared pages use `loadHtmlString` without a base
URL; navigation requests are blocked, JavaScript is limited to the view host
channel, Android file/content access and zoom are disabled, and the bridge's
prepared no-network CSP remains in force. Inline document overflow is hidden so
vertical gestures can continue scrolling the conversation. Expand opens a
full-screen route and loads the same cached page again.

## Host messages

`ViewHostSession` is the pure Dart boundary for messages from `UxnanView`. It
checks JSON-RPC 2.0, an explicit method allowlist, an 8 KiB message limit,
bounded proposed text, bounded annotations and safe external URL schemes.
`ui/initialize` receives host theme variables, brightness, platform, locale and
display mode. Link requests require confirmation before the OS link opener is
called. `ui/message` and annotation notes become composer drafts; they never
send a turn automatically. Existing composer text is rescued using the app's
composer handoff state.

Theme changes send `ui/notifications/host-context-changed`. Annotate toggles
send `uxnan/annotate`; page selections open a note sheet and use the same
`formatViewAnnotations` text format as the shared TypeScript contract.

## Verification

Run `flutter test test/unit/domain/agent_view_test.dart
test/unit/presentation/view_host_session_test.dart
test/unit/infrastructure/bridge_agent_view_repository_test.dart
test/widget/presentation/view_block_test.dart`, then `dart analyze` and
`dart format lib test`. A real Android/iOS WebView pass is still needed to check
platform gesture arbitration, JavaScript channel behavior and theme updates.

## Where a view sits in a settled turn

A view is part of the answer, never of the work. When a settled turn folds the steps (desktop) or the earlier responses (phone) that led to its answer, the views leave the fold, in the order the agent showed them, and open the visible answer — otherwise only someone who knew a view was there would find it. The desktop does it in `splitAnswer` (`src/lib/bridge/timeline.ts`), the phone in the message view's response grouping; both follow the same rule.
