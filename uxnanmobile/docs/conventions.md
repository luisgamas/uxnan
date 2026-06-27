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
