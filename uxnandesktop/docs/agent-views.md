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
- **Annotate** lets the person select an element in the view and add a note to the composer. **Expand** opens the same staged page in a large dialog.

## Development and verification

Run `npm run check` and `npm test` from `uxnandesktop/`. Run Rust checks from `uxnandesktop/src-tauri/` with `cargo fmt --check`, `cargo clippy --all-targets --all-features`, and `cargo test views::`. The tests cover JSON-RPC validation, bounded parameters, height clamping, annotation formatting, scheme response headers, and store eviction.

The automated component test asserts `sandbox="allow-scripts"`, no `allow` attribute, `no-referrer`, and the dedicated scheme URL. The Rust response test asserts the scheme response carries the exact no-network CSP (`connect-src 'none'`) and security headers. When Tauri is upgraded, re-check the two facts the IPC isolation rests on (main-frame-only bootstrap, invoke-key check) in its sources.
