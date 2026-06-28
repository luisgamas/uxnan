# Changelog

All notable changes to the `uxnanmobile` app are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — in-app update checker (Play In-App Updates + iOS App Store)
- **The app now checks for newer versions and lets the user decide — no silent
  install.** A throttled check runs on cold start and on resume (at most once
  every 12 h); a manual *Check now* lives in **Settings → Updates**, and an
  *Update available* banner appears atop the threads list when a newer version
  ships. On **Android** it drives the **Play In-App Update** API (an *immediate*,
  user-confirmed, Play-managed download + install + restart); on **iOS** it looks
  up the **App Store** version and opens the listing. The banner is dismissible
  per store version (it won't nag again until a *newer* one ships).
- Wraps the `flutter_upgrade_version` plugin behind a guarded, injectable
  `AppUpdateService` (`infrastructure/updates/`) that maps both platforms to a
  single `AppUpdateStatus` value object; an `AppUpdateController`
  (`presentation/providers/update_providers.dart`) owns the throttle, dismissal
  and the user-initiated launch. State + throttle persist in
  `UpdatePreferencesStore` (`uxnan.updates.lastCheckMs` /
  `…dismissedVersion`). Added `url_launcher` for the iOS App Store open action,
  and R8 keep rules for `com.google.android.play.core.**` (release minify is on).
- **Caveats:** Android In-App Updates only report a real update when the build
  was installed from **Google Play** (a Play *internal-testing* track build) — a
  sideloaded `--release`/debug APK reports "no update", by design. The **iOS**
  path is inert until the app has an **App Store listing** (the iTunes lookup
  returns empty before then). A separate **GitHub-Releases-APK** update channel
  is **not** covered by this plugin (tracked in `FOR-DEV.md`).
- Tests: `app_update_service_test.dart` (platform mapping, guards, start/open),
  `update_preferences_store_test.dart`, `update_controller_test.dart`
  (throttle / dismiss / launch) — 24 new tests.

### Fixed — commit history is now in correct chronological order
- The History screen's commits were sometimes out of time order (a branch's
  commits grouped together, so some commits made around the same time showed far
  apart). Fixed in the bridge — `git/log` switched from `--topo-order` to
  `--date-order` — so the phone now matches the desktop ADE and GitHub. No
  mobile code change; it consumes the bridge fix.

### Changed — history branch graph: VS Code swimlane curves
- **The History graph now uses the VS Code swimlane model + true arc
  connectors.** Lanes *compact* — when a branch merges, the extra lanes waiting
  for the commit collapse into the node and the lanes to their right shift one
  column left — so the graph narrows with flowing curves instead of leaving
  parallel gaps. Connectors are real circular arcs (`Path.arcToPoint`): a
  quarter-circle (radius ≈ one lane) into/out of a node, and a gentle S when a
  passing lane shifts column — replacing the previous stable-lane layout and
  tiny rounded-step connectors. Node dots are unchanged (solid dot, with a
  separate outer ring on merges). `git_history_screen.dart` (`_buildGraph`
  swimlane layout → per-row `_GraphEdge` list, `_GraphPainter` arc geometry).

### Changed — file browser: git-conventional colours + dimmed ignored entries
- **Untracked files use the conventional git colour again, and git-ignored
  entries are now dimmed (muted + italic).** PR #25 had coloured *untracked*
  files in a muted italic tone — but that's the universal "git ignores this"
  affordance, and it diverged from the rest of the app, where untracked is the
  `gitUntracked` blue (the Git screen, commit detail, diff views). The browser
  now matches that convention: untracked → blue, like added/modified/deleted in
  their tokens. Rows no longer carry a medium weight at all — colour alone (plus
  italic for ignored) conveys the state. The muted-italic *dimmed* treatment is
  reserved for **ignored** entries, a distinct concept (a file type vs a git
  state), surfaced by the bridge's new `WorkspaceEntry.ignored` flag and carried
  on `FileEntry` / `FileTreeNode`. Ignored is independent of `gitStatus`
  (ignored entries never appear in `git/status`), so an ignored folder dims even
  while collapsed and its children dim when expanded.
  - `domain/entities/file_browser.dart` (`FileEntry.ignored`,
    `FileTreeNode.ignored`), `application/managers/file_browser_manager.dart`
    (carries the flag through), `presentation/.../widgets/file_tree_tile.dart`
    (untracked → `gitUntracked`; ignored → muted + italic).
  - Tests: +5 (`file_tree_tile_test.dart`: untracked/modified/ignored/clean
    visuals; `file_browser_manager_test.dart`: the ignored flag flows through and
    survives a git-status repaint).

### Fixed — a mid-stream turn's earlier reply is no longer lost on reconnect (Bug A)
- **The live re-attach now seeds the streaming buffer with the in-flight turn's
  partial output.** When the app was killed and reopened while the agent was
  mid-turn, the re-attach (`activeTurnId`) recreated the `_live` buffer **empty**,
  so the text the agent had already streamed before the close (e.g. "on it, let
  me check…") vanished from the bubble — only output produced *after* the
  reconnect showed, and because new deltas made the buffer non-empty, the
  finalized message also dropped the earlier part. The bridge already persists
  deltas as they stream and returns the accumulated text/thinking/blocks for the
  active turn in `turn/list`, so `_resyncThread` now pre-fills the re-attached
  `_LiveTurn` from that partial content (blocks first, then the text run kept
  last so the next delta extends it in place). No bridge/contract change — it
  consumes the partial content `turn/list` already reports. Confirmed against the
  fresh `[reconn]` capture: a full close/reopen handshakes as `trusted_reconnect`
  with "no catch-up backlog to replay", i.e. `_live` is genuinely empty at resync
  time. Tests: +1 (`thread_manager_test.dart`: a resync seeds the live buffer
  with the in-flight turn's partial text).
  - `application/managers/thread_manager.dart` (`_resyncThread`, `_seedLiveTurn`).

### Fixed — a resume resync no longer hangs the thread view for 30 s (Bug A)
- **The resume/reconnect `turn/list` resync now uses an 8 s timeout** instead of
  the request correlator's 30 s default. When the app returns from the background
  the socket can be silently half-open, so the resync round-trip gets no reply;
  the `[reconn]` capture showed it stall the full 30 s (`turn/list resync failed
  (kept local)`) while the thread sat un-refreshed. With the tighter bound it
  gives up fast and keeps local state — and the already-shipped live re-attach
  (`activeTurnId` + the `_ensureLive` self-heal) restores any in-flight turn from
  the stream — so the view recovers quickly. Only the resync (newest-page) pull is
  bounded; user-driven older-page paging keeps the default timeout. The bound is
  injectable (`ThreadManager.resyncTimeout`) so tests don't wait it out. Tests:
  +1 (`thread_manager_test.dart`: a resync over a half-open socket fails fast,
  not after 30 s) → **433** unit + widget tests, all green.

### Fixed — dial direct hosts in parallel so a dead host can't stall reconnection (Bug A)
- **`DirectTransportSelector` now connects to every advertised direct host
  concurrently** instead of one-at-a-time, and keeps the first that connects
  within the per-host timeout (the rest are disconnected). Serial dialing made
  reconnection pay one **full** per-host timeout for every unreachable address
  ahead of a live one — the `[reconn]` capture showed a resume burning 2 s on a
  dead virtual NIC (`172.27.192.1`) **and** 2 s on a Tailscale host still waking
  from OS suspension before it could even try the next candidate. Parallel
  dialing returns as soon as *any* host answers, so a single slow/dead address no
  longer adds to the relink latency. The relay fallback (when every direct host
  fails) is unchanged. Pairs with the bridge-side fix that stops advertising
  unreachable virtual-NIC addresses in the first place (see `bridge/CHANGELOG.md`).
  Tests: +1 (`transport_selector_test.dart`: a hanging host no longer blocks a
  reachable one) → **432** unit + widget tests, all green.

### Fixed — a turn no longer "dies" on the phone after reconnecting mid-stream
- **The phone re-attaches to a turn still in flight on the bridge.** Before, the
  "responding…" indicator + composer Stop button were driven only by the
  in-memory `_live` buffer, created **only** on `turn_started`. If the app
  missed that event (reconnected mid-turn, or was killed and reopened while the
  agent kept running on the PC), every later `delta`/`thinking`/`block` was
  silently **dropped** — the turn looked ended, the app waited for nothing, and
  the only way forward was to type again. Three coupled fixes in
  `application/managers/thread_manager.dart`:
  - **Self-heal (`_ensureLive`).** A stream event for a turn we aren't tracking
    now lazily (re)creates the live buffer and re-lights the activity indicator
    instead of being dropped — any further agent output revives the view. The
    bridge serializes one in-flight turn per thread, so a delta for a different
    `turnId` correctly replaces a stale one.
  - **Proactive re-attach on resync.** `resyncActive`/`_resyncThread` reads the
    new `turn/list` → `activeTurnId` (the bridge's authoritative in-flight turn,
    absent after a bridge restart) and recreates `_live` before persisting, so
    the indicator + Stop reappear immediately on resume — without resurrecting a
    turn that already ended.
  - **Authoritative completion text.** `TurnCompletedEvent` now carries the
    bridge's full final `text` (`processors/incoming_message_processor.dart`,
    `processors/domain_event.dart`); `_finishTurn` uses it when the live buffer
    captured no streamed text (re-attached mid-turn), so the finalized bubble is
    never left empty/partial — while preserving the interleaved live text+blocks
    in the normal case.
  - Tests: `test/unit/application/thread_manager_test.dart` (+3: self-heal,
    resync re-attach, authoritative-text completion). NOTE: this is the
    "active-turn loss" half of the remote-connection work; the relink-latency /
    reconnect-loop half is still tracked in `FOR-DEV.md` (Bug A).

### Changed
- **File browser: file rows show details + are comfortable by default, with a
  compact option.** Two changes to the in-conversation file browser rows:
  - **Details line replaces the redundant name.** With extensions hidden, each
    row showed a second line that just repeated the file's path/name *with* the
    extension — noise. That line is gone; in its place, files now show a details
    line — **size · modified date** (the modified date comes from the new
    `WorkspaceEntry.mtime`, localised via `intl`) — toggleable from the 3-dot
    menu (*Show file details*, on by default). Directories never show details.
  - **Taller rows by default + a compact mode.** Rows were cramped at a single
    line's height; they're now a little taller by default so the name + details
    breathe (`UxnanSpacing.sm` vertical), with a *Compact rows* toggle in the
    3-dot menu that restores the previous tight spacing (`UxnanSpacing.xs`).
  - `presentation/screens/conversation/files/widgets/file_tree_tile.dart`,
    `file_browser_screen.dart`, `providers/file_browser_providers.dart`
    (`showFileDetailsProvider`, `compactFileRowsProvider`), `FileEntry`/
    `FileTreeNode.mtime`, new l10n `fileBrowserShowDetails` /
    `fileBrowserCompactRows`.
- **File browser: untracked files now clearly distinct from tracked ones.** In
  the in-conversation file browser, untracked files were painted in
  `onSurfaceVariant` — a muted grey barely distinguishable from the
  tracked-unchanged `onSurface` tone, so you couldn't tell at a glance which
  files git is and isn't tracking. The split is now carried by weight + style,
  not just hue: every *tracked* row (unchanged or changed) uses a medium weight,
  while *untracked* rows stay regular weight and **italic** in the muted
  `onSurfaceVariant` tone. Each git state keeps its own colour
  (tracked-unchanged neutral, untracked muted, added/modified/deleted/renamed in
  their diff colours).
  - `presentation/screens/conversation/files/widgets/file_tree_tile.dart`
    (`gitStatusColor`, `FileTreeTile`).
- **Consistent circular floating scroll buttons.** The git history's
  back-to-top button was M3's default rounded-square `FloatingActionButton`,
  while the conversation's scroll-to-bottom button is a circle; NE's action
  language is circular, so both now share one widget
  (`presentation/widgets/ne_circular_button.dart`, `secondaryContainer`).
- **Commit detail: per-file expandable diffs.** The commit detail screen no
  longer shows one big combined diff under the file list; each touched file is
  now its own collapsible card (collapsed by default) that reveals **just that
  file's diff** when tapped — mirroring the clean per-file cards of the
  version-control screen. The combined `git/commitShow` diff is split per file
  client-side (keyed by new/old path). `NeSurface` was hoisted from
  `git_screen.dart` into `presentation/widgets/ne_surface.dart` for reuse.
  - `presentation/screens/conversation/git/git_commit_detail_screen.dart`,
    `presentation/widgets/ne_surface.dart` (new), new l10n
    `gitHistoryNoTextDiff` / `gitHistoryBinaryDiff`.

### Fixed
- **File browser: folders/files no longer keep a stale git colour after a
  commit.** Once a file or its parent folder was painted as changed, the colour
  could never be cleared: `FileTreeNode.copyWith` read `gitStatus: gitStatus ??
  this.gitStatus`, so passing `null` (a node gone clean) preserved the old
  status, and `_applyGitStatus` early-returned the node unchanged whenever its
  new status was `null`. After committing through the git screen (or an external
  CLI commit on the same PC), the browser kept showing the change. `copyWith`
  now sentinel-guards `gitStatus` (passing `null` *clears* it, like `error`),
  and the repaint walk rebuilds a node whenever its status actually changed —
  including a non-null → null transition — so committed changes drop their
  colour immediately. Added a regression test covering the modified → clean
  path.
  - `domain/entities/file_browser.dart` (`copyWith`),
    `application/managers/file_browser_manager.dart` (`_applyGitStatus`),
    `test/unit/application/file_browser_manager_test.dart`.
- **Git history graph: pass-through lanes no longer draw diagonal "hooks".** A
  lane just crossing a row was routed to `outgoing.indexOf(occupant)`, which —
  when the same parent occupied two lanes (a commit with multiple children,
  common around merges) — returned the *first* lane, so the other lane bent
  sideways every row. Pass-through lanes now draw a straight vertical in their
  own column (lanes are never compacted), matching VS Code / the desktop graph.
  - `presentation/screens/conversation/git/git_history_screen.dart`
    (`_GraphPainter`).
- **Git history graph: no more ref-chip overflow, cleaner lanes.** In graph
  mode each row now shows a single width-capped primary ref chip (branch > tag
  > HEAD > remote) plus a `+N` marker instead of every chip inline, so a tip
  with several refs (e.g. `HEAD`/`main`/`origin/main`) can no longer overflow
  the row; `CommitRefChip` ellipsizes when width-capped. The graph connectors
  are now VS Code-style rounded steps (vertical → arc → vertical) instead of
  swoopy S-curves. (The missing-commits / phantom-lane problem itself is fixed
  bridge-side — `git/log` now uses topological order + offset pagination + a
  merge-safe parser; this page just consumes the corrected, opaque cursor.)
  - `presentation/screens/conversation/git/git_history_screen.dart`,
    `widgets/commit_ref_chip.dart`; regression widget test for the overflow.

### Added
- **Redesigned git history + full commit detail.** The history screen is now a
  single clean, flat list (no card chrome — matches the file browser) with two
  app-bar `IconSurface` toggles: **graph** (a VS Code-style swimlane overlay —
  fixed-height rows so dots align, branch-stable colors that follow a branch
  across columns, smooth branch/merge curves, and a distinct merge node = solid
  dot + separate outer ring) and **compact** density. Branch/tag/HEAD chips
  (from the new `GitCommit.refs`), a colored short-SHA badge + green/red `+/−`
  on each row, **infinite scroll** + a **back-to-top** FAB, and a *Load older
  commits* footer. Tapping a commit opens a new full-screen
  **`GitCommitDetailScreen`** (via `git/commitShow`): full message, ref chips,
  author/committer/date, copyable SHA, parents, stats, the **file list**
  (status + per-file `+/-` + rename `from <old>`), and the **complete unified
  diff** (colored, horizontally scrollable, truncation notice). An app-bar
  **branch/ref picker** (`git/branches`) views any branch's/remote's history
  read-only (no checkout), with a "Viewing <ref>" banner + one-tap return to
  HEAD.
  - `presentation/screens/conversation/git/git_history_screen.dart` (rewrite),
    `git_commit_detail_screen.dart` (new), `widgets/commit_ref_chip.dart` (new).
- **File browser: "Collapse all folders" action.** A new `IconSurface`
  (`unfold_less`) in the file browser app bar collapses every expanded
  directory in one tap; it only appears when at least one folder is open.
  Fetched children are kept in the tree so re-expanding is instant
  (`FileBrowserManager.collapseAll`).
  - `application/managers/file_browser_manager.dart`,
    `presentation/screens/conversation/files/file_browser_screen.dart`.
- **Much broader file-type recognition in the browser + viewer.** Syntax
  highlighting now resolves ~70 extensions and well-known extensionless files
  (`Dockerfile`, `Makefile`, `CMakeLists.txt`, `.env`) instead of ~20; the
  file-tree icons gained categories (data/config, archives, spreadsheets,
  shell, fonts, audio, video, text). Unknown grammars fall back to plaintext
  safely (never throw).
  - `presentation/screens/conversation/files/file_viewer_screen.dart`
    (`_languageForPath` + `_languageByExtension`),
    `presentation/screens/conversation/files/widgets/file_tree_tile.dart`
    (`fileTypeVisuals`).
- **Dedicated Theme Manager screen (`ThemeManagerScreen`).** The custom-themes
  library moved out of the Personalization list into its own M3 Expressive +
  Neural Expressive screen: a responsive grid (`SliverGrid`, max-extent tiles)
  of **live preview cards**, each painted with the theme's own colors — a dual
  theme shows light|dark side by side, a single theme one panel — with a
  brightness chip (*Light & dark* / *Light only* / *Dark only*) and *Active* /
  *Built-in* badges. Tap a card to activate it; **long-press to enter
  multi-select** for bulk delete / export. *New* / *Import* / *Export all* /
  *Reset* live in the `NeTopBar` (`IconSurface` + overflow); the bar swaps to a
  selection bar with a live count while selecting. This fixes the
  "30 themes → scroll Personalization to the bottom for any action" problem and
  adds bulk import (already array-aware) + bulk delete/export.
  - `presentation/screens/settings/theme_manager_screen.dart` (new).
  - `presentation/screens/settings/theme_sheets.dart` (new): Import and Export
    are **bottom sheets**, not dialogs — the Neural Expressive surface for
    input + menus (pasting JSON / choosing copy-vs-file). Confirmations remain
    `AlertDialog`s. Reused by the editor.

### Changed
- **Floating composer over a scroll veil (conversation + git screens).** The
  message composer and the git commit bar no longer sit on a solid surface
  band. They now float over the timeline / file list — which scrolls *under*
  them — backed by a `NeComposerVeil`: a vertical surface gradient that is
  transparent at the top (so content shows through as it scrolls past) and
  solid at the very bottom, mirroring the top bar's veil. The scroll reserves a
  bottom spacer equal to the composer's live height (measured via a new
  `MeasureHeight` widget) so the last message/card still rests just above the
  pill, and the conversation's jump-to-latest button is lifted by the same
  amount.
  - `presentation/widgets/measure_size.dart` (new), `widgets/ne_top_bar.dart`
    (`NeComposerVeil`), `screens/conversation/conversation_screen.dart`,
    `screens/conversation/git/git_screen.dart`.
- **Stronger Neural Expressive app-bar scroll veil.** The transparent top bar's
  gradient is more present (top alpha `0.75 → 0.92`, mid `0.45 → 0.62`) so the
  back/actions read confidently against busy content, while still dissolving to
  fully transparent at the lower edge (never a solid band).
  - `presentation/widgets/ne_top_bar.dart`.
- **File browser conveys git state by name colour, not status dots.** The small
  decorative grey type-dots are gone; each row's leading glyph is now the
  file-type icon and the **name + icon colour** carries the git state —
  tracked-unchanged files read as `onSurface`, **untracked** ones as a muted
  grey (`onSurfaceVariant`, previously the untracked blue), and
  added/modified/deleted/renamed in their git colour (only an actual change
  bumps the weight). New shared `gitStatusColor` helper.
  - `presentation/screens/conversation/files/widgets/file_tree_tile.dart`.
- **Custom themes can now be single-brightness (light-only / dark-only) or
  dual.** A `CustomTheme` authors at least one side; the other, when needed for
  rendering, is derived from the authored side's key colors
  (primary/secondary/tertiary/error) via Material 3 — so blue/brown/green
  chosen for light become the tone-correct blue/brown/green for dark. JSON
  carries the cardinality: a one-sided document imports as a single theme and
  exports only that side; a two-sided document is dual. `schemaVersion` 1 → 2
  (v1 documents load as dual). See *Fixed* for the parser that feeds this.
- **A dual custom theme no longer locks the System/Light/Dark picker.**
  `effectiveThemeModeProvider` forces a *single* theme to its own brightness
  (so it can't hide behind a mismatched OS setting) but lets a *dual* theme (or
  the brand baseline) follow the user's choice; `themePickerEnabledProvider`
  re-enables the picker for dual themes. `app.dart` applies the effective mode.
- **Personalization slimmed down.** The inline library list + per-row menus +
  library-action rows are gone; the screen now shows the theme-mode picker, a
  compact custom-theme card (master switch + a *Custom themes* entry that opens
  the manager and previews the active theme), and the language selector.
- **Theme editor follows single/dual.** Light/Dark tabs show only for a dual
  theme; a single theme shows its side plus *Add a {light/dark} side* (promotes
  to dual via `withOtherSideDerived`). Import/Export/Derive-from-seed use bottom
  sheets. Saving no longer force-writes the global theme mode.
- **Theme editor app bar reworked.** *Save* (primary) and *Export* are the app
  bar actions; *Reset brightness* and *Derive from seed* moved into an overflow
  menu; the bottom Save button is gone. The *Import* action was removed from
  the editor — importing JSON belongs to the library manager, not a theme you
  already have open.
- **Preview-card overflow menu is legible on every palette.** The three-dot
  menu on a theme card sat over the theme's own (often dark) preview, so the
  app's `onSurface` glyph vanished in light mode; it now uses a fixed neutral
  grey that reads on both light and dark surfaces.
- **New themes are created dual from one seed.** The *New theme* flow dropped
  its redundant brightness toggle: pick a seed color and a full Material 3 light
  **and** dark theme is generated (the dark side derived), nudging users to
  configure both — single themes come from importing a one-sided JSON. The two
  built-in templates likewise derive their dark side (no second hardcoded
  palette; `UxnanColors` stays the only hand-tuned palette).
- **i18n:** new theme-manager / brightness-chip / multi-select / add-side keys
  (en + es), regenerated localizations.
- Tests: new `theme_manager_screen_test` + `custom_theme_editor_screen_test`,
  `custom_theme_test` single/dual group, rewritten `personalization_screen_test`
  for the slim screen. Full suite green; `flutter analyze` clean.

### Fixed
- **File browser path bar no longer rises like a composer when a keyboard
  shows.** The browser pins its body (`resizeToAvoidBottomInset: false`) so the
  read-only bottom path bar stays anchored, and it drops focus when returning
  from the file viewer so any soft keyboard left over from the viewer's inline
  editor dismisses instead of shoving the path bar upward.
  - `presentation/screens/conversation/files/file_browser_screen.dart`.
- **Markdown preview no longer stretches tables vertically.** The file viewer's
  Markdown body now uses `IntrinsicColumnWidth` (was the framework default
  `FlexColumnWidth`, which squeezed every column to fit the viewport and wrapped
  each cell into a tall stack); wide tables get `flutter_markdown_plus`'
  built-in horizontal scroll with a visible scrollbar. The style sheet was also
  filled out — `h4`–`h6`, list bullets, padded/decorated blockquotes, a real
  horizontal rule, table borders/padding, and tapped links copy their URL to
  the clipboard (no `url_launcher` dependency).
  - `presentation/screens/conversation/files/file_viewer_screen.dart`
    (`_MarkdownBody`), new l10n `fileViewerLinkCopied`.
- **Imported themes persist (incl. multi-theme JSON), and the import bar copy
  is clearer.** A late-finishing library hydrate could re-seed the built-ins
  over a freshly-imported theme on a fast first run, losing it on the next
  restart; `CustomThemesLibrary` now flags user mutations and never lets a
  stale hydrate clobber them. Importing a JSON **array of several themes** adds
  every entry — and the dedup now tracks ids across the whole batch, so even a
  JSON with repeated ids keeps each as a distinct, separately-saved theme
  (instead of overwriting). Single- and dual-scheme themes are still both
  accepted per entry.
- **Built-in themes (Midnight / Sandstone) are healed from code on load.** A
  device that persisted the built-ins under an older build kept their broken
  dark side (a light-ish copy — dark mode and the dual preview showed light on
  both sides). Built-ins are app-owned templates, so `CustomThemesLibrary`
  now reconciles every built-in entry against the current code definition on
  hydrate (user-authored themes pass through untouched) and rewrites the
  corrected library. Editing a built-in now forks it into a new user theme so
  the reconciliation never clobbers a deliberate edit.
- **Custom theme JSON import now detects light/dark and stops defaulting to
  purple.** The importer only understood Uxnan's own `{light, dark}` document;
  any other shape left both scheme maps empty, and `CustomThemeColors.fromJson`
  then materialized the Material 3 baseline palette — whose primary is the
  canonical `#6750A4` purple. That is why "the import always saved a purple
  theme" and "light/dark was never detected". The parser is now tolerant of
  the three shapes a user actually pastes:
  - **Uxnan native** — `{ "light": {...}, "dark": {...} }`.
  - **Material Theme Builder export** — `{ "schemes": { "light": {...},
    "dark": {...}, "light-medium-contrast": {...}, ... } }`. The base
    `light`/`dark` schemes are used; the contrast variants are ignored. The
    role keys already match Material's, so these import directly.
  - **A single flat scheme** — role keys at the top level. Its brightness is
    detected from an explicit `"brightness"` field or, failing that, the
    `surface` (then `onSurface`) luminance, and it is applied to the matching
    side only.
  Missing roles in a partial document now fall back to a Material 3 scheme
  **seed-derived from the document's own `primary`** for the correct
  brightness (so a partial *dark* import stays dark) instead of a fixed
  light-purple palette. A document with no recognizable scheme now throws a
  `FormatException` (surfaced as an import-failed snackbar) instead of
  silently producing purple.
  - `domain/value_objects/custom_theme.dart`: `CustomThemeColors.fromJson`
    gained a required `brightness` + seed-derived fallback; `CustomTheme.fromJson`
    routes through a new `_extractSchemeMaps` (native / Material Theme Builder
    / flat) + `_detectBrightness`, and pairs an absent side off the present
    side's primary; new `CustomTheme.parseImport` → `CustomThemeImport`
    reports which sides were found so the editor can patch just one.
  - `presentation/screens/settings/custom_theme_editor_screen.dart`: *Import*
    now uses `parseImport` — a single-brightness palette patches only its side
    (leaving the other untouched) and flips the visible tab to match; a full
    theme replaces both.
  - The library-level *Import* on the Personalization screen inherits the same
    tolerant `CustomTheme.fromJson`, so Material Theme Builder and flat
    single-scheme JSON now import there too (a single scheme is paired into a
    complete light+dark theme).
  - `test/unit/domain/value_objects/custom_theme_test.dart`: new
    "tolerant multi-format import" group (Material Theme Builder, flat
    light/dark detection, explicit `brightness`, no-purple partial fill,
    `parseImport` sides, scheme-less throws).

### Added
- **`git/log` RPC contract.** The shared package gains three new types
  (`GitCommit`, `GitLogResult`, `GitLogParams` in `models/git.ts`) plus
  the runtime registration of `git/log` in the JSON-RPC method registry
  (`method-registry.ts` and the typed `methods.ts`). This is the
  contract half of the commit history feature; the bridge handler and
  the mobile manager land in the next commits.
  - `architecture/02b-contracts-and-requirements.md` lists `git/log` in
    the git method table.
- **`git/log` bridge handler.** The bridge exposes the new RPC: it runs
  `git log --format=...%x1e -z --shortstat` and parses the stream into
  the typed `GitCommit[]`. Cursor semantics: the caller passes the last
  commit's SHA on the next page; the bridge uses `<cursor>^` to start
  from the parent so the cursor itself is excluded. A fresh repo (no
  HEAD) returns `{commits:[], hasMore:false}` instead of a 128 exit, so
  the history screen opens cleanly on a brand-new repository. 21/21
  git tests pass.
  - `bridge/src/git/git-service.ts`: new `log(cwd, {limit, cursor,
    ref})` plus a `parseLogOutput` helper (shortstat from `--shortstat`
    is emitted after each `%x1e` record and is associated with the
    previous commit via deferred attachment).
  - `bridge/src/handlers/git-handler.ts`: new `git/log` handler with
    tolerant param coercion (optional `limit: number`, `cursor?: string`,
    `ref?: string`).
  - `bridge/test/git/git-service.test.ts`: three new tests (`log`
    returns commits newest-first with author/parents/stats; cursor
    pagination + hasMore + nextCursor; empty repo returns an empty
    list).
  - `architecture/02a-system-architecture.md` §5.8.6 documents the new
    handler and its cursor pagination contract.
- **Mobile `git/log` support (`GitActionManager.log`).** The mobile
  half of the bridge RPC: the domain value objects (`GitCommit`,
  `GitLogResult`, `GitLogParams` with a tolerant JSON codec) and a
  `log(GitLogParams)` method on `GitActionManager`. Pure read — no
  side effects on the manager state, no `git/status` refresh (the
  history screen is independent of the working-tree state, the same
  way the conversation timeline is independent of `git/status`).
  12/12 git action manager tests pass.
  - `uxnanmobile/lib/domain/value_objects/git/git_log.dart`: new
    `GitCommit` (sha, shortSha, parents[], author/committer name+email+
    timestamp, messageTitle, messageBody, stats?), `GitLogResult`
    (commits, hasMore, nextCursor), `GitLogParams` (cwd, limit?,
    cursor?, ref?) with `toRpcParams()`.
  - `uxnanmobile/lib/application/managers/git_action_manager.dart`:
    new `log(GitLogParams)` method.
  - `uxnanmobile/test/unit/application/git_action_manager_test.dart`:
    two new unit tests (round-trip parse of the bridge payload +
    empty-result handling).
- **Git commit history screen (`GitHistoryScreen`).** Fourth and final
  commit of the history feature: the mobile UI on top of
  `GitActionManager.log`. Two views share the same cursor-paginated
  data, switched via a `ConnectedButtonGroup` (Neural Expressive §4.5):
  - **List** — chronological commit rows (`ExpressiveCard`, title,
    "Merge" badge when more than one parent, author + relative date,
    +/- stats).
  - **Graph** — GitKraken-style lanes assigned by parent continuation
    with Bézier curves connecting parents to children.

  Cursor-based pagination (50 commits per page), *Load older commits*
  footer, pull-to-refresh, empty + error states with a Retry button.
  Tapping a row opens a bottom sheet with the full message, authors,
  parents, stats, and **Copy SHA** / **Copy message** actions (each
  with a SnackBar confirmation). The `Icons.history_rounded`
  `IconSurface` lives in `GitScreen`'s app bar (visible only when a
  repo is open) and pushes the new screen. Built strictly on the
  Neural Expressive design system: `ExpressiveCard` for rows,
  `PolygonLoader` for the initial-load spinner, `UxnanSpacing` /
  `UxnanRadius` tokens throughout.
  - `uxnanmobile/lib/presentation/screens/conversation/git/git_history_screen.dart`:
    new screen with the `List` and `Graph` views, the lane-assignment
    algorithm (`_assignLanes`), and the custom `_GraphPainter` that
    draws lane tracks, the commit circle, outgoing lines, and Bézier
    branch curves.
  - `uxnanmobile/lib/presentation/widgets/connected_button_group.dart`:
    new shared widget implementing Neural Expressive §4.5 — a
    physically fused horizontal strip with dynamic corner radii (outer
    stadium, inner 4 dp), neighbour-squish on press via `spatialFast`.
    Asserted to 2–5 options per spec.
  - `uxnanmobile/lib/presentation/screens/conversation/git/git_screen.dart`:
    new `IconSurface` in the app-bar `actions` row that pushes
    `GitHistoryScreen`.
  - `uxnanmobile/l10n/app_en.arb` + `app_es.arb`: 19 new keys
    (history title, button, list/graph view labels, empty/loading/error
    states, merge badge, details sheet, copy actions with snackbars).
  - `test/widget/presentation/git_history_screen_test.dart`: 5 new
    widget tests (list rendering, empty state, error state, list↔graph
    toggle, details bottom sheet).
    `test/widget/presentation/connected_button_group_test.dart`: 4 new
    widget tests (renders N values, onChanged fires, selected uses
    bold text, asserts 2–5 options).
    `test/widget/presentation/git_screen_test.dart`: 1 new test
    verifying the History `IconSurface` is exposed in the app bar.
    394/394 mobile tests pass; 339/339 bridge tests pass.
  - `architecture/02a-system-architecture.md` §5.8.6 documents the UI
    half of the history feature (lane algorithm, list+graph views,
    bottom sheet actions, pull-to-refresh, NE design tokens).
  - `uxnanmobile/FOR-DEV.md` flips the entry to **DONE**.

### Changed
- **File browser, Git screen and file viewer: app-bar refresh moved to
  pull-to-refresh.** The standalone *Refresh* `IconSurface` is gone from the
  `FileBrowserScreen`, `GitScreen` and `FileViewerScreen` app bars; users now
  refresh by pulling down on the list / file tree / file content (a
  `RefreshIndicator` wrapping the scroll surface — same gesture the threads
  list already uses, same `BouncingScrollPhysics` +
  `AlwaysScrollableScrollPhysics` combo). The
  `GitScreen` keeps its existing *Pull* (badged, behind > 0) action;
  refresh was redundant with it. The `FileBrowserScreen` keeps its
  *Show extensions* / *Show hidden* toggles — moved into a new
  three-dot overflow menu (see *Added* below) so the bar stays under
  the M3 ≤3-actions guideline and the chrome matches every other
  Neural Expressive screen (the conversation screen uses the same
  `IconSurfaceMenu` pattern for its overflow). The screens no longer
  carry refresh chrome that the threads list and conversation screen
  never had; the whole app now refreshes by
  pull-to-refresh except for the few actions that need to be one-tap
  reachable (pull, expand-all, the conversation menu).
  - `file_browser_screen.dart`: new `_refresh()` wraps
    `manager.loadRoot(cwd)`; `CustomScrollView` wrapped in
    `RefreshIndicator(onRefresh: _refresh, …)`. Refresh
    `IconSurface` removed from the app bar; toggle `IconSurface`s
    moved to a new `IconSurfaceMenu<void>` (see *Added*).
  - `git_screen.dart`: new `_pullToRefresh()` wrapper for the
    existing `_refresh(cwd)` (which takes a parameter — the
    `RefreshIndicator` needs a parameterless `Future<void>
    Function()`); `CustomScrollView` wrapped in
    `RefreshIndicator(onRefresh: _pullToRefresh, …)`. Refresh
    `IconSurface` removed from the app bar.
  - `git_screen_test.dart`: new widget test (`GitScreen no longer
    renders a Refresh button in the app bar`) locks in the change
    (the `Icons.refresh_rounded` glyph is absent and the
    `RefreshIndicator` is in the tree).
  - `file_viewer_screen.dart`: refresh `IconSurface` removed from the
    app bar; the scrollable bodies (code, markdown source/preview, diff)
    are each wrapped in `RefreshIndicator(onRefresh: _load, edgeOffset:
    …)` so the spinner clears the transparent `NeTopBar`. `_CodeBody`
    and `FileDiffViewer` gain the `AlwaysScrollableScrollPhysics` combo
    so the pull works even when the content fits the viewport.

### Added
- **File browser: three-dot overflow menu.** The two view toggles
  (*Show file extensions* / *Show hidden files*) that used to live as
  standalone `IconSurface`s in the app bar are now in a popup menu
  triggered by a `Icons.more_vert_rounded` `IconSurfaceMenu` — the same
  pattern the conversation screen, the git screen overflow and the
  threads list use for their low-frequency actions. The bar now
  carries a single trailing action (the overflow) so it lines up with
  the M3 ≤3-actions guideline and the rest of the Neural Expressive
  chrome. Each toggle is a `CheckedPopupMenuItem<void>` with the same
  icon and label the `IconSurface` used, so the selection state is
  visible at a glance when the menu is open.
  - `file_browser_screen.dart`: the app bar's `actions:` now holds a
    single `IconSurfaceMenu<void>` with two
    `CheckedPopupMenuItem<void>` entries (one per toggle). The
    `showFileExtensionsProvider` / `showHiddenFilesProvider` setters
    are unchanged — the menu is a pure UI surface, the persistence +
    the on-device store are the source of truth.

### Added
- **Threads screen — scope selector (Agent / Project).** The threads filter
  bar now starts with a small chip-styled **scope selector** on the left
  that shows the active scope (Agent or Project) and opens a popup to
  switch between them. To its right, the chip bar shows the matching
  filter: *All + each agent* under the Agent scope, *All + each project*
  (one per distinct `projectId` / `cwd`) under the Project scope. Only
  one scope is visible at a time — the previous "two stacked chip bars"
  layout is gone. Switching scope clears the other dimension's filter so
  the two stay independent (an agent filter has no meaning under the
  Project scope and vice versa). The project filter — which was already
  fully implemented (`_projectsPresent` / `_projectKeyOf` / bridge
  `loadThreads(projectId:)`) but hidden behind the `_projectFilterEnabled`
  flag — is now reachable from the UI without any back-end change. Same
  visual language as the filter chips (M3 `ChoiceChip` + popup menu
  trigger), same horizontal `ListView` scrolling, so the whole bar reads
  as one coherent surface. New l10n keys: `threadsFilterByAgent`,
  `threadsFilterByProject`, `threadsFilterScopeTooltip` (en + es).
  Covered by three widget tests in `threads_list_test.dart` (default
  scope renders Agent, switching to Project swaps the chip bar,
  switching scope clears the other dimension's filter).
- **Git screen commit composer autofocus on open.** The title field of the
  commit composer in the full-screen `GitScreen` now opens with primary
  focus, so the keyboard pops up as soon as the repo state loads (matches
  the conversation composer: the user opened the screen to type a commit
  message). The existing tap-outside-to-unfocus behavior on the timeline
  area (`GestureDetector` + `FocusScope.unfocus` in `GitScreen.build`) is
  preserved — tapping the file list or branch summary still dismisses the
  keyboard. Implemented as `autofocus: true` on the title
  `_BorderlessField` (only the title; the description and co-author fields
  stay non-autofocus so expanding the details doesn't yank the caret).
  `_BorderlessField` gained an optional `autofocus` parameter (default
  `false`) so the other call sites are unaffected. Covered by two widget
  tests in `git_screen_test.dart` (`GitScreen autofocuses the commit
  title field on first build` + `GitScreen keeps the
  tap-outside-to-unfocus behavior on the commit title field`).

- **Composer autofocus on conversation open.** The message composer's text
  field now opens with primary focus, so the keyboard pops up the moment a
  conversation is opened (matches the user's expectation: the composer is
  the primary input surface, and opening a thread almost always means
  "type something"). The existing tap-outside-to-unfocus behavior on the
  timeline (`GestureDetector` + `FocusScope.unfocus` in
  `ConversationScreen`) is preserved — tapping the message area still
  dismisses the keyboard. Implemented as a single `autofocus: true` flag on
  the composer's `TextField` (no `FocusNode` plumbing required) so the
  change is intentionally minimal; the field's lifecycle is fully owned by
  the framework. Covered by two widget tests in
  `conversation_widgets_test.dart` (`ComposerBar autofocuses the text field
  on first build` + `ComposerBar keeps the tap-outside-to-unfocus
  behavior`) that lock in both the autofocus and the unfocus-from-tap.

### Added — `[reconn]` diagnostic logs for Bug A (relink latency after resume)
- Temporary, greppable `[reconn]` timing logs at the resume/reconnect sites
  (`SessionCoordinator.resume` / `verifyConnection` / `_runReconnectLoop` /
  `_dropAndReconnect` / `_heartbeatTick` and `DirectTransportSelector.select`)
  to pin where the post-"recents" relink spends its time before changing the
  reconnect logic. No behavior change; logs are suppressed unless built with
  `--dart-define=ENABLE_LOGGING=true`. Tracked (with capture steps + recovery
  session IDs) in `uxnanmobile/FOR-DEV.md` → "Bug A". To be removed once the
  root cause is fixed.

### Fixed — QR scanner (and FCM push) broken in `--release` by R8 stripping
- **Root cause:** AGP 9 enables R8/minification by default for `release`, and
  in full mode it stripped the no-arg constructors of the reflectively-
  instantiated component registrars used by ML Kit (`BarcodeRegistrar`) and
  Firebase (`FirebaseMessagingKtxRegistrar`) — `NoSuchMethodException:
  <init>[]`. That left the barcode scanner null, so `mobile_scanner` threw
  `genericError: … getClass() on a null object reference` on camera start
  (dark screen), and it would also have broken background push in release.
  Debug builds (no minify) were unaffected, which is why it only showed under
  `flutter run --release`. **Fix:** added `android/app/proguard-rules.pro` with
  keep rules for the ML Kit, Firebase and mobile_scanner classes (and any
  `ComponentRegistrar`), keeping minification **on** (`isMinifyEnabled = true` +
  `isShrinkResources = true`) so the release stays small while the scanner and
  push keep working.
- **Graceful fallback instead of a dead screen:** the scanner had no
  `errorBuilder`, so a start failure left the user on a dark screen with the
  package's cryptic default glyph and no way out. A camera start error is now
  hoisted into stable top-level state (`_ScannerError`) — out of the package's
  rapidly-rebuilding `errorBuilder`, which made the fallback buttons
  unresponsive — showing the real error (code + message) plus **Pair with a
  code** (manual pairing) and **Try again** (recreates the controller).
  (`qr_scanner_screen.dart`; new l10n keys `qrCameraErrorTitle`,
  `qrCameraErrorBody`, `actionRetry`.)
- **Modernized `mobile_scanner` 5.2.3 → 6.0.11** along the way (newer CameraX
  1.5 + ML Kit 17.3; source-compatible: autoStart, `onDetect`, 3-arg
  `errorBuilder`). Requires `compileSdk 36` (already our default) and bumps the
  **iOS deployment target to 15.5** (`project.pbxproj`).

### Changed — bundle id renamed `com.uxnan.mobile` → `dev.luisgamas.uxnanmobile`
- **Android.** `android/app/build.gradle.kts` `namespace` + `applicationId`
  rewritten. The Kotlin source moved from
  `android/app/src/main/kotlin/com/uxnan/mobile/MainActivity.kt` (package
  `com.uxnan.mobile`) to
  `android/app/src/main/kotlin/dev/luisgamas/uxnanmobile/MainActivity.kt`
  (package `dev.luisgamas.uxnanmobile`). `AndroidManifest.xml` was unaffected
  (it uses `${applicationName}` / `.MainActivity`, no hard-coded `package=`).
- **iOS.** All 6 `PRODUCT_BUNDLE_IDENTIFIER` entries in
  `ios/Runner.xcodeproj/project.pbxproj` rewritten
  (`dev.luisgamas.uxnanmobile` for the Runner target and the
  derived `dev.luisgamas.uxnanmobile.RunnerTests` for the test target).
  `Info.plist` was unaffected (it uses `$(PRODUCT_BUNDLE_IDENTIFIER)`).
- **Firebase client config invalidated.** The locally-cached
  `android/app/google-services.json` and `ios/Runner/GoogleService-Info.plist`
  were pinned to the old `com.uxnan.mobile` bundle id and are now stale
  (`Firebase.initializeApp()` would refuse them). They are gitignored and
  were deleted; the Gradle Google Services plugin stays conditionally applied
  (`if (file("google-services.json").exists())`) so the build stays green.
  See `FOR-HUMAN.md` §2 — re-register / re-fetch under
  `dev.luisgamas.uxnanmobile` to re-enable push.
- **Spec updated.** `architecture/00-index.md` bootstrap row,
  `architecture/03-technical-reference.md` Firebase-registration steps,
  `uxnanmobile/README.md` package-id line, and `uxnanmobile/docs/architecture.md`
  iOS-bundle line all reflect the new id. The Dart package name `uxnan`
  (import path `package:uxnan/...`) is **unchanged** — it is a separate
  namespace from the Android / iOS bundle id.
- **Visible app name unchanged.** `android:label="Uxnan"`,
  `Info.plist` `CFBundleDisplayName=Uxnan`, and the user-facing brand "Uxnan"
  are unaffected.

### Changed — brand icon & splash rework
- **New brand mark + two theme variants.** The source SVGs were
  refreshed: `assets/images/logo.svg` (black mark on a white, rounded
  surface — the launcher mark), `assets/images/logo_nb.svg` (black
  stroke, for light surfaces) and the new `assets/images/logo_wnb.svg`
  (white stroke, for dark surfaces).
- **Launcher icon now derives from `logo.svg`.** Rasters regenerated:
  `logo-1024-1024.png` (square white background — iOS/macOS reject alpha
  corners and apply their own mask) and `logo_fg_1024.png` (padded mark
  on transparency, for the Android 8+ adaptive foreground over a flat
  white background layer). `flutter_launcher_icons` is now scoped to
  **Android + iOS only** (the "PC menu" icon lives in the desktop app),
  with `remove_alpha_ios: true`.
- **In-app marks pick the variant by surface, no runtime tint.** The
  devices-screen footer swaps `logo_nb`/`logo_wnb` by theme brightness
  instead of `ColorFilter`-tinting a single black mark.
- **Splash double-render fixed.** The mandatory Android 12+ SplashScreen
  API used to show the mark (cropped/zoomed into its circular icon mask)
  and then hard-cut to a differently sized Flutter overlay — a visible
  "two splashes" sequence. The Android 12+ splash icon is now a fully
  transparent image (`splash_blank.png`) over a white window, so the
  system splash is a plain white screen with no mark. The brand mark then
  appears exactly once — animated — in the `UxnanSplash` overlay over the
  same white surface, so it reads as a single splash. Pre-Android-12
  devices use the padded `logo_fg_1024.png` in the classic drawable splash.
- **`UxnanSplash` animation reworked.** The mark now enters at 70% scale
  rotated a half-turn (180°) and springs to 100% / 0° in place
  (`spatialSlow`), then the overlay fades out (`effectsSlow`). The intro is
  started on the first painted frame (not in `initState`) so the engine's
  init time can't fast-forward past it, and the minimum hold is 1200 ms so
  it always reads. Also fixes the dark-mode white-on-white invisibility —
  the overlay is always a flat white surface with the black mark.

### Added
- **Brand splash screen + launcher icons (Android, iOS, web).** The
  Uxnan brand mark is now the splash + home/launcher icon on every
  surface:
  - New `assets/images/logo.svg` (with white bg, splash fallback) and
    `assets/images/logo_nb.svg` (no bg, the brand mark used everywhere
    it needs to adapt to a theme); a 1024×1024 PNG
    (`assets/images/logo-1024-1024.png`) is generated alongside because
    `flutter_launcher_icons` / `flutter_native_splash` need a raster
    source.
  - `flutter_launcher_icons ^0.14.4` +
    `flutter_native_splash ^2.4.7` added as `dev_dependencies`; their
    config in `pubspec.yaml` regenerates the Android legacy + adaptive
    icons, the iOS `AppIcon.appiconset`, the iOS launch storyboard, the
    web PWA manifest + icons, and the Android 12+ SplashScreen API
    assets (`android12splash.png` + `values-v31`/`values-night-v31`
    styles).
  - New `UxnanSplash` overlay
    (`lib/presentation/widgets/uxnan_splash.dart`) shown on top of the
    first frame after the native splash hands off — the logo scales in
    with the M3E `spatialDefault` spring (slight overshoot) and the
    overlay fades out with `effectsSlow` once `onReady` resolves. A
    900 ms minimum hold guarantees the splash reads as a deliberate
    moment on fast devices. Black-on-white in light mode,
    white-on-white in dark mode via a `ColorFilter` (no second SVG
    variant needed). Wired in `app.dart` via a new `_AppShell` that
    composes the router output with `_PushHost` + `UxnanSplash` in a
    `Stack`.

### Changed
- **Devices-screen footer is now the brand mark + ALPHA caption.**
  `_BrandingFooter` no longer renders the localized "Uxnan Mobile"
  text; instead it shows a small SVG of the brand mark (28 dp tall,
  theme-aware via `ColorFilter`) with the existing ALPHA pill kept as
  the caption underneath.
- **Custom themes as a library (multi-selectable + JSON import/export of
  many themes).** The personalization screen's previous 4-segment
  `SegmentedButton` (System / Light / Dark / Custom) is replaced with a
  **3-segment** picker + a **"Use a custom theme"** master switch + a
  collapsible library. The library ships **2 built-in example themes**
  ("Midnight" — leans dark, deep blue-violet seed;
  "Sandstone" — leans light, warm amber seed) so a first-run user always
  has something selectable before authoring anything; the master switch
  controls whether the app applies the user's selected theme (when on)
  or follows System/Light/Dark (when off). When the switch is on, the
  segmented picker is disabled; when off, the library is rendered greyed
  out (and its rows are non-interactive via `IgnorePointer`), so the
  two states are visually + functionally exclusive. Each row in the
  library shows a radio (the active theme), the theme's name, an
  **Active** or **Built-in** badge, a 4-dot color preview (light
  primary + dark primary + light surface + dark surface) and an
  `IconSurfaceMenu` (Edit / Export JSON / Delete — Delete is disabled
  for built-ins). Below the rows, library-level actions: **Import
  theme** (paste a single theme JSON OR a JSON array — the typical
  *Export all* payload — and assign fresh ids when an imported id
  collides with an existing entry), **Export all themes** (copy the
  whole library to the clipboard as a JSON array), and **Reset
  library** (drop every authored theme, restore the built-in seed,
  flip the switch off). State model:
  - New providers in `application_providers.dart`:
    `customThemesLibraryProvider` (`List<CustomTheme>`, seeded with
    the built-ins on first hydrate, persisted under
    `uxnan.appearance.customThemes` as a JSON array),
    `activeCustomThemeIdProvider` (`String?`, persisted under
    `uxnan.appearance.activeCustomThemeId`),
    `useCustomThemeProvider` (`bool`, persisted under
    `uxnan.appearance.useCustomTheme`).
  - `customThemeSettingProvider` becomes a derived
    `Provider<CustomTheme?>` (was a `Notifier<CustomTheme?>`) — it
    resolves to the active theme when the switch is on and an id is
    selected, so `app.dart` + `themeSourceSettingProvider` keep their
    existing contract.
  - Legacy `uxnan.appearance.customTheme` is migrated into the library
    on first hydrate (single-shot; the key is removed after migration).
  - `CustomThemeEditorScreen` saves via
    `customThemesLibraryProvider.notifier.upsert(theme)` instead of
    the old singular setter, so editing the active theme keeps it
    active after save.
  - `isBuiltInCustomThemeId(id)` (constant
    `kBuiltInThemeIdPrefix = 'uxnan.builtin.'`) gates the Delete menu
    item + the per-row deletion; the two shipped themes are read-only.
  - `AppearancePreferencesStore` gains
    `readCustomThemesLibrary` / `writeCustomThemesLibrary`,
    `readActiveCustomThemeId` / `writeActiveCustomThemeId`, and
    `readUseCustomTheme` / `writeUseCustomTheme`. The legacy
    `readCustomTheme` / `writeCustomTheme` are kept for the one-shot
    migration and the existing storage tests.
  - `personalization_screen.dart` is rewritten: `ThemeModeOption` drops
    its `custom` variant; `_ThemeModeOptionSelector` is 3 segments and
    takes a `disabled` flag; `_CustomThemesSection` hosts the master
    `SwitchListTile` + `_CustomThemesCollapsible` (an `ExpansionTile`
    with the per-theme rows and the library-level action tiles).
  - Tests in `personalization_screen_test.dart` are rewritten to cover
    the new shape: 3-segment picker, switch + collapsible + built-in
    examples, language persistence, switch-on + tap-to-activate flow,
    and pre-seeded active-theme hydration with the *Active* badge.
    All 349 unit + widget tests pass.
  - **Spec drift:** `architecture/02c-implementation-guide.md` §3.1
    ("Temas personalizables") is rewritten to describe the library
    model (state shape, picker + collapsible UX, editor contract,
    storage, JSON wire shape for both single-theme and library-array
    payloads, redesign rationale).
- **Custom themes replace the curated accent picker.** The personalization
  screen no longer offers a closed 7-swatch palette (blue / purple / pink
  / red / orange / green / teal). Instead, the theme-mode selector is a
  4-segment `SegmentedButton` (System / Light / Dark / **Custom**);
  selecting *Custom* (when a custom theme is present) flips the source
  to `ThemeSource.custom` and opens a new
  **`CustomThemeEditorScreen`** that lets the user fine-tune **every
  public Material 3 color role** (46 roles, grouped: Primary,
  Secondary, Tertiary, Error, Surface, Outline & inverse) for both
  brightnesses independently. Two helpers — *Reset brightness* (regenerate
  one side from the current `primary` via `ColorScheme.fromSeed`) and
  *Derive from seed* (pick a seed and regenerate one side from scratch) —
  give the user a fast path when they don't want to tweak every role.
  The editor ships an inline HSV color picker (`ColorPickerSheet`) plus
  hex entry; the visual baseline (the hand-tuned brand palette) is
  preserved for users that never personalize. *Export* copies the theme
  JSON to the clipboard and opens a pretty-printed, selectable dialog so
  the JSON can be shared via any system share sheet; *Import* parses a
  pasted JSON into the working theme (the user's current name +
  description are preserved across an import).
  - New: `domain/value_objects/custom_theme.dart` — `CustomTheme`
    (id / name / description / schemaVersion + light + dark) and
    `CustomThemeColors` (the flat role map). Builders
    (`CustomTheme.derivedFromSeed`), copy-with (`withLightColors`,
    `withDarkColors`, `withMetadata`), and a JSON codec
    (`toJson` / `fromJson` / `toJsonString` / `fromJsonString`)
    that round-trips every role as `#AARRGGBB` (also accepts legacy
    integer ARGB) and is tolerant of unknown / missing keys so a
    hand-edited or older document still loads.
  - New: `presentation/screens/settings/custom_theme_editor_screen.dart`
    — the full editor (metadata, brightness tabs, grouped role list,
    export / import, derive-from-seed).
  - New: `presentation/widgets/color_picker.dart` — `ColorPickerSheet`,
    an HSV-based picker (`Slider`s + hex field + preview) used by the
    editor's per-role editing and by the *Derive from seed* dialog.
  - Removed: `domain/value_objects/accent_color.dart`
    (`AccentPalette` + `AccentColorId` + 7 hard-coded seeds + the
    tolerant id parser).
  - Removed: `AccentSetting` notifier and `accentSettingProvider` from
    `application_providers.dart`.
  - Removed: l10n keys `accentBlue` … `accentTeal` (en + es).
  - `presentation/theme/uxnan_theme.dart` —
    `buildUxnanTheme({themeSource, customTheme, brightness})`. Two
    mutually exclusive paths: `ThemeSource.brand` →
    hand-tuned palette (identical visual baseline to a fresh install);
    `ThemeSource.custom` → the user's `CustomTheme.colorScheme` /
    `.darkColorScheme`. A transient null `customTheme` while the source
    is `custom` degrades to brand rather than crashing the theme — the
    UI never reaches that state, but it keeps a misconfigured provider
    recoverable.
  - `infrastructure/storage/appearance_preferences_store.dart` —
    `readCustomTheme()` / `writeCustomTheme(CustomTheme?)` under
    `uxnan.appearance.customTheme`. Tolerant parser (a malformed
    document yields null → brand baseline) and a clear-the-key path
    for `writeCustomTheme(null)`.
  - `presentation/providers/application_providers.dart` — new
    `CustomThemeSetting` notifier + `customThemeSettingProvider` and
    `ThemeSourceSetting` notifier + `themeSourceSettingProvider`. The
    source derives from the presence of a custom theme (no separate
    key on disk; the two stay in lock-step).
  - `presentation/screens/settings/personalization_screen.dart` —
    4-segment `SegmentedButton<ThemeModeOption>` (System / Light / Dark
    / Custom); while no custom theme is persisted the *Custom* segment
    is disabled (the user must author one first). When *Custom* is
    active, a card below the picker shows the active theme's name +
    description + *Edit* / *Reset* tiles.
  - `app.dart` — watches `themeSourceSettingProvider` +
    `customThemeSettingProvider` and passes them to `buildUxnanTheme`
    for both `theme` and `darkTheme`.
  - `test/widget/presentation/file_viewer_screen_test.dart` — updated
    the test helper to pass the new required `themeSource` argument.
  - Tests: 8 new in `uxnan_theme_test.dart` (brand baseline +
    dynamic from-theme for light + dark; custom source with null theme
    falls back to brand); 14 new in `custom_theme_test.dart` (JSON
    round-trip via `toJson` / `fromJson` and `toJsonString` /
    `fromJsonString`, partial / unknown role tolerance, hex (RGB + ARGB)
    and int ARGB parsing, malformed input, derived builders,
    `toColorScheme` role coverage, `freshId` uniqueness); 7 new in
    `appearance_preferences_custom_theme_test.dart` (read null,
    write + read, clear via null, unparseable → null, namespacing,
    isolation from other appearance keys, role-preserving round-trip);
    5 rewritten in `personalization_screen_test.dart` (4-segment
    picker, *Custom* disabled on first run, *Custom* enabled when a
    theme is persisted, language persistence still works, active
    theme card renders the persisted theme's name + description).
    **354 unit + widget tests passing, all green.**
  - **Spec drift:** `architecture/02c-implementation-guide.md` §3.1
    replaces the *"Colores de acento personalizables"* section with the
    full *"Temas personalizables"* spec (builder signature, picker UX,
    editor structure, storage, JSON wire shape, redesign rationale);
    `architecture/00-index.md` status table flips the entry from
    *"7 swatches curados"* to *"Custom themes (temas personalizables)"*.
    `FOR-DEV.md` marks the previous accent-picker item as superseded.

- **Library-level actions live outside the collapsible themes tile.**
  *+ New theme*, *Import theme*, *Export all themes* and *Reset library*
  are no longer nested inside the `ExpansionTile`'s children — they're
  rendered as siblings of the tile so they stay one tap away whether
  the themes list is folded or open. The collapsible now only hosts the
  per-theme rows; its persisted expand/collapse state (see Fixed
  below) keeps controlling the row visibility. The `_CustomThemesSection`
  in `personalization_screen.dart` lays out: master switch → optional
  description (when empty) → `ExpansionTile` (rows only) → 4 action
  rows separated by thin dividers. New widget test
  (`library-level actions are visible without expanding the themes
  tile`) locks the new layout in.

- **Custom theme JSON exports can now save to a file (in addition to
  the clipboard).** Every export surface — the per-row *Export* menu
  item, the library-level *Export all themes* action, and the editor's
  *Export* button — now lets the user choose between *Copy to clipboard*
  (existing behaviour) and *Save to file* via the native share sheet
  (`share_plus` + a temp file under `getTemporaryDirectory()`; the
  sheet lets the user pick Files / Drive / email / any registered share
  target). The per-theme payload is named
  `uxnan-theme-<slug>.json` and the library payload
  `uxnan-themes-<YYYYMMDD-HHmm>.json`. Helper:
  `lib/presentation/screens/settings/theme_export.dart`
  (`shareThemeJsonFile`). New `share_plus` dependency in `pubspec.yaml`.
  New l10n keys: `personalizationCustomThemeExportCopy`,
  `personalizationCustomThemeExportFile`,
  `personalizationCustomThemesSaved`,
  `personalizationCustomThemesSaveFailed`,
  `customThemeEditorDefaultName`, `customThemeEditorSaved`,
  `customThemeEditorSaveFailed`, `customThemeEditorShareFile`,
  `actionApply` (en + es).

- **+ New theme picker — seed color + brightness are now user input.**
  Tapping *+ New theme* opens a small dialog (HSV preview + hue /
  saturation / value sliders + a Light / Dark segmented button + Cancel
  / Apply) instead of silently reusing the active app's primary as the
  seed and always defaulting to the Light tab. The picked seed is
  forced to the resulting theme's `primary` (and Material's
  `ColorScheme.fromSeed` derives every other role from it); both
  brightnesses are seeded. The editor opens on the brightness the user
  picked. New l10n keys:
  `personalizationCustomThemeNewDialogTitle`,
  `personalizationCustomThemeNewDialogBody` (en + es).

### Removed
- `domain/value_objects/accent_color.dart` (`AccentPalette` /
  `AccentColorId` and the 7 curated swatches).
- `accentSettingProvider` (Riverpod notifier that drove
  `ColorScheme.fromSeed` for non-default accents).
- `infrastructure/storage/appearance_preferences_store.dart` keys
  `readAccentId` / `writeAccentId` (replaced by
  `readCustomTheme` / `writeCustomTheme`).
- **Unused l10n key `appTitleMobile`** (en + es). The key only fed the
  old footer text we replaced with the brand mark; the descriptions
  in the .arb files were updated to reflect that.
- l10n keys `accentBlue` … `accentTeal` (en + es) — replaced by the
  `customTheme*` key set on the editor + section headers.
- Tests `test/unit/domain/value_objects/accent_color_test.dart` and
  `test/unit/infrastructure/storage/appearance_preferences_accent_test.dart`
  (the equivalent coverage now lives in `custom_theme_test.dart` +
  `appearance_preferences_custom_theme_test.dart`).

### Fixed
- **Conversation no longer opens at the top — scroll position is
  remembered.** Opening a thread always reset the timeline to the top,
  forcing users who had scrolled up to read older context to scroll all the
  way back down (or tap *Jump to latest*) every time they left and re-entered.
  A new session-scoped `ConversationScrollStore`
  (`lib/presentation/providers/conversation_scroll_store.dart`, an
  in-memory `Map<threadId, { offset, atBottom }>`) records the current
  pixel offset while the user scrolls, and `ConversationScreen` now
  restores it once on first content (a one-time, idempotent
  `_restoreScroll` guarded by `_restoredScroll`, re-applied on the next
  frame to catch late layout — variable-height messages / images that
  grow `maxScrollExtent`). When the user was at (or near) the bottom on
  close, the restore follows the newest message instead of pinning a now-
  stale offset. The store is intentionally in-memory only (per session):
  a saved pixel offset only maps cleanly onto the same rendered content,
  which a cross-restart resync can change. Pairs with the existing
  *Jump to latest* button — the button still gets you to the newest
  message manually; the restore makes the common case (returning to a
  thread) just work. New: 3 tests in
  `test/unit/presentation/conversation_scroll_store_test.dart` (null until
  saved, round-trip, overwrite). **346 unit + widget tests passing, all
  green.**

### Fixed
- **File browser's git-status colours are now live across the app.**
  Previously `FileBrowserManager` cached the per-cwd `git/status` map and
  only refreshed it on `loadRoot` / `toggleDirectory` / `writeFile`, so a
  commit made elsewhere on the same PC (the git screen, a CLI `git commit`,
  a pull on the bridge) left the browser painting stale colours until the
  user navigated away and back. The browser now listens to a new
  `GitStatusBus` (a process-wide broadcast owned by
  `gitStatusBusProvider`) that `GitActionManager` and `FileBrowserManager`
  both publish to; every successful `git/status` fetch pushes a
  `GitStatusChange` onto the bus, and every manager holding that cwd
  repaints from the payload. No more stale `modified` colours on a tree
  that has actually been committed. The bus is generic — any future
  consumer can subscribe without touching the producer side.
  - New: `lib/domain/value_objects/git/git_status_change.dart`
    (`GitStatusChange { cwd, state }` value object).
  - New: `lib/application/services/git_status_bus.dart`
    (`GitStatusBus` — broadcast `Stream<GitStatusChange>`, `emit`,
    `dispose`; safe no-op after close).
  - `lib/application/managers/git_action_manager.dart` — emits on the
    bus after every successful `refreshStatus(cwd)` (the single point
    that issues the `git/status` RPC).
  - `lib/application/managers/file_browser_manager.dart` — subscribes
    once; repaints any managed cwd from a bus event whose `cwd` matches;
    also publishes on the bus from its own `refreshGitStatus` (with a
    minimal `GitRepoState` carrying only the `changedFiles`, since that
    is the only field the colour treatment needs).
  - `lib/presentation/providers/application_providers.dart` — new
    `gitStatusBusProvider` (one instance per app, disposed with the
    providers); `gitActionManagerProvider` and `fileBrowserManagerProvider`
    are wired to it.
  - Tests: 5 in `git_status_bus_test.dart` (broadcast, no replay, no-op
    after dispose, payload preservation, ordering), 2 added to
    `git_action_manager_test.dart` (`refreshStatus` emits;
    `commit` propagates), 3 added to `file_browser_manager_test.dart`
    (bus repaint for a managed cwd, ignored for an unknown cwd, own
    refresh publishes the new state). **340 unit + widget tests
    passing, all green.**

### Fixed
- **Custom themes: deleting an authored theme no longer crashes with
  `Bad state: Using "ref" when a widget is about to or has been
  unmounted`.** `_CustomThemeRow._delete` showed a confirm dialog
  asynchronously; once the user confirmed, the library removed the
  theme and the row unmounted before the follow-up
  `ref.read(activeCustomThemeIdProvider…).set(null)` /
  `ref.read(useCustomThemeProvider…).set(false)` ran — those late
  reads tripped Riverpod's `assertNotDisposed`. The fix captures the
  three notifiers + the local `isActive` flag into local fields
  *before* the first `await`, so the post-delete cleanup operates on
  stable handles. New widget test (`deleting an authored theme does
  not crash when the row unmounts`) covers the path.

- **New custom themes now actually apply to the app.** Tapping *+ New
  theme* and confirming the seed+brightness dialog used to leave the
  new theme sitting in the library waiting to be tapped — the
  `themeMode` (System / Light / Dark) was untouched, so a brand-new
  dark theme was hidden behind a `system`-mode + system-brightness-
  light combo. The editor's *Save* now detects a fresh id (not yet
  in the library) and atomically (a) upserts, (b) sets
  `activeCustomThemeIdProvider`, (c) flips `useCustomThemeProvider` on,
  and (d) syncs `themeModeSettingProvider` to the brightness the user
  picked in the new-theme dialog — so the resulting dark/light custom
  theme is what the app actually shows on pop. Editing an existing
  theme keeps the existing activation + themeMode untouched. New
  widget test (`creating a new dark theme applies it with
  ThemeMode.dark on save`) covers the path.

- **Custom themes library collapsible remembers its state across
  restarts.** The ExpansionTile's expanded/collapsed state was owned
  by the widget itself, so it always reset to collapsed on reopen. A
  new `customThemesExpandedProvider`
  (`Notifier<bool>` + `AppearancePreferencesStore.readCustomThemesExpanded`
  / `writeCustomThemesExpanded`, persisted under
  `uxnan.appearance.customThemesExpanded`) drives an `ExpansibleController`
  from the screen's state class. Toggle → provider → disk; first
  build → disk → controller. New widget test (`the library expansion
  state persists across restarts`) covers the path.

### Added
- **Custom accent colors (Personalization → Accent color).** The
  personalization screen now offers a curated palette of **7 swatches**
  (`blue` / `purple` / `pink` / `red` / `orange` / `green` / `teal`)
  in place of the previous *"Coming soon"* placeholder. The whole
  `ColorScheme` is derived from the picked swatch via
  `ColorScheme.fromSeed(seedColor: accent.seed, brightness: …)` for
  **both** light and dark, so every M3 role (primary, secondary,
  tertiary, surface containers, outline, …) stays coherent and
  harmonious — exactly the *"larger theming change"* `FOR-DEV.md`
  called for, and a direct fix for the visual incoherence a first cut
  that only overrode `primary` had. The brand `blue` keeps the
  hand-tuned palette (no visual regression for users that never
  personalize); every other swatch switches to the dynamic scheme.
  The pick is persisted in `shared_preferences` under
  `uxnan.appearance.accentId` (only the id; the seed is resolved
  from the immutable `AccentPalette`, so adding a swatch is
  non-breaking for old saves and `AccentPalette.fromId` degrades
  unknown ids to the default).
  - `domain/value_objects/accent_color.dart` — `AccentColorId` + the
    closed `AccentPalette` (7 swatches with M3-friendly chroma).
  - `infrastructure/storage/appearance_preferences_store.dart` —
    `readAccentId()` / `writeAccentId(String?)` (replaces the
    `FOR-DEV:` reservation in the doc comment).
  - `presentation/providers/application_providers.dart` —
    `AccentSetting` notifier + `accentSettingProvider`
    (Riverpod 3.x manual, same hydrate-then-persist pattern as
    `ThemeModeSetting` / `LocaleSetting`).
  - `presentation/theme/uxnan_theme.dart` —
    `buildUxnanTheme({ accent: AccentColorId? })`; brand blue →
    hand-tuned palette, anything else → dynamic from-seed scheme.
  - `presentation/screens/settings/personalization_screen.dart` —
    `_AccentPicker` (M3 list of swatch rows, M3E chrome), replacing
    the `_AccentComingSoon` placeholder.
  - `app.dart` — watches `accentSettingProvider` and passes the seed
    to `buildUxnanTheme` for both `theme` and `darkTheme`.
  - l10n (en + es): `accentBlue` … `accentTeal`.
  - Tests: 8 in `accent_color_test.dart` (palette, tolerant parser,
    equality), 7 in `appearance_preferences_accent_test.dart`
    (store round-trip, namespacing, isolation from the other
    appearance keys), 7 new + 2 pre-existing in
    `uxnan_theme_test.dart` (default-palette preservation, dynamic
    from-seed for every non-default swatch, light/dark coherence,
    determinism), 4 in `personalization_screen_test.dart` (7
    swatches render, default is pre-selected, tap persists, language
    flow still works). **319 unit + widget tests passing, all green.**
  - **Spec drift:** `architecture/02c-implementation-guide.md` §3.1
    documents the two-path rule (brand-blue → hand-tuned;
    non-default → from-seed for both brightnesses);
    `architecture/00-index.md` status table flips the item to
    ✅ Hecho. `FOR-DEV.md` marks the entry as DONE (on-device
    visual review of the swatch picker is the remaining UX step).

### Changed
- **`flutter_markdown` → `flutter_markdown_plus`.** The original
  `flutter_markdown 0.7.x` package is marked discontinued on pub.dev;
  replaced with `flutter_markdown_plus 1.0.7` (the maintained fork
  published by the Flutter team + community). The API is a
  drop-in replacement — `MarkdownBody`, `Markdown`, and
  `MarkdownStyleSheet` keep their exact signatures — so the only
  changes are the `pubspec.yaml` entry and the package import in
  `file_viewer_screen.dart`, `message_content_view.dart`, and the
  matching test. The pubspec resolution dropped `flutter_markdown
  0.7.7+1` automatically.

### Fixed
- **Bridge connection survives background → resume.** Backgrounding the
  app could leave it stuck "disconnected" on reopen (the OS suspends/drops
  the socket and nothing re-checked on resume). On resume the app now calls
  `SessionCoordinator.resume()`: if a reconnect backoff was pending it
  retries **immediately** (new wake mechanism — `resume` interrupts the
  backoff delay instead of waiting it out), if it believed it was connected
  it round-trips `bridge/status` to catch a silently-dropped socket, and if
  disconnected it kicks a reconnect. The open conversation also re-syncs
  (`ThreadManager.resyncActive`) so messages that landed while away appear
  without leaving + re-entering it.

### Added
- **Cold-start auto-reconnect + history recovery.** On launch (incl. after
  an unexpected close) the app reconnects to the most-recently-used PC
  (`lastSeen`, best-effort, with a backoff fallback) so the bridge session
  is restored automatically; the existing `turn/list` re-sync then recovers
  the thread's messages from the bridge (local drift history is preserved
  across restarts and reconciled by the deterministic assistant id).
- **Jump-to-latest button in the conversation.** Scrolling up in a long
  or streaming conversation now reveals a small circular button (over the
  timeline, above the composer) that springs in (NE small-element motion)
  and jumps back to the newest message in one tap; it hides again near the
  bottom. Driven by a scroll listener (`_showJumpToBottom`) reusing the
  existing `_scrollToBottom`.
- **Agent plan / to-do lists now render (plan mode).** When an agent emits
  its task list, it shows as a checklist in the turn (the `PlanContent`
  decoder + `_PlanCard` already existed; the bridge now maps each agent's
  plan/to-do tool to a `plan` content block — see the bridge changelog).
  No mobile change beyond confirming the end-to-end render.
- **mDNS "Browse nearby bridges" in manual pairing.** The manual-code
  screen now has a **Browse nearby bridges** action that opens a sheet
  listing bridges advertising `_uxnan._tcp` on the LAN (a new
  `BridgeDiscoveryService` over the native `nsd` plugin — NsdManager /
  Bonjour, which handles the Android multicast lock). Picking one
  pre-fills the host; typing the host stays the fallback. TXT/addr
  parsing (`parseDiscoveredBridge`, prefers the advertised `addr`/`port`,
  falls back to the resolved IPv4 + SRV port) is unit-tested. Adds the
  `nsd` dependency; Android `INTERNET` + `CHANGE_WIFI_MULTICAST_STATE`
  permissions and iOS `NSBonjourServices` + `NSLocalNetworkUsageDescription`
  (copy review tracked in `FOR-HUMAN.md`).
- **Session info sheet ("resume from the CLI").** The conversation
  overflow menu's **Session info** item (replacing the bare "Copy thread
  ID") opens a sheet showing the copyable **Thread ID** and the agent's
  **native session id** (fetched lazily via `thread/read`,
  `ThreadManager.readAgentSessionId`; absent on older bridges/agents),
  with a hint that they let you resume the conversation from the agent's
  CLI on the PC.
- **Per-thread approval mode now persists server-side.** The approval
  (access) mode picked in the turn-tools sheet is seeded from the bridge
  on open (`ThreadManager.readAccessMode` via `thread/read`, the source
  of truth) and persisted on change (`ThreadManager.setAccessMode` →
  `thread/setAccessMode`), so the per-thread choice survives a restart and
  is shared across devices. (Enforcing the mode per turn — mapping it to
  each agent's permission flag — is a tracked follow-up.)
- **Remote history pagination (newest-page open + backward paging).**
  Opening a thread now pulls only the **newest** page of turns
  (`turn/list { fromEnd: true, limit: 20 }`) instead of the oldest page,
  and "Show earlier messages" pages **backward** over the bridge: it
  widens the local window first, then fetches the previous turn page by
  an explicit offset cursor derived from the bridge's new `total`,
  persisting older answers below the current min `orderIndex`. `hasMore`
  reflects local-window OR remote-offset. Backward-compatible (an older
  bridge that omits `total` falls back to local windowing only). Requires
  the bridge/shared `turn/list` changes below. Covered by a manager
  back-paging test.
- **Project filter chips on the threads list (implemented, disabled in
  the UI).** A PC hosting several repos can be sliced by project: a
  horizontal chip bar filtering by a project key (`projectId` when set,
  otherwise the working `cwd`, labelled by the folder basename),
  composing with the agent filter. The code (`_ProjectFilterBar` +
  grouping helpers) is complete but **intentionally not shown** — a flat
  chip bar isn't the right surface; it's gated behind
  `_projectFilterEnabled` (`false`) until a dedicated advanced
  filters / organization view exists. Flip the flag from that view to
  enable; no other change needed.
- **Sort + density thread-list preference now persists.** The list
  ordering (created / name / folder) and the compact-density toggle were
  in-memory `StatefulWidget` fields; they're now persisted on-device
  (`ThreadListPreferencesStore`, keys `uxnan.threads.sort` /
  `uxnan.threads.compact`) and exposed as `threadSortProvider` /
  `threadDensityCompactProvider`, so the active and archived thread lists
  share one persisted choice that survives restarts. Covered by a store
  round-trip test.
- **Inline file editing in the file viewer.** Text files (UTF-8, not
  images or binaries) now show an **Edit** action in the viewer's top
  bar. Editing opens a full-height monospace editor over the raw file
  content; saving writes the buffer back through the existing
  `workspace/applyPatch` RPC (a single `modify` change — no new bridge
  contract) and immediately re-fetches the file so the git diff and the
  browser tree colours repaint with the new changes. An unsaved buffer
  prompts a discard confirmation on close / system-back (`PopScope`).
  New manager method `FileBrowserManager.writeFile`; new strings
  `fileViewer{Edit,Save,Saved,SaveFailed,Discard,DiscardTitle,DiscardBody,KeepEditing}`.

### Changed
- **File-browser folders now colour by their contents' git status.**
  A directory whose (possibly still-collapsed) descendants contain
  changes now paints its name + folder icon: `modified` when any tracked
  descendant changed, `untracked` when the only changes underneath are
  untracked. Previously only files coloured, so a changed file deep in
  the tree left every parent folder neutral until expanded. Implemented
  as an aggregate scan over the `git/status` map in `FileBrowserManager`
  (`_dirStatus`), applied to directory nodes on build and repatch.

### Fixed
- **File viewer content now scrolls *under* the transparent app bar.**
  The previous `Column([SizedBox(topInset), Expanded(body)])` layout
  pinned the scrollable body *below* the bar, so the bar always sat over
  a blank `surface` band and read as a solid app bar. The body now fills
  the `Stack` and each scrollable leaf (`_CodeBody`, `_MarkdownBody`,
  `FileDiffViewer`) pads its own top by `topInset`, so content scrolls
  beneath the gradient veil — matching `ConversationScreen` /
  `FileBrowserScreen` / `GitScreen`.
- **File viewer no longer renders a solid band under the app bar.**
  The viewer's body used `Padding(top: topInset, child: _buildBody)`
  inside the `Stack`, which painted the `surface` background of the
  Scaffold into the gap between the bar's gradient and the content.
  The new body is a `Column` whose first child is a transparent
  `SizedBox(height: topInset)` (no painted background), so the area
  between the bar and the content is see-through and the gradient
  dissolves naturally into the surface. Matches `ConversationScreen`
  / `FileBrowserScreen` / `GitScreen` exactly.
- **`NeTopBar` gradient softened.** Peaked at `surface` (alpha 1.0)
  in the original; now peaks at 0.75 and dissolves faster
  (`0.75 → 0.45 → 0`, stops `[0, 0.5, 1]`). Affects every screen
  that uses `NeTopBar` (file browser, file viewer, git screen,
  conversation, branch picker). The bar still gives the
  back / actions a stable background but reads as a *veil* over the
  content instead of a solid app-bar band.

### Added
- **Horizontal padding for file viewer text content.** The text body
  (code, markdown source, markdown preview, diff, image, binary,
  error) now wraps its content in `EdgeInsets.symmetric(horizontal:
  UxnanSpacing.lg)` so the rendered text doesn't kiss the screen
  edges on narrow viewports. Previously the text went from
  `padding: 0` to `padding: 0` (only the highlight theme's own
  internal padding kept it off the edge, and only sometimes). Same
  `lg` (16 dp) inset the rest of the app uses for content surfaces.
- **File viewer / file browser / git screen — `NeTopBar` no longer
  overflows on phone widths.** All three screens overlaid the bar with
  `Positioned(top: 0, left: 0, right: 0, child: NeTopBar(...))` inside
  a `Scaffold(body: Stack(children: [...]))` that defaulted to
  `StackFit.loose`. With loose fit the stack's own size is the union
  of its non-Positioned children — and on the file viewer the body
  is a `MarkdownBody` whose intrinsic width is much smaller than the
  screen, so the Stack collapsed to ~131 dp on a 360 dp viewport. The
  Positioned inherited that narrow width (`left: 0, right: 0` on a
  zero-width stack gives the bar zero horizontal room), the `Row` of
  leading + title + actions tried to fit 4 × 48 dp `IconSurface`s
  into ~131 dp, and the user saw a `RenderFlex overflowed by 86/73
  pixels` exception. Switching all three screens to
  `Stack(fit: StackFit.expand, children: [...])` makes the stack
  fill the Scaffold body, so the bar gets the full row width.
  A regression test (`file_viewer_screen_test.dart`) pumps the viewer
  with three real markdown samples (CLAUDE.md → "AGENTS.md", a full
  README with headings + lists + code blocks, and a long paragraph)
  on a 1080×2160 / 3.0 viewport and asserts no captured layout
  exceptions.
- **File viewer chrome — bar gradient softened.** The bar's
  `LinearGradient` peaked at `surface` (opaque) which read as a
  solid app-bar band on top of the file tree. Now peaks at
  `surface.withValues(alpha: 0.85)` and dissolves faster
  (`0.55 → 0`) so the bar feels like a *veil* over the content, not
  a solid panel. Affects every screen that uses `NeTopBar` (file
  browser, file viewer, git screen, conversation, branch picker) so
  the whole app now shares the lighter bar tone.
- **`GitScreen` now uses `BouncingScrollPhysics`.** The
  `CustomScrollView` in the file list was missing the `physics:`
  argument and so fell back to `ClampingScrollPhysics` on Android —
  the user couldn't see the iOS-style overscroll bounce the rest of
  the app uses. Added `physics: const BouncingScrollPhysics(parent:
  AlwaysScrollableScrollPhysics())` to match `ConversationScreen`,
  `FileBrowserScreen`, and `NeScaffold`.
- **Hardcoded colors replaced with theme tokens.** `_PrimaryActionButton`
  (git screen) used a raw `Colors.white` literal for the busy spinner;
  replaced with `colors.onPrimary` (the semantic token that already
  drives the icon and the surface). `_MarkdownBody` (file viewer)
  used raw `Color(0xFF282C34)` / `Color(0xFFFAFAFA)` literals for
  the codeblock background; replaced with
  `colors.surfaceContainerHighest` / `colors.surfaceContainerHigh`
  so the block follows the active M3 scheme. New rule going forward:
  never inline a hex literal in a widget — always reference
  `UxnanColors.*` or `Theme.of(context).colorScheme.*`.

### Changed
- **Git status now paints newly expanded subdirectories.** The file
  browser only applied `git/status` to children that were loaded in
  the initial root listing — when the user expanded a deeper
  directory, its children were created with `gitStatus = null`, so
  the new entries rendered in the neutral `onSurface` colour instead
  of the git-status colour. `_buildInitialChildren` now takes the
  cached git-status map and pre-paints each file the same way the
  root does; `toggleDirectory` forwards the map when it fetches a
  new sub-listing. Visible effect: the entire tree, not just the
  root level, reflects `git status`.
- **File viewer's app bar matches the conversation chrome.** The
  file viewer's title used `titleMedium`; every other NE-styled
  screen (`ConversationScreen`, `GitScreen`, file browser) uses
  `titleLarge.copyWith(fontSize: 20)`. The viewer now uses the same
  size — the back, title, and trailing action row are visually
  indistinguishable from the rest of the app.
- **`GitScreen` is now a true Neural Expressive surface.** The
  screen kept using M3 widgets (`Card.outlined`, `Card.filled`,
  `Checkbox`, `IconButton`, `IconButton.filled`, `ListTile`,
  `InkWell`) while every other screen was rebuilt against NE — the
  result was a card-style chrome that didn't match the file browser,
  conversation, or new-conversation dialog. The screen now uses:
    - `_NeSurface` (a new shared widget) in place of
      `Card.filled` / `Card.outlined` — rounded 20 dp corners,
      `surfaceContainerHigh` fill, optional thin outline.
    - `_NeCheckbox` in place of M3's `Checkbox` — a 24 dp circular
      surface on `primary` when selected, the empty-box / check /
      dash glyph in the same M3E scale spring as the rest of the
      bar.
    - `IconSurface` in place of every `IconButton` (refresh,
      expand-all, undo-commit, etc.) — same round press feedback,
      same tooltip contract.
    - `_PrimaryActionButton` in place of `IconButton.filled` for
      the commit / push primary slot — keeps the round ripple that
      `IconButton.filled` breaks, supports a busy-spinner overlay,
      and accepts the `Badge.count` for the push-ahead count.
    - `_BranchPickerRow` in place of `ListTile` for the
      branch-switcher bottom sheet — a tappable row with the same
      M3E ripple.
    - `_ExpandableRow` for the whole file card so a tap anywhere
      on the row (not just the chevron) toggles expansion.
  The file's *name* in the row now picks up the git-status colour
  (matching the file browser's tile), so the row reads at a glance
  before reading the icon.

### Fixed
- **File browser sends absolute paths to the bridge.** The bridge's
  `workspace/list` does `resolve(cwd)` server-side, so a relative `cwd`
  resolves against the project's CWD, not the worktree / sub-folder the
  user is browsing — the visible symptom was `FormatException: Invalid
  workspace/list response` whenever the user opened a directory under a
  worktree. `FileBrowserManager` now joins the workspace's absolute root
  (the `cwd` from the active thread) with each expanded directory's
  relative path before sending. `loadRoot` and `toggleDirectory` both
  honour this convention. `FileBrowserManager`'s docstring documents
  the path contract.
- **Folder/file load errors no longer crash the browser.** A
  `workspace/list` failure (directory removed, permission denied, a
  stale cwd) used to surface as an unhandled `FormatException`. The
  manager now catches the underlying `RpcError` (or any
  `FileListingException` from a malformed payload) and stores the
  message on the affected `FileTreeNode.error`. The directory is shown
  collapsed with its error visible; the root failure shows the
  existing `_ErrorBody`. `readFile` / `readImage` throw a dedicated
  `FileReadException` (also caught by the viewer) so the existing
  error state still renders correctly.
- **Toggles in the file browser now reflect their state in the app
  bar.** The previous overflow-menu `Switch`es rebuilt only when the
  popup reopened (the `PopupMenuItem` doesn't watch the provider), so
  the user saw no visual feedback until the menu was closed. Both
  "show file extensions" and "show hidden files" are now `IconSurface`s
  in the app bar with `selected: bool` (matching the diff-toggle
  pattern the file viewer already uses) — the secondary-container
  tone + `onSecondaryContainer` foreground make the active state
  immediately visible.
- **File browser / viewer chrome matches the rest of the app.** Both
  screens now use the same `Scaffold` + `Stack` + `NeTopBar` overlay
  pattern that `ConversationScreen` and `GitScreen` use, with
  `BouncingScrollPhysics` + `AlwaysScrollableScrollPhysics` on the
  tree list (matches `NeScaffold`). The gradiente del app bar, el
  scroll-veil inferior y la separación con el status bar now match
  the conversation screen exactly.

### Added
- **Workspace file browser (HECHO).** A full-screen file tree for the active
  thread's `cwd`, reachable from a new `folder_open` `IconSurface` in the
  conversation top bar (next to the existing git action). Lists every file and
  folder, including hidden dotfiles, with the git-aware color treatment the
  user asked for: tracked-but-unchanged files are neutral; `added`,
  `modified`, `deleted`, `renamed` and `untracked` each get a distinct color
  (matching the `GitScreen` + `GitDiffView` chrome). Tapping a directory
  toggles its expansion (lazy `workspace/list` walks); tapping a file opens
  the new **file viewer**. New `FileBrowserManager`
  (`application/managers/`) + per-cwd stream provider; entity layer in
  `domain/entities/file_browser.dart`. i18n strings added in EN + ES.

- **File viewer (HECHO).** A second screen, pushed from the browser, that
  decides the rendering by extension:
  - **Images** (`.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`/`.bmp`): inline
    `Image.memory` from `workspace/readImage`'s base64, wrapped in an
    `InteractiveViewer` for pinch-zoom and pan.
  - **Markdown** (`.md`/`.markdown`): a **preview** (rich
    `flutter_markdown` rendering with M3 chrome — code blocks, blockquotes,
    …) **or the raw source** (preserving indent / escape sequences), toggled
    by a top-bar action; the choice is a per-session toggle. The footer pill
    surfaces the current mode.
  - **Code / text**: syntax highlighting via `flutter_highlight` with the
    `atom-one-{dark,light}` themes (matching the message-content renderer);
    per-extension language detection (Dart/TypeScript/JavaScript/Python/Swift/
    Kotlin/Java/Go/Rust/C/C++/CSS/SCSS/HTML/JSON/YAML/TOML/XML/Bash/SQL/Markdown).
  - **Git diff overlay**: for files that report a `git status`, the viewer
    fetches `git/diff { path }` and renders the unified diff with the same
    +/- coloring as `GitDiffView` in the conversation; a top-bar toggle
    switches back to the raw file content. The footer status pill paints the
    file's git state (added/modified/deleted/renamed/untracked).
  - **Binary placeholder**: a graceful "binary file" message when the
    bridge returned base64 instead of UTF-8.
  - **Copy file** action: copies the current content (or base64) to the
    clipboard, with a snackbar.
  The viewer's chrome mirrors the browser (transparent `NeTopBar` +
    scroll-veil body) and reuses the `IconSurface` / `IconSurfaceMenu`
    components for a consistent Neural Expressive feel.
### Added
- **Seq-based catch-up on reconnect (mobile half)** — the phone now persists the
  highest bridge→phone `seq` it has applied per device and advertises it on
  reconnect so the bridge replays only the outbound it missed (spec 02a §5.9.2).
  `ClientHello` gained a `resumeState` field
  (`{ lastAppliedBridgeOutboundSeq }`, omitted when 0) serialized into the
  handshake; `SecureTransportLayer.performHandshake` forwards it. The applied
  seq (tracked by `SecureChannel.decrypt` on `SecureSession.bridgeOutboundSeq`)
  is persisted on `TrustedDevice.lastAppliedBridgeOutboundSeq` — a new nullable
  drift column (schema **v5**, additive migration) read/written by
  `TrustedDeviceRepository`. `SessionCoordinator` loads it into the handshake and
  checkpoints it on every teardown (drop / disconnect / socket close) **and**
  periodically on the heartbeat, updating the in-memory active device
  synchronously so an immediate reconnect advertises the freshest value. With
  the bridge half already shipped, reconnects now resume the bridge→phone stream
  instead of silently dropping anything sent while the phone was briefly away.
  Covered by `handshake_messages_test.dart` (resumeState serialization),
  `trusted_device_repository_test.dart` (column round-trip + older-row default
  0), and `session_coordinator_test.dart` (persists on disconnect, advertises
  resumeState on reconnect, first connection sends none). Note: a bridge restart
  resets its in-memory outbound log, so a stale resume point yields no replay and
  the phone re-syncs via `turn/list` — acceptable and expected.
- **Approval decisions persist across scroll + restart** — the user's
  decision on every interactive approval card (Approve / Reject / "always
  allow this session") is now stored on-device via
  `ApprovalResponseStore` (`infrastructure/storage/approval_response_store.dart`,
  SharedPreferences) as soon as the card is tapped. The next time the same
  card scrolls into view — even after a full app restart — it renders its
  **resolved** state (`Decision recorded · Answered 14:32`) with no
  action buttons, so an answered prompt can never be re-answered. The
  resolved view also picks up a risk-tinted outline (success / warning /
  error / neutral) and a muted body text, so the "already decided" state
  reads at a glance in line with the Neural Expressive design language.
  Two new l10n strings: `approvalDecidedTitle` ("Decision recorded" /
  "Decisión registrada") and `approvalAnsweredAt` ("Answered" /
  "Respondido"). Covered by
  `test/unit/infrastructure/storage/approval_response_store_test.dart`
  (9 cases: round-trip, persistence across store instances, idempotency,
  forget, defensive decoding of corrupt/malformed blobs) and two new
  widget tests in `conversation_widgets_test.dart` that pre-seed the
  store and assert the action buttons are absent after hydration.

### Docs
- **Synced the spec (`architecture/00-index.md`,
  `architecture/02a-system-architecture.md`,
  `architecture/02b-contracts-and-requirements.md`) with the code.** This
  is a docs-only change in the mobile app; no runtime behavior changed.
  Per `AGENTS.md` → *Spec drift control (non-negotiable)*, every `DONE` in
  this monorepo's `FOR-DEV.md` is now reflected in the spec. The spec was
  behind the code (Neural Expressive, manual-code pairing bridge-first,
  voice, image attachments, per-model run-option knobs, context-usage
  indicator, per-agent `auth/status`, interactive approval, full Git,
  etc.). The spec now matches.
  - `architecture/00-index.md`: status table updated to the live
    Android-alpha-ready state (Neural Expressive added, the full repo
    set, manual-code pairing bridge-first, voice, stop-the-turn, attach,
    per-model run-option knobs, context-usage indicator, per-agent
    `auth/status`, interactive approval, per-PC threads with
    connection-targeted live actions, thread lifecycle actions, Remove
    device, full Git with per-file diff, push with deep-link +
    preferences + persistence). `architecture.old/` removed from the
    monorepo tree (archived in git tag `pre-architecture-old-archive`);
    relay marked as optional / self-hosted.
  - `architecture/02a-system-architecture.md`: section 2 (topologies
    re-ranked: LAN-direct and Tailscale-direct as primary/recommended;
    relay demoted to self-hosted fallback); section 3 (`IAgentAdapter`
    updated with the methods and capabilities that the app actually
    consumes today); section 5.5.3 (manual-code pairing reframed as
    bridge-first); section 5.5.4 (`PairingPayload` v2 with optional
    `relay` + `hosts`); section 5.10 (push split into bridge-direct
    primary + relay fallback).
  - `architecture/02b-contracts-and-requirements.md`: the canonical 59
    JSON-RPC methods + 8 streaming notifications the app consumes (or
    may consume) today + cross-cutting shapes (`PairingPayload` v2,
    `TurnSendParams`, `TurnAttachment`, `ApprovalResponse`, `AgentModel`,
    `AgentCapabilities`, `TurnUsage`).
- **Updated this monorepo's `README.md`** to reflect the Android
  alpha-ready state (status section, the full MVP, the iOS pending
  FOR-HUMAN list, the test count, the new i18n + Neural Expressive
  stack entries).

### Fixed
- **App-bar menu buttons ripple as circles, not squares.** The sort / more /
  pairing / conversation / git overflow menus wrapped a round surface in a
  `PopupMenuButton`, whose internal `InkWell` is rectangular — so the press
  ripple read as a square over the circle. New shared `IconSurfaceMenu` drives
  `showMenu` from a real `IconSurface`, so the ripple is clipped to the circle
  and the M3E press-scale spring plays, matching the standalone bar actions.
- **"Remove worktree" now appears** for worktree-backed threads: the app
  persists the `worktreePath` it created (the bridge doesn't track it), which is
  what gates the action.
- **Branch delete protects the primary branch** (`main`/`master`) and the
  current branch, and only offers deletion for local branches (never remotes).
- **Conversation auto-scroll reaches the true bottom.** It jumped to a stale
  `maxScrollExtent` (captured before streaming/late layout finished), landing
  just short and fighting a manual drag-down. It now jumps to the live bottom
  and re-checks next frame to catch late layout.

### Added
- **Git revert + branch/worktree deletion wiring.** `GitActionManager` gains
  `revert` (`git/revert`), `deleteBranch` (`git/deleteBranch`, `force`) and
  `removeWorktree` (`git/removeWorktree`, `force`) now that the bridge implements
  them. The git screen's overflow menu adds **"Revert last commit"** (creates a
  revert commit, preserving history — distinct from Undo commit). Branch-delete /
  worktree-management UI + cwd-vanished composer disable (`workspace/exists`) are
  follow-ups (see `FOR-DEV.md`).

### Fixed
- **Foreground push no longer fires for the conversation on screen.** The
  bridge-direct FCM push raised a foreground notification even while the user
  was viewing that conversation (the per-thread suppression only covered the
  local domain-event path). `PushNotificationService` now suppresses a
  foreground FCM whose `threadId` is the active conversation and — while
  connected — defers to the live WS/domain-event path so a push never
  duplicates the notification it already raises; a disconnected foreground (the
  devices list) still shows it. Covered by `foreground_push_suppression_test.dart`.

### Changed
- **Devices app-bar pairing entry is a floating menu** offering **Scan QR** or
  **Enter manual code**, instead of a single scan button. Uses the same
  `PopupMenuButton` + Icon-Surface style as the threads sort/more menus.

### Added
- **Manual-code pairing (`ManualCodeScreen`).** Pair without scanning a QR by
  typing the bridge **host** + the short **pairing code** shown on the PC. A new
  `ManualPairingService` (`infrastructure/pairing/`, dio) calls the bridge's
  `GET /pair/resolve?code=` directly, decodes the returned `PairingPayload`, and
  hands it to the normal `SessionCoordinator.processPairingPayload` handshake.
  Tolerant host parsing (`host` or `host:port`, default port 19850, scheme/path
  stripped) and classified errors (bad/expired code, rate-limited, unreachable,
  malformed). Reachable from the onboarding pair page ("Enter a code instead",
  route `/pairing/manual`). Covered by `manual_pairing_service_test.dart`.
  **UI pending the maintainer's on-device review** (AGENTS.md "UI changes").
  mDNS auto-discovery is a follow-up (`FOR-DEV.md`).
- **History windowing + conversation fork/resume.** The conversation timeline
  now renders only the most-recent page and offers a **"Show earlier messages"**
  header to load older history on demand (`ThreadManager.loadMoreHistory`),
  bounding widget build for long threads. A **"Fork conversation"** overflow
  action deep-copies the thread on the bridge (`thread/fork`) and opens the new
  one; opening a conversation now best-effort **resumes** it on the bridge
  (`thread/resume`, skipping archived threads). Incremental *remote* back-paging
  is a documented follow-up (the bridge's `turn/list` cursor is forward-only).
- **Image attachments in the composer (app side).** The "+" turn-tools sheet's
  Attach action (shown for `images`-capable agents) now picks an image from the
  **photo library** or **camera** (`image_picker`, downscaled to 2048 px / q85).
  Pending images appear as a removable thumbnail strip above the composer, an
  image-only message (empty text) can be sent, and sent/received images render
  inline. The image rides on `turn/send` as `attachments` and is echoed locally.
  **Dormant for delivery until the bridge accepts attachments** (no
  `TurnSendParams.attachments` / `AgentManager.sendTurn` forwarding yet) — the
  contract is documented in `FOR-DEV.md`.
- **Interactive approval prompts (app side).** The in-timeline approval card is
  now interactive: **Approve**, **Reject**, and **Always allow this session**,
  with a spring morph into a settled status row, an in-flight spinner, and
  re-enable on failure. `ThreadManager.respondApproval` sends the decision via
  `turn/send { approvalResponse: { approvalId, decision } }`; an in-memory
  `ApprovalResponses` provider tracks the per-request sending/resolved/failed
  state. **Dormant until the bridge supports approvals** — the Claude adapter
  runs headless and Echo doesn't emit requests, so this can't fire on-device
  yet; the exact bridge contract (emit + accept + route) is documented in
  `FOR-DEV.md`. Plan/subagent blocks were verified to be informational, not
  approval gates.
- **Extended git actions (branch & remote).** `GitActionManager` gains `pull`
  (`git/pull`), `checkout` (`git/checkout`), `createBranch` (`git/createBranch`)
  and `createWorktree` (`git/createWorktree`), surfaced in the git screen where
  each belongs rather than in a catch-all sheet:
  - **Pull** is a badged app-bar action that appears only when the branch is
    behind its remote (the badge counts the incoming commits).
  - **Switch branch** and **New branch** (create + checkout) live in the
    three-dots overflow menu.
  - The commit composer **morphs into a push control** once the working tree is
    clean and the branch is ahead — the commit button becomes a badged Push and
    the extra-options toggle becomes Undo-last-commit — so push and undo are no
    longer buried in the overflow menu.
  - **Worktree creation moved to the new-conversation dialog**: an optional "Run
    in a worktree" toggle creates an isolated branch checkout from the chosen
    working dir and starts the conversation in it. The phone derives a sibling
    path (the bridge needs an explicit path — no managed/auto-path yet); a "Let
    the bridge pick the location" switch forwards `managed` for the future.
  - Not wired yet, all blocked on missing bridge support (tracked in
    `FOR-DEV.md`): revert (`git/revert`), safe branch/worktree **deletion**
    (`git/deleteBranch` / `git/removeWorktree`), and detecting a vanished
    cwd/worktree to disable the threads that lived in it.
- **Branding footer on the devices list.** The home screen now shows a small
  footer at the bottom: the localized app name ("Uxnan Mobile" / "Uxnan
  Móvil") and an "ALPHA" release-stage pill. The footer uses
  `SliverFillRemaining(hasScrollBody: false)` so it pins to the bottom of
  the screen with few paired PCs, and shrinks to its natural size right
  after the last card when the list is long — it never leaves a
  screen-sized white gap when you scroll. The pill is a neutral,
  non-interactive label (modeled on the existing `_RiskBadge` /
  `_TokenChip` pattern) so the alpha status is always visible without
  standing out across theme changes.
- **"Scroll to latest on send" setting** (Settings → Conversation, on by
  default). When you send a message the conversation jumps to your message even
  if you'd scrolled up; turn it off to keep your manual scroll position on send.
  (Auto-scroll still follows the stream while you're near the bottom.)

### Changed
- **Neural Expressive UI redesign — pilot: the conversation screen.** Reworked
  the conversation surface to the Material 3 Expressive / Neural Expressive
  design language (see `docs/neural-expressive-design.md`), cutting the visual
  noise the old layout accumulated **while preserving every function**:
  - The large two-line app bar is gone. A lean **56 dp transparent top bar with
    a scroll veil** carries only the **model-picker pill**, the git action and
    the overflow menu — each on the neutral circular **Icon Surface** tone (the
    overflow menu now matches the git action; the connection dot was dropped, as
    earlier screens already show online state).
  - **Context usage and the turn's numeric diff moved out of the chrome** to a
    compact, right-aligned info row just above the composer: `+a −d` (numbers
    only — the Git screen has the detail) next to the context indicator, both on
    the same neutral surface as the Icon Surfaces.
  - The composer is now a **fully-rounded floating pill** (matching the model
    pill and Icon Surfaces) with only the essentials: a "+", the text field, and
    a mic that swaps to Send (and to Stop while a turn runs). Its controls share
    one vertical baseline; it stays editable while offline (draft now, send when
    reconnected) — only *sending* is gated.
  - The "+" opens a unified **turn-tools sheet** (attach + run-option knobs +
    approval mode), replacing the always-on options strip above the composer.
  - Agent activity now reads as a **morphing polygon loader** at the *start of
    each streaming response* (not a bar across the top).
  - **Floating menus are rounded and roomier** (16 dp corners, min width) — the
    overflow menu and the run-option knob menus, plus 28 dp bottom-sheet corners.
  - The **work log** and the **reasoning ("Thinking")** section share one light
    **borderless** container (hairline outline, no fill). The work log shows its
    first few **commands inline (one truncated line each)**, in order, under the
    message that triggered them; its **header is always tappable** (even a single
    command expands to its full text + output), with a "+N" hint when collapsed.
    Thinking stays collapsed by default, gated to the Settings → Conversation
    toggle.
  - A matching **bottom scroll veil** sits above the composer (mirroring the top
    bar): the last messages fade into the surface as they reach it.
  - New shared building blocks for the rollout: spring-motion tokens
    (`theme/motion.dart`), `IconSurface`, `NeTopBar`, `PolygonLoader`, and the
    pill composer + turn-tools sheet.

  This is a UI proposal pending on-device review (per the propose → review →
  adjust → approve workflow). The remaining screens (devices, threads + the
  navigation drawer, git, settings) follow in later increments. The context
  meter moved out of the composer, so its two composer-level widget tests were
  retired; all other conversation tests still pass.

### Fixed
- **Streaming turns now truly interleave the work log with the response.** The
  live turn buffer preserves the order text and command/diff blocks arrive in,
  instead of accumulating all text in one string and all blocks in another and
  rendering every command above the answer. The activity now sits under the
  message that triggered it, in execution order. Persisted turns keep that order
  across a `turn/list` re-sync (the split text runs reconcile to the same full
  answer); a turn loaded purely from history can't interleave yet — the wire
  `blocks` array carries no per-block text offset (tracked as `FOR-DEV` in
  `thread_manager`).
- **Agent responses no longer collapse into one block.** An assistant turn now
  renders its work logs and responses **in chronological order** (a work log
  sits just above the response it precedes) instead of stacking every work log
  on top of one merged prose block — interleaved responses read as separate
  paragraphs again. Thinking stays at the top; the Changed files summary at the
  end. (No functionality lost.)
- **Context meter persists when you re-open a chat** — the bridge now stores a
  turn's token usage and returns it in history, and the phone restores the meter
  on re-sync, so it no longer resets to 0 on leaving and returning to the same
  conversation.

### Added

- **Stop the agent mid-turn.** While the agent is producing a turn, the composer
  Send button becomes a red **Stop** button that cancels the in-flight turn
  (`turn/cancel`, via `ThreadManager.cancelTurn`) without closing the thread — so
  a message sent by mistake can be stopped and rewritten.
- **Copy your own message.** Tapping a user (right-side) bubble toggles a **Copy
  message** action beneath it (hidden by default), mirroring the agent turn's
  copy action. The user bubble's text is no longer selectable (the tap toggles
  the copy affordance instead of placing a cursor).
- **Work log / Changed files / thinking now also populate for Codex, pi and
  OpenCode** (the phone already decodes the structured events; the bridge now
  emits them for every agent — see `bridge/CHANGELOG.md`). Pending on-device
  verification of each CLI's tool shapes.

### Changed

- **Conversation centers within a max width on wide screens (tablets).** The
  message list, the above-composer chrome (login banner, run-options strip,
  "Last edits" strip) and the composer content are now constrained to
  `UxnanSpacing.maxContentWidth` and centered, so extra horizontal space becomes
  side margins instead of over-wide messages and a composer whose right-hand
  controls floated far from the edge. The app bar and the composer's surface
  still span the full width.

### Fixed

- **Part of an agent reply no longer disappears after leaving and re-opening a
  conversation.** Fixed in the bridge (it was storing only the final segment of a
  tool-using turn); see `bridge/CHANGELOG.md`. The phone already kept the full
  streamed text live.
- **Context meter no longer stuck at 0** for turns where the agent's `result`
  event omitted token usage (bridge fallback to per-message usage).

### Added

- **Work log & Changed files now populate (structured commands/tools/diffs).**
  The bridge emits the agent's shell commands, file edits and tool calls as
  structured `stream/content/block` events; the phone decodes each into a
  `MessageContent` (`ContentBlockEvent` → timeline reducer) and folds it into the
  turn, so the collapsible **Work log** (Bash → command cards, other tools →
  rows) and **Changed files** (Edit/Write → per-file diffs with +/- counts) — and
  the green/red **Last edits** strip above the composer — finally fill in. Blocks
  stream live and are persisted (survive `turn/list`). Claude Code today; Codex/pi
  next.
- **Agent "thinking" (reasoning) in conversations — first structured-content
  slice.** Claude Code's extended-thinking output now flows end-to-end: the
  bridge parses `thinking_delta` blocks and emits a new `stream/thinking/delta`
  event (persisted on the message), and the phone renders it in a **collapsible
  "Thinking" section** at the top of the agent's turn (`ThinkingContent` block,
  default collapsed). A **Settings → Conversation → "Show agent thinking"**
  toggle (persisted) controls whether it appears. Thinking is kept out of the
  copied response / previews. (Commands, tools and diffs are the next slices —
  they still arrive as text until the bridge emits structured blocks for them.)
- **Workspace browser: "up one folder" button.** The folder-picker sheet now has
  an explicit up-one-level button to the left of the breadcrumb (disabled at a
  root); the breadcrumb still navigates on tap.
- **Voice → text in the composer.** The composer mic now dictates into the
  message field via on-device speech-to-text (`speech_to_text`): tap to start,
  tap again (or a final result) to stop, with recognized words streaming in
  live and a recording state on the mic chip. A guarded `SpeechToTextService`
  (+ `speechToTextServiceProvider`) no-ops without the plugin / mic permission,
  so the app and tests run unaffected; an "unavailable" snackbar covers the
  denied/unsupported case. Android `RECORD_AUDIO` is wired; iOS Info.plist
  usage strings are FOR-HUMAN. On-device verification is deferred (needs a mic).
- **Structured agent turns in the conversation (work log, changed files,
  copy).** An assistant reply now renders as a structured, full-width turn
  (`AssistantTurnView`): a collapsible **Work log (N)** of the commands/tools it
  ran, the prose answer, a collapsible **Changed files (N) · +a −d** summary at
  the end (each file expands to its diff), and a **Copy response** action that
  copies the full text. A compact green/red **Last edits** strip above the
  composer mirrors the latest turn's `+a −d · N files`. Diff +/- counters are now
  colored (green additions / red deletions) everywhere.
- **Settings screen + notification preferences (`notifications/update`).** A new
  `SettingsScreen` (route `/settings`, reached via a gear action in the devices
  app bar) lets the user toggle the **Replies** (`turnCompleted`) and **Errors**
  (`turnError`) notification channels with M3 `SwitchListTile`s. A
  `NotificationPreferences` value object, an on-device `NotificationPreferencesStore`
  (`shared_preferences`) and `notificationPreferencesProvider` are now the source
  of truth: the `PushRegistrar` sends them as `preferences` on
  `notifications/register` and gates the local notifications it raises, replacing
  the hard-coded `{turnCompleted:true, turnError:true}`. Toggling persists locally
  and best-effort calls `notifications/update` while a PC is connected (a silent
  no-op offline / against an older bridge). Covered by unit + widget tests.
- **pi agent support.** The `pi` CLI is now a fully wired agent on the bridge,
  so it appears in the app like the others through the existing data-driven UI
  (model picker, reasoning-effort knob via `--thinking`, context meter, sign-in
  status). Added its monochrome logo (`assets/images/agents/pi.svg`, tinted via
  `currentColor`) and wired `AgentVisuals` (logo/label "pi"/accent). No UI code
  changes were needed — the app already renders any agent the bridge advertises.

### Changed

- **Agent replies no longer sit in a chat bubble.** Only the user's own
  messages keep a (right-aligned) bubble; assistant turns render full-width, so
  the whole answer is one clean selectable surface and consecutive text is merged
  into a single selectable region instead of many fragments that copied as if
  they were separate messages.
- **Model picker grouped by provider + no inline-dropdown jank.** The model
  picker (`model_picker_sheet.dart`) now groups models under provider headers
  (M3 list subheaders) for multi-provider agents like pi/OpenCode, flattened
  into one lazy `ListView.builder` so hundreds of models stay cheap; agents with
  a single provider (Claude/Codex) render flat without headers. Grouping is a
  pure domain helper (`groupModelsByProvider` in `agent_model.dart`, unit-tested).
  The new-conversation dialog's model field no longer builds a giant inline
  `DropdownMenu` (which stalled for pi's ~326 models) — it's a tappable field
  that opens the same sheet, showing the selected model and a spinner while the
  list loads.
- **Conversation app bar scrolls away for more reading room.** The large app
  bar drops `snap` (keeps `floating`, stays non-pinned), so it scrolls fully out
  of the way with the content and returns proportionally on scroll-up instead of
  snapping the tall header open — more clean space for messages.
- **Consistent `.large` app-bar title height across screens.** The conversation
  app bar used a two-line `Column` title (title + connection/"Responding…"
  status), which sat at a different level/size than the single-line titles on
  the devices, threads and archived screens. Its title is now a single-line
  `Text` like the others, and the live connection / responding state moved to a
  compact dot/spinner indicator in the actions (tooltip carries the label) — so
  all four `.large` bars align at the same title level and size.
- **Conversation options strip: coherent spacing + collapsible.** The reasoning
  (run-option) and approval-mode controls are now one strip above the composer
  with consistent vertical rhythm (fixes the run-option chip sitting flush
  against the composer for pi, and the over-large gap when both showed). A
  `tune` toggle in the composer toolbar collapses/expands the strip
  (`AnimatedSize`), shown only when there's something to toggle.
- **Manual "Check sign-in" on the not-signed-in surfaces.** Both the
  new-conversation agent card and the **conversation login banner** now offer a
  **Check sign-in** `TextButton` that re-queries `auth/status` on tap (spinner
  while checking), so the user can verify sign-in without leaving the screen —
  complementing the on-resume refresh. The card also gains a soft error tint
  (replacing its static "Sign in required" text); the banner keeps its
  error-container strip (the M3 alert-with-action shape — not a `MaterialBanner`,
  which is a top-of-content component) and adds the action at the end. Both
  reuse `authStatusProvider` + `ref.invalidate` and un-resolve once signed in.

### Fixed

- **Agent sign-in status refreshes after a PC-side login.** `auth/status` is
  cached per agent and the PC's sign-in state can change with no phone-side
  reconnect, so a re-login on the PC left the app showing the agent as "not
  signed in". The app now re-queries `auth/status` on **app resume** (a new
  `authStatusRefreshProvider` tick that `authStatusProvider` watches; `_PushHost`
  bumps it on `AppLifecycleState.resumed`), clearing the stale banner / red dot.

### Added

- **Context meter always visible for usage-reporting agents.** The composer's
  context meter now shows for any agent that reports token/context usage (new
  per-agent `reportsContextUsage` capability — Claude/Codex true, OpenCode
  false), at a **0 baseline** until the first turn reports usage (then the
  percentage ring once the window is known, or the raw token count). Agents that
  report no usage show nothing, as before.
- **Data-driven run-option knobs.** The conversation screen now renders the
  per-model run options the bridge advertises on `agent/models` (today a
  **Reasoning effort** enum on Claude/Codex models) as a generic control bar
  above the composer, and sends the chosen values on `turn/send` via `options`
  (persisted per thread, in memory). The renderer is fully data-driven —
  `AgentModelOption`/`AgentModelOptionValue` entities, an `activeModelOptions`
  provider that resolves the thread's model, and a `runOptionSelections`
  notifier — so a new knob (or a new agent) needs **no app change**; `enum`
  renders as a value menu, `toggle` as a filter chip, and unknown kinds are
  ignored. Phase 3 of the per-model run-options seam.
- **Relay-vs-direct transport indicator.** The connected PC's card now shows how
  the live channel runs — **Relay** or **Direct** (LAN/Tailscale) — read from
  the bridge's `bridge/status.relayConnected`, which the app previously ignored
  (it used `bridge/status` only as a reachability ping). New `BridgeStatus`
  entity (tolerant parser) and a `bridgeStatusProvider` that refreshes whenever
  the connected device changes and short-circuits to nothing while offline.
- **Remove device.** The paired-PC card's overflow menu now has a destructive
  **Remove device** action: after a confirmation dialog it tells the bridge to
  revoke this phone's trust (`bridge/removeTrustedDevice` with the phone's own
  id, best-effort and only when connected to that PC), tears down the session if
  it was the connected one, and wipes the PC's local data — the `TrustedDevice`
  plus all its threads, messages and turns (new
  `IThreadRepository.deleteThreadsByDeviceId` and
  `SessionCoordinator.removeTrustedDevice`). Lets the user clear a stale PC and
  fully unpair. Menu labels are now `Flexible` so long entries never overflow.
- **Agent sign-in banner (`auth/status`).** The conversation screen now queries
  the bridge's sanitized per-agent `auth/status` for the active thread's agent
  and shows a warning banner above the composer when that agent is **not signed
  in on the PC** (turns won't run until the user logs into its CLI there). New
  `AuthStatus` entity (tolerant parser, never carries tokens),
  `ThreadManager.loadAuthStatus(agentId)` and an `authStatusProvider`
  `FutureProvider.family`, mirroring the existing `agentModels`/
  `agentCapabilities` providers. The banner is gated on actually holding this
  thread's PC channel (`connectedHere`) and degrades to nothing while offline or
  against an older bridge. Informational only for now — there is no in-app login
  yet (the bridge's `auth/login` is still a stub), so it points the user to the
  PC; it also renders a "Signing in…" state for `loginInProgress`.
- **Sign-in status before entering a conversation.** The agent's sign-in state
  (`auth/status`) is now surfaced earlier, reusing `authStatusProvider`: the
  **new-conversation** agent card shows a red "Sign in required" marker when the
  agent is installed but not signed in (distinct from "Unavailable" — the card
  stays selectable), and a thread's **status dot in the list turns red** (with a
  tooltip) when its agent is not signed in, instead of the usual active green.
  Both degrade to no marker while offline or against an older bridge.

### Fixed

- **Crash when leaving a conversation (`Tried to modify a provider while the
  widget tree was building`).** The conversation screen cleared the foreground
  marker by mutating `foregroundThreadProvider` synchronously in `dispose()`,
  which Riverpod rejects during unmount. It now defers the clear to the next
  event-loop tick (`leave()` stays a no-op if another thread is already in
  front), so back-navigation no longer throws.
- **Notifications wrongly suppressed on the threads list.** The "currently
  viewing" thread was cleared inside `dispose()` via `ref`, which is unreliable
  in Riverpod — the clear could be dropped, leaving the last-opened thread
  marked as foreground and suppressing its notifications even after leaving the
  conversation. The conversation screen now captures the notifier in `initState`
  and clears on leave, so suppression applies only while its conversation is on
  screen.

### Added

- **Unread thread indicator.** When an agent reply lands in a thread you're not
  viewing, its row in the threads list is emphasized — a primary-tinted surface,
  a **bold title** and a small **unread dot** — so it's easy to spot without
  tapping the notification. Cleared when you open (or return to) the
  conversation. In memory only (resets on restart). `ThreadManager` tracks the
  unread set, gated by the foreground thread.

### Changed

- **Personalized turn notifications.** A turn-end local notification is now
  titled with the **thread name** and its body reads **"{agent} replied"** /
  **"{agent} reported an error"** (e.g. *"Cambio de rutina" — "Opencode te
  respondió"*) — was a generic "Turn completed / Your agent finished a turn."
  The agent label + thread title are resolved per event; copy is parameterized
  in l10n.

### Added

- **Threads list: search, sort and density controls (active + archived).**
  Shared `thread_list_controls.dart` so both lists behave identically:
  - **Search** — the M3 full-screen `SearchAnchor` view, matching by title, id,
    agent (label or wire id) and working folder; tapping a result opens it.
  - **Sort** — an M3 menu (check on the active order): creation date (newest
    first, the **new default**), name, or folder. The per-agent filter chips are
    unchanged.
  - **Density** — a compact, single-line tile variant (the full tile stays the
    default).
  - App-bar kept to the M3 ≤3-actions guideline: **Search + Sort** stay visible;
    **Density** (checkable) and **Archived** (navigation) live in a `⋮` overflow
    menu. The archived screen gained the same search/sort/density controls.
  - Preferences are in-memory per screen (not yet persisted).

- **"Responding…" header in the conversation.** While the agent is producing a
  turn, the conversation app-bar shows a small spinner + "Responding…" (primary
  colour) in place of the connection label, so a reply is clearly on the way
  even before the first streamed delta. Driven by the per-thread activity that
  already powers the threads list.

### Fixed

- **No redundant local notification for the conversation you're watching.** A
  turn-end (completed/error) local notification is now **suppressed while that
  thread's conversation is on screen in the foreground** — you already see the
  reply live. It still fires for a turn that ends in a *different* thread, and
  while the app is backgrounded (you're no longer watching). Wired via a new
  `foregroundThreadProvider` the conversation screen sets on enter and clears on
  leave / app-background; `PushRegistrar` reads it before raising the notice.

- **Thread `createdAt`/last-activity now parsed from the bridge.** The parser
  read `json['lastActivity']`, a field the wire never carries, so a thread's
  last-activity time was always null (blank in the list). It now maps the
  bridge's `updatedAt` to last-activity and keeps `createdAt` — exposed on the
  `Thread` entity and persisted by the drift repo (which previously stamped
  `now()` on every save, clobbering the real creation time). Enables a stable
  "newest first" ordering.

- **No more phantom threads or silent send failures** (chat was broken: messages
  sent, no responses). `ThreadManager.startThread` fabricated a local `uuid`
  thread whenever `thread/start` returned an error or no result — so the bridge
  never had that thread and every `turn/send` failed with `-32008 thread not
  found`, silently. It now surfaces the error (the new-conversation flow reports
  it) instead of inventing an id, and `sendUserMessage` marks the user's message
  **failed** when the bridge rejects the turn, so a failure is visible rather
  than swallowed. (Pairs with the bridge `thread/start` browsed-cwd fix.)

### Changed

- **Conversation composer + app bar aligned to Material 3.** The composer was a
  floating rounded card (`elevation`/shadow + `circular(24)`) — replaced with a
  **bottom-anchored bar** on `surfaceContainer` with a top `outlineVariant`
  hairline (no card, no shadow), so it reads as screen chrome and lets the
  thread breathe (the M3 surface-tone pattern over a custom floating surface).
  The app-bar git affordance dropped the redundant branch `ActionChip` (chips
  aren't an app-bar action widget) for a single `IconButton` with a commit icon
  that opens the git sheet; the branch now shows in its tooltip.

- **Drop the unused `RELAY_URL` compile-time define.** The bridge address comes
  entirely from the pairing QR (`PairingPayload` `hosts`/`relay`, persisted on
  the `TrustedDevice`), so the `AppConstants.relayUrl` `--dart-define` was dead
  (never read). Removed the constant and the `--dart-define=RELAY_URL=…` from the
  README run command + build-flavors table, with a note that a fresh bridge is
  LAN/Tailscale-direct (relay optional, only for background push).

- **New-conversation flow redesigned (Material 3).** It is now a **full-screen
  M3 dialog** (roomier than a bottom sheet for a multi-input creation task)
  with: a **working-directory card** that defaults to the bridge's root and a
  "Browse…" action to pick any sub-folder (the manual project list is gone — the
  bridge auto-roots at its launch dir), **agent cards** that clearly show each
  agent's logo, name and **capability chips** (Streaming / Plan / Approvals /
  Forking / Images) with a selected state, and the model field. The built-in
  **Echo (dev) agent is hidden** from the picker.

### Added

- **Android push notifications activated (Firebase project `uxnan-app`).** The
  `com.uxnan.mobile` Android app is registered in Firebase, `google-services.json`
  is provisioned (gitignored), and the **Google Services Gradle plugin is wired
  conditionally** — `settings.gradle.kts` keeps it on the classpath (`apply
  false`) and `app/build.gradle.kts` applies it only `if
  (file("google-services.json").exists())`, so the build stays green without the
  config. iOS is registered in the same project (`GoogleService-Info.plist`
  placed) but push remains **pending** the APNs key (macOS + Apple Developer);
  see `FOR-HUMAN.md`.

- **Folder browser for new conversations (`workspace/browseDirs`)** — a
  plug-and-play way to root a thread anywhere under the bridge's configured
  browse roots, alongside the configured project list. New `BrowseRoot` /
  `BrowseDirEntry` / `BrowseResult` entities (tolerant parsers), a
  `WorkspaceBrowser` manager + provider, and a `WorkspaceBrowserSheet` (root
  picker, breadcrumb, git-repo badges, "Open here"). The new-conversation sheet
  gains a **"Browse…"** action: the chosen folder is resolved to a project
  (`project/resolve`) and started via `thread/start { cwd }`.

### Fixed

- **Everything now targets the PC we are actually connected to.** Browsing a
  paired PC's threads no longer implies a connection: the threads-screen online
  dot, the new-conversation FAB, and refresh are gated on holding *that* PC's
  live channel (`connectedDeviceProvider`), not the global phase — and an
  offline banner offers a validated "Connect" here. The conversation composer is
  disabled unless connected to the thread's PC, so messages can never be sent
  over a different connected PC's channel. Tapping a PC to browse no longer
  changes the connection/reconnect target (`setActiveDevice` removed from the
  browse path).
- **Codex context usage is now visible in the composer** — the context chip
  showed only Claude's percentage; it now also renders the raw token count when
  the model's window is unknown (Codex).

- **Context-usage indicator** — consumes the new `turn/completed` `usage`:
  `ThreadManager` tracks per-thread token usage (`contextUsageProvider`) and the
  session environment shows a **percentage** when the model's context window is
  known (Claude tiers) or the **raw token count** otherwise (Codex), replacing
  the FOR-DEV placeholder in the status sheet. OpenCode reports no usage.
- **Live conversations survive leaving the screen + per-thread activity** — the
  `ThreadManager` now buffers each thread's in-flight turn in memory (it is a
  singleton) and applies streaming events for **all** threads, not just the one
  on screen. Leaving and re-entering a conversation keeps the streaming response
  rendering and updating; an answer that completes off-screen is persisted
  (keyed by the deterministic `stream-<turnId>` id) and shown on return.
  Entering a thread also re-syncs it from the bridge (`turn/list`) to recover
  anything missed (e.g. after an app restart). A new `ThreadActivity`
  (`running`/`error`/idle) is exposed per thread and the list card shows a
  **"Responding…" spinner** while a conversation is working — replacing the
  unclear static dot for active turns (`threadActivityProvider`).

### Fixed

- **Switching PCs no longer fakes the connection status** — tapping a paired PC
  to browse its threads previously flipped it to "connected" (and the current PC
  to "disconnected") because the indicator keyed off the *selected* device plus
  the stale global phase. Status now follows the device that actually holds the
  live channel (`connectedDeviceProvider`) and the one being attempted
  (`connectingDeviceProvider`). The **Connect** action validates reachability
  first (`SessionCoordinator.switchMac` probes then commits): if the target is
  unreachable it stays on the current PC and surfaces a message, instead of
  optimistically switching. Browsing a PC never implies a connection.

### Added

- **Structured model picker + resolved-version display** — consumes the
  bridge's richer `agent/models` contract so model selection is plug-and-play
  across Claude Code, Codex and OpenCode:
  - New `AgentModel` entity (`domain/entities/agent_model.dart`) parsing the
    structured contract (`id`, `displayName`, `description?`, `version?`,
    `isDefault?`) and tolerating bare-string responses from older bridges.
    `ThreadManager.loadModels` / `agentModelsProvider` now return
    `List<AgentModel>`.
  - The model picker and the new-conversation model field show readable names,
    a "Default" badge, and a secondary line with the wire id / resolved version
    / description; selection still routes by `id`.
  - **Resolved-version surfacing**: a new `stream/model/resolved`
    (`ModelResolvedEvent`) updates an in-memory `resolvedModelsProvider`; the
    session status sheet shows the concrete version an alias resolved to (e.g.
    `opus` → `claude-opus-4-8`) under a new "Active version" row.

### Added

- **Direct LAN/Tailscale transport (relay now optional)** — consumes the
  bridge's pairing-QR `hosts` so the phone connects directly, with the relay as
  a fallback (spec 02a §5.9.3; bridge `docs/connectivity.md`):
  - `PairingPayload` now parses `hosts: List<String>` and treats `relay` as
    optional (a pure LAN/Tailscale QR carries only `hosts`); the structural
    parser is tolerant and `PairingValidator` enforces "at least one transport"
    — mirroring `shared` `validatePairingPayload`. **Fixes** the old parser,
    which threw on a relay-less QR.
  - `TrustedDevice` carries `hosts`, persisted by `TrustedDeviceRepository`
    (drift schema → v4: additive, nullable `trusted_devices.hosts` column,
    newline-separated; relay-only devices load with empty hosts).
  - `DirectTransportSelector` (now the default `transportSelectorProvider`)
    tries each direct host as a plain `ws://host:port` endpoint (the bridge's
    LAN server needs no relay routing headers) with a short per-host timeout,
    then falls back to the relay with the `x-role`/`x-session-id` headers.
    `processPairingPayload` carries the scanned `hosts` onto the device.
  - UI (proposal, pending on-device review): the `MyDevicesScreen` card shows
    the first direct host when a device has no relay (instead of a blank).
  - Tests: payload hosts parse + relay-optional, validator transport rule,
    repository hosts round-trip, and `DirectTransportSelector` (direct-first,
    host→host→relay fallback, per-host timeout, no-transport error, scheme
    passthrough).

- **Archive / unarchive threads + an "Archived" screen** — completes the
  thread-actions set (rename/delete already shipped):
  - `ThreadManager.archiveThread` / `unarchiveThread` flip the local
    `ThreadStatus` first (archived threads leave the active list immediately),
    then call `thread/archive` / `thread/unarchive` best-effort — **nothing is
    deleted**; degrades gracefully if the bridge lacks the method.
  - UI (proposal, pending on-device review): the long-press menu gains
    **Archive** (active threads) / **Unarchive** (archived threads); the
    `ThreadsScreen` hides archived threads and gets an **Archived** app-bar
    action → a new per-PC `ArchivedThreadsScreen` (route
    `/device/:deviceId/archived`) where archived threads can be reopened,
    unarchived or deleted. The thread row + actions menu were extracted to a
    shared `ThreadTile` (`thread_tile.dart`) reused by both screens. New en/es
    strings. Archived threads are **per-PC** (not in the future app Settings).

- **Advanced message content: `approval` / `plan` / `subagent`** — these blocks
  used to fall through to the generic `UnknownContent` placeholder; they now
  decode and render properly (exactly what Codex/Claude emit for plan mode &
  approvals):
  - Domain: `ApprovalContent`/`PlanContent`/`SubagentContent` + value objects
    `ApprovalRequest`, `PlanState`/`PlanStep`, `SubagentState`/`SubagentAction`
    and enums `ApprovalRisk`, `PlanStepStatus`, `SubagentActionKind`. The codec
    is tolerant of both nested (`{request|state:{…}}`) and flat payloads and
    falls back gracefully on unknown enum values; JSON round-trips.
  - UI (proposal, pending on-device review): an approval card (action + risk
    badge + **disabled** Approve/Reject — FOR-DEV: the response RPC needs the
    bridge), a plan checklist (per-step status icons), and a subagent card
    (name/status + its actions). Read-only for now.

- **Capability-aware conversation UI** (proposal, pending on-device review) —
  the conversation now adapts to the active agent's advertised
  `AgentCapabilities` (from `agent/list`):
  - `agentCapabilitiesProvider` resolves a thread's agent capabilities, falling
    back to an all-permissive default (`AgentCapabilities.permissive()`) when the
    agent list isn't loaded yet, so controls are never hidden spuriously.
  - The `SessionStatusSheet` approval-mode row is shown only when the agent
    advertises `approvals`; the `ComposerBar` attach button only when it
    advertises `images` (the picker itself stays FOR-DEV). OpenCode (no
    approvals/images) hides both; Codex/Claude will surface them once the bridge
    exposes those agents. Verify on-device when they land.

- **New threads default their title to the thread id** — when a conversation is
  started without an explicit title, `ThreadManager.startThread` sets the local
  title to the new thread's own id (instead of a generic "New thread"), so it's
  identifiable in the list and resumable from the CLI on the PC. The user can
  rename it afterwards (see thread actions). An explicit title is preserved.

- **Thread management — rename, delete & copy id** — user-requested:
  - `ThreadManager.renameThread` mirrors the new title locally first (immediate
    UI), then calls `thread/rename { threadId, title }`; ignores a blank title.
  - `ThreadManager.deleteThread` removes the thread locally (clearing the active
    timeline when it was active), then calls `thread/delete { threadId }`.
  - Both are best-effort over the bridge and degrade gracefully when the method
    is not yet implemented (the local change is kept).
  - UI (proposal, pending on-device review): long-pressing a thread on
    `ThreadsScreen` opens an actions sheet (Rename / Copy thread ID / Delete)
    with a rename dialog and a delete confirmation. The conversation
    `SessionStatusSheet` gains a copyable **Thread ID** row (shortened display,
    copies the full id) so the same conversation can be resumed from the CLI on
    the PC. New en/es strings.

- **Notification tap → deep-link to the conversation** — closes the push loop:
  - `PushNotificationService` now exposes `onNotificationTap` (a `threadId`
    stream from foreground / background-resume taps) and `initialThreadId()`
    (the `threadId` that cold-started the app). Wires the local-notification
    `onDidReceiveNotificationResponse`, FCM `onMessageOpenedApp`, plus
    `getNotificationAppLaunchDetails()` / `getInitialMessage()` for cold start.
  - `PushRegistrar` re-exposes both; `_PushHost` (`app.dart`) subscribes and
    deep-links taps to `/conversation/:threadId` (cold start navigates after the
    first frame). Fully guarded: a no-op when Firebase config is absent.

- **Per-thread model picker (`thread/setModel`)** — spec 02a §5.4:
  - `ThreadManager.setThreadModel` calls `thread/setModel { threadId, model }`
    and mirrors the new model onto the local `Thread`; `loadAgentModels`
    (`agent/models`) feeds the picker.
  - `ModelPickerSheet` (`conversation/support/model_picker_sheet.dart`): a
    searchable M3 bottom sheet that lists the agent's models and resolves with
    the pick. Wired into the composer model chip and the `SessionStatusSheet`
    model row (`ConversationScreen` → `setThreadModel`).
  - The real model picker is also used by `NewConversationSheet` (the agent's
    `defaultModel` preselected); onboarding is skipped when a PC is already
    paired (straight to the devices list).

- **"Verify connection" device action** — spec 02c §11:
  - `SessionCoordinator.verifyConnection` actively probes the bridge with an
    encrypted `bridge/status` (timeout), and reconnects first when the session is
    disconnected. Surfaced as a per-device action on `MyDevicesScreen`
    (`deviceVerifyConnection`, EN + ES).

### Changed

- **Threads scoped to the selected PC** — `Thread` now carries `deviceId`;
  `thread/list` results are tagged with the active device and the threads screen
  filters by it. Drift schema → v3: additive `threads.device_id` column + a
  migration that purges the old UI demo data (`demo-thread*`, `demo-mac`).

- **Robust reconnection + liveness** — spec 02c §11:
  - `turn/send` now sends `text` at the top level (was nested under `content`,
    which produced no response).
  - `WebSocketChannelTransport` sets a 20s `pingInterval` so a dead socket is
    detected; the relay closes the paired peer when one side drops (see
    `relay/CHANGELOG.md`).
  - `SessionCoordinator` runs a 25s `bridge/status` app heartbeat that detects a
    dead bridge behind a still-open relay socket and triggers reconnect; a
    single-flight reconnect guard prevents overlapping loops; `verifyConnection`
    reconnects when disconnected; last-seen is updated on connect.

### Fixed

- **Seq-replay race on outbound envelopes** — the secure transport reserves the
  outbound sequence number **synchronously** (before the `await` on encryption),
  and `SessionCoordinator` serializes encrypt+send onto a single `_sendChain`, so
  concurrent sends can no longer interleave and trip the bridge's replay
  rejection.
- **Model picker overflow + keyboard** — fixed the model-picker layout overflow
  and dismiss the keyboard when tapping the chat surface.

### Added

- **Push notifications (FCM) — gated** — spec 02a §5.10:
  - `PushNotificationService` (infrastructure): fully guarded `firebase_core` +
    `firebase_messaging` + `flutter_local_notifications`. The app builds and runs
    with **no** Firebase native config — `Firebase.initializeApp()` and every FCM
    call are try/caught; when config is absent `isAvailable` is `false` and push
    silently degrades to a no-op.
  - `PushRegistrar` (application): on `ConnectionPhase.connected` it fetches the
    FCM token and calls `notifications/register { pushToken, platform,
    preferences }` over the session RPC; re-registers on token refresh; raises a
    local notification on `TurnCompleted`/`TurnError` domain events.
  - `main.dart` guarded Firebase init + `@pragma('vm:entry-point')` background
    handler; `_PushHost` (under `MaterialApp.builder`) keeps the registrar alive
    and feeds it localized copy. EN + ES strings.
  - Android: core-library desugaring enabled (required by
    `flutter_local_notifications`). Native Firebase config is **FOR-HUMAN**
    (`FOR-HUMAN.md`): `google-services.json` / `GoogleService-Info.plist` + the
    google-services gradle plugin + iOS push capability.
  - Tests: `PushRegistrar` (register-on-connect, no-reregister, token refresh,
    local notification on turn end) with a fake push service.

- **MVP wiring — real bridge data + new-conversation flow** — spec 02a §5.2 /
  §5.4 / §5.6:
  - `Thread` entity now carries `model` (alongside `agentId`/`cwd`), parsed from
    `thread/list` / `thread/start` and persisted (drift schema → v2, additive
    `threads.model` column + migration).
  - New bridge catalog entities `Project` (`project/list`) and `AgentDescriptor`
    + `AgentCapabilities` (`agent/list`) with tolerant parsers; `ThreadManager`
    gains `loadProjects`, `loadAgents` and `startThread` (`thread/start`).
    Providers: `projectsProvider`, `agentsProvider`, `threadByIdProvider`.
  - **New-conversation flow**: a "New conversation" / "Nueva conversación" FAB on
    the threads screen opens `NewConversationSheet` (M3 bottom sheet matching the
    existing `*_sheet.dart` patterns) to pick a project (name + cwd subtitle), an
    agent (only `available` ones selectable, capability hints, `AgentLogoChip`/
    `AgentVisuals` icon or a generic fallback) and an optional model (the agent's
    `defaultModel` preselected); `thread/start` then navigates to the
    conversation. FAB is disabled while disconnected.
  - **Conversation wired to real data**: the model/agent indicator is driven by
    the active `Thread`, connection state by `connectionPhaseProvider`, and the
    git branch/state by `gitRepoStateProvider` fed with the thread's `cwd`
    (refreshed via `GitActionManager.refreshStatus(cwd)`); `GitActionsSheet` runs
    real commit/push against that `cwd`. Removed `SessionEnvironment.sample()`,
    `GitRepoState.sample()` from the UI, and the `previewState` / `_simulatePush`
    FOR-DEV git paths.
  - **Composer/status controls**: the model indicator shows the real thread
    model; the context badge is hidden until the bridge reports real token usage
    (no fabricated 42%); approval mode is an explicit local per-thread setting
    (FOR-DEV note, no sampled value); attach/voice stay disabled placeholders
    (FOR-DEV).
  - **Removed demo seeding** from the default UX: deleted `demo_seed.dart` and
    the home preview button.
  - Tests: `Project`/`AgentDescriptor` parsers, `ThreadManager` `loadProjects`/
    `loadAgents`/`startThread`, the `model` thread round-trip, and updated
    composer/git-sheet widget tests to the real-data shape.

- **Conversation/timeline — application managers** — spec 02a §5.2.2 / §5.2.5:
  - `DomainEvent` hierarchy and `IncomingMessageProcessor` that classifies
    inbound bridge notifications (`stream/turn/started`, `stream/message/delta`,
    `stream/turn/completed`, `…/error`, `…/aborted`) into typed events; other
    `stream/*` notifications map to `UnknownDomainEvent`.
  - `ThreadManager`: builds the active thread's `TurnTimelineSnapshot` from the
    local message repository and applies streaming events through the reducer
    (start → delta → complete, persisting the finalized message); `loadThreads`
    (`thread/list`) and `sendUserMessage` (`turn/send`) over the injected RPC
    sender; dedup via `MessageDeduplicator`.
  - Providers: `incomingMessageProcessorProvider`, `threadManagerProvider`,
    `threadsProvider`, `activeTimelineProvider`.
  - Tests: event classification, and a `ThreadManager` driven by an in-memory
    DB + a controllable event stream (timeline build, full streaming turn,
    thread loading, send).
  - The conversation **UI** (`ConversationScreen`, renderers, composer) is the
    remaining piece (FOR-DEV), built next for visual review.

- **Conversation/timeline — domain & data layer** — spec 02a §5.6 / §6.2:
  - `MessageContent` sealed hierarchy with a JSON codec: `text`, `code`,
    `image`, `tool`, `diff`, `mermaid`, `system`, `command_execution`, plus an
    `UnknownContent` fallback so unmodeled/newer types round-trip losslessly.
  - `Message` and `Turn` entities; `MessageDeliveryState`, `SystemContentKind`
    and `CommandStatus` enums.
  - `IMessageRepository` + `DriftMessageRepository` (content stored as JSON in
    the existing `messages` table; ascending reads, limit + `beforeId`
    pagination, reactive `watch`). `messageRepositoryProvider` wired.
  - `MessageDeduplicator` (fingerprint/id dedup for replays, §5.6.5) and the
    immutable `TurnTimelineSnapshot` with a streaming reducer
    (reconcile / prependHistory / startStreaming / appendStreamingDelta /
    completeStreaming) per §5.4.6.
  - Tests: content codec round-trips + unknown fallback, repository
    CRUD/pagination/watch, deduplicator, and the timeline reducer.
  - Advanced content (`approval`/`plan`/`subagent`) and the application managers
    (`ThreadManager` timeline, `IncomingMessageProcessor`) + the conversation UI
    are deferred (FOR-DEV) to the next increments.

- **Pairing / onboarding UI** — spec 02a §5.5.1–5.5.2, M3 design tokens:
  - `OnboardingScreen`: a 4-page flow (Welcome → Features → Install bridge →
    Pair) with a page indicator, Skip/Back/Next controls and a copyable
    `CommandCardWidget` (`npx uxnan-bridge`); width-constrained for tablets.
  - Onboarding visual treatment: an `OnboardingBackground` (soft square grid +
    top-transparent → deeper-bottom gradient) and `FloatingAgents` — bundled
    coding-agent logos (`flutter_svg`, `assets/images/agents/`) that gently
    float on soft dark chips, with a different size/position preset per page.
    Implemented efficiently (one controller per page, GPU transforms,
    `RepaintBoundary`).
  - `QrScannerScreen`: camera permission gating (request / settings fallback),
    `mobile_scanner` preview with a scan window, validates the QR via
    `PairingValidator`, drives `SessionCoordinator.processPairingPayload`, and
    shows `UpdatePromptDialog` on an unsupported QR version.
  - Routes `/onboarding` and `/pairing`; the home "Pair a device" button now
    launches the flow. English + Spanish strings.
  - `mobile_scanner` and `permission_handler` dependencies; Android `CAMERA`
    permission and iOS `NSCameraUsageDescription` configured.
  - Widget test covering onboarding page navigation.
  - **FOR-DEV** (deferred): iOS `permission_handler` Podfile macro
    (`PERMISSION_CAMERA=1`), live on-device camera pairing against a real bridge.

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
- Updated the Material 3 theme to provide both light and dark variants and
  follow `ThemeMode.system` instead of forcing dark mode. The shared design
  tokens now expose brightness-aware semantic colors, and existing screens were
  updated to consume theme-derived muted text colors.

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
  and the adaptive `buildUxnanTheme()` builder (spec 02c §3.1).
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
