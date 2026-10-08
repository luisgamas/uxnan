# Agent views in chat

Agent views are interactive HTML pages carried as `view` content blocks. The desktop fetches each page through the owning bridge's `view/read` method, stages the prepared HTML in memory, and displays it inside the chat timeline. HTML does not travel in the chat stream.

## Isolation

Views load from the dedicated `uxnan-view` scheme (`uxnan-view://localhost/<id>` on macOS/Linux and `http://uxnan-view.localhost/<id>` on Windows). The Rust scheme store retains at most 24 documents and 16 MiB. Its responses set the same strict policy as the prepared page: scripts and styles may be inline, images/media/fonts may use inline data, and all network connections, nested frames, forms, and base URLs are blocked. Staged pages are returned with `nosniff` and `no-store` headers.

The iframe has `sandbox="allow-scripts"` only and no `allow` permissions, so the page runs with an opaque origin: it cannot read the app's storage, globals or DOM. It cannot call the app's Rust side either, for two reasons checked in the Tauri 2.11 / wry 0.55 sources the app builds with: Tauri injects its IPC bootstrap — which carries the per-launch random invoke key — into the **main frame only** (`for_main_frame_only: true`, `tauri/src/manager/webview.rs`), and every IPC request must present that key or is rejected (`tauri/src/webview/mod.rs`, `on_message`). A framed page has no way to learn it, and its `connect-src 'none'` policy blocks a `fetch` to the IPC endpoint before that. The app's own CSP permits frames only from the view scheme origins.

The host accepts messages only when `event.source` is the iframe's `contentWindow`, then validates the JSON-RPC envelope and bounded method parameters. Link requests support only HTTP, HTTPS, and mail links and ask before opening in the external browser. Messages and element annotations are inserted into the chat draft; they are never sent automatically.

## Performance and use

- Pages are fetched and staged only when their card enters a 240px viewport margin.
- Prepared HTML is cached in memory up to 4 MiB; the scheme store is bounded to 24 documents / 16 MiB.
- At most four iframes stay mounted across the app. Older frames are suspended with their measured height reserved; returning to a card mounts it again.
- The requested height is clamped to 80–1600 CSS pixels. The page can report a measured height, and taller content scrolls inside its frame.
- **Annotate** lets the person pick elements in the view. A picked element stays highlighted while a popover anchored to it takes the note; each saved note leaves a numbered marker on its element, and clicking a marker reopens that note to edit or delete it. The header then shows *N notes · Add to message*, which puts every note into the composer at once (nothing is sent on its own); notes survive leaving annotate mode until added or discarded. **Expand** opens the same staged page in a large dialog.

## Checking a view before it is shown

The control catalog exposes `view_render` (`view/render`, CLI `uxnan-cli view
render <file.html> --out <file.png>`) so an agent can check a prepared page before
showing it; the bridge's `view_check` calls it when a desktop is attached. Pass the
prepared HTML from the bridge, including its CSP and bootstrap, and optionally a
width from 240 to 1600 CSS pixels (default 720). Only one render runs at a time.

The desktop loads a disposable child webview off the window with the render frame
(`uxnan-view://…/render/<key>`, `RENDER_FRAME` in `src-tauri/src/views.rs`): our own
page, which holds the agent's page in an `allow-scripts` iframe. A webview's main
frame gets Tauri's IPC bridge injected; the sandboxed child, with its opaque
origin, gets none and cannot reach its parent — checked live: a page that looked
for the bridge in itself and in its parent found neither. The frame answers the
page's `ui/initialize`, keeps the height it reports and the errors and warnings
its bootstrap forwards (`uxnan/log`), and once the page has loaded writes the
report into its own URL's hash, which the Rust side reads; then it captures the
PNG (`browser/capture.rs`) and closes the webview. A hidden webview gets no
animation frames, so the frame waits on a timer.

The result carries the capture as `image` (`mimeType`, `width`, `height`,
`data` — MCP callers receive it as an image block), the document's content
height, up to 50 bounded console messages, and `timedOut`. A timeout still
returns a capture; `contentHeight` is 0 and `console` is empty when the page did
not report before the 10-second deadline. The HTML is capped at 2 MiB. This is a
preview in the desktop's webview engine and width, not a claim that every device
renders it identically.

## Development and verification

Run `npm run check` and `npm test` from `uxnandesktop/`. Run Rust checks from `uxnandesktop/src-tauri/` with `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test view`. The tests cover JSON-RPC validation, bounded parameters and render reports, height clamping, annotation formatting, scheme response headers, and store eviction.

The automated component test asserts `sandbox="allow-scripts"`, no `allow` attribute, `no-referrer`, and the dedicated scheme URL. The Rust response test asserts the scheme response carries the exact no-network CSP (`connect-src 'none'`) and security headers. When Tauri is upgraded, re-check the two facts the IPC isolation rests on (main-frame-only bootstrap, invoke-key check) in its sources.

## Where a view sits in a settled turn

A view is part of the answer, never of the work. When a settled turn folds the steps (desktop) or the earlier responses (phone) that led to its answer, the views leave the fold, in the order the agent showed them, and open the visible answer — otherwise only someone who knew a view was there would find it. The desktop does it in `splitAnswer` (`src/lib/bridge/timeline.ts`), the phone in the message view's response grouping; both follow the same rule.
