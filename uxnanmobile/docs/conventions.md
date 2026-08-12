# Conventions

![State](https://img.shields.io/badge/Riverpod_3.x-manual,_no_codegen-0553B1?style=for-the-badge)
![UI](https://img.shields.io/badge/Material_3-design_tokens_%2B_skills-757575?style=for-the-badge&logo=materialdesign&logoColor=white)
![Security](https://img.shields.io/badge/security-non--negotiable-2ea44f?style=for-the-badge&logo=letsencrypt&logoColor=white)

The working agreement for anyone (human or agent) touching `uxnanmobile`. These
extend the monorepo [`../../AGENTS.md`](../../AGENTS.md); where a Flutter skill's
generic default conflicts with the [`architecture/`](../../architecture/00-index.md)
spec, the spec wins.

## State management — Riverpod 3.x, manual

- No `riverpod_generator` / `riverpod_annotation`. Use the modern `Notifier` /
  `NotifierProvider` / `AsyncNotifierProvider` API; the spec's older
  `StateNotifierProvider` examples are adapted to this.
- Providers are declared by hand in `presentation/providers/`. Construct
  infrastructure in `infrastructure_providers.dart`; compose app services in
  `application_providers.dart`.
- Expose manager state as `rxdart` `BehaviorSubject` streams consumed via
  `StreamProvider`s. Always `ref.onDispose` anything with a `dispose()`.
- Use `family` providers where they genuinely help (e.g.
  `agentModelsProvider(agentId)`); don't over-parameterize.

## UI — Material 3 + the skills

- **Always use the installed Flutter skills** when building or restructuring UI:
  `flutter-m3-uiux` (theme, tokens, responsive), `flutter-clean-architect`
  (layers/modules), `flutter-riverpod-expert` (providers/notifiers),
  `flutter-init-project` (baseline). Invoke the relevant skill first.
- Extract `colorScheme` / `textTheme` once at the top of `build()`. No hardcoded
  colors or ad-hoc spacing — use the tokens in `presentation/theme/`
  (`UxnanColors`, `UxnanSpacing`, `UxnanRadius`, `UxnanTypography`).
- **Reuse the NE building-block widgets** in `presentation/widgets/` instead of
  hand-rolling surfaces: `NeCard` (discrete card — calm `surfaceContainer` tone +
  16 dp radius + spring press), `ExpressiveCard`/`ExpressiveCardGroup` (grouped
  settings rows, dynamic 24/4 corners + 3 dp gap), `ConnectedButtonGroup` (the
  M3E replacement for `SegmentedButton`), the `settings_tiles.dart` rows
  (`NeSectionHeader` / `NeSectionHint` / `NeSwitchTile` / `NeNavTile`), plus
  `NeSurface`, `IconSurface`, `NeScaffold` / `NeTopBar`, `NeEntranceScope` /
  `NeEntranceRow` (a list whose rows rise into place the first time it fills —
  never on scroll), `NeScrollAwareFab`
  (a FAB that steps aside while the list moves — see NE §"FAB and FAB Menu" for
  which FABs may take it and which must not), `NeBadge` (read-only
  status pill — `neutral` for a plain fact, `secondary` for supporting metadata,
  `live` for the one solid `tertiary` fill, reserved for what is true right now). Cards use
  `surfaceContainer`, **never** `surfaceContainerHighest` — that tone is reserved
  for input fills / active chips (NE §2.4).
- **Agent marks: bare in rows, framed only as objects.** `AgentLogo` draws the
  mark alone for dense surfaces (thread rows, and the folder rows that head
  them);
  `AgentLogoChip` frames it where an agent is a thing you pick or admire (the
  onboarding hero, the agent picker). Neither carries a border or a shadow —
  framing made the frame the thing you noticed, and a shadowed tile inside a
  card reads as the card being elevated when it is not.
- **A screen you touch leaves with the current design language.** Not a
  migration to schedule — a condition of the change you are already making. It
  means three things, all of them cheap once you are in the file:
  1. **Type from the scale**, and by meaning: `titleMedium` heads a *group*,
     `titleSmall` names a *row*, `headlineX` says what a *region* is about. No
     literal `fontSize` (see NE §2.3 → *What uxnan actually ships*).
  2. **Motion where content arrives.** A list of rows uses `NeEntranceRow`
     (every `NeScaffold` is already a scope, so there is nothing to wire); a
     fixed list of children uses `NeEntranceScope.stagger([...])`; a single
     block — a form — uses one `NeEnterTransition` and no stagger, so nothing
     delays reaching the field. **Not** a live camera preview, and **not** a
     scroll affordance.
  3. **Sizes and spacing from tokens**, never a bare dp.

  This exists because the alternative was found the expensive way: the app ran
  two type scales at once and its density jumped from screen to screen, and
  nobody had planned that either.

- **Reach for the Material widget before building the row.** `ListTile` already
  specifies a list row — ink, minimum height, leading/trailing slots, disabled
  and selected states, and the semantics that make it announce as one thing;
  the button family already specifies a button. A hand-rolled `Material` +
  `InkWell` gets the look and silently drops the rest, and it is the shape this
  codebase reaches for by reflex. Build one only when the M3 widget's own
  metrics are the thing in the way (a two-line dense row inside a menu, a
  lazily-built tree), and say so at the site.

  Where a component genuinely does not fit, that is worth a sentence too:
  `NavigationDrawer` models **N fixed destinations with one selected**, and its
  own scrollable would nest inside the spaces tree's. The permanent drawer is
  therefore a `Material` holding three zones, not a `NavigationDrawer`.

- **Read `MediaQuery` by the property you need**, never `MediaQuery.of(context)`.
  `of` subscribes the widget to EVERY change — the keyboard opening, a rotation,
  a text-scale change — so a widget that only cares about `disableAnimations`
  rebuilds on every keystroke that moves the view insets.
  `MediaQuery.disableAnimationsOf`, `.sizeOf`, `.paddingOf`, `.viewInsetsOf`,
  `.textScalerOf` each subscribe to one thing.

  And **a widget inside a pane must not measure the window at all**: use a
  `LayoutBuilder`. With a 320 dp drawer taken out of a 1280 dp window, the
  content has ~955 dp, and centring against 1280 puts the text off to one side.

- **Two panes is the ceiling. Depth goes into a pane's own navigator.**
  A tablet does not have room for three columns that anyone enjoys using, so
  when a surface already sits beside the drawer — or is itself split — the next
  level down does **not** become another column. It stacks *inside* the pane it
  came from.

  The mechanism is a nested `Navigator` as the pane's content, keyed by what it
  is showing:

  ```dart
  detail: Navigator(
    key: ValueKey('pane-${selected.id}'),
    onGenerateRoute: (_) => MaterialPageRoute<void>(
      builder: (_) => selected.build(),
    ),
  )
  ```

  Everything then falls out for free: a child opened with
  `Navigator.of(context).push` lands in the pane instead of taking the window;
  its back arrow returns to the parent rather than leaving the screen; and the
  key means picking a different parent starts at *its* root instead of
  inheriting where you wandered in the last one. Settings does this for
  Personalization → custom themes and About → licences, and any section added
  later gets it without being touched.

  Without the nested navigator the push resolves to the navigator **above** and
  covers everything, list included — which is the bug this replaced, not a
  hypothetical.

  Two rules follow:
  - A screen rendered as a pane's content takes an `embedded` flag: it keeps
    its title (the pane must say what it is) and drops the automatic back arrow,
    because `canPop` would answer for the route still open beside it.
  - A **destination** is never a pane. Settings and profile are somewhere you
    *went*, not something you opened from a list, so they own the window and the
    drawer steps aside — see `AppShell.isFullScreen`.

- **Which navigation API depends on what the screen IS.** Both are in use, and
  mixing them is the design, not drift:

  | The screen is… | Open it with | Why |
  |---|---|---|
  | a **destination** you went to | `context.push` / `context.go` (go_router) | it is in the flat route table, so deep links and push notifications reach it |
  | **content** opened from a list | `context.openInPane` | a tap means two different things by width, and this is the one place that decides (`router/pane_navigation.dart`) |
  | a **child** of what is already open | `Navigator.of(context).push` + a `static push(...)` on the screen | it lands in the nearest navigator, which is the pane's — so it stacks inside instead of taking the window |

  Going back is `Navigator.of(context).maybePop()` — the app bar's arrow
  (`NeTopBar`) and every screen that draws its own. **Never `context.pop()`**,
  which is why there are zero of them: a raw `Navigator.push` puts pages
  go_router does not know about on top of the route, so `context.pop` pops the
  *route underneath* and leaves the child covering the screen. The same
  mismatch is why `openInPane` empties `shellNavigatorKey` before it calls
  `go`.

  The OS back button reaches none of this directly — it goes to
  `GoRouterDelegate.popRoute`, and what the app tells Android about it lives in
  `AppShell._SystemBack` (see [`architecture.md`](architecture.md)).

- **Icons come from the catalogue, never from the package.** `UxIcons`
  (`presentation/theme/icons.dart`) names every glyph for what it MEANS, and
  `UxIcon` (`presentation/widgets/ux_icon.dart`) is the only widget that talks
  to `hugeicons`. Never write `HugeIcons.strokeRounded…` in a screen and never
  use Flutter's `Icon`: choosing a glyph is a design decision, and the
  catalogue is where those are reviewed and changed once instead of per call
  site. A glyph that is missing gets **added to the catalogue first** — and its
  name verified against the package, because the Hugeicons *website* also lists
  Pro icons that the Flutter package does not ship.
  `UxIcon` restores the two things `HugeIcon` lacks: a `semanticLabel`, and
  sizing inherited from the ambient `IconTheme`. Colour needs no help.
  It also fixes the weight: Hugeicons authors a 1.5 stroke against Material's 2
  and `UxIcon`'s optical scale thinned that further, so glyphs read faint. They
  draw at `UxnanSize.iconStroke` unless a call site says otherwise. **Sizes come
  from tokens too** — `iconContentLarge` / `iconContent` / `iconContentSmall`
  for glyphs inside content, `iconSurfaceGlyph` for chrome (NE §4.2). A literal
  dp in a screen is how they drifted between 13 and 18 last time.
  In tests, `find.byIcon` cannot see these at all (it takes an `IconData`) —
  use `findUxIcon(UxIcons.x)` from `test/support/ux_icon_finder.dart`.
- **Two menu triggers, one menu.** `IconSurfaceMenu` for **chrome** (an app-bar
  action over transparent chrome — it wears the filled circle so the glyph is
  legible over scrolling content) and `NeMenuButton` for **in-content** triggers
  (a ⋮ inside a card or row, where a filled circle would stack a button on the
  surface it already sits on). The menu itself — surface, radius, tone, type,
  minimum width (`kNeMenuConstraints`) — comes from `ThemeData.popupMenuTheme`,
  so a menu is the same menu wherever it opens from. A raw `PopupMenuButton` is
  only justified by a documented exception (the theme-manager card's fixed grey
  glyph over a colour preview), and even then it passes `kNeMenuConstraints`.
- **Only five text styles are real.** `UxnanTheme` populates `displayLarge`
  (32/w700), `headlineMedium` (20/w600), `titleSmall` (14/w500), `bodyMedium`
  (14) and `bodySmall` (12); every other `textTheme.*` getter falls through to
  **Flutter's defaults, in a different font family**. So `textTheme.headlineLarge`
  or `labelSmall` silently render in the wrong typeface next to text that is
  right — which reads as "the design broke" long before anyone suspects the
  theme. Build from the five, or add the missing style to
  `_buildTextTheme` + `UxnanTypography` first.
- **Never compare a raw width.** `UxnanBreakpoint` (`presentation/theme/
  breakpoints.dart`) is the single source for what a window size means — its
  margin, its content clamp, whether a permanent side pane fits. A stray
  `width < 600` is how two screens start disagreeing about what a tablet is.
  Screens that own the window use `UxnanBreakpoint.of(context)`; anything that
  can be rendered **inside a pane** must use `UxnanBreakpoint.fromWidth` with its
  own `constraints.maxWidth`, because `MediaQuery` still reports the whole
  window there. `NeScaffold` and `TwoPaneScaffold` already do the latter.
- Prefer current M3 widgets over Material 2 equivalents. Keep modal sheets
  scrollable so they fit short screens (and the 800×600 test window).
- **UI is proposed, not committed unilaterally.** Implement → verify once
  (analyze/test) → present for the user's on-device review → iterate → only then
  is it approved. Don't treat a green analyze as feature-verified.

## Information architecture

- App-level preferences (notifications, theme) belong in a future **Settings**
  screen. **Per-PC / per-thread** surfaces (threads, archived threads, a
  conversation's environment) stay with their device/thread, not in Settings.

## Localization

- Strings live in `l10n/app_en.arb` (template) + `l10n/app_es.arb`. Add the key
  to **both**, then run `flutter gen-l10n`. Use
  `AppLocalizations.of(context).key`. en + es are both required.

## Deferred work & human assets

- **`FOR-DEV:`** — the only allowed form of a deferred-work TODO. Put a greppable
  inline marker at the site and a line in [`../FOR-DEV.md`](../FOR-DEV.md): what,
  where, why. Plain `TODO`/`FIXME` are not allowed.
- **`FOR-HUMAN:`** — assets only a human can provide (fonts, Firebase config,
  signing keys). Marker at the site + a line in
  [`../FOR-HUMAN.md`](../FOR-HUMAN.md). The app must always build/run without
  them (graceful fallback).

## Security (non-negotiable)

- Never store secrets in plaintext — use the OS secure storage
  (`flutter_secure_storage`). Never log secrets. Never weaken TLS.
- Follow the documented E2EE protocol exactly (X25519 + Ed25519 + AES-256-GCM +
  HKDF-SHA256); do not invent crypto variants.
- Validate all input at boundaries (bridge payloads, QR, deep links).

## Commits

- Conventional Commits: `type(scope): message`, imperative, lowercase first
  letter. Mobile scopes: `flutter`, `domain`, `infra`, `ui`, `riverpod`,
  `drift`, `transport`, `e2ee` (plus `mobile` as used in history), and `docs`.
- One commit per logical change — don't mix a feature, a fix and a refactor.
- Do not commit or push without the user's say-so.
