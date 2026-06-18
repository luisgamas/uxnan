import 'dart:ui' show Color;

import 'package:equatable/equatable.dart';

/// A user-selectable accent color (a single seed) from which the entire app
/// `ColorScheme` is derived via `ColorScheme.fromSeed` when the user picks a
/// non-default accent. The default is the brand blue and keeps the
/// hand-tuned palette — the dynamic scheme is only used for the other swatches
/// (see `buildUxnanTheme` in `uxnan_theme.dart`).
///
/// Persistence: only the `id` is stored on-device (`uxnan.appearance.accentId`
/// in `AppearancePreferencesStore`); the seed is resolved from this
/// immutable palette at hydrate time, so adding a swatch later never breaks
/// old saves.
///
/// i18n: the localized label is keyed by `nameKey` in the ARB; the picker
/// looks it up via `AppLocalizations.of(context)`. The keys are stable so a
/// renamed label never breaks a stored accent.
class AccentColorId extends Equatable {
  /// Creates an accent id. The public surface is the static constants and
  /// the `AccentPalette.all` list — callers do not construct new instances.
  const AccentColorId({
    required this.id,
    required this.seed,
    required this.nameKey,
  });

  /// Stable wire/storage id (`blue`, `purple`, …). Treated as opaque by
  /// storage and the picker; the seed is resolved from `AccentPalette.all`.
  final String id;

  /// The M3 HCT seed passed to `ColorScheme.fromSeed` for both light and
  /// dark variants when this accent is active.
  final Color seed;

  /// ARB key for the localized label (e.g. `accentPurple`).
  final String nameKey;

  @override
  List<Object?> get props => [id, seed, nameKey];
}

/// The curated set of accent swatches offered in the personalization screen.
///
/// Seven colors (the brand default + six alternatives) cover the major hue
/// families with M3-friendly chroma (40–60) so each one reads well in both
/// light and dark. Adding or reordering a swatch is additive — the
/// `fromId` parser is tolerant, so an old stored id that no longer exists
/// degrades to [defaultAccent] instead of failing.
class AccentPalette {
  const AccentPalette._();

  /// The brand blue — also the default. Kept hand-tuned in
  /// `UxnanColors`; `buildUxnanTheme` short-circuits to the hand-tuned
  /// palette when this is the active accent, so the visual baseline does
  /// not shift when the user has not picked a different accent.
  static const AccentColorId blue = AccentColorId(
    id: 'blue',
    seed: Color(0xFF1B6EF3),
    nameKey: 'accentBlue',
  );

  /// A vivid purple. Mapped from the OpenCode agent brand color so the
  /// existing palette stays in family.
  static const AccentColorId purple = AccentColorId(
    id: 'purple',
    seed: Color(0xFF7C3AED),
    nameKey: 'accentPurple',
  );

  /// A warm pink. Adds a softer, expressive tone.
  static const AccentColorId pink = AccentColorId(
    id: 'pink',
    seed: Color(0xFFEC4899),
    nameKey: 'accentPink',
  );

  /// A clear red. Strong attention color, useful for high-emphasis flows.
  static const AccentColorId red = AccentColorId(
    id: 'red',
    seed: Color(0xFFEF4444),
    nameKey: 'accentRed',
  );

  /// A balanced orange. Between red and amber in warmth.
  static const AccentColorId orange = AccentColorId(
    id: 'orange',
    seed: Color(0xFFF97316),
    nameKey: 'accentOrange',
  );

  /// A friendly green. Echoes the existing secondary palette.
  static const AccentColorId green = AccentColorId(
    id: 'green',
    seed: Color(0xFF10B981),
    nameKey: 'accentGreen',
  );

  /// A cool teal. Sits between green and blue — distinct from [blue].
  static const AccentColorId teal = AccentColorId(
    id: 'teal',
    seed: Color(0xFF14B8A6),
    nameKey: 'accentTeal',
  );

  /// The default accent — used when no preference has been persisted yet
  /// and as a fallback for any unrecognized id.
  static const AccentColorId defaultAccent = blue;

  /// All swatches, in display order (default first).
  static const List<AccentColorId> all = <AccentColorId>[
    blue,
    purple,
    pink,
    red,
    orange,
    green,
    teal,
  ];

  /// Resolves a stored [id] to an [AccentColorId]. `null`, empty, and
  /// unknown ids all return [defaultAccent] — matching the tolerant
  /// contract used elsewhere in the appearance store.
  static AccentColorId fromId(String? id) {
    if (id == null || id.isEmpty) return defaultAccent;
    for (final accent in all) {
      if (accent.id == id) return accent;
    }
    return defaultAccent;
  }
}
