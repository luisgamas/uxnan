# Interactive agent views

Agent views are assistant message blocks whose HTML is fetched from the bridge
with `view/read`. The timeline stores only `viewId`, title, byte count, optional
height hint and block id. Mobile validates the id and response bounds before
displaying the prepared HTML.

## Rendering and isolation

`ViewBlock` reserves the agent-provided height (or 320 px) clamped to 80–1600
CSS px. A valid `ui/notifications/size-changed` message updates that height,
so that the conversation never jumps under the reader's finger:

- A size measured at zero width is ignored: Android lays the page out before
  the WebView has its width, and the heights it reports then (0, or several
  screens) are not the page's.
- Reports are gathered for 150 ms and a change under 4 px is ignored, so a page
  whose images decode in steps resizes the card once.
- The last reported height of each view is remembered for the life of the app
  (`ViewHeights`, 256 views). The conversation list builds a message only near
  the screen, so a view scrolled away is rebuilt when it comes back; it starts
  at the height it had instead of the agent's hint.
- While the conversation is scrolling, a resize waits for the scroll to stop,
  and a card whose top is above the screen moves the scroll offset by the same
  amount it grows (`keepScreenStill`), so what the reader sees stays still.
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
called. `ui/message` is offered to the composer, and annotation notes stay on
the view until the user adds them to the message; neither path sends a turn
automatically. Existing composer text is rescued using the app's composer
handoff state.

## Notes and markers

Theme changes send `ui/notifications/host-context-changed`. Annotate toggles
send `uxnan/annotate`. A page selection opens the note sheet while the page
holds that element; saving adds or replaces a note, deleting removes it, and
dismissing leaves the notes unchanged. The host sends the current numbered
`uxnan/annotations` marks after every sheet closes and whenever notes change, so
the page can release a held element and keep its markers current. A tapped
`uxnan/mark` opens that note for editing or deletion. Notes remain on the view
while annotation mode is off. The inline card and full-screen route share one
notes model; *Add to message* hands the complete list to the composer using the
same `formatViewAnnotations` text format as the shared TypeScript contract,
then clears the notes and marker list. *Discard notes* clears the notes and
markers without changing the composer.

## Verification

Run `flutter test test/unit/domain/agent_view_test.dart
test/unit/presentation/view_host_session_test.dart
test/unit/infrastructure/bridge_agent_view_repository_test.dart
test/widget/presentation/view_block_test.dart`, then `dart analyze` and
`dart format lib test`. A real Android/iOS WebView pass is still needed to check
platform gesture arbitration, JavaScript channel behavior and theme updates.

## Where a view sits in a settled turn

A view is part of the answer, never of the work. When a settled turn folds the steps (desktop) or the earlier responses (phone) that led to its answer, the views leave the fold, in the order the agent showed them, and open the visible answer — otherwise only someone who knew a view was there would find it. The desktop does it in `splitAnswer` (`src/lib/bridge/timeline.ts`), the phone in the message view's response grouping; both follow the same rule.
